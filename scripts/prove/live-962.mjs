// LIVE proof, after.md row 962 (fix-other card 37 NIT): the New session sheet still lists models when `grok models` and
// `cursor-agent --list-models` run with stdout piped, stdin null, stderr dropped and only exit 0 accepted.
// Stand-in grok.cmd / cursor-agent.cmd sit in a scratch folder at the front of the app's PATH BEFORE it starts (no real
// agent is ever run). The listing is asked once per agent per app run, so there are two launches:
//   node live-962.mjs 1   grok = fixed list; cursor-agent = a list followed by about 200 KB of banner (over the 64 KB pipe buffer)
//   node live-962.mjs 2   grok = waits on stdin (findstr reads NUL) then prints its list; cursor-agent = hangs for an hour
// Run 2 times the app against the 10 s listing limit and checks no stand-in process outlives the listing.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { reporter, startPlain, finish, sleep, LIVE_BASE, LIVE_LOGS } from "./live-common.mjs";
import { PLUS } from "./live-SESS-004.mjs";

const RUN = process.argv[2] === "2" ? 2 : 1;
const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const win = (p) => p.replaceAll("/", "\\");
const BIN = `${LIVE_BASE}/standin-962-${RUN}`;
const CALLS = `${LIVE_BASE}/standin-962-${RUN}-calls.log`;
const HANG = 3600 + RUN; // unique ping count, so the pid check finds only this stand-in's child
const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
const stand = () => ps(`Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -match '^(cmd|ping|findstr)\\.exe$' -and $_.CommandLine -match 'standin-962|ping -n ${HANG}|findstr' } | ForEach-Object { "$($_.ProcessId):$($_.Name)" }`).split(/\r?\n/).filter(Boolean);

function writeStandins() {
  if (existsSync(BIN)) rmSync(BIN, { recursive: true, force: true });
  mkdirSync(BIN, { recursive: true });
  writeFileSync(CALLS, "");
  const calls = win(CALLS);
  const head = (who) => [`@echo off`, `if "%~1"=="--version" (echo ${who} 0.0.0-standin & exit /b 0)`, `echo %time% ${who} start %* >> "${calls}"`];
  const rows = (pairs) => pairs.map(([id, name]) => `echo ${id} - ${name}`);
  let grok;
  let cursor;
  if (RUN === 1) {
    grok = [...head("grok"), `echo Available models`, ...rows([["grok-standin-alpha", "Standin Alpha"], ["grok-standin-beta", "Standin Beta"]]), `echo %time% grok end >> "${calls}"`, `exit /b 0`];
    cursor = [
      ...head("cursor-agent"),
      ...rows([["cursor-standin-one", "Standin One"], ["cursor-standin-two", "Standin Two"]]),
      `for /L %%i in (1,1,3000) do echo Tip %%i: this banner line only pads the output well past the 64 KB pipe buffer xxxxxxxxxxxx`,
      `echo %time% cursor-agent end >> "${calls}"`,
      `exit /b 0`,
    ];
  } else {
    grok = [...head("grok"), `findstr "^" >nul`, `echo %time% grok stdin returned >> "${calls}"`, ...rows([["grok-standin-alpha", "Standin Alpha"], ["grok-standin-beta", "Standin Beta"]]), `exit /b 0`];
    cursor = [...head("cursor-agent"), `ping -n ${HANG} 127.0.0.1 >nul`, `echo %time% cursor-agent end >> "${calls}"`, ...rows([["cursor-standin-late", "Standin Late"]]), `exit /b 0`];
  }
  writeFileSync(`${BIN}/grok.cmd`, grok.join("\r\n") + "\r\n");
  writeFileSync(`${BIN}/cursor-agent.cmd`, cursor.join("\r\n") + "\r\n");
}

const radios = (app, group) =>
  app.evalJs(`(() => { const g = document.querySelector('[role=radiogroup][aria-label=${JSON.stringify(group)}]'); return g ? [...g.querySelectorAll("label.choice")].map(l => ({ t: l.textContent.trim(), c: l.querySelector("input")?.checked })) : null; })()`);
const pickAi = (app, re) =>
  app.evalJs(`(() => {
    const g = () => document.querySelector('[role=radiogroup][aria-label="Seat 1: which AI"]');
    let l = [...g().querySelectorAll("label.choice")].find(l => ${re}.test(l.textContent));
    if (!l) { const more = [...g().querySelectorAll("button.agent-link")].find(b => /^More agents/.test(b.textContent)); if (more) more.click(); }
    return new Promise(r => setTimeout(() => { l = [...g().querySelectorAll("label.choice")].find(l => ${re}.test(l.textContent)); if (!l) return r(null); l.querySelector("input").click(); r({ text: l.textContent.trim(), title: l.title }); }, 400));
  })()`);
const labelsOf = async (app) => ((await radios(app, "Seat 1: which model")) ?? []).map((r) => r.t.replace(/^Model/, ""));
const realExes = async (app) => (await app.treeOf(app.pid)).filter((p) => /^(claude|codex|grok|cursor-agent|cursor)(\.exe)?$/i.test(p.name)).map((p) => `${p.name}:${p.pid}`);

