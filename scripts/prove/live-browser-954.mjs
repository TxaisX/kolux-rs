// LIVE re-proof of browser row 954 (MERGE 407): a tab that closes itself is rebuilt, with a cap, without focus, in its own profile.
// node live-browser-954.mjs [items...]   items: 1 2 3 4 5 6 7 8 9 10 (default all). Loopback pages only, no real agent.
// Writes G:/Temp/live-v11-logs/BROW954.out.txt and BROW954-items.json; with no item filter it appends the dated section to evidence/browser-954b.txt.
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, poll, checker, LIVE_LOGS } from "./live-proj-common.mjs";
import { ROOT } from "./live-common.mjs";
import { runCli } from "./live-cli-common.mjs";
import { pageTarget, targets, targetEval } from "./live-browser-common.mjs";

const run = promisify(execFile);
const DATE = "2026-10-28";
const want = process.argv.slice(2).map(Number);
const on = (n) => want.length === 0 || want.includes(n);
const TABS = "div[role=tablist][aria-label=Tabs] div[role=tab]";

const rep = reporter();
const { log } = rep;
const chk = checker(log);
const hitLog = [];
const counts = {};

/** One loopback server per port. /loop pages self-close through a popup; see the query keys below. */
function serve(tag, ports) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const q = u.searchParams;
    if (u.pathname === "/favicon.ico") return res.writeHead(404).end();
    const kase = q.get("case") ?? "-";
    const pop = q.get("role") === "pop";
    const key = `${kase}${pop ? ":pop" : ""}`;
    const n = (counts[key] = (counts[key] ?? 0) + 1);
    hitLog.push({ t: Date.now(), tag, path: u.pathname, kase, pop, n, cookie: req.headers.cookie ?? "" });
    const headers = { "content-type": "text/html", "cache-control": "no-store" };
    const set = q.get("set");
    if (set && !pop) headers["set-cookie"] = `${set}=1; Path=/; Max-Age=3600`;
    if (u.pathname !== "/loop") return res.writeHead(200, headers).end(`<!doctype html><title>${u.pathname}</title><p>${u.pathname}</p><script>window.__token=Math.random()</script>`);
    const pk = q.get("pk") ?? "co";
    let script;
    if (pop) script = `setTimeout(()=>{${{ co: "window.close.call(opener)", xo: "opener.close()", own: "window.close()" }[pk]}},${Number(q.get("pd") ?? 0)})`;
    else {
      const ms = Number(q.get("ms") ?? 1000);
      const first = q.get("first");
      const delay = n === 1 && first !== null ? Number(first) : ms;
      const max = Number(q.get("max") ?? 1);
      const popBase = pk === "xo" ? ports.b : ports.a;
      const popUrl = `${popBase}/loop?case=${kase}&role=pop&pk=${pk}&pd=${q.get("pd") ?? 0}`;
      script = n <= max ? `window.__st='armed';setTimeout(function go(){window.__st='fired';try{const w=window.open(${JSON.stringify(popUrl)},'','width=400,height=300');window.__st+=w?':opened':':null';if(!w&&${pk === "own" ? 0 : 1})setTimeout(go,500)}catch(e){window.__st+=':err '+e}},${delay})` : "";
    }
    res.writeHead(200, headers).end(`<!doctype html><title>loop ${kase}</title><p>${kase} ${pop ? "popup" : "tab"} #${n}</p><script>window.__token=Math.random();${script ?? ""}</script>`);
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port })));
}

const hitsOf = (kase, pop = false) => hitLog.filter((h) => h.kase === kase && h.pop === pop);
const results = [];
const out = (item, verdict, text, shot) => {
  const line = `item ${item}: ${verdict} - ${text}${shot ? ` [screenshot ${shot}]` : ""}`;
  log(line);
  results.push({ item, verdict, text, shot, line });
};

const A_RE = (kase) => new RegExp(`^http://127\\.0\\.0\\.1:\\d+/loop\\?case=${kase}&(?!role=pop)`);
const tabPage = (kase) => pageTarget(A_RE(kase));

