// LIVE proof, TERM-103 box 1 + 2 (spec/03): opening 10 terminals never shows blank panes; with more than 6 terminals
// visible, the panes beyond the GPU cap draw on the plain path and still show text. Hidden app, 10 shell panes.
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
const N = 10;
try {
  ctx = await startPlain("TERM-103", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  for (let want = 2; want <= N; want++) {
    await app.focusPane(TERM, 0, ".xterm-helper-textarea");
    await app.click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} panes shown`, async () => (await app.shown(TERM)) === want, 30000);
    await sleep(600);
  }
  await waitFor("every pane has its input field", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= N, 30000);
  await sleep(4000);
  const stamp = Date.now().toString(36).slice(-4);
  for (let i = 0; i < N; i++) {
    await ctx.typeInto(i, `Write-Output 'M${stamp}-${i}-END'`);
    await sleep(150);
  }
  const mark = (i) => `M${stamp}-${i}-END`;
  await waitFor("every pane to print its marker", async () => {
    for (let i = 0; i < N; i++) if (!((await ctx.text(i)) ?? "").split("\n").some((l) => l.trim() === mark(i))) return false;
    return true;
  }, 90000, 1000);
  await sleep(1500);
  // Per pane: the renderer the header reports, the canvas the GPU path draws on, the DOM rows the plain path draws.
  const panes = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null).map((e, i) => { const tip = e.querySelector(".st")?.getAttribute("data-tip") ?? ""; const canv = [...e.querySelectorAll(".xterm-screen canvas")].filter(c => c.width > 0 && c.height > 0); const rows = e.querySelector(".xterm-rows")?.innerText ?? ""; const b = e.getBoundingClientRect(); return { i, label: e.getAttribute("aria-label"), renderer: /GPU renderer/.test(tip) ? "webgl" : /plain renderer/.test(tip) ? "dom" : "?", canvases: canv.length, canvasPx: canv.map(c => c.width + "x" + c.height).join(","), rowsText: rows.replace(/\\s+/g, " ").trim().slice(0, 120), w: Math.round(b.width), h: Math.round(b.height) }; })`);
  let webgl = 0;
  const blanks = [];
  const plainWithoutText = [];
  for (const p of panes) {
    const buffer = ((await ctx.text(p.i)) ?? "").split("\n").some((l) => l.trim() === mark(p.i));
    const showsText = p.renderer === "dom" ? p.rowsText.includes(mark(p.i)) : p.canvases > 0;
    if (p.renderer === "webgl") webgl++;
    if (!buffer || !showsText) blanks.push(p.i + 1);
    if (p.renderer === "dom" && !p.rowsText.includes(mark(p.i))) plainWithoutText.push(p.i + 1);
    log(`pane ${p.i + 1}: ${p.w}x${p.h} renderer=${p.renderer} canvases=${p.canvases}(${p.canvasPx}) bufferHasMarker=${buffer} rows="${p.rowsText.slice(0, 60)}"`);
  }
  log(`summary: ${panes.length} panes shown, ${webgl} on the GPU path, ${panes.length - webgl} on the plain path`);
  const shotFile = await ctx.shot("TERM-103-ten-panes");
  log(`screenshot: ${shotFile}`);
  check("box 1: 10 terminals shown", panes.length === N, `${panes.length} panes`);
  check("box 1: no blank pane (each holds its marker in its session and draws something: canvas or text rows)", blanks.length === 0, blanks.length ? `blank/missing: ${blanks.join(",")}` : "none");
  check("box 2: more than 6 terminals are visible", panes.length > 6, `${panes.length} visible`);
  check("box 2: at most 6 panes draw on the GPU path", webgl <= 6, `${webgl} on the GPU path`);
  check("box 2: GPU path is really in use for some panes (else the cap is not exercised)", webgl >= 1, `${webgl} on the GPU path`);
  check("box 2: panes beyond the cap draw on the plain path and show their text in the DOM rows", panes.length - webgl >= 1 && plainWithoutText.length === 0, `${panes.length - webgl} plain panes; without text: ${plainWithoutText.join(",") || "none"}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-103", ev, ok) : 1);
