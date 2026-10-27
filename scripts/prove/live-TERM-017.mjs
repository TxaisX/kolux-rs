// LIVE proof, TERM-017 box 1 (spec/03): after 10 random splits and moves, each pane still shows its own session.
// Hidden app: 4 shells, each prints its own marker and its xterm host element gets a tag. Ten seeded operations
// (pane moves by drag-and-drop events onto cell edge zones, layout presets, splits); after each one every pane is
// checked: same host element (tag, no remount), its own marker only, no other pane's marker.
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
const stamp = Date.now().toString(36).slice(-4);
const M = (n) => `P${stamp}-${n}-END`;
let seed = 1017;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
const ZONES = ["left", "right", "top", "bottom", "centre"];
try {
  ctx = await startPlain("TERM-017", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  let started = 1;
  const splitFrom = async (idx, down) => {
    await app.focusPane(TERM, idx, ".xterm-helper-textarea");
    const before = await app.shown(TERM);
    await app.cdp("key", "d", down ? "9" : "10"); // Alt+Shift+D splits down, Ctrl+Shift+D right
    await waitFor(`${before + 1} panes`, async () => (await app.shown(TERM)) === before + 1, 30000);
    await waitFor("every pane has its input field", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= before + 1, 20000);
    await sleep(2500);
    started += 1;
    // The new pane is the shown shell that holds the focus: give it the next marker.
    const idxNew = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(TERM)})].filter(e => e.offsetParent !== null).findIndex(e => e.contains(document.activeElement))`);
    await ctx.typeInto(idxNew, `Write-Output '${M(started - 1)}'`);
    await waitFor(`marker ${started - 1}`, async () => ((await ctx.text(idxNew)) ?? "").split("\n").some((l) => l.trim() === M(started - 1)), 30000, 500);
  };
  await ctx.typeInto(0, `Write-Output '${M(0)}'`);
  await waitFor("marker 0", async () => ((await ctx.text(0)) ?? "").split("\n").some((l) => l.trim() === M(0)), 30000, 500);
  for (let i = 0; i < 3; i++) await splitFrom(0, false);
  // Tag every host element with the number in its marker.
  const tagged = await app.evalJs(`(() => { const out = []; for (const p of document.querySelectorAll(${JSON.stringify(TERM)})) { if (p.offsetParent === null) continue; for (const d of p.querySelectorAll("div")) { const t = d.__koluxTerm; if (!t) continue; const b = t.buffer.active; let found = null; for (let y = 0; y < b.length; y++) { const m = /^P${stamp}-(\\d+)-END$/.exec((b.getLine(y)?.translateToString(true) ?? "").trim()); if (m) found = Number(m[1]); } d.__proveTag = found; out.push(found); break; } } return out; })()`);
  log(`tagged hosts: ${JSON.stringify(tagged)}`);
  check("setup: four panes, each tagged with its own marker", tagged.length === 4 && new Set(tagged).size === 4 && tagged.every((t) => t !== null), JSON.stringify(tagged));
  await ctx.shot("TERM-017-start");
  const pidsBefore = await ctx.shellPids();

  const snapshot = () =>
    app.evalJs(`(() => { const out = []; for (const p of document.querySelectorAll(${JSON.stringify(TERM)})) { if (p.offsetParent === null) continue; let host = null; for (const d of p.querySelectorAll("div")) if (d.__koluxTerm) { host = d; break; } if (!host) { out.push({ tag: null, markers: [] }); continue; } const b = host.__koluxTerm.buffer.active; const ms = new Set(); for (let y = 0; y < b.length; y++) { const m = /^P${stamp}-(\\d+)-END$/.exec((b.getLine(y)?.translateToString(true) ?? "").trim()); if (m) ms.add(Number(m[1])); } const r = p.getBoundingClientRect(); out.push({ tag: host.__proveTag ?? null, markers: [...ms], x: Math.round(r.x), y: Math.round(r.y) }); } return out; })()`);
  const layoutSig = (s) => JSON.stringify(s.map((p) => [p.tag, p.x, p.y]));
  const moveOp = (si, ti, zone) =>
    app.evalJs(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const grips = [...document.querySelectorAll(".pane-grip")].filter((g) => g.offsetParent !== null);
      const cells = [...document.querySelectorAll(".cell")].filter((c) => !c.hidden && c.offsetParent !== null);
      const g = grips[${si}];
      if (!g) return "no grip " + ${si} + " of " + grips.length;
      const pr = g.closest("section.pane").getBoundingClientRect();
      const px = pr.x + pr.width / 2, py = pr.y + pr.height / 2;
      const own = cells.findIndex((c) => { const r = c.getBoundingClientRect(); return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom; });
      const others = cells.map((c, i) => i).filter((i) => i !== own);
      const tc = cells[others[${ti} % others.length]];
      if (!tc) return "no target cell";
      const r = tc.getBoundingClientRect();
      const at = { left: [0.06, 0.5], right: [0.94, 0.5], top: [0.5, 0.06], bottom: [0.5, 0.94], centre: [0.5, 0.5] }[${JSON.stringify(zone)}];
      const cx = r.left + r.width * at[0], cy = r.top + r.height * at[1];
      const dt = new DataTransfer();
      const fire = (el, type, extra) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy, ...extra }));
      fire(g, "dragstart"); await wait(80);
      fire(tc, "dragenter"); fire(tc, "dragover"); await wait(80);
      fire(tc, "dragover"); await wait(40);
      fire(tc, "drop"); await wait(80);
      fire(g, "dragend"); await wait(300);
      return "dropped on cell " + others[${ti} % others.length] + " (own " + own + ") zone " + ${JSON.stringify(zone)};
    })()`);
  const pick = (n) => app.clickWhere(".layouts button", `/^\\s*${n}\\s*$/`);

  // Ten operations from the seed: at most 2 presets and 2 splits, the rest moves.
  const ops = [];
  let presets = 0;
  let splits = 0;
  while (ops.length < 10) {
    const r = rnd(10);
    if (r < 2 && presets < 2) { presets++; ops.push({ kind: "preset", n: rnd(2) ? 6 : 4 }); }
    else if (r < 4 && splits < 2) { splits++; ops.push({ kind: "split", down: !!rnd(2) }); }
    else ops.push({ kind: "move", s: rnd(6), t: rnd(6), z: ZONES[rnd(5)] });
  }
  log(`operations: ${JSON.stringify(ops)}`);
  let changed = 0;
  let moves = 0;
  let firstBad = null;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    const before = await snapshot();
    let res = "";
    if (op.kind === "move") {
      moves++;
      const n = before.length;
      res = await moveOp(op.s % n, op.t, op.z);
    } else if (op.kind === "preset") {
      await pick(op.n);
      await sleep(1500);
      res = `layout ${op.n}`;
    } else {
      await splitFrom(rnd(before.length), op.down);
      // The new pane is tagged with its marker.
      await app.evalJs(`(() => { for (const p of document.querySelectorAll(${JSON.stringify(TERM)})) { if (p.offsetParent === null) continue; for (const d of p.querySelectorAll("div")) { const t = d.__koluxTerm; if (!t) continue; if (d.__proveTag !== undefined && d.__proveTag !== null) break; const b = t.buffer.active; for (let y = 0; y < b.length; y++) { const m = /^P${stamp}-(\\d+)-END$/.exec((b.getLine(y)?.translateToString(true) ?? "").trim()); if (m) d.__proveTag = Number(m[1]); } break; } } })()`);
      res = `split ${op.down ? "down" : "right"}`;
    }
    await sleep(1200);
    const after = await snapshot();
    const moved = layoutSig(before) !== layoutSig(after);
    if (moved) changed++;
    const tags = after.map((p) => p.tag);
    const problems = [];
    if (after.length < started) problems.push(`only ${after.length} panes shown, want ${started}`);
    for (let n = 0; n < started; n++) if (tags.filter((t) => t === n).length !== 1) problems.push(`tag ${n} found ${tags.filter((t) => t === n).length} times`);
    for (const p of after) if (p.tag === null || p.markers.length !== 1 || p.markers[0] !== p.tag) problems.push(`pane tag ${p.tag} shows markers ${JSON.stringify(p.markers)}`);
    log(`op ${k + 1} ${JSON.stringify(op)} -> ${res}; layout changed: ${moved}; panes ${after.length}; tags ${JSON.stringify(tags)}; ${problems.length ? "PROBLEMS " + problems.join("; ") : "each pane has its own host and only its own marker"}`);
    if (problems.length && !firstBad) firstBad = `op ${k + 1}: ${problems.join("; ")}`;
  }
  await ctx.shot("TERM-017-end");
  const pidsAfter = await ctx.shellPids();
  const gone = pidsBefore.filter((p) => !pidsAfter.includes(p));
  const fresh = pidsAfter.filter((p) => !pidsBefore.includes(p));
  log(`shell pids before ${JSON.stringify(pidsBefore)}, after ${JSON.stringify(pidsAfter)}; ended ${JSON.stringify(gone)}, new ${JSON.stringify(fresh)}; splits ${splits}, presets ${presets}, moves ${moves}; ops that changed the layout ${changed}`);
  check("10 operations ran (the seeded random mix)", ops.length === 10, `${moves} moves, ${splits} splits, ${presets} presets`);
  check("at least 5 operations really changed the layout (not all no-ops)", changed >= 5, `${changed} changed`);
  check("after every operation each pane kept its own host element and shows only its own session", firstBad === null, firstBad ?? "all 10 checks clean");
  check("no session ended, and the only new shells were the splits", pidsBefore.length === 4 && gone.length === 0 && fresh.length === splits, `ended ${gone.length}, new ${fresh.length} (splits ${splits})`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-017", ev, ok) : 1);
