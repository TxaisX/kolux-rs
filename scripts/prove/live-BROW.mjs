// LIVE proof, spec/13 boxes BROW-001 b1+b2, BROW-002 b1+b2, BROW-005 b1, BROW-008 b1, BROW-009 b1, all in one hidden launch.
// node live-BROW.mjs   (writes G:/Temp/live-v8-logs/BROW.out.txt and BROW-boxes.json; evidence sections go to evidence/cards-BROW-00x.txt)
import http from "node:http";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, makeWorktree, selectedWorktree, pickMain, LIVE_LOGS } from "./live-proj-common.mjs";
import { ROOT } from "./live-common.mjs";
import { makeSites, listenOn9, pageTarget, targetCall, targetEval, targetInsert, evidence } from "./live-browser-common.mjs";

const run = promisify(execFile);
const BR = "section.pane.browser:not([hidden])";
const ADDR = `${BR} input[aria-label="Address"]`;
const TABS = "div[role=tablist][aria-label=Tabs] div[role=tab]";
const ALERT = `${BR} [role=alert][data-kind]`;

async function goIn(app, url) {
  await app.focusField(ADDR);
  await sleep(300);
  await app.evalJs(`document.querySelector(${JSON.stringify(ADDR)}).select()`);
  await app.cdp("insert", url, "enter");
}
const tabState = (app) => app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TABS)})].map(t => ({ text: t.textContent.trim().slice(0, 24), sel: t.getAttribute("aria-selected") === "true" }))`);
const clickTab = (app, i) => app.evalJs(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(TABS)})][${i}]; t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); t.click(); return t.textContent.trim(); })()`);
// On screen by the app's own rule (BrowserPane.tsx:410): not hidden and a non-zero box, so a hidden ancestor cell counts as off screen.
const visibleBrowsers = (app) => app.evalJs(`[...document.querySelectorAll("section.pane.browser")].filter(p => !p.hidden && p.clientWidth > 0 && p.clientHeight > 0).map(p => p.getAttribute("aria-label"))`);
const pageUrls = async (base) => (await (await fetch("http://127.0.0.1:9290/json")).json()).filter((t) => t.type === "page" && t.url.startsWith(base)).map((t) => t.url.slice(base.length));
// A JS null comes back from evalJs as a raw CDP wrapper, so the value travels as JSON text.
const alertText = async (app) => JSON.parse(await app.evalJs(`JSON.stringify((() => { const a = document.querySelector(${JSON.stringify(ALERT)}); return a ? { kind: a.dataset.kind, text: a.innerText.replace(/\\s+/g, " ").trim() } : null; })())`));

async function renderers(app) {
  const tree = [app.pid, ...(await app.treeOf(app.pid)).map((p) => p.pid)];
  const { stdout } = await run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { @(${tree.join(",")}) -contains $_.ProcessId -and $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match '--type=renderer' } | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.KernelModeTime + $_.UserModeTime)" }`]);
  return stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [pid, ppid, cpu] = l.split(" ").map(Number); return { pid, ppid, cpu }; });
}

