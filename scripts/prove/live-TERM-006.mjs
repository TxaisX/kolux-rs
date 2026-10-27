// LIVE proof, TERM-006 box 1 (spec/03): splitting a pane in folder X opens a shell whose working folder is X.
// Hidden app: the first shell opens in the project folder X; Ctrl+Shift+D (chord) and the header Split-right button each add a shell.
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
  ctx = await startPlain("TERM-006", { report: rep });
  const { app } = ctx;
  const X = norm(ctx.repo);
  log(`X (the folder pane 1 was opened in) = ${ctx.repo}`);
  await sleep(3000);
  // The folder a pane's shell reports for itself: Get-Location prints it alone on a line.
  const whereIs = async (index, tag) => {
    await ctx.typeInto(index, `Write-Output ('WD-${tag}=' + (Get-Location).Path)`);
    const re = new RegExp(`^WD-${tag}=(.+)$`);
    const line = await waitFor(`pane ${index + 1} to report its folder`, async () => ((await ctx.text(index)) ?? "").split("\n").map((l) => l.trim()).find((l) => re.test(l)) ?? null, 30000, 500);
    return line.replace(re, "$1");
  };
  const wd0 = await whereIs(0, "A");
  check("pane 1 is in X", norm(wd0) === X, wd0);

  // Chord: focus pane 1, Ctrl+Shift+D (mods Ctrl=2 + Shift=8).
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.cdp("key", "d", "10");
  await waitFor("a second pane", async () => (await app.shown(TERM)) === 2, 30000);
  await waitFor("its input field", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= 2, 20000);
  await sleep(3000);
  const wd1 = await whereIs(1, "B");
  check("Ctrl+Shift+D: the new shell's working folder is X", norm(wd1) === X, wd1);
  await ctx.shot("TERM-006-split-chord");

  // Header button from pane 1 as well.
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.click('.pane.focused button[title^="Split right"]');
  await waitFor("a third pane", async () => (await app.shown(TERM)) === 3, 30000);
  await sleep(3500);
  // The new pane sits right after the one it was split from.
  const wd2 = await whereIs(1, "C");
  check("Split-right button: the new shell's working folder is X", norm(wd2) === X, wd2);
  log(`screenshot: ${await ctx.shot("TERM-006-split-button")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-006", ev, ok) : 1);