try {
  writeStandins();
  log(`run ${RUN}: stand-ins in ${BIN} (grok.cmd, cursor-agent.cmd), call log ${CALLS}`);
  ctx = await startPlain(`962-${RUN}`, { report: rep, pathDirs: [BIN] });
  const { app } = ctx;
  await sleep(3000);
  log(`real agent exes in the app tree at start: ${JSON.stringify(await realExes(app))}`);
  const t0 = Date.now();
  await app.evalJs(`document.querySelector(${JSON.stringify(PLUS)}).click()`);
  for (let i = 0; i < 30 && !(await app.exists('[role=menu][aria-label="New session"]')); i++) await sleep(300);
  await app.evalJs(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label="New session"] [role=menuitem]')].find(b => /^Open a pane that asks/.test(b.title)); b.click(); return true; })()`);
  let sheet = false;
  for (let i = 0; i < 40 && !sheet; i++) {
    sheet = await app.exists('[role=radiogroup][aria-label="Seat 1: which AI"]');
    if (!sheet) await sleep(300);
  }
  check("the chooser opens with the Seat 1 AI choices", sheet, `${Date.now() - t0} ms after the click`);
  log(`AI choices: ${JSON.stringify((await radios(app, "Seat 1: which AI")).map((r) => r.t))}`);
  log(`screenshot: ${await ctx.shot(`962-${RUN}-chooser`)}`);

  // Which agent file did the app resolve?
  const grokPick = await pickAi(app, "/grok/i");
  log(`picked Grok: ${JSON.stringify(grokPick)}`);
  check("Grok resolves to the stand-in grok.cmd on the scratch PATH", !!grokPick && /standin-962/i.test(grokPick.title ?? ""), JSON.stringify(grokPick));

  // Poll for the discovered models of Grok.
  const seen = async (re, ms) => {
    const s = Date.now();
    for (;;) {
      const l = await labelsOf(app);
      if (l.some((x) => re.test(x))) return { at: Date.now() - t0, labels: l };
      if (Date.now() - s > ms) return { at: null, labels: l };
      await sleep(400);
    }
  };
  const g = await seen(/Standin Alpha/, 25000);
  log(`Grok model choices after ${g.at ?? "never (25 s)"} ms from the open: ${JSON.stringify(g.labels)}`);
  check("Grok's model choices are the stand-in's own list (Standin Alpha, Standin Beta)", g.at !== null && g.labels.some((x) => /Standin Beta/.test(x)), `${JSON.stringify(g.labels)} at ${g.at} ms`);
  log(`screenshot: ${await ctx.shot(`962-${RUN}-grok`)}`);

  const cur = await pickAi(app, "/cursor/i");
  log(`picked Cursor: ${JSON.stringify(cur)}`);
  check("Cursor resolves to the stand-in cursor-agent.cmd on the scratch PATH", !!cur && /standin-962/i.test(cur.title ?? ""), JSON.stringify(cur));
  if (RUN === 1) {
    const c = await seen(/Standin One/, 25000);
    log(`Cursor model choices after ${c.at ?? "never (25 s)"} ms from the open: ${JSON.stringify(c.labels)}`);
    check("a listing over 64 KB (rows first, about 200 KB of banner after) is still read: Cursor shows Standin One and Standin Two", c.at !== null && c.labels.some((x) => /Standin Two/.test(x)), `${JSON.stringify(c.labels)} at ${c.at} ms`);
    log(`screenshot: ${await ctx.shot(`962-${RUN}-cursor`)}`);
  } else {
    // Hanging cursor-agent: the listing is cut off at the 10 s limit; the sheet must stay usable meanwhile.
    const lat = [];
    for (let i = 0; i < 5; i++) {
      const s = Date.now();
      await app.evalJs("1+1");
      lat.push(Date.now() - s);
      await sleep(500);
    }
    log(`while the cursor-agent stand-in hangs: page answers in ${JSON.stringify(lat)} ms; stand-in processes now: ${JSON.stringify(stand())}`);
    check("the sheet stays responsive while a listing hangs (page round-trips under 1 s)", Math.max(...lat) < 1000, JSON.stringify(lat));
    await sleep(Math.max(0, 15000 - (Date.now() - t0)));
    const c = await labelsOf(app);
    log(`Cursor model choices at ${Date.now() - t0} ms from the open: ${JSON.stringify(c)}`);
    check("the hanging listing adds no models (Cursor keeps its default choices)", !c.some((x) => /Standin Late/.test(x)), JSON.stringify(c));
    log(`screenshot: ${await ctx.shot(`962-${RUN}-cursor-hang`)}`);
  }

  // No stand-in outlives the listing.
  await sleep(RUN === 2 ? 4000 : 2000);
  const left = stand();
  log(`stand-in processes (cmd/ping/findstr of the stand-ins) still alive ${Date.now() - t0} ms after the open: ${JSON.stringify(left)}`);
  check("no stand-in process outlives the listing", left.length === 0, JSON.stringify(left));
  log(`stand-in call log:\n${readFileSync(CALLS, "utf8").trim()}`);
  const exes = await realExes(app);
  log(`real agent exes in the app tree: ${JSON.stringify(exes)}`);
  check("no real agent program ran under the app", exes.length === 0, JSON.stringify(exes));
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
const code = ctx ? await finish(ctx, `962-${RUN}`, ev, ok) : 1;
const evidence = "G:/Dev/kolux-rs-lanes/prove/evidence/live-962-model-listing.txt";
const stamp = new Date().toISOString().slice(0, 10);
const section = `LIVE ${stamp} (batch 8) run ${RUN} of 2: ${RUN === 1 ? "grok = fixed list; cursor-agent = list + about 200 KB banner" : "grok = waits on stdin; cursor-agent = hangs"} (scripts/prove/live-962.mjs ${RUN})\n${ev.join("\n")}\nresult: ${ok ? "PASS" : "FAIL"}\n\n`;
if (RUN === 1) writeFileSync(evidence, `After.md row 962: do grok models / cursor-agent --list-models (stdout piped, stdin null, 10 s limit) still fill the New session sheet?\nStand-in scripts only; no real agent was run.\n\n${section}`);
else appendFileSync(evidence, section);
process.exit(code);
