// LIVE proof, TERM-106 box 1 (spec/03): after the background host died, reopened panes show their earlier output
// above a new prompt, in the same folder. Hidden app: a shell prints marker M; only the host pid recorded in the
// scratch profile's terminals.json is killed (hard); the app is closed and relaunched on the same profile.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
const norm = (s) => s.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const stamp = Date.now().toString(36).slice(-4);
const M = `H${stamp}-OUTPUT-END`;
const NOTE = "restored after a restart";
try {
  ctx = await startPlain("TERM-106", { report: rep });
  const { app } = ctx;
  const endpointFile = join(app.paths.profile, "terminals.json");
  await sleep(3000);
  await ctx.typeInto(0, `Write-Output '${M}'`);
  await waitFor("the marker", async () => ((await ctx.text(0)) ?? "").split("\n").some((l) => l.trim() === M), 30000, 500);
  await ctx.typeInto(0, "Write-Output ('WD=' + (Get-Location).Path)");
  const wdLine = await waitFor("the folder line", async () => ((await ctx.text(0)) ?? "").split("\n").map((l) => l.trim()).find((l) => /^WD=/.test(l)) ?? null, 30000, 500);
  const wd0 = wdLine.slice(3);
  log(`pane folder before: ${wd0}`);
  await sleep(3000); // the saved history and layout settle (debounced writes)
  const haveEndpoint = existsSync(endpointFile);
  let hostPid = null;
  if (haveEndpoint) {
    try {
      hostPid = Number(JSON.parse(readFileSync(endpointFile, "utf8")).pid);
    } catch (e) {
      log(`terminals.json unreadable: ${e.message}`);
    }
  }
  log(`terminals.json present: ${haveEndpoint}; host pid ${hostPid}`);
  // No separate host in this build (spec T-068: the app owns the sessions): then the process that holds the sessions is the app itself.
  const target = hostPid && hostPid !== app.pid && hostPid > 4 ? hostPid : app.pid;
  log(`session holder killed hard: pid ${target} (${target === app.pid ? "the app itself; no separate host is recorded" : "the recorded host"})`);
  await ctx.shot("TERM-106-before-kill");
  const tree = await app.treeOf(app.pid);
  const killed = await app.run("taskkill", ["/PID", String(target), "/T", "/F"]).then(() => "killed", (e) => `kill failed: ${e.message}`);
  log(`pid ${target}: ${killed} (no graceful close, so no save on exit)`);
  await sleep(2500);
  const left = await app.survivorsOf(tree);
  log(`processes of the old tree still alive: ${left.length} (${app.byName(left)})`);
  await app.killAll(left);
  await app.treeGone(tree);
  await app.relaunch();
  await dismissFirstRun(app, log);
  await waitFor("a pane back", async () => (await app.shown(TERM)) >= 1, 60000, 500);
  await waitFor("its input field", async () => (await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM + " .xterm-helper-textarea")}).length`)) >= 1, 30000);
  await sleep(5000);
  const view = () => app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(TERM)})].find(e => e.offsetParent !== null); for (const d of p.querySelectorAll("div")) { const t = d.__koluxTerm; if (!t) continue; const b = t.buffer.active; const vis = []; for (let y = b.viewportY; y < b.viewportY + t.rows; y++) vis.push((b.getLine(y)?.translateToString(true) ?? "").trim()); return { rows: t.rows, length: b.length, baseY: b.baseY, viewportY: b.viewportY, visible: vis.filter(Boolean).slice(0, 12) }; } return null; })()`);
  log(`right after the relaunch, before any typing: ${JSON.stringify(await view())}`);
  log(`screenshot: ${await ctx.shot("TERM-106-restored-view")}`);
  await ctx.typeInto(0, "Write-Output ('WD2=' + (Get-Location).Path)");
  const wd2Line = await waitFor("the new shell's folder", async () => ((await ctx.text(0)) ?? "").split("\n").map((l) => l.trim()).find((l) => /^WD2=/.test(l)) ?? null, 30000, 500).catch(() => null);
  const rows = ((await ctx.text(0)) ?? "").split("\n").map((l) => l.trimEnd());
  const iM = rows.findIndex((l) => l.trim() === M);
  const iNote = rows.findIndex((l) => l.includes(NOTE));
  const iPrompt = rows.findIndex((l, i) => i > iNote && iNote >= 0 && /^PS .*>/.test(l.trim()));
  log(`rows: marker ${iM}, restored note ${iNote}, new prompt ${iPrompt} (buffer ${rows.length} rows)`);
  log(`buffer tail: ${JSON.stringify(rows.filter((l) => l.trim()).slice(-8))}`);
  check("the earlier output (marker) is on screen", iM >= 0, `row ${iM}`);
  check("the earlier output is above the restored note, which is above a new prompt", iM >= 0 && iNote > iM && iPrompt > iNote, `marker ${iM} < note ${iNote} < prompt ${iPrompt}`);
  const wd2 = wd2Line ? wd2Line.slice(4) : "";
  check("the new shell is in the same folder as the old one", !!wd2 && norm(wd2) === norm(wd0), `${wd2} vs ${wd0}`);
  log(`after typing: ${JSON.stringify(await view())}`);
  log(`screenshot: ${await ctx.shot("TERM-106-after-relaunch")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-106", ev, ok) : 1);
