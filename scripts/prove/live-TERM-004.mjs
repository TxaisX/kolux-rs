// LIVE proof, TERM-004 box 1 (spec/03): applying the 4-pane preset to 4 running sessions keeps the same 4 sessions
// with the same output. Hidden app, 4 shells each printing a marker; Layout 6 first so that 4 is a real change.
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
const CHOOSER = "section.pane.chooser";
try {
  ctx = await startPlain("TERM-004", { report: rep });
  const { app } = ctx;
  const layoutOn = () => app.evalJs(`document.querySelector('.layouts button[aria-pressed="true"]')?.textContent.trim() ?? null`);
  const pick = (n) => app.clickWhere(".layouts button", `/^\\s*${n}\\s*$/`);
  for (const want of [2, 3, 4]) {
    await app.focusPane(TERM, 0, ".xterm-helper-textarea");
    await app.click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} panes`, async () => (await app.shown(TERM)) === want, 30000);
  }
  await pick(6);
  await waitFor("Layout 6", async () => (await layoutOn()) === "6", 5000);
  check("setup: Layout 6 shows 4 shells + 2 empty panes", (await app.shown(TERM)) === 4 && (await app.shown(CHOOSER)) === 2, `${await app.shown(TERM)} shells, ${await app.shown(CHOOSER)} choosers`);
  await sleep(3000);
  const stamp = Date.now().toString(36);
  for (let i = 0; i < 4; i++) {
    await ctx.typeInto(i, `Write-Output 'MARK-${stamp}-${i}-END'`);
    await waitFor(`marker ${i}`, async () => ((await ctx.text(i)) ?? "").split("\n").filter((l) => l.trim() === `MARK-${stamp}-${i}-END`).length >= 1, 30000, 500);
  }
  const before = [];
  for (let i = 0; i < 4; i++) before.push((await ctx.text(i)).split("\n").map((l) => l.trimEnd()).filter(Boolean));
  const idBefore = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null).map(e => e.getAttribute("aria-label"))`);
  const pidsBefore = await ctx.shellPids();
  log(`before: layout ${await layoutOn()}; panes ${JSON.stringify(idBefore)}; marker lines ${before.map((b, i) => b.filter((l) => l.includes(`MARK-${stamp}-${i}-END`)).length)}`);
  await ctx.shot("TERM-004-layout6");

  await pick(4);
  await waitFor("Layout 4", async () => (await layoutOn()) === "4", 5000);
  await waitFor("no empty pane left", async () => (await app.shown(CHOOSER)) === 0, 10000, 250);
  await sleep(2500);
  const after = [];
  for (let i = 0; i < 4; i++) after.push((await ctx.text(i)).split("\n").map((l) => l.trimEnd()).filter(Boolean));
  const idAfter = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null).map(e => e.getAttribute("aria-label"))`);
  const pidsAfter = await ctx.shellPids();
  log(`after: layout ${await layoutOn()}; panes ${JSON.stringify(idAfter)}; shell pids before ${JSON.stringify(pidsBefore)}, after ${JSON.stringify(pidsAfter)}`);
  check("preset 4 applied: 4 shells shown, no empty pane", (await app.shown(TERM)) === 4 && (await app.shown(CHOOSER)) === 0, `${await app.shown(TERM)} shells, ${await app.shown(CHOOSER)} choosers`);
  check("same 4 panes in the same order", JSON.stringify(idBefore) === JSON.stringify(idAfter), `${JSON.stringify(idBefore)} -> ${JSON.stringify(idAfter)}`);
  check("no session restarted: the same four shell processes are still running, none new", pidsBefore.length >= 4 && JSON.stringify(pidsBefore) === JSON.stringify(pidsAfter), `${JSON.stringify(pidsBefore)} -> ${JSON.stringify(pidsAfter)}`);
  for (let i = 0; i < 4; i++) {
    const m = `MARK-${stamp}-${i}-END`;
    const keep = before[i].filter((l) => l.trim() === m).length === after[i].filter((l) => l.trim() === m).length && after[i].some((l) => l.trim() === m);
    // Up to the marker line, ignoring line breaks and spaces (a narrower or wider pane wraps long lines differently).
    const headOf = (ls) => ls.slice(0, ls.findIndex((l) => l.trim() === m) + 1).join("").replace(/\s+/g, "");
    const sameHead = headOf(before[i]) === headOf(after[i]);
    if (!sameHead) log(`  pane ${i + 1} head differs:\n    before ${JSON.stringify(before[i].slice(0, 6))}\n    after  ${JSON.stringify(after[i].slice(0, 6))}`);
    check(`pane ${i + 1} keeps its output (marker line and everything above it)`, keep && sameHead, `${before[i].length} -> ${after[i].length} non-blank lines, marker line present: ${keep}`);
    check(`pane ${i + 1} holds no other pane's marker`, after[i].every((l) => !/MARK-[a-z0-9]+-\d-END/.test(l) || l.includes(m)), "checked");
  }
  log(`screenshot: ${await ctx.shot("TERM-004-layout4")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-004", ev, ok) : 1);
