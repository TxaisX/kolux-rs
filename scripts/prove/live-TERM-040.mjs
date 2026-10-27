// LIVE proof, TERM-040 box 1 (spec/03): Ctrl+T opens a shell in the workspace folder with the cursor ready.
// Hidden app: one workspace (the throwaway repo), focus in its shell, Ctrl+T over CDP.
import { reporter, startPlain, finish, sleep, waitFor, TERM } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const norm = (s) => s.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
try {
  ctx = await startPlain("TERM-040", { report: rep });
  const { app } = ctx;
  const X = norm(ctx.repo);
  await sleep(3000);
  const before = await app.count(TERM);
  const shownBefore = await app.shown(TERM);
  const activeBefore = await app.evalJs(`document.activeElement?.closest("section.pane")?.getAttribute("aria-label") ?? null`);
  log(`before: ${before} terminal panes (${shownBefore} shown); focus in ${activeBefore}`);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.cdp("key", "t", "2"); // Ctrl+T
  await waitFor("one more terminal pane", async () => (await app.count(TERM)) === before + 1, 30000, 250);
  await sleep(3500);
  const info = await app.evalJs(`(() => { const a = document.activeElement; const sec = a?.closest("section.pane"); return { activeClass: a?.className ?? null, isHelper: !!a?.classList?.contains("xterm-helper-textarea"), pane: sec?.getAttribute("aria-label") ?? null, agent: sec?.getAttribute("data-agent") ?? null, shown: sec ? sec.offsetParent !== null : null, focusedPane: sec?.classList.contains("focused") ?? null }; })()`);
  log(`after Ctrl+T: ${await app.count(TERM)} terminal panes (${await app.shown(TERM)} shown); activeElement ${JSON.stringify(info)}`);
  check("one more terminal pane after Ctrl+T", (await app.count(TERM)) === before + 1, `${before} -> ${await app.count(TERM)}`);
  check("the new pane is a shell, shown, and holds the cursor (document.activeElement is its .xterm-helper-textarea)", info.isHelper && info.agent === "shell" && info.shown === true, JSON.stringify(info));
  // Which pane is the new one: the shown shell that owns the focus. Read its folder and its prompt.
  const idx = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null).findIndex(e => e.contains(document.activeElement))`);
  const shot = await ctx.text(idx);
  log(`new pane is shown pane #${idx + 1}; prompt rows: ${JSON.stringify(shot.split("\n").map((l) => l.trim()).filter(Boolean).slice(-3))}`);
  // Type without clicking: the cursor is ready if the keystrokes land in this pane.
  await app.cdp("insert", "Write-Output ('WD=' + (Get-Location).Path)", "enter");
  const line = await waitFor("the new shell to report its folder", async () => ((await ctx.text(idx)) ?? "").split("\n").map((l) => l.trim()).find((l) => /^WD=/.test(l)) ?? null, 30000, 500);
  const wd = line.slice(3);
  check("typing at once (no click) reached the new pane, and its working folder is the workspace folder", norm(wd) === X, `${wd} vs ${ctx.repo}`);
  log(`screenshot: ${await ctx.shot("TERM-040-ctrl-t")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-040", ev, ok) : 1);
