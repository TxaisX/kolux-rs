// S8 soak: a realistic mixed load for 30 minutes (override: --minutes N). Six panes print a steady modest stream; every
// event period a seventh pane opens and closes, an editor tab opens and closes, and a setting changes. Every 30 s (--interval)
// the app's memory (app + web view), handle count, pane host process count and the page's longest timer gap are sampled.
// Bars: memory slope under 5 MB/min after minute 5 and under +20% over the run, no handle growth trend, 0 orphan processes,
// no page timer gap over 1 s, 0 page errors.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TERM, addProjectAndOpen, appMemMB, fmt, gitInit, handlesOf, installProbe, pageErrors, paneProcs, paneText, seedProfile, slash, snapshot, typeInto } from "./lib.mjs";

export const title = "30-minute soak (6 panes, churn, editor, settings)";
export const seed = seedProfile;
const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : d;
};
const MINUTES = opt("minutes", 30);
const INTERVAL_S = opt("interval", 30);
const EVENT_S = opt("event", 240); // one churn cycle: extra pane, editor tab, setting change
const WARMUP_MIN = Math.min(5, MINUTES / 3);
const PANES = 6;
const GAP_MS = 1000;
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);

// Page timer monitor: 50 ms timer, the longest gap since the last read is returned and reset.
const MONITOR_JS = `(() => {
  if (window.__s8mon) return "already";
  const m = (window.__s8mon = { max: 0, last: performance.now(), n: 0 });
  setInterval(() => { const t = performance.now(); const g = t - m.last; m.last = t; m.n++; if (g > m.max) m.max = g; }, 50);
  return "on";
})()`;
const READ_MONITOR_JS = `(() => { const m = window.__s8mon; if (!m) return null; const r = { max: Math.round(m.max), n: m.n }; m.max = 0; m.n = 0; m.last = performance.now(); return r; })()`;

// Steady modest output: ~2 lines per second, a short colored run now and then.
const SOAK_JS = `let i = 0;
setInterval(() => {
  i++;
  const body = "soak " + process.argv[2] + " line " + i + " " + "abcdefghij".repeat(5);
  console.log(i % 20 === 0 ? "\\x1b[32m" + body + "\\x1b[0m" : body);
}, 500);
`;

