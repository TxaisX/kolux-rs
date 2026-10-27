// LIVE proof, TERM-105 box 2 (spec/03): after quitting and reopening, restored panes accept typing at once and the
// pane that had focus before quitting has it again. Hidden app: two shells, focus pane 1 (not the newest), quit
// through the window's own close, relaunch the same profile.
import { reporter, startPlain, finish, sleep, waitFor, dismissFirstRun, TERM } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const stamp = Date.now().toString(36).slice(-4);
const M = (i) => `R${stamp}-${i}-END`;
const shownLines = async (i) => ((await ctx.text(i)) ?? "").split("\n").map((l) => l.trim());
try {
  ctx = await startPlain("TERM-105", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.click('.pane.focused button[title^="Split right"]');
  await waitFor("two panes", async () => (await app.shown(TERM)) === 2, 30000);
  await waitFor("both input fields", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= 2, 20000);
  await sleep(3000);
  for (let i = 0; i < 2; i++) {
    await ctx.typeInto(i, `Write-Output '${M(i)}'`);
    await waitFor(`pane ${i + 1} marker`, async () => (await shownLines(i)).includes(M(i)), 30000, 500);
  }
  // Focus pane 1 last, so the focus differs from the default (the newest pane).
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await sleep(2500);
  const focusedBefore = await app.evalJs(`(() => { const a = document.activeElement; const ps = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null); return { helper: !!a?.classList?.contains("xterm-helper-textarea"), index: ps.findIndex(p => p.contains(a)) }; })()`);
  log(`before quit: focus ${JSON.stringify(focusedBefore)}`);
  check("before the quit, pane 1 holds the focus", focusedBefore.helper && focusedBefore.index === 0, JSON.stringify(focusedBefore));
  await ctx.shot("TERM-105-before-quit");

  const closed = await app.closeAndCount(app.pid);
  log(`quit: ${closed.how}; pre-close tree ${closed.tree.length} (${app.byName(closed.tree)}); survivors ${closed.survivors.length} (${app.byName(closed.survivors)}) [the background terminal host is meant to stay]`);
  await app.relaunch();
  // The first-run guide may greet a relaunched profile too.
  await dismissFirstRun(app, log);
  await waitFor("two panes back", async () => (await app.shown(TERM)) === 2, 60000, 500);
  await waitFor("both input fields", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= 2, 30000);
  await sleep(4000);
  const info = await app.evalJs(`(() => { const a = document.activeElement; const ps = [...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null); return { helper: !!a?.classList?.contains("xterm-helper-textarea"), index: ps.findIndex(p => p.contains(a)), panes: ps.length }; })()`);
  log(`after relaunch: ${JSON.stringify(info)}`);
  const l0 = await shownLines(0);
  const l1 = await shownLines(1);
  log(`pane 1 holds its marker: ${l0.includes(M(0))}; pane 2 holds its marker: ${l1.includes(M(1))}; pane 1 holds pane 2's: ${l0.includes(M(1))}`);
  check("both panes are back with their earlier output", l0.includes(M(0)) && l1.includes(M(1)) && !l0.includes(M(1)) && !l1.includes(M(0)), `p1 ${l0.includes(M(0))}, p2 ${l1.includes(M(1))}`);
  check("the pane that had focus (pane 1) has it again, in its input field", info.helper && info.index === 0, JSON.stringify(info));
  // Typing at once: nothing clicked, nothing focused by the script.
  const typed = `T${stamp}-NOW`;
  await app.cdp("insert", `Write-Output '${typed}'`, "enter");
  const arrived = await waitFor("the typed line to run in pane 1", async () => (await shownLines(0)).filter((l) => l === typed).length >= 1, 20000, 500).then(() => true, () => false);
  const other = (await shownLines(1)).includes(typed);
  for (const w of [0, 3000, 8000]) {
    await sleep(w);
    const t0 = await shownLines(0);
    log(`pane 1 ${w ? `+${w} ms` : "now"}: ${t0.length} buffer rows, marker kept ${t0.includes(M(0))}, typed line ${t0.includes(typed)}, tail ${JSON.stringify(t0.filter(Boolean).slice(-4))}`);
  }
  check("typing at once (no click) runs in pane 1 and shows its output there", arrived && !other, `pane 1 ${arrived}, pane 2 ${other}`);
  log(`screenshot: ${await ctx.shot("TERM-105-after-relaunch")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-105", ev, ok) : 1);
