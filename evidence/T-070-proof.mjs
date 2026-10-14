// T-546-b (2) + T-070 live proof driver: drives the look-lane dev app that T-070-run.mjs launched
// (scratch profile under G:/Temp/look-t070, CDP 9249) and prints raw readings.
//   cards: two stand-in Claude panes under the accounts work and personal → the Tower's usage cards
//          (one Claude card, the figures once, both accounts listed under it with their pane counts).
//   usage: the USAGE-023 scheduler through the dev-only hook window.__koluxUsageDev (a stubbed read,
//          never a real provider): a forced failure keeps the last figures and raises one steady error
//          mark through background retries; a focus after six minutes reads once, a second focus two
//          seconds later does not; the Tower's Refresh reads every provider at once.
//   pill (T-550): the top-bar usage pill is one button; a click opens Settings at Accounts & keys.
// Usage: node evidence/T-070-proof.mjs <app pid> <step: tour|cards|pill|usage|all>
import { execFile } from "node:child_process";

const ROOT = "G:/Dev/kolux-rs-lanes/look";
const CDP = "9249";
const CLAUDE = 'section.pane[data-agent*="claude"]';
const PILL = "[data-claude-state]";
const run = (f, a, env) => new Promise((res, rej) => execFile(f, a, { env: { ...process.env, ...env }, maxBuffer: 1 << 24 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so.trim()))));
const cdp = (...a) => run(process.execPath, [`${ROOT}/scripts/evidence/cdp.mjs`, "main", ...a], { CDP_PORT: CDP });
const ev = async (js) => {
  const out = await cdp("eval", js);
  let v = JSON.parse(out);
  if (v && typeof v === "object" && v.exceptionDetails) throw new Error(JSON.stringify(v.exceptionDetails));
  if (v && typeof v === "object" && v.result && typeof v.result === "object" && "type" in v.result) v = v.result.value ?? null;
  return v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
async function waitFor(what, probe, ms = 8000, every = 150) {
  const s = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return Date.now() - s;
    if (Date.now() - s > ms) throw new Error(`timed out: ${what}`);
    await sleep(every);
  }
}
const view = (name) => ev(`(() => { const b = [...document.querySelectorAll("nav.switcher button, button")].find(b => b.textContent.trim() === ${JSON.stringify(name)}); if (!b) return "missing"; b.click(); return "clicked"; })()`);
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const cards = () => ev(`[...document.querySelectorAll(".tower .top .card")].map(c => c.getAttribute("aria-label") + ": " + c.textContent.trim())`);
// The Claude pill as the viewer sees it: its words, whether the error mark is up, how many marks.
const pill = () => ev(`(() => { const p = document.querySelector(${JSON.stringify(PILL)}); return p ? { text: p.textContent.trim(), trouble: p.getAttribute("data-usage-trouble"), marks: p.querySelectorAll(".mark").length, spinner: !!p.querySelector('[data-glyph="spinner"], .spinner') } : null; })()`);
const DEV = "window.__koluxUsageDev";
const calls = () => ev(`JSON.stringify(${DEV}.calls)`).then((s) => JSON.parse(s));
const sched = (name) => ev(`(() => { const s = ${DEV}.runners[${JSON.stringify(name)}].state(); return { failures: s.failures, inFlight: s.inFlight, retryAfter: s.retryAfter }; })()`);
const OK = `[{ kind: "five_hour", usedPercent: 12, resetsAt: null }, { kind: "seven_day", usedPercent: 63, resetsAt: null }]`;
const stub = (how) => ev(`(${DEV}.fetch.claude = () => Promise.resolve(${how === "ok" ? `{ kind: "ok", value: ${OK} }` : `{ kind: "fail", message: "forced failure (T-070 proof)" }`}), ${JSON.stringify(how)})`);
const kick = (reason) => ev(`${DEV}.runners.claude.kick(${JSON.stringify(reason)})`);
const focus = () => ev(`(window.dispatchEvent(new Event("focus")), "focus dispatched")`);

const step = process.argv[3] ?? "all";
const is = (s) => step === s || step === "all";