export async function runBrow(ctx, { check, log }, sites) {
  const { app } = ctx;
  const { base, hits } = sites;
  const res = {};
  const ev = {};
  const sub = (box, name, pass, detail) => {
    check(`${box}: ${name}`, pass, detail);
    res[box] = (res[box] ?? true) && !!pass;
    (ev[box] ??= []).push(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
  };
  const note = (box, text) => { log(`${box}: ${text}`); (ev[box] ??= []).push(text); };
  const re = (path) => new RegExp(`^${base.replace(/[.]/g, "\\.")}${path}`);

  // BROW-001 b1: Mod+Shift+B.
  note("BROW-001-b1", `panes before: ${JSON.stringify(await visibleBrowsers(app))}; tabs before: ${JSON.stringify(await tabState(app))}`);
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await app.waitFor("a New Tab browser pane", () => app.exists('section.pane.browser[aria-label="New Tab pane"]'), 20000);
  await sleep(2500);
  const tabs1 = await tabState(app);
  const pane = await app.evalJs(`(() => { const p = document.querySelector('section.pane.browser[aria-label="New Tab pane"]'); const a = document.activeElement; return { hidden: p.hidden, activeIsAddress: !!a && a.matches('input[aria-label=Address]') && p.contains(a), before: a && a.value, selStart: a && a.selectionStart, selEnd: a && a.selectionEnd }; })()`);
  note("BROW-001-b1", `tabs after: ${JSON.stringify(tabs1)}; new pane: ${JSON.stringify(pane)}`);
  sub("BROW-001-b1", "a New Tab is the active (selected) tab", tabs1.some((t) => t.sel && /New Tab/.test(t.text)) && !pane.hidden, JSON.stringify(tabs1));
  sub("BROW-001-b1", "the address bar holds the cursor (activeElement) with its contents selected", pane.activeIsAddress && pane.selStart === 0 && pane.selEnd === (pane.before ?? "").length, JSON.stringify(pane));
  await app.cdp("insert", "ab");
  const typed = await app.evalJs(`(() => { const a = document.querySelector('section.pane.browser[aria-label="New Tab pane"] input[aria-label=Address]'); return { value: a.value, focused: document.activeElement === a }; })()`);
  sub("BROW-001-b1", 'typed characters ("ab") land in the address bar', typed.value === "ab" && typed.focused, JSON.stringify(typed));
  note("BROW-001-b1", `screenshot: ${await ctx.shot("BROW-001-b1")}`);

  // BROW-001 b2: a page whose script calls window.close().
  await goIn(app, `${base}/closer`);
  const closer = await poll(() => pageTarget(re("/closer")), 30000, 400);
  const timeline = [];
  for (const ms of [500, 1500, 3000, 6000]) { await sleep(ms - (timeline.at(-1)?.ms ?? 0)); timeline.push({ ms, targets: await pageUrls(base) }); }
  const tabs2 = await tabState(app);
  const closerPane = JSON.parse(await app.evalJs(`JSON.stringify((() => { const p = document.querySelector('section.pane.browser[aria-label="Closer page pane"]'); return p ? { hidden: p.hidden, w: p.clientWidth, h: p.clientHeight } : null; })())`));
  const closerAlert = await alertText(app);
  note("BROW-001-b2", `closer page served ${hits["/closer"] ?? 0} time(s); page targets over time ${JSON.stringify(timeline)}; tabs ${JSON.stringify(tabs2)}; pane ${JSON.stringify(closerPane)}; overlay ${JSON.stringify(closerAlert)}`);
  sub("BROW-001-b2", "the page loaded and its script ran (server saw it)", (hits["/closer"] ?? 0) >= 1, `hits=${hits["/closer"]}`);
  sub("BROW-001-b2", "after window.close() the tab stays: still in the strip, selected, its pane on screen", tabs2.length === 2 && tabs2[1].sel && /Closer page/.test(tabs2[1].text) && !!closerPane && !closerPane.hidden && closerPane.w > 0, JSON.stringify({ tabs: tabs2.length, closerPane }));
  sub("BROW-001-b2", "and the close request was ignored (card Rules): the page is still there, no 'stopped responding' overlay", !closerAlert && timeline.at(-1).targets.length > 0, JSON.stringify({ closerAlert, targets: timeline.at(-1).targets }));
  // second browser tab, then switch every way
  await ctx.rawKey({ key: "B", code: "KeyB", vk: 66, mods: 2 | 8 });
  await poll(async () => (await tabState(app)).length === 3, 15000, 300);
  await sleep(2000);
  const order = [0, 1, 2, 1, 0, 2];
  const seen = [];
  for (const i of order) {
    await clickTab(app, i);
    await sleep(700);
    const st = await tabState(app);
    const shown = await visibleBrowsers(app);
    seen.push({ clicked: i, selected: st.findIndex((t) => t.sel), onlyOne: st.filter((t) => t.sel).length === 1, browserPanesShown: shown.length });
  }
  note("BROW-001-b2", `switching sequence: ${JSON.stringify(seen)}`);
  sub("BROW-001-b2", "with three tabs, clicking each tab (forward and back) selects exactly that tab", seen.every((s) => s.selected === s.clicked && s.onlyOne), JSON.stringify(seen.map((s) => `${s.clicked}->${s.selected}`)));
  const tabsEnd = await tabState(app);
  note("BROW-001-b2", `after the switching: tabs ${JSON.stringify(tabsEnd)}; page targets ${JSON.stringify(await pageUrls(base))}`);
  sub("BROW-001-b2", "all three tabs are still in the strip after the switching, the closer tab included", tabsEnd.length === 3 && /Closer page/.test(tabsEnd[1].text), JSON.stringify(tabsEnd));
  note("BROW-001-b2", `screenshot: ${await ctx.shot("BROW-001-b2")}`);

  // BROW-002 b1: typed text survives a trip to a terminal tab. Tab 2 is the second New Tab.
  await clickTab(app, 2);
  await sleep(800);
  await goIn(app, `${base}/form`);
  const form = await poll(() => pageTarget(re("/form")), 30000, 400);
  await sleep(2000);
  await targetEval(re("/form"), 'document.getElementById("t").focus()');
  await targetInsert(re("/form"), "keep me");
  const before = await targetEval(re("/form"), "JSON.stringify({ v: document.getElementById('t').value, token: window.__token, loaded: window.__loaded })").then(JSON.parse);
  const hitsBefore = hits["/form"];
  note("BROW-002-b1", `form page target ${form ? "present" : "absent"}; before leaving: ${JSON.stringify(before)}; server hits ${hitsBefore}`);
  sub("BROW-002-b1", 'the text "keep me" is typed into the page field', before.v === "keep me", JSON.stringify(before));
  const away = await clickTab(app, 0);
  await sleep(2500);
  const awayState = await tabState(app);
  const awayShown = await visibleBrowsers(app);
  note("BROW-002-b1", `went to tab 0 "${away}": tabs ${JSON.stringify(awayState)}; browser panes shown ${JSON.stringify(awayShown)}`);
  await clickTab(app, 2);
  await sleep(2500);
  const after = await targetEval(re("/form"), "JSON.stringify({ v: document.getElementById('t').value, token: window.__token, loaded: window.__loaded })").then(JSON.parse);
  note("BROW-002-b1", `back on the browser tab: ${JSON.stringify(after)}; server hits ${hits["/form"]}`);
  sub("BROW-002-b1", "went to the terminal tab (browser pane hidden) and came back", awayState[0]?.sel === true && !awayShown.includes("Form page pane"), JSON.stringify({ sel0: awayState[0]?.sel, awayShown }));
  sub("BROW-002-b1", "the typed text is still in the field", after.v === "keep me", JSON.stringify(after));
  sub("BROW-002-b1", "and the page did not reload (same token, loaded=1, one server hit)", after.token === before.token && after.loaded === 1 && hits["/form"] === hitsBefore, JSON.stringify({ sameToken: after.token === before.token, loaded: after.loaded, hits: hits["/form"] }));
  note("BROW-002-b1", `screenshot: ${await ctx.shot("BROW-002-b1")}`);

  // BROW-002 b2: another worktree and back.
  const wasSel = await selectedWorktree(app);
  const made = await makeWorktree(app, "second", log);
  await sleep(1500);
  const selB = await selectedWorktree(app);
  const shownB = await visibleBrowsers(app);
  note("BROW-002-b2", `from ${wasSel} made worktree second=${made}; now ${selB}; browser panes shown there ${JSON.stringify(shownB)}`);
  sub("BROW-002-b2", "another worktree is selected and the form page's pane is not on screen", made && selB === "second" && shownB.length === 0, JSON.stringify({ selB, shownB }));
  await sleep(2000);
  await pickMain(app);
  await sleep(3500);
  const selA = await selectedWorktree(app);
  const tabsA = await tabState(app);
  await clickTab(app, 2); // picking the worktree selects its terminal; go back to the form page's tab
  await sleep(2000);
  const back = await poll(async () => (await targetEval(re("/form"), "JSON.stringify({ v: document.getElementById('t').value, token: window.__token, loaded: window.__loaded })").then(JSON.parse).catch(() => null)), 15000, 500);
  const shownA = await visibleBrowsers(app);
  note("BROW-002-b2", `back in ${selA} (tabs ${JSON.stringify(tabsA)}): ${JSON.stringify(back)}; browser panes shown ${JSON.stringify(shownA)}; server hits ${hits["/form"]}`);
  sub("BROW-002-b2", "back in the first worktree the page has not reloaded (same token, loaded=1, no new server hit)", selA === "main" && !!back && back.token === before.token && back.loaded === 1 && hits["/form"] === hitsBefore && back.v === "keep me", JSON.stringify({ selA, sameToken: back?.token === before.token, loaded: back?.loaded, hits: hits["/form"], value: back?.v }));
  sub("BROW-002-b2", "and its pane is shown again", shownA.includes("Form page pane"), JSON.stringify(shownA));
  note("BROW-002-b2", `screenshot: ${await ctx.shot("BROW-002-b2")}`);

  // BROW-005 b1: slow page, Stop, then a normal page.
  await goIn(app, `${base}/slow`);
  const stopSel = `${BR} button[data-go=stop].loading`;
  const stopUp = await poll(() => app.exists(stopSel), 15000, 150);
  const spin = await app.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(stopSel)}); if (!b) return null; const s = getComputedStyle(b, "::before"); return { title: b.title, label: b.getAttribute("aria-label"), animation: s.animationName, content: s.content }; })()`);
  note("BROW-005-b1", `slow page: Stop button present=${!!stopUp}; ${JSON.stringify(spin)}; server hits ${hits["/slow"]}`);
  sub("BROW-005-b1", "while the slow page loads the toolbar button is Stop with the loading (spinner) class", !!stopUp && !!spin, JSON.stringify(spin));
  note("BROW-005-b1", `screenshot: ${await ctx.shot("BROW-005-b1-loading")}`);
  const t0 = Date.now();
  await app.evalJs(`document.querySelector(${JSON.stringify(stopSel)}).click()`);
  const reloadBack = await poll(async () => (await app.exists(`${BR} button[data-go=reload]`)) && !(await app.exists(`${BR} button[data-go=stop]`)), 3000, 100);
  const ms = Date.now() - t0;
  const ready = await targetEval(re("/slow"), "document.readyState").catch((e) => `err ${e.message}`);
  note("BROW-005-b1", `after pressing Stop: Reload button back=${!!reloadBack} in ${ms} ms; page readyState=${ready}`);
  sub("BROW-005-b1", "pressing Stop halts the load: the button returns to Reload within 1 s", !!reloadBack && ms <= 1000, `${ms} ms`);
  sub("BROW-005-b1", "and the page's readyState is no longer loading", ready !== "loading" && !String(ready).startsWith("err"), String(ready));
  await goIn(app, `${base}/ok`);
  await poll(() => pageTarget(re("/ok")), 20000, 300);
  await sleep(2500);
  const rel = await app.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(`${BR} button[data-go=reload]`)}); return { reload: !!b, title: b && b.title, stop: !!document.querySelector(${JSON.stringify(`${BR} button[data-go=stop]`)}) }; })()`);
  note("BROW-005-b1", `after a normal page: ${JSON.stringify(rel)}`);
  sub("BROW-005-b1", "after a normal load the button reads Reload (no Stop)", rel.reload && !rel.stop && /reload/i.test(rel.title ?? ""), JSON.stringify(rel));

  // BROW-008 b1: localhost:9 with nothing listening, then a server and Retry.
  await goIn(app, "http://localhost:9");
  // the overlay first says "could not load"; the back end's diagnosis (local-server advice) arrives a moment later
  const over = await poll(async () => { const t = await alertText(app); return t && /Nothing is listening|refused|could not find|cannot be reached|did not answer/.test(t.text) ? t : null; }, 40000, 400) ?? await alertText(app);
  const retry = await app.exists(`${BR} button[data-go=retry]`);
  note("BROW-008-b1", `overlay: ${JSON.stringify(over)}; Retry button=${retry}`);
  sub("BROW-008-b1", "overlay says nothing is listening on localhost:9 and gives local-server advice", !!over && /Nothing is listening on localhost:9\./.test(over.text) && /start it, then press Retry/i.test(over.text), JSON.stringify(over));
  sub("BROW-008-b1", "a Retry button is on the overlay", retry, String(retry));
  note("BROW-008-b1", `screenshot: ${await ctx.shot("BROW-008-b1-overlay")}`);
  const nine = await listenOn9(log);
  const t1 = Date.now();
  await app.evalJs(`document.querySelector(${JSON.stringify(`${BR} button[data-go=retry]`)}).click()`);
  const gone = await poll(async () => (await alertText(app)) === null, 15000, 150);
  const read9 = () => targetEval(/^http:\/\/localhost:9\//, "location.href + ' | ' + document.title").catch(() => null);
  const loaded = (await poll(async () => { const r = await read9(); return /Nine page/.test(r ?? "") ? r : null; }, 15000, 250)) ?? (await read9());
  note("BROW-008-b1", `after the server started and Retry: overlay gone=${!!gone} (${Date.now() - t1} ms), page target reads ${JSON.stringify(loaded)}`);
  sub("BROW-008-b1", "pressing Retry loads the page (overlay gone, page shows the server's content)", !!gone && /Nine page/.test(loaded ?? ""), JSON.stringify(loaded));
  note("BROW-008-b1", `screenshot: ${await ctx.shot("BROW-008-b1-loaded")}`);
  const engineText = await targetEval(/^chrome-error:/, "document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300) + ' | ' + (document.documentElement.innerHTML.match(/ERR_[A-Z_]+/) ?? [''])[0]").catch((e) => `unreadable ${e.message}`);
  note("BROW-008-b1", `engine error page after Retry: ${JSON.stringify(engineText)}`);
  nine.close();
  // Supplementary (not the box): the same steps on a free port, to tell the Retry path from the port-9 refusal.
  const freePort = await new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
  await goIn(app, `http://localhost:${freePort}`);
  const overF = await poll(async () => { const t = await alertText(app); return t && /Nothing is listening/.test(t.text) ? t : null; }, 40000, 400);
  note("BROW-008-b1", `supplementary free port ${freePort}: overlay ${JSON.stringify(overF)}`);
  const srvF = http.createServer((req, res) => { log(`port ${freePort} saw ${req.method} ${req.url}`); res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Free page</title><p>free</p>"); });
  await new Promise((ok) => srvF.listen({ port: freePort, host: "::", ipv6Only: false }, ok));
  await app.evalJs(`document.querySelector(${JSON.stringify(`${BR} button[data-go=retry]`)}).click()`);
  const readF = () => targetEval(new RegExp(`^http://localhost:${freePort}/`), "location.href + ' | ' + document.title").catch(() => null);
  const loadedF = (await poll(async () => { const r = await readF(); return /Free page/.test(r ?? "") ? r : null; }, 20000, 300)) ?? (await readF());
  note("BROW-008-b1", `supplementary: after the server started on ${freePort} and Retry the page target reads ${JSON.stringify(loadedF)}`);
  sub("BROW-008-b1", `(supplementary, not the box) the same steps on free port ${freePort}: advice overlay, then Retry loads the page`, !!overF && /Free page/.test(loadedF ?? ""), JSON.stringify({ overF, loadedF }));
  srvF.close();

  // BROW-009 b1: kill the renderer behind the tab.
  await goIn(app, `${base}/die`);
  await poll(() => pageTarget(re("/die")), 20000, 300);
  await sleep(3000);
  const tok0 = await targetEval(re("/die"), "window.__token");
  const hits0 = hits["/die"];
  const c0 = await renderers(app);
  note("BROW-009-b1", `page token ${tok0}; /die hits ${hits0}; renderer children of the app: ${JSON.stringify(c0.map((r) => r.pid))}`);
  const spinning = targetEval(re("/die"), "(() => { const e = Date.now() + 3500; while (Date.now() < e) {} return 1; })()", 9000).catch(() => null);
  await sleep(1500);
  const c1 = await renderers(app);
  await spinning;
  const deltas = c1.map((r) => ({ pid: r.pid, ppid: r.ppid, ms: ((r.cpu - (c0.find((x) => x.pid === r.pid)?.cpu ?? r.cpu)) / 10000) | 0 })).sort((a, b) => b.ms - a.ms);
  note("BROW-009-b1", `CPU used in 1.5 s by each renderer while the tab page spun: ${JSON.stringify(deltas)}`);
  const victim = deltas[0];
  sub("BROW-009-b1", "exactly one renderer of the app is busy while the tab page spins (the tab's)", !!victim && victim.ms > 800 && (deltas[1]?.ms ?? 0) < 300, JSON.stringify(deltas));
  if (victim && victim.ms > 800) {
    await sleep(2500);
    const owned = (await renderers(app)).some((r) => r.pid === victim.pid);
    if (!owned) throw new Error("victim pid is not an app descendant renderer");
    const tKill = Date.now();
    await run("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${victim.pid} -Force`]);
    note("BROW-009-b1", `killed renderer pid ${victim.pid} (child of the app's WebView2 tree) at t=0`);
    let sawAlert = null;
    let recovered = null;
    while (Date.now() - tKill < 25000) {
      await sleep(250);
      const a = await alertText(app).catch(() => null);
      if (a && !sawAlert) sawAlert = { at: Date.now() - tKill, ...a };
      const tok = await targetEval(re("/die"), "window.__token", 3000).catch(() => null);
      if (tok !== null && tok !== undefined && tok !== tok0) { recovered = { at: Date.now() - tKill, token: tok }; break; }
    }
    await sleep(1500);
    const finalAlert = await alertText(app);
    note("BROW-009-b1", `recovery: ${JSON.stringify(recovered)}; alert seen during recovery: ${JSON.stringify(sawAlert)}; alert at the end: ${JSON.stringify(finalAlert)}; /die hits ${hits0} -> ${hits["/die"]}`);
    sub("BROW-009-b1", "the page came back on its own within the 25 s watched (a fresh page with a new token, same address)", !!recovered, JSON.stringify(recovered));
    sub("BROW-009-b1", "with no error overlay and the server asked for the page again", !sawAlert && !finalAlert && hits["/die"] > hits0, JSON.stringify({ sawAlert, finalAlert, hits: hits["/die"] }));
    note("BROW-009-b1", `screenshot: ${await ctx.shot("BROW-009-b1")}`);
  }

  writeFileSync(`${LIVE_LOGS}/BROW-boxes.json`, JSON.stringify(res, null, 1));
  for (const card of ["BROW-001", "BROW-002", "BROW-005", "BROW-008", "BROW-009"]) {
    const lines = Object.entries(ev).filter(([k]) => k.startsWith(card)).flatMap(([k, v]) => [`box ${k.split("-b")[1]}: ${res[k] ? "PASS" : "FAIL"}`, ...v.map((l) => `  ${l}`)]);
    evidence(ROOT, card, lines);
  }
  return res;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  const sites = await makeSites();
  log(`scratch pages on ${sites.base}`);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("BROW", { report: rep });
    await sleep(3000);
    await runBrow(ctx, { check: chk.check, log }, sites);
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  const code = ctx ? await finish(ctx, "BROW", ev, ok) : 1;
  sites.stop();
  process.exit(code);
}