// Least-squares slope per minute of (t seconds, value) points.
function slopePerMin(points) {
  const n = points.length;
  if (n < 3) return NaN;
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? NaN : (num / den) * 60;
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const series = (vals) => (vals.length ? `first ${fmt(vals[0], 1)} / min ${fmt(Math.min(...vals), 1)} / max ${fmt(Math.max(...vals), 1)} / last ${fmt(vals[vals.length - 1], 1)}` : "no samples");

// Closes the shown pane that is not printing the soak stream (the extra one) or, with all=true, the last shown pane.
const closeExtra = (all) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const panes = () => [...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null);
  const before = panes().length;
  const pick = ${all ? "panes()[before - 1]" : 'panes().find((e) => !/soak \\d+ line/.test(e.querySelector(".xterm-rows")?.innerText ?? ""))'};
  const b = pick?.querySelector('button[title^="Close pane"]');
  if (!b) return { error: "no pane to close (of " + before + ")" };
  b.click();
  for (let i = 0; i < 150 && panes().length === before; i++) {
    await sleep(20);
    const d = document.querySelector('[role="alertdialog"] .btn-row');
    if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click();
  }
  return panes().length === before ? { error: "close removed no pane" } : { count: panes().length };
})()`;

export async function run({ launch, checks, opts }) {
  const app = await launch("s8");
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s8");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "soak.js"), SOAK_JS);
  await installProbe(app);
  await addProjectAndOpen(app, repo);
  const seen = new Map(); // pane host processes ever seen under the app
  const note = (snap) => {
    for (const p of paneProcs(snap)) seen.set(`${p.pid}|${p.created}`, p);
  };

  const split = async (want) => {
    await app.focusPane(TERM, 0, ".xterm-helper-textarea");
    await app.click('.pane.focused button[title^="Split right"]');
    await app.waitFor(`${want} shell panes`, async () => (await app.shown(TERM)) === want, 30000);
    return {};
  };
  for (let want = 2; want <= PANES; want++) await split(want);
  for (let i = 0; i < PANES; i++) await app.waitFor(`pane ${i + 1}'s input field`, async () => unwrap(await app.evalJs(`!!([...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[${i}]?.querySelector(".xterm-helper-textarea"))`)), 20000);
  await app.sleep(4000); // the shells reach their prompts
  for (let k = 0; k < PANES; k++) await typeInto(app, k, `node '${slash(join(files, "soak.js"))}' ${k}`);
  await app.sleep(4000);
  const fed = [];
  for (let k = 0; k < PANES; k++) fed.push(/soak \d+ line \d+/.test(String(unwrap(await paneText(app, k)) ?? "")));
  checks.add(`${PANES} panes open and each prints its steady stream`, `${PANES} of ${PANES}`, `${fed.filter(Boolean).length} of ${PANES} (${await app.shown(TERM)} shown)`, fed.every(Boolean));
  await app.evalJs(MONITOR_JS);
  await app.sleep(1500);
  await app.evalJs(READ_MONITOR_JS);

  // ---- the soak ----
  const samples = []; // { t, mem, handles, procs, gap, ping }
  const events = []; // what the churn did and what it cost
  const faults = [];
  const t0 = Date.now();
  const total = MINUTES * 60;
  let nextSample = 0;
  let cycle = -1;
  const done = new Set();
  let extraOpen = false;
  let editorOpen = false;
  const due = (key, atS) => !done.has(key) && (Date.now() - t0) / 1000 >= atS && (done.add(key), true);
  const patchTheme = (k) => app.invoke("settings_patch", { set: { theme: k % 2 ? "dark" : "classic" }, remove: [] });

  const closeEditorTab = async () => {
    await app.click('button[title^="Close tab"]');
    await app.sleep(600);
    await app.evalJs(`(() => { const d = document.querySelector('[role="alertdialog"] .btn-row'); if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click(); return "x"; })()`).catch(() => {});
    return {};
  };

  async function sample() {
    const t = Math.round((Date.now() - t0) / 1000);
    const p0 = Date.now();
    let mon = null;
    try {
      mon = unwrap(await app.evalJs(READ_MONITOR_JS));
    } catch (e) {
      faults.push(`t=${t}s page did not answer: ${e.message.slice(0, 100)}`);
    }
    const ping = Date.now() - p0;
    const snap = await snapshot(app);
    note(snap);
    const row = { t, mem: appMemMB(snap), handles: handlesOf(snap), procs: paneProcs(snap).length, gap: mon?.max ?? -1, ping };
    row.ev = events.length;
    samples.push(row);
    if (samples.length % 6 === 1) console.log(`  t=${t}s mem ${fmt(row.mem)} MB handles ${row.handles} paneprocs ${row.procs} gap ${row.gap} ms ping ${ping} ms`);
  }

  while ((Date.now() - t0) / 1000 < total) {
    const el = (Date.now() - t0) / 1000;
    if (el >= nextSample) {
      await sample();
      nextSample += INTERVAL_S;
    }
    for (let k = Math.max(0, cycle); k * EVENT_S <= el && k * EVENT_S < total; k++) {
      cycle = k;
      const base = k * EVENT_S;
      const ev = async (what, f) => {
        const s = Date.now();
        let res;
        try {
          res = unwrap(await f());
        } catch (e) {
          res = { error: e.message.slice(0, 120) };
        }
        events.push({ t: Math.round((s - t0) / 1000), what, ms: Date.now() - s, error: res?.error });
        if (res?.error) faults.push(`t=${Math.round((s - t0) / 1000)}s ${what}: ${res.error}`);
        return res;
      };
      if (due(`pane-open-${k}`, base) && !extraOpen) extraOpen = !(await ev("open 7th pane", () => split(PANES + 1)))?.error;
      if (due(`editor-open-${k}`, base + EVENT_S * 0.25) && !editorOpen) {
        // Go to File is held by a focused terminal, so the keystroke goes to the page body.
        const r = await ev("open notes.txt in the editor", async () => {
          await app.evalJs(`(() => { if (document.activeElement) document.activeElement.blur(); document.body.focus(); })()`);
          await app.cdp("key", "p", "2");
          await app.waitFor("the Go to File picker", () => app.exists('[role="dialog"][aria-label="Open a file"] .picker-input'), 8000, 150);
          await app.focusField('[role="dialog"][aria-label="Open a file"] .picker-input');
          await app.cdp("insert", "notes.txt", "");
          await app.waitFor("the picker lists notes.txt", async () => unwrap(await app.evalJs(`[...document.querySelectorAll('[role="dialog"][aria-label="Open a file"] [role="option"], [role="dialog"][aria-label="Open a file"] .picker-list > *')].some(e => e.textContent.includes("notes.txt"))`)), 15000, 200);
          await app.cdp("key", "Enter", "0");
          await app.waitFor("the editor", async () => unwrap(await app.evalJs(`!!document.querySelector(".cm-editor .cm-content .cm-line")`)), 15000, 200);
          return {};
        });
        editorOpen = !r?.error;
      }
      if (due(`setting-${k}`, base + EVENT_S * 0.4)) await ev("change a setting (theme)", () => patchTheme(k));
      if (due(`editor-close-${k}`, base + EVENT_S * 0.55) && editorOpen) {
        await ev("close the editor tab", closeEditorTab);
        editorOpen = false;
      }
      if (due(`pane-close-${k}`, base + EVENT_S * 0.7) && extraOpen) {
        await ev("close the 7th pane", () => app.evalJs(closeExtra(false)));
        extraOpen = false;
      }
    }
    await app.sleep(1000);
  }
  await sample();

  // ---- wind down: pane output still flowing, then close everything and look for leftovers ----
  const live = [];
  for (let k = 0; k < PANES; k++) live.push(/soak \d+ line \d+/.test(String(unwrap(await paneText(app, k).catch(() => "")) ?? "")));
  // An open editor tab sits in the 7th pane's tab group and hides that shell behind it (App.tsx openFile + terminal pane hidden={p.key !== active}): close the tab first so the shell is shown.
  const hiddenAtEnd = unwrap(await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent === null).length`).catch(() => -1));
  if (editorOpen) await closeEditorTab().catch(() => {});
  await app.sleep(800);
  checks.note(`wind-down start: editor tab open ${editorOpen}, 7th pane open ${extraOpen}, panes hidden before the editor tab was closed ${hiddenAtEnd}, shown after ${await app.shown(TERM)}`);
  const closeLog = [];
  for (let n = 0; n < 12 && (await app.shown(TERM)) > 0; n++) {
    const r = unwrap(await app.evalJs(closeExtra(true)).catch((e) => ({ error: e.message })));
    closeLog.push(r?.error ? "ERR " + r.error : String(r?.count));
    if (r?.error) break;
  }
  await app.sleep(5000);
  const leftPanes = unwrap(await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].map((e) => (e.offsetParent !== null ? "shown " : "hidden ") + (e.getAttribute("aria-label") || e.querySelector(".pane-title,.title")?.textContent || "") + " | " + (e.querySelector(".xterm-rows")?.innerText ?? "").slice(-80).replace(/\s+/g, " "))`).catch(() => []));
  checks.note(`wind-down: closing panes one by one left counts [${closeLog.join(", ")}]; panes still in the page: ${JSON.stringify(leftPanes)}`);
  const after = await snapshot(app);
  note(after);
  const left = paneProcs(after);
  const aliveNow = await app.survivorsOf([...seen.values()]);
  const inTree = new Set(after.map((p) => p.pid));
  const orphans = aliveNow.filter((p) => !inTree.has(p.pid));

  // ---- verdicts ----
  const post = samples.filter((s) => s.t >= WARMUP_MIN * 60);
  const memSlope = slopePerMin(post.map((s) => [s.t, s.mem]));
  const handleSlope = slopePerMin(post.map((s) => [s.t, s.handles]));
  const win = Math.max(2, Math.floor(post.length / 4));
  const memStart = median(post.slice(0, win).map((s) => s.mem));
  const memEnd = median(post.slice(-win).map((s) => s.mem));
  const hStart = median(post.slice(0, win).map((s) => s.handles));
  const hEnd = median(post.slice(-win).map((s) => s.handles));
  const worstGap = Math.max(...samples.map((s) => s.gap));
  const overGap = samples.filter((s) => s.gap > GAP_MS);
  const pingMax = Math.max(...samples.map((s) => s.ping));
  const incon = post.length < 8; // a short debug run cannot judge a slope
  const mems = samples.map((s) => s.mem);
  const hs = samples.map((s) => s.handles);

  checks.add("soak ran for the full duration with every sample answered", `${MINUTES} min, a sample every ${INTERVAL_S} s, page always answers`, `${samples.length} samples over ${total} s; ${faults.length} faults${faults.length ? `: ${faults.slice(0, 4).join(" || ")}` : ""}; slowest CDP answer ${pingMax} ms`, faults.length === 0 && samples.length >= Math.floor(total / INTERVAL_S));
  checks.add("memory growth slope after the first 5 minutes (app + web view working set)", "< 5 MB/min", `${fmt(memSlope, 2)} MB/min over ${post.length} samples; series MB ${series(mems)}`, memSlope < 5, incon);
  checks.add("memory growth over the run (median of first vs last quarter after warm-up)", "< +20%", `${fmt(memStart)} -> ${fmt(memEnd)} MB (${fmt(((memEnd - memStart) / memStart) * 100, 1)}%)`, (memEnd - memStart) / memStart < 0.2, incon);
  checks.add("handle count trend (app + web view processes)", "no growth trend: slope <= 5 handles/min and median grows < 5%", `slope ${fmt(handleSlope, 2)}/min; ${fmt(hStart)} -> ${fmt(hEnd)} (${fmt(((hEnd - hStart) / hStart) * 100, 1)}%); series ${series(hs)}`, handleSlope <= 5 && (hEnd - hStart) / hStart < 0.05, incon);
  checks.add("pane host processes in the app's tree after every pane is closed", "0", `${left.length}${left.length ? ` (${left.map((p) => p.name).join(", ")})` : ""}; peak in a sample ${Math.max(...samples.map((s) => s.procs))}`, left.length === 0);
  checks.add("orphan shell / console host processes (seen under the app, alive, no longer its children)", "0", `${orphans.length}${orphans.length ? ` (${app.byName(orphans)})` : ""} of ${seen.size} ever seen`, orphans.length === 0);
  await app.killAll(orphans); // cleanup, not the check
  checks.add("longest page timer gap in any 30 s window (50 ms timer, including churn events)", `<= ${GAP_MS} ms`, `worst ${worstGap} ms; windows over the bar: ${overGap.length}${overGap.length ? ` [${overGap.slice(0, 6).map((s) => `t=${s.t}s ${s.gap}ms`).join(", ")}]` : ""}; median ${fmt(median(samples.map((s) => s.gap)))} ms`, worstGap <= GAP_MS);
  checks.add("the six panes were still printing at the end", `${PANES} of ${PANES}`, `${live.filter(Boolean).length} of ${PANES}`, live.every(Boolean));
  const errs = await pageErrors(app).then(unwrap).catch(() => []);
  checks.add("page errors (window error, unhandled rejection, console.error) during the run", "0", `${errs.length}${errs.length ? `: ${[...new Set(errs)].slice(0, 5).join(" || ")}` : ""}`, errs.length === 0);

  writeFileSync(join(opts.root, "evidence", "stress-s8-samples.csv"), "t,memMB,handles,paneProcs,gapMs,pingMs,eventsSoFar\n" + samples.map((r) => [r.t, r.mem.toFixed(1), r.handles, r.procs, r.gap, r.ping, r.ev].join(",")).join("\n") + "\n");
  const steps = samples.slice(1).map((r, i) => ({ t: r.t, d: r.handles - samples[i].handles, ev: events.slice(samples[i].ev ?? 0, r.ev).map((e) => e.what + "@" + e.t + "s").join(", ") })).filter((x) => Math.abs(x.d) >= 40);
  checks.note(`handle steps of 40 or more between samples: ${steps.map((x) => `t=${x.t}s ${x.d > 0 ? "+" : ""}${x.d} [${x.ev || "no event"}]`).join("; ") || "none"}`);
  const evErr = events.filter((e) => e.error).length;
  checks.note(`churn events ${events.length} (${evErr} failed): ${events.slice(0, 9).map((e) => `${e.t}s ${e.what} ${e.ms}ms${e.error ? " ERR" : ""}`).join("; ")}${events.length > 9 ? "; ..." : ""}`);
  checks.note(`sample series (t s: MB / handles / pane procs / gap ms): ${samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 12)) === 0 || i === samples.length - 1).map((s) => `${s.t}: ${fmt(s.mem)}/${s.handles}/${s.procs}/${s.gap}`).join(" | ")}`);
  const spikes = [...samples].sort((a, b) => b.gap - a.gap).slice(0, 3).map((s) => `t=${s.t}s ${s.gap}ms`);
  checks.note(`worst three timer gaps: ${spikes.join(", ")}`);
}