async function closeTour() {
  log("tour close:", await ev(`(() => { const d = document.querySelector("[role=dialog]"); const x = d && [...d.querySelectorAll("button")].find(b => b.title === "Close" || b.getAttribute("aria-label") === "Close"); if (!x) return "no tour"; x.click(); return "closed"; })()`));
  await sleep(500);
  log("skip:", await ev(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Skip"); if (!b) return "no skip"; b.click(); return "skipped"; })()`));
  await sleep(400);
}
if (is("tour")) {
  await closeTour();
  log("switcher:", JSON.stringify(await ev(`[...document.querySelectorAll("nav.switcher button")].map(b => b.textContent.trim() + (b.getAttribute("aria-pressed") === "true" ? "*" : ""))`)));
  log("Terminals view:", await view("Terminals"));
  await sleep(500);
}

if (is("cards")) {
  await waitFor("two Claude panes from the seeded layout", async () => (await count(CLAUDE)) >= 2, 20000);
  log("panes:", JSON.stringify(await ev(`[...document.querySelectorAll("section.pane")].map(p => ({ label: p.getAttribute("aria-label"), agent: p.dataset.agent ?? null }))`)));
  // Figures first, so the cards have something to repeat (or not): a stubbed read, then a manual kick.
  log("hook:", await ev(`typeof ${DEV}`), "runners:", JSON.stringify(await ev(`Object.keys(${DEV}.runners)`)));
  log("stub:", await stub("ok"), "manual kick:", await kick("manual"));
  await waitFor("the Claude pill with the stubbed figures", async () => (await pill())?.text === "Claude 37% left", 8000);
  log("pill:", JSON.stringify(await pill()));
  log("Tower view:", await view("Tower"));
  await waitFor("the tower", () => ev(`!!document.querySelector(".tower")`), 5000);
  await sleep(600);
  log("cards:", JSON.stringify(await cards(), null, 1));
  const usage = await ev(`[...document.querySelectorAll(".tower .top .card.usage")].map(c => ({ label: c.getAttribute("aria-label"), name: c.querySelector(".name")?.textContent.trim(), panes: c.querySelector(".panes")?.textContent.trim(), accounts: [...c.querySelectorAll(".acct")].map(a => a.textContent.trim()), bars: [...c.querySelectorAll(".bar")].map(b => b.textContent.trim()) }))`);
  log("usage cards:", JSON.stringify(usage));
  const weeklyShown = await ev(`[...document.querySelectorAll(".tower .top .card.usage .bar .lbl")].filter(l => l.textContent.trim() === "Weekly").length`);
  log(`Claude cards: ${usage.filter((u) => u.label === "Claude usage").length} (one per provider, never one per account); Weekly bars across the top strip: ${weeklyShown} (the figures appear once); accounts listed: ${JSON.stringify(usage.flatMap((u) => u.accounts))}`);
  log("rows:", JSON.stringify(await ev(`[...document.querySelectorAll(".tower .row")].map(r => r.querySelector(".name")?.textContent.trim() + " / " + (r.querySelector(".agent")?.textContent.trim() ?? ""))`)));
  log("Terminals view:", await view("Terminals"));
  await sleep(400);
}

// T-550: the top-bar usage pill is one button with the pill's look; a click opens Settings at Accounts & keys.
if (is("pill")) {
  log("stub:", await stub("ok"), "manual kick:", await kick("manual"));
  await waitFor("the Claude pill with the stubbed figures", async () => (await pill())?.text === "Claude 37% left", 8000);
  const shape = () => ev(`(() => { const u = document.querySelector(".tb .usage, header .usage, .usage"); if (!u) return null; const s = getComputedStyle(u); const r = u.getBoundingClientRect(); return { tag: u.tagName, type: u.getAttribute("type"), title: u.title, hidden: u.hidden, buttonsInside: u.querySelectorAll("button").length, parts: [...u.querySelectorAll(".usage-part")].map(p => p.textContent.trim()), height: Math.round(r.height), radius: s.borderRadius, border: s.borderTopWidth + " " + s.borderTopStyle, padding: s.paddingLeft + " " + s.paddingRight, background: s.backgroundColor, fontSize: s.fontSize, cursor: s.cursor }; })()`);
  log("pill element:", JSON.stringify(await shape()));
  log("settings open before click:", await ev(`!!document.querySelector(".settings[role=dialog]")`));
  const t = Date.now();
  log("click pill:", await ev(`(() => { const u = document.querySelector(".usage"); if (!u) return "missing"; u.click(); return "clicked"; })()`));
  await waitFor("Settings to open", () => ev(`!!document.querySelector(".settings[role=dialog]")`), 5000, 50);
  await sleep(300);
  log(`settings after click (${Date.now() - t} ms):`, JSON.stringify(await ev(`(() => { const d = document.querySelector(".settings[role=dialog]"); return { open: !!d, current: d?.querySelector(".settings-link[aria-current=page]")?.textContent.trim() ?? null, heading: d?.querySelector("h1")?.textContent.trim() ?? null }; })()`)));
  log("Escape:", await cdp("key", "Escape"));
  await sleep(500);
  log("settings open after Escape:", await ev(`!!document.querySelector(".settings[role=dialog]")`));
}

if (is("usage")) {
  log("hook:", await ev(`typeof ${DEV}`), "runners:", JSON.stringify(await ev(`Object.keys(${DEV}.runners)`)), "calls so far:", JSON.stringify(await calls()));
  // 1. good figures through a stubbed read
  log("stub:", await stub("ok"), "manual kick:", await kick("manual"));
  await waitFor("the Claude pill with the stubbed figures", async () => (await pill())?.text === "Claude 37% left", 8000);
  log("pill after a good read:", JSON.stringify(await pill()), "sched:", JSON.stringify(await sched("claude")));
  // 2. a forced failure: the figures stay, one steady error mark goes up
  log("stub:", await stub("fail"), "manual kick:", await kick("manual"));
  await waitFor("the error mark", async () => (await pill())?.trouble === "1", 8000);
  log("pill after the failed read:", JSON.stringify(await pill()), "sched:", JSON.stringify(await sched("claude")));
  // 3. background retries while it keeps failing: every frame sampled during two timer kicks reads the same pill
  const states = await ev(`new Promise((done) => { const seen = new Set(); const p = () => { const e = document.querySelector(${JSON.stringify(PILL)}); seen.add(e ? e.textContent.trim() + " | trouble=" + e.getAttribute("data-usage-trouble") + " | marks=" + e.querySelectorAll(".mark").length : "no pill"); }; p(); const id = setInterval(p, 16); ${DEV}.runners.claude.kick("timer"); setTimeout(() => { ${DEV}.runners.claude.kick("timer"); }, 400); setTimeout(() => { clearInterval(id); p(); done([...seen]); }, 1200); })`);
  log("distinct pill states sampled every 16 ms across two failing timer reads:", JSON.stringify(states), "sched:", JSON.stringify(await sched("claude")));
  // 4. a focus six minutes on reads once (the failed read is retried on focus, past its backoff)
  const before = await calls();
  await ev(`(${DEV}.skew = 6 * 60 * 1000, ${DEV}.skew)`);
  log("clock skewed +6 min; before focus calls:", JSON.stringify(before), "|", await focus());
  const ms = await waitFor("one more Claude read", async () => (await calls()).claude === before.claude + 1, 5000, 50);
  await sleep(600);
  const afterFocus = await calls();
  log(`after focus (${ms} ms): calls`, JSON.stringify(afterFocus), "-> Claude reads +", afterFocus.claude - before.claude);
  // 5. a second focus two seconds later does not read again
  await ev(`(${DEV}.skew = 6 * 60 * 1000 + 2000, ${DEV}.skew)`);
  log("clock skewed +6 min 2 s;", await focus());
  await sleep(1500);
  const afterSecond = await calls();
  log("1.5 s after the second focus: calls", JSON.stringify(afterSecond), "-> Claude reads +", afterSecond.claude - afterFocus.claude, "(0 = the debounce held)");
  log("pill now:", JSON.stringify(await pill()), "sched:", JSON.stringify(await sched("claude")));
  // 6. the Tower's Refresh reads every provider at once, past the debounce; a good read clears the mark
  log("stub:", await stub("ok"));
  log("Tower view:", await view("Tower"));
  await waitFor("the tower", () => ev(`!!document.querySelector(".tower")`), 5000);
  const b2 = await calls();
  const t = Date.now();
  log("click Refresh:", await ev(`(() => { const b = document.querySelector(".tower .card.summary .refresh"); if (!b) return "missing"; b.click(); return "clicked"; })()`));
  await waitFor("both providers read", async () => { const c = await calls(); return c.claude === b2.claude + 1 && (c.codex ?? 0) === (b2.codex ?? 0) + 1; }, 5000, 50);
  log(`after Refresh (${Date.now() - t} ms): calls`, JSON.stringify(await calls()), "from", JSON.stringify(b2));
  await waitFor("the mark to clear", async () => (await pill())?.trouble === null, 8000);
  log("pill after the manual refresh:", JSON.stringify(await pill()), "sched:", JSON.stringify(await sched("claude")));
  log("Terminals view:", await view("Terminals"));
}