async function main(ctx, urls) {
  const { app } = ctx;
  const { a, b } = urls;
  const root = `${ctx.TEMP}`;
  const cli = async (args, o = {}) => {
    await toShell();
    const r = await runCli(ctx, args, { pane: 0, ...o });
    log(`kolux-dev ${args} -> exit ${r.exit} ${r.raw.replace(/\s+/g, " ").slice(0, 260)}`);
    return r;
  };
  const clickTab = (i) => app.evalJs(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(TABS)})][${i}]; if (!t) return null; t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); t.click(); return t.textContent.trim(); })()`);
  const toShell = async () => {
    if ((await app.shown('section.pane[data-agent="shell"]')) >= 1) return;
    await clickTab(0);
    await sleep(500);
  };
  const showTab = (kase) => app.evalJs(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(TABS)})].find((x) => x.textContent.includes(${JSON.stringify("loop " + kase)})); if (!t) return null; t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); t.click(); return t.textContent.trim(); })()`);
  const idOf = (j) => Number(j?.page ?? j?.id ?? j?.tab?.page ?? j?.tab?.id ?? NaN);
  const create = async (url, profile) => {
    const r = await cli(`tab create --url '${url}'${profile ? ` --profile ${profile}` : ""}`);
    return { ...r, id: idOf(r.json) };
  };
  const paneSel = (id) => `section.pane.browser[data-key="${id}"]`;
  const paneAlerts = async (id) =>
    JSON.parse(await app.evalJs(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(paneSel(id) + " [role=alert]")})].map(a => a.innerText.replace(/\\s+/g, " ").trim()).filter(Boolean))`));
  const allAlerts = async () =>
    JSON.parse(await app.evalJs(`JSON.stringify([...document.querySelectorAll("section.pane.browser [role=alert]")].map(a => a.innerText.replace(/\\s+/g, " ").trim()).filter(Boolean))`));
  /** Polls until cond() is truthy or ms pass; every alert text seen on the way is collected. */
  const logSince = async (t0) => JSON.parse(await app.evalJs("JSON.stringify((window.__alog || []).filter(x => x.at >= " + t0 + ").map(x => x.t))").catch(() => "[]"));
  const watch = async (cond, ms, seen = new Set()) => {
    const t0 = Date.now();
    const done = async (ok) => { for (const x of await logSince(t0 - 100)) seen.add(x); return { ok, ms: Date.now() - t0, seen: [...seen] }; };
    for (;;) {
      for (const x of await allAlerts().catch(() => [])) seen.add(x);
      const v = await cond();
      if (v) return done(v);
      if (Date.now() - t0 > ms) return done(false);
      await sleep(120);
    }
  };
  const retry = (id) => app.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(paneSel(id) + " button[data-go=retry]")}); if (!b) return false; b.click(); return true; })()`);
  const list = async () => ((await cli("tab list --show-profile")).json);
  const rowOf = async (id) => {
    const j = await list();
    const rows = Array.isArray(j) ? j : (j?.tabs ?? j?.pages ?? []);
    return rows.find((r) => Number(r.page ?? r.id) === id) ?? null;
  };
  const closeTab = (id) => cli(`tab close --page ${id}`);
  const pstore = () => {
    const f = findFile(root, "browser-profiles.json");
    return { file: f, data: f ? JSON.parse(readFileSync(f, "utf8")) : null };
  };
  const mainFocus = () => app.evalJs(`JSON.stringify({ doc: document.hasFocus(), el: (document.activeElement?.tagName ?? "") + "|" + (document.activeElement?.getAttribute?.("aria-label") ?? "") })`);
  const shotName = (n) => ctx.shot(`BROW954-${n}`);
  const dumps = () => walk(root).filter((p) => /\.dmp$/i.test(p) || /crashpad[\\/]reports[\\/]/i.test(p)).length;
  const renderers = async () => {
    const tree = [app.pid, ...(await app.treeOf(app.pid)).map((p) => p.pid)];
    const { stdout } = await run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { @(${tree.join(",")}) -contains $_.ProcessId -and $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match '--type=renderer' } | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.KernelModeTime + $_.UserModeTime)" }`]);
    return stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [pid, ppid, cpu] = l.split(" ").map(Number); return { pid, ppid, cpu }; });
  };
  /** Finds the renderer behind the tab page matching re by spinning that page, then kills it. */
  const killTabRenderer = async (re) => {
    const c0 = await renderers();
    const spin = targetEval(re, "(() => { const e = Date.now() + 3500; while (Date.now() < e) {} return 1; })()", 9000).catch(() => null);
    await sleep(1500);
    const c1 = await renderers();
    await spin;
    const d = c1.map((r) => ({ pid: r.pid, ms: ((r.cpu - (c0.find((x) => x.pid === r.pid)?.cpu ?? r.cpu)) / 10000) | 0 })).sort((x, y) => y.ms - x.ms);
    if (!(d[0]?.ms > 800 && (d[1]?.ms ?? 0) < 300)) return { killed: false, why: JSON.stringify(d) };
    await sleep(2200);
    if (!(await renderers()).some((r) => r.pid === d[0].pid)) return { killed: false, why: "victim not an app renderer" };
    await run("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${d[0].pid} -Force`]);
    return { killed: true, pid: d[0].pid, deltas: JSON.stringify(d) };
  };
  const cookieHas = (h, name) => new RegExp(`(^|;\\s*)${name}=`).test(h.cookie);

  const q = (kase, extra = "") => `${a}/loop?case=${kase}&${extra}`;
  // the CLI needs one browser tab opened by the user first (the app learns its data folder from it)
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await app.waitFor("a New Tab browser pane", () => app.exists('section.pane.browser[aria-label="New Tab pane"]'), 20000);
  await sleep(2500);
  await app.evalJs(`(() => { if (window.__alog) return; window.__alog = []; const rec = () => { for (const a of document.querySelectorAll("section.pane.browser [role=alert]")) { const t = a.innerText.replace(/\\s+/g, " ").trim(); const k = a.closest("section.pane.browser")?.dataset.key ?? ""; if (t && !window.__alog.some(x => x.t === t && x.k === k && Date.now() - x.at < 3000)) window.__alog.push({ at: Date.now(), k, t }); } }; new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); setInterval(rec, 100); })()`);
  const baseline = { renderers: (await renderers()).length, dumps: dumps() };
  log(`baseline renderers ${baseline.renderers}, dump files ${baseline.dumps}`);

  // ---- item 1: steps 1, 4, 5
  if (on(1)) {
    try {
      const t0 = Date.now();
      const c = await create(q("one", "ms=800&max=1&pk=co"));
      const w = await watch(() => hitsOf("one").length >= 2, 20000);
      const notice = w.seen.find((s) => /closed itself; Kolux reopened it/.test(s));
      const stopped = w.seen.find((s) => /stopped responding/i.test(s));
      const row = await rowOf(c.id);
      const url2 = row?.url ?? "";
      const pops = hitsOf("one", true).length;
      const lat = hitsOf("one")[1] ? hitsOf("one")[1].t - hitsOf("one")[0].t : null;
      const seen2 = await watch(() => allAlerts().then((x) => x.some((s) => /reopened it/.test(s))), 6000, new Set(w.seen));
      const notice2 = notice ?? seen2.seen.find((s) => /closed itself; Kolux reopened it/.test(s));
      const shot = await shotName("item1a");
      out("1a step 1 (popup closes the tab via window.close.call(opener))",
        hitsOf("one").length === 2 && notice2 && !stopped && /case=one/.test(url2) ? "PASS" : "FAIL",
        `tab id ${c.id}, loads ${hitsOf("one").length}, popup loads ${pops}, tab url after ${url2.slice(0, 80)}, load-to-reload ${lat} ms, notice ${JSON.stringify(notice2 ?? null)}, stopped-responding overlay ${stopped ?? "none"}`, shot);
      await closeTab(c.id);

      const c4 = await create(q("own", "ms=800&max=1&pk=own"));
      await watch(() => hitsOf("own", true).length >= 1, 15000);
      const w4 = await watch(() => false, 4500);
      const tok = await targetEval(A_RE("own"), "window.__token", 4000).catch(() => null);
      const popTarget = (await targets()).filter((t) => /role=pop/.test(t.url) && /case=own/.test(t.url));
      out("1b step 4 (a popup's own window.close() just closes it)",
        hitsOf("own").length === 1 && !w4.seen.some((s) => /closed itself/.test(s)) && tok !== null ? "PASS" : "FAIL",
        `tab loads ${hitsOf("own").length}, popup loads ${hitsOf("own", true).length}, notices ${JSON.stringify(w4.seen)}, tab page still alive (token ${tok !== null}), popup targets left ${popTarget.length}`, await shotName("item1b"));
      await closeTab(c4.id);

      const c5 = await create(q("xo", "ms=800&max=1&pk=xo"));
      const w5 = await watch(() => hitsOf("xo").length >= 2, 20000);
      const n5 = w5.seen.find((s) => /closed itself; Kolux reopened it/.test(s)) ?? (await watch(() => false, 3000, new Set(w5.seen))).seen.find((s) => /reopened it/.test(s));
      out("1c step 5 (cross-origin popup runs opener.close())",
        hitsOf("xo").length === 2 && n5 ? "PASS" : "FAIL",
        `tab loads ${hitsOf("xo").length}, popup loads (other port) ${hitsOf("xo", true).length}, notice ${JSON.stringify(n5 ?? null)}`, await shotName("item1c"));
      await closeTab(c5.id);
    } catch (e) { out("1", "FAIL", `error ${e.message}`); }
  }

  // ---- item 2: fast rebuild cap
  if (on(2)) {
    try {
      const c = await create(q("fast", "ms=1500&max=3&pk=co"));
      const w = await watch(async () => (await paneAlerts(c.id)).some((s) => /keeps closing itself/.test(s)), 30000);
      const loadsClosed = hitsOf("fast").length;
      const target = await tabPage("fast");
      const shotClosed = await shotName("item2-closed");
      await sleep(12000);
      const loadsAfter = hitsOf("fast").length;
      const pressed = await retry(c.id);
      const w2 = await watch(() => hitsOf("fast").length > loadsAfter, 20000);
      await sleep(4000);
      const stable = await watch(() => false, 1, new Set());
      const alertsEnd = await paneAlerts(c.id);
      out("2 (fast cap: 3rd close within 10 s stays closed; Retry reopens)",
        w.ok && loadsClosed === 3 && loadsAfter === 3 && pressed && w2.ok && !alertsEnd.some((s) => /keeps closing/.test(s)) ? "PASS" : "FAIL",
        `closed notice after ${w.ms} ms with ${loadsClosed} loads; page target after close ${target ? "STILL THERE" : "gone"}; loads 12 s later ${loadsAfter}; Retry pressed ${pressed}; loads after Retry ${hitsOf("fast").length}; alerts at end ${JSON.stringify(alertsEnd)}; notices seen ${JSON.stringify(w.seen)}`, shotClosed);
      await closeTab(c.id);
    } catch (e) { out("2", "FAIL", `error ${e.message}`); }
  }

  // ---- item 3: 5.1 s cadence
  if (on(3)) {
    try {
      const d0 = dumps();
      const r0 = (await renderers()).length;
      const c = await create(q("slow", "ms=5100&first=200&max=99&pk=co"));
      const w = await watch(async () => (await paneAlerts(c.id)).some((s) => /keeps closing itself/.test(s)), 40000);
      const hs = hitsOf("slow");
      const times = hs.map((h) => h.t - hs[0].t);
      const shotClosed = await shotName("item3-closed");
      const nAt = hitLog.length;
      await sleep(30000);
      const later = hitLog.slice(nAt).filter((h) => h.kase === "slow");
      const target = await tabPage("slow");
      const popLeft = (await targets()).filter((t) => /case=slow/.test(t.url)).length;
      const r1 = (await renderers()).length;
      const gaps = times.slice(1).map((t, i) => t - times[i]);
      const okGaps = gaps.length >= 3 && gaps.slice(1, 3).every((g) => g > 4500 && g < 7500);
      out("3 (5.1 s cadence: three rebuilds, closed on the 4th; nothing after; no crash report)",
        w.ok && hs.length === 4 && okGaps && later.length === 0 && !target && popLeft === 0 && dumps() === d0 ? "PASS" : "FAIL",
        `tab loads ${hs.length} at ${JSON.stringify(times)} ms (gaps ${JSON.stringify(gaps)}); closed notice after ${w.ms} ms; server hits in the 30 s after the close: ${later.length}; page/popup targets left ${target ? 1 : 0}/${popLeft}; renderers ${r0} -> ${r1} (baseline ${baseline.renderers}); crash/dump files ${d0} -> ${dumps()}; notices seen ${JSON.stringify(w.seen).slice(0, 500)}`, shotClosed);
      await closeTab(c.id);
    } catch (e) { out("3", "FAIL", `error ${e.message}`); }
  }

  // ---- item 4: focus (shown and hidden) and the user click
  if (on(4)) {
    try {
      // probe: open a self-closing page, show it, put the keyboard in the address field, watch the rebuild
      const probe = async (kase, pk) => {
        const c = await create(q(kase, `ms=4000&max=1&pk=${pk}`));
        await showTab(kase);
        await sleep(600);
        await app.focusField(`${paneSel(c.id)} input[aria-label="Address"]`).catch(() => {});
        const before = await mainFocus();
        const hasBefore = await targetEval(A_RE(kase), "document.hasFocus()", 4000).catch(() => "n/a");
        const w = await watch(() => (pk === "own" ? hitsOf(kase, true).length >= 1 : hitsOf(kase).length >= 2), 20000);
        await sleep(2500);
        const after = await mainFocus();
        const hasAfter = await targetEval(A_RE(kase), "document.hasFocus()", 4000).catch(() => "n/a");
        return { c, before, after, hasBefore, hasAfter, w };
      };
      const own = await probe("fown", "own");
      await closeTab(own.c.id);
      const p = await probe("fshow", "co");
      const shotShown = await shotName("item4-shown");
      await toShell();
      await sleep(500);
      await showTab("fshow"); // a user click on the strip tab
      await sleep(1200);
      const click = await targetEval(A_RE("fshow"), "document.hasFocus()", 4000).catch(() => "n/a");
      const mainClick = await mainFocus();
      const drop = (x) => x.before !== x.after;
      out("4a (no focus on rebuild, shown tab; a user click still focuses)",
        p.w.ok && p.hasAfter === false && p.before === p.after ? (click === true ? "PASS" : "PARTIAL") : "FAIL",
        `rebuild: main focus before ${p.before} after ${p.after}; tab page hasFocus before ${p.hasBefore} after ${p.hasAfter}; rebuilt ${p.w.ok}. control (popup closes itself, no rebuild): main focus before ${own.before} after ${own.after} (changed ${drop(own)}). after a user click on the strip tab: ${click} (main then ${mainClick})`, shotShown);
      await closeTab(p.c.id);

      // popup opens while the tab is shown (a hidden page cannot open one), then the tab is hidden before the popup closes it
      const h = await create(q("fhid", "ms=600&max=1&pk=co&pd=7000"));
      await watch(() => hitsOf("fhid", true).length >= 1, 10000);
      await toShell();
      await app.focusField('section.pane[data-agent="shell"] .xterm-helper-textarea').catch(() => {});
      await sleep(1000);
      const other = { id: null };
      const hb = await mainFocus();
      const hiddenBefore = await app.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(paneSel(h.id))}); return !p || p.hidden || p.clientWidth === 0 })()`);
      const wh = await watch(() => hitsOf("fhid").length >= 2, 25000);
      const popN = hitsOf("fhid", true).length;
      const vis = await targetEval(A_RE("fhid"), "document.visibilityState + ' st=' + window.__st", 3000).catch(() => "n/a");
      await sleep(1500);
      const ha = await mainFocus();
      const hiddenAfter = await app.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(paneSel(h.id))}); return !p || p.hidden || p.clientWidth === 0 })()`);
      const hf = await targetEval(A_RE("fhid"), "document.hasFocus()", 4000).catch(() => "n/a");
      // the same tab shown again later must rebuild if the hidden one never did
      let late = null;
      if (!wh.ok) { await showTab("fhid"); late = (await watch(() => hitsOf("fhid").length >= 2, 15000)).ok; late = `${late} (page then ${await targetEval(A_RE("fhid"), "document.visibilityState + ' st=' + window.__st", 3000).catch(() => "n/a")})`; }
      out("4b (no focus on rebuild, hidden tab; it stays hidden)",
        wh.ok && hiddenBefore && hiddenAfter && hf === false && JSON.parse(hb).el === JSON.parse(ha).el ? "PASS" : "FAIL",
        `rebuilt while hidden ${wh.ok} (loads ${hitsOf("fhid").length}, popup hits ${popN}, page visibilityState ${vis}); rebuilt once shown again ${late}; pane hidden before/after ${hiddenBefore}/${hiddenAfter}; rebuilt page hasFocus ${hf}; main focus before ${hb} after ${ha} (only the focused element is compared: the document flag flips with the popup window, see 4a control); notices ${JSON.stringify(wh.seen)}`, await shotName("item4-hidden"));
      await closeTab(h.id);
      } catch (e) { out("4", "FAIL", `error ${e.stack ?? e.message}`); }
  }

  // ---- items 5, 6 (profiles: N1 reused id, BROW-009)
  let workId = null;
  if (on(5) || on(6) || on(7)) {
    try {
      const pc = await cli("profiles create --label work");
      const rBefore = (await renderers()).map((r) => r.pid);
      const wtab = await create(q("wk", "ms=999999&max=0&set=work"), "work");
      workId = wtab.id;
      await sleep(2500);
      const workRend = (await renderers()).filter((r) => !rBefore.includes(r.pid));
      log(`renderers added by the work tab: ${JSON.stringify(workRend.map((r) => r.pid))}`);
      const rowW = await rowOf(wtab.id);
      log(`work tab ${wtab.id} row ${JSON.stringify(rowW)}; profiles create exit ${pc.exit}`);
      if (on(5)) {
        // seed stale "work" rows for the ids the next tabs will take (ids are not reused in one session)
        const st = pstore();
        if (!st.file) throw new Error("browser-profiles.json not found");
        const next = wtab.id + 1;
        const tabs = { ...(st.data.tabs ?? {}) };
        for (let i = 0; i < 6; i++) tabs[String(next + i)] = "work";
        writeFileSync(st.file, JSON.stringify({ ...st.data, tabs }, null, 2));
        log(`seeded work rows for ids ${next}..${next + 5} in ${st.file.replace(/\\/g, "/").split("/").slice(-3).join("/")}`);
        const n1 = await create(q("n1", "ms=1500&max=1&set=n1&pk=co"));
        const w = await watch(() => hitsOf("n1").length >= 2, 20000);
        await sleep(1500);
        const row1 = await rowOf(n1.id);
        const st2 = pstore();
        const hs = hitsOf("n1");
        const noWork = hs.every((h) => !cookieHas(h, "work"));
        const reuse = n1.id === next;
        const afterRebuild = row1?.profile;
        // crash + Retry
        await showTab("n1"); await sleep(1000);
        const kr = await killTabRenderer(A_RE("n1"));
        let recovered = false;
        let retried = false;
        if (kr.killed) {
          const base = hitsOf("n1").length;
          const w2 = await watch(async () => {
            if (hitsOf("n1").length > base) return true;
            if (await retry(n1.id)) retried = true;
            return false;
          }, 30000);
          recovered = w2.ok;
        }
        const row2 = await rowOf(n1.id);
        const noWork2 = hitsOf("n1").every((h) => !cookieHas(h, "work"));
        out("5 (N1: reused id opens in default; self-close rebuild and crash+Retry stay default)",
          reuse && w.ok && afterRebuild === "default" && noWork && kr.killed && recovered && row2?.profile === "default" && noWork2 && st2.data?.tabs?.[String(n1.id)] !== "work" ? "PASS" : "FAIL",
          `new tab id ${n1.id} (seeded stale work row for it: ${reuse}); profile after open+rebuild ${afterRebuild}; loads ${hitsOf("n1").length}; "work" cookie sent on any load ${!noWork2}; renderer kill ${JSON.stringify(kr)}; recovered ${recovered} (Retry pressed ${retried}); profile after crash ${row2?.profile}; row in browser-profiles.json after ${JSON.stringify(st2.data?.tabs?.[String(n1.id)] ?? null)}`, await shotName("item5"));
        await closeTab(n1.id);
      }
      if (on(6)) {
        const base = hitsOf("wk").length;
        const shW = await showTab("wk"); await sleep(1500); log(`wk show ${shW}; page ${await targetEval(A_RE("wk"), "document.visibilityState + ' ' + document.hasFocus()", 4000).catch((e) => "err " + e.message)}; tabs ${JSON.stringify((await targets()).filter((x) => x.type === "page").map((x) => x.url.slice(0, 60)))}`);
        // the work profile runs in its own WebView2 environment, absent from the CDP port: take the renderer it added
        const alive = (await renderers()).filter((r) => workRend.some((w) => w.pid === r.pid));
        let kr = { killed: false, why: `work renderers added ${workRend.length}, alive ${alive.length}` };
        if (alive.length === 1) { await run("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${alive[0].pid} -Force`]); kr = { killed: true, pid: alive[0].pid, via: "renderer added by opening the work tab" }; }
        let retried = false;
        let ok = false;
        if (kr.killed) {
          const w = await watch(async () => {
            if (hitsOf("wk").length > base) return true;
            if (await retry(wtab.id)) retried = true;
            return false;
          }, 30000);
          ok = w.ok;
        }
        await sleep(1500);
        const row = await rowOf(wtab.id);
        const last = hitsOf("wk").slice(-1)[0];
        // and a self-closing work tab keeps work through the rebuild
        const ws = await create(q("ws", "ms=1500&max=1&pk=co"), "work");
        const w3 = await watch(() => hitsOf("ws").length >= 2, 20000);
        const rowS = await rowOf(ws.id);
        const hs = hitsOf("ws");
        out("6 (BROW-009: a real work tab keeps work through a renderer kill, Retry and a self-close)",
          kr.killed && ok && row?.profile === "work" && last && cookieHas(last, "work") && w3.ok && rowS?.profile === "work" && hs[1] && cookieHas(hs[1], "work") ? "PASS" : "FAIL",
          `renderer kill ${JSON.stringify(kr)}; recovered ${ok} (Retry pressed ${retried}); profile after ${row?.profile}; "work" cookie on the reload ${last ? cookieHas(last, "work") : "n/a"}; self-closing work tab ${ws.id}: loads ${hs.length}, profile after ${rowS?.profile}, cookie on rebuild ${hs[1] ? cookieHas(hs[1], "work") : "n/a"}`, await shotName("item6"));
        await closeTab(ws.id);
      }
      if (on(7)) {
        await cli("profiles create --label alt");
        const f1 = `${root}/cli/p7a.txt`;
        const f2 = `${root}/cli/p7b.txt`;
        const done = `${root}/cli/p7.done`;
        rmSync(done, { force: true });
        await toShell();
        const body = (u, p, f) => `kolux-dev tab create --url '${u}' --profile ${p} --json > '${f}' 2>&1`;
        const line = `$j1 = Start-Job { ${body(q("pa", "ms=2500&max=1&set=ck&pk=co"), "work", f1)} }; $j2 = Start-Job { ${body(q("pb", "ms=2500&max=1&set=ck&pk=co"), "alt", f2)} }; Wait-Job $j1,$j2 | Out-Null; 'done' | Out-File -Encoding ascii '${done}'`;
        await ctx.typeInto(0, line, 'section.pane[data-agent="shell"]');
        const got = await poll(() => existsSync(done), 60000, 400);
        const read = (f) => { try { const b = readFileSync(f); return (b[0] === 0xff ? b.toString("utf16le") : b.toString("utf8")).replace(/^﻿/, ""); } catch { return ""; } };
        const ja = (() => { try { const j = JSON.parse(read(f1)); return j.result ?? j; } catch { return null; } })();
        const jb = (() => { try { const j = JSON.parse(read(f2)); return j.result ?? j; } catch { return null; } })();
        const ia = idOf(ja);
        const ib = idOf(jb);
        // a hidden page cannot open its popup (4b), so show each one until its popup opened
        await showTab("pa"); await watch(() => hitsOf("pa", true).length >= 1, 12000);
        await showTab("pb"); await watch(() => hitsOf("pb", true).length >= 1, 12000);
        await watch(() => hitsOf("pa").length >= 2 && hitsOf("pb").length >= 2, 25000);
        await sleep(1000);
        const ra = await rowOf(ia);
        const rb = await rowOf(ib);
        const ha = hitsOf("pa");
        const hb = hitsOf("pb");
        out("7 (two tab create --profile at once keep their own profiles, also after a self-close)",
          got && ia !== ib && ra?.profile === "work" && rb?.profile === "alt" && ha.length >= 2 && hb.length >= 2 ? "PASS" : "FAIL",
          `ids ${ia}/${ib}; profiles after rebuild ${ra?.profile}/${rb?.profile}; loads ${ha.length}/${hb.length}; create outputs ${read(f1).replace(/\s+/g, " ").slice(0, 120)} | ${read(f2).replace(/\s+/g, " ").slice(0, 120)}`, await shotName("item7"));
        await closeTab(ia);
        await closeTab(ib);
      }
      if (workId) await closeTab(workId);
    } catch (e) { out("5/6/7", "FAIL", `error ${e.stack ?? e.message}`); }
  }

  // ---- item 8: ghost profile
  if (on(8)) {
    try {
      const c = await create(q("gh", "ms=9000&max=1&pk=co"));
      await sleep(800);
      const st = pstore();
      if (!st.file) throw new Error("browser-profiles.json not found");
      writeFileSync(st.file, JSON.stringify({ ...st.data, tabs: { ...(st.data.tabs ?? {}), [String(c.id)]: "ghost" } }, null, 2));
      const w = await watch(() => hitsOf("gh").length >= 2, 30000);
      await sleep(1500);
      const row = await rowOf(c.id);
      const st2 = pstore();
      out("8 (a row naming profile ghost rebuilds in default and the row is gone)",
        w.ok && row?.profile === "default" && st2.data?.tabs?.[String(c.id)] === undefined ? "PASS" : "FAIL",
        `loads ${hitsOf("gh").length}; profile after ${row?.profile}; row in browser-profiles.json after ${JSON.stringify(st2.data?.tabs?.[String(c.id)] ?? null)}`, await shotName("item8"));
      await closeTab(c.id);
    } catch (e) { out("8", "FAIL", `error ${e.message}`); }
  }

  // ---- item 9: profile commands
  if (on(9)) {
    try {
      const steps = [];
      const t = await create(`${a}/ok`);
      const mk = await cli("profiles create --label p9");
      steps.push(["profiles create", mk.exit === 0]);
      const set = await cli(`tab profile set --profile p9 --page ${t.id}`);
      steps.push(["tab profile set", set.exit === 0 && (await rowOf(t.id))?.profile === "p9"]);
      const cl = await cli(`tab profile clone --page ${t.id}`);
      steps.push(["tab profile clone", cl.exit === 0]);
      const ud = await cli(`tab profile use-default --page ${t.id}`);
      steps.push(["tab profile use-default", ud.exit === 0 && (await rowOf(t.id))?.profile === "default"]);
      const pl = await cli("profiles list");
      const del = await cli("profiles delete --profile p9");
      const pl2 = await cli("profiles list");
      steps.push(["profiles delete", del.exit === 0 && !/"p9"/.test(pl2.raw) || (del.exit === 0 && /p9/.test(pl.raw))]);
      const tmp = walk(root).filter((p) => /browser-profiles\.json\.tmp$/.test(p));
      out("9 (profile commands work; no browser-profiles.json.tmp left)",
        steps.every((s) => s[1]) && tmp.length === 0 ? "PASS" : "FAIL",
        `${steps.map((s) => `${s[0]} ${s[1] ? "ok" : "FAILED"}`).join(", ")}; tmp files left ${tmp.length}`, await shotName("item9"));
      await closeTab(t.id);
    } catch (e) { out("9", "FAIL", `error ${e.message}`); }
  }

  // ---- item 10: steps 3, 6, 13, 14
  if (on(10)) {
    try {
      const t1 = await create(`${a}/ok`);
      const t2 = await create(`${a}/ok`);
      const lp = await create(q("sw", "ms=1200&max=2&pk=co"));
      const states = [];
      for (let i = 0; i < 6; i++) {
        await clickTab(i % 4);
        await sleep(500);
        states.push(await app.evalJs(`[...document.querySelectorAll("section.pane.browser")].filter(p => !p.hidden && p.clientWidth > 0).length`));
      }
      await watch(() => hitsOf("sw").length >= 3, 20000);
      const strays = (await targets()).filter((t) => /role=pop/.test(t.url)).length;
      out("10/step 3 (tab switching during and after the loops, no stray window)", states.every((n) => n <= 1) && strays === 0 ? "PASS" : "FAIL", `shown browser panes per switch ${JSON.stringify(states)}; popup targets left ${strays}`, await shotName("item10-s3"));
      const hs = hitsOf("sw");
      out("10/step 6 (which detector fires; judged by rebuild latency, no log seam exists)", "INFO", `popup-to-reload latencies ${JSON.stringify(hs.slice(1).map((h, i) => h.t - hs[i].t))} ms (the page waits 1200 ms before opening its popup)`);
      await closeTab(lp.id);
      const um = await create(q("um", "ms=1000&max=99&pk=co"));
      await watch(() => hitsOf("um").length >= 1, 10000);
      await sleep(1300);
      await closeTab(um.id);
      await sleep(5000);
      const n0 = hitsOf("um").length;
      await sleep(4000);
      const j = await list();
      const rows = Array.isArray(j) ? j : (j?.tabs ?? j?.pages ?? []);
      const ghost = rows.some((r) => Number(r.page ?? r.id) === um.id);
      const tg = await tabPage("um");
      out("10/step 13 (close the tab's pane while it rebuilds: no ghost, no orphan window)", !ghost && !tg && hitsOf("um").length === n0 ? "PASS" : "FAIL", `loads ${hitsOf("um").length}; listed after close ${ghost}; page target left ${!!tg}; hits kept coming ${hitsOf("um").length !== n0}`, await shotName("item10-s13"));
      out("10/step 14 (hidden tab destroyed with no close event)", "NOT RUN", "no way to end a hidden tab's container window from outside without Add-Type or a native call; the brief forbids runtime compilation");
      await closeTab(t1.id);
      await closeTab(t2.id);
    } catch (e) { out("10", "FAIL", `error ${e.message}`); }
  }
}

function walk(dir, acc = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
const findFile = (dir, name) => walk(dir).find((p) => p.endsWith(`/${name}`)) ?? null;

const ports = {};
const A = await serve("a", ports);
const B = await serve("b", ports);
ports.a = `http://127.0.0.1:${A.port}`;
ports.b = `http://127.0.0.1:${B.port}`;
const urls = ports;
log(`scratch servers: a ${urls.a}, b ${urls.b}`);

let ctx;
let ok = false;
try {
  ctx = await startPlain("BROW954", { report: rep });
  await sleep(3000);
  await main(ctx, urls);
  ok = results.every((r) => r.verdict === "PASS" || r.verdict === "INFO" || r.verdict === "NOT RUN");
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
writeFileSync(`${LIVE_LOGS}/BROW954-items.json`, JSON.stringify(results, null, 1));
if (want.length === 0) {
  appendFileSync(`${ROOT}/evidence/browser-954b.txt`, `\n\nLIVE re-proof (MERGE 407) ${DATE} (scripts/prove/live-browser-954.mjs, hidden dev app, loopback pages, scratch profile, no real agent)\n${results.map((r) => r.line).join("\n")}\n`);
}
const code = ctx ? await finish(ctx, "BROW954", rep.lines, ok) : 1;
A.srv.close();
B.srv.close();
process.exit(code);
