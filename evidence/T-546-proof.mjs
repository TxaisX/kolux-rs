// T-546 live proof driver (OD-09 control tower): drives the look-lane dev app that T-546-run.mjs
// launched (scratch profile under G:/Temp/look-t546, CDP 9249) and prints raw readings.
// Two shells and two stand-in Claude Code panes: the stand-in records its hook endpoint, the driver
// posts the hook events itself (one pane working with a tool, one waiting on a permission), opens
// the Tower, reads every row, clicks rows and reads which pane got the focus, then changes the
// waiting pane's state and times the row update. Never touches a real account or CLI.
// Usage: node evidence/T-546-proof.mjs <app pid> <step: tour|standin|panes|events|tower|click|update|shot|all>
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";

const ROOT = "G:/Dev/kolux-rs-lanes/look";
const TEMP = "G:/Temp/look-t546";
const STANDIN = `${TEMP}/standin`;
const REPO = `${TEMP}/repo`;
const CDP = "9249";
const PID = process.argv[2];
const CLAUDE = 'section.pane[data-agent*="claude"]';
const SHELL = 'section.pane[data-agent="shell"]';
const run = (f, a, env) => new Promise((res, rej) => execFile(f, a, { env: { ...process.env, ...env }, maxBuffer: 1 << 24 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so.trim()))));
const cdp = (...a) => run(process.execPath, [`${ROOT}/scripts/evidence/cdp.mjs`, "main", ...a], { CDP_PORT: CDP });
const ev = async (js) => {
  const out = await cdp("eval", js);
  let v = JSON.parse(out);
  if (v && typeof v === "object" && v.exceptionDetails) throw new Error(JSON.stringify(v.exceptionDetails));
  if (v && typeof v === "object" && v.result && typeof v.result === "object" && "type" in v.result) v = v.result.value ?? null;
  return v;
};
const invoke = (cmd, args = {}) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(v => v === undefined ? null : v)`);
const ps = (s) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", s]);
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
const newTab = async (re) => {
  await ev(`document.querySelector("button.newtab").click(), true`);
  await waitFor("the New tab menu", () => ev(`!!document.querySelector('[role="menu"][aria-label="New tab"]')`), 5000);
  const r = await ev(`(() => { const items = [...document.querySelectorAll('[role="menu"][aria-label="New tab"] [role="menuitem"]')]; const e = items.find(x => ${re}.test((x.querySelector(".name") ?? x).textContent || "")); if (!e) return "missing: " + items.map(x => x.textContent.trim()).join(" | "); e.click(); return "clicked " + e.textContent.trim(); })()`);
  if (r.startsWith("missing")) throw new Error(`no New tab item matching ${re} (${r})`);
  return r;
};
// Every tower row, in order, as the viewer sees it.
const rows = () => ev(`[...document.querySelectorAll(".tower .row")].map(r => ({ id: r.id, lane: r.className.replace("row", "").trim(), selected: r.getAttribute("aria-selected"), text: [...r.children].map(c => c.textContent.trim()).filter(Boolean).join(" | ") }))`);
const cards = () => ev(`[...document.querySelectorAll(".tower .top .card")].map(c => c.getAttribute("aria-label") + ": " + c.textContent.trim())`);
const sections = () => ev(`[...document.querySelectorAll(".tower .list section")].map(s => s.querySelector("h3").textContent.trim())`);
const focusedPane = () => ev(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(CLAUDE)})]; const f = document.querySelector("section.pane.focused"); return { label: f ? f.getAttribute("aria-label") : null, claudeIndex: f ? all.indexOf(f) : -1, visible: f ? f.offsetParent !== null : false, screen: document.querySelector("nav.switcher button[aria-pressed=true]")?.textContent.trim() ?? null, towerShown: !!document.querySelector(".tower") }; })()`);
// The stand-in's recorded endpoints: pane-<handle>.env (KOLUX_PANE_KEY is the pane's hex handle, not
// the window's row key) holds port, token, identity, config dir; oldest file first = the pane opened first.
const endpoints = () => (existsSync(STANDIN) ? readdirSync(STANDIN).filter((f) => /^pane-[0-9a-f]+\.env$/.test(f)) : []).map((f) => {
  const [port, token, identity, config] = readFileSync(`${STANDIN}/${f}`, "utf8").split(/\r?\n/).map((l) => l.trim());
  return { key: f.slice(5, 13), port, token, identity, config, at: statSync(`${STANDIN}/${f}`).mtimeMs };
}).sort((a, b) => a.at - b.at);
async function post(ep, session, event) {
  const body = JSON.stringify({ hook_event_name: event.name, session_id: session, cwd: REPO, ...event.extra });
  // node:http, not fetch: fetch adds Sec-Fetch-* headers and the endpoint answers those 404 (BROW-051).
  const status = await new Promise((res, rej) => {
    const r = request({ host: "127.0.0.1", port: Number(ep.port), path: "/claude", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-Kolux-Token": ep.token, "X-Kolux-Pane": ep.identity, "X-Kolux-Config": ep.config } }, (m) => { m.resume(); m.on("end", () => res(m.statusCode)); });
    r.on("error", rej);
    r.end(body);
  });
  return `${event.name}${event.extra?.tool_name ? `(${event.extra.tool_name})` : ""} -> HTTP ${status}`;
}

const step = process.argv[3] ?? "all";
const is = (s) => step === s || step === "all";

// The first-run wizard (role=dialog "Get started with Kolux"): its Close button carries a title, and
// closing asks "Skip setup?", answered with Skip.
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

if (is("standin")) {
  // The stand-in for Claude Code: the same guards and endpoint-file read as the smoke's flow 4 stand-in
  // (hooks.rs), but instead of posting a fixed script it records where to post (port, token, identity,
  // config dir) so this driver can play any sequence of events per pane; then it stays up like a session.
  mkdirSync(STANDIN, { recursive: true });
  writeFileSync(`${STANDIN}/session-start.json`, JSON.stringify({ hook_event_name: "SessionStart", session_id: "t546", cwd: REPO, source: "startup" }));
  const post = (file) => `type "%~dp0${file}" | %SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1`;
  writeFileSync(
    `${STANDIN}/claude.cmd`,
    [
      "@echo off",
      "echo Kolux RS T-546 stand-in for Claude Code: records its hook endpoint, posts SessionStart, stays up.",
      'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
      "setlocal",
      'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
      'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
      'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
      '(echo %KP%& echo %KT%& echo %KOLUX_HOOK_IDENTITY%& echo %CLAUDE_CONFIG_DIR%) > "%~dp0pane-%KOLUX_PANE_KEY%.env"',
      post("session-start.json"),
      "echo stand-in pane %KOLUX_PANE_KEY%: endpoint recorded; staying up",
      "ping -n 3600 127.0.0.1 >nul",
      "",
    ].join("\r\n"),
  );
  const old = await invoke("get_settings");
  const had = old && typeof old === "object" && "agentOptions" in old;
  const agentOptions = { ...(had ? old.agentOptions : {}), claude: { ...(had ? (old.agentOptions?.claude ?? {}) : {}), command: `${STANDIN}/claude.cmd`.replace(/\//g, "\\") } };
  writeFileSync(`${STANDIN}/restore.json`, JSON.stringify(had ? { set: { agentOptions: old.agentOptions }, remove: [] } : { set: {}, remove: ["agentOptions"] }));
  log("stand-in set:", JSON.stringify(await invoke("settings_patch", { set: { agentOptions }, remove: [] })), "command:", agentOptions.claude.command);
}

if (is("panes")) {
  log("panes before:", JSON.stringify({ shells: await count(SHELL), claude: await count(CLAUDE), all: await count("section.pane") }));
  while ((await count(SHELL)) < 2) {
    log("new shell tab:", await newTab("/^\\s*(PowerShell|pwsh|Command Prompt|cmd|Terminal|Shell)\\b/i"));
    await sleep(1200);
  }
  for (let i = 0; i < 2; i++) {
    log("new Claude tab:", await newTab("/^\\s*Claude Code\\s*$/"));
    await sleep(1500);
  }
  await waitFor("two Claude panes", async () => (await count(CLAUDE)) >= 2, 15000);
  const ms = await waitFor("both stand-ins to record their endpoint", () => endpoints().length >= 2, 30000, 500);
  const eps = endpoints();
  log(`endpoints recorded ${ms} ms after the tabs opened: pane keys`, JSON.stringify(eps.map((e) => e.key)), "port", eps[0].port, "identity header set:", eps.every((e) => e.identity.length > 0));
  log("panes after:", JSON.stringify({ shells: await count(SHELL), claude: await count(CLAUDE), all: await count("section.pane") }));
}

if (is("events")) {
  const [a, b] = endpoints();
  if (!a || !b) throw new Error("need two recorded stand-in panes");
  log(`pane ${a.key} (working):`, await post(a, "t546-a", { name: "UserPromptSubmit", extra: { prompt: "t546: run the tests" } }), "/", await post(a, "t546-a", { name: "PreToolUse", extra: { tool_name: "Bash", tool_input: { command: "pnpm test" } } }));
  log(`pane ${b.key} (permission):`, await post(b, "t546-b", { name: "UserPromptSubmit", extra: { prompt: "t546: write the notes" } }), "/", await post(b, "t546-b", { name: "PermissionRequest", extra: { tool_name: "Write", tool_input: { file_path: `${REPO}/notes.txt` } } }));
  const dots = () => ev(`[...document.querySelectorAll(${JSON.stringify(CLAUDE + " .st")})].map(e => e.getAttribute("aria-label"))`);
  await waitFor("the two dots to read Working and Needs you", async () => { const d = await dots(); return d.some((x) => /Working/.test(x ?? "")) && d.some((x) => /Needs you|permission/i.test(x ?? "")); }, 15000, 250);
  log("pane dots:", JSON.stringify(await dots()));
}

if (is("tower")) {
  log("Tower view:", await view("Tower"));
  await waitFor("the tower", () => ev(`!!document.querySelector(".tower")`), 5000);
  await sleep(800);
  log("screen:", JSON.stringify(await focusedPane()));
  log("cards:", JSON.stringify(await cards(), null, 1));
  log("sections:", JSON.stringify(await sections()));
  const r = await rows();
  log(`rows (${r.length}):`);
  for (const x of r) console.log(`    ${x.id} [${x.lane}] ${x.text}`);
  log("shells in the window (not rows: the tower lists agents):", await count(SHELL));
}

if (is("click")) {
  // Rows carry the window's pane keys (tower-<key>) and the panes render in key order, so the higher key
  // is the second Claude section. Which row is which pane follows from the lanes the posted events made.
  const needsId = await ev(`document.querySelector(".tower .row.needs")?.id ?? null`);
  const workingId = await ev(`document.querySelector(".tower .row.working")?.id ?? null`);
  const keyOf = (id) => Number(String(id).replace("tower-", ""));
  // Every row is a Claude pane here (shells are not rows), so a pane's section index among the Claude
  // panes is the number of rows with a lower key.
  const keys = (await ev(`[...document.querySelectorAll(".tower .row")].map((r) => r.id)`)).map(keyOf);
  const idxOf = (id) => keys.filter((k) => k < keyOf(id)).length;
  const needsIdx = idxOf(needsId);
  const workingIdx = idxOf(workingId);
  log("needs-you row:", needsId, "working row:", workingId, "-> the needs-you pane is Claude section", needsIdx, "and the working pane is section", workingIdx);
  const before = await focusedPane();
  log("before click:", JSON.stringify(before));
  await ev(`document.querySelector(".tower .row.needs").click(), true`);
  const ms = await waitFor("a focused pane on the Terminals screen", async () => { const f = await focusedPane(); return !f.towerShown && f.label !== null ? f : null; }, 5000, 50);
  const after = await focusedPane();
  log(`after click (${ms} ms):`, JSON.stringify(after), `-> the needs-you pane (Claude section ${needsIdx}, row ${needsId}) is focused:`, after.claudeIndex === needsIdx);
  // The other way round, so the mapping is proven in both directions.
  log("Tower view:", await view("Tower"));
  await waitFor("the tower", () => ev(`!!document.querySelector(".tower")`), 5000);
  await ev(`document.getElementById(${JSON.stringify(workingId)}).click(), true`);
  await waitFor("a focused pane", async () => !(await focusedPane()).towerShown, 5000, 50);
  const again = await focusedPane();
  log(`after clicking the working row ${workingId}:`, JSON.stringify(again), `-> the working pane (Claude section ${workingIdx}) is focused:`, again.claudeIndex === workingIdx);
}

if (is("update")) {
  const [, b] = endpoints();
  log("Tower view:", await view("Tower"));
  await waitFor("the tower", () => ev(`!!document.querySelector(".tower")`), 5000);
  const id = await ev(`document.querySelector(".tower .row.needs")?.id ?? null`);
  const was = (await rows()).find((r) => r.id === id);
  log("row before:", JSON.stringify(was));
  const t = Date.now();
  log("post:", await post(b, "t546-b", { name: "PostToolUse", extra: { tool_name: "Write", tool_input: { file_path: `${REPO}/notes.txt` } } }));
  const ms = await waitFor("the row to leave needs-you", async () => { const r = (await rows()).find((x) => x.id === id); return r && r.lane !== "needs" ? r : null; }, 5000, 50);
  const now = (await rows()).find((r) => r.id === id);
  log(`row after (${Date.now() - t} ms after the post, ${ms} ms of polling):`, JSON.stringify(now), "within 2 s:", Date.now() - t <= 2000);
  log("post:", await post(b, "t546-b", { name: "Stop", extra: { last_assistant_message: "Notes written and checked." } }));
  const ms2 = await waitFor("the row to read done", async () => { const r = (await rows()).find((x) => x.id === id); return r && r.lane === "done" ? r : null; }, 5000, 50);
  log(`row after Stop (${ms2} ms):`, JSON.stringify((await rows()).find((r) => r.id === id)));
  log("order now:", JSON.stringify((await rows()).map((r) => `${r.id}:${r.lane}`)));
}

if (is("shot")) {
  // The first-run wizard can open after the tour step ran: close it so the picture shows the tower.
  await closeTour();
  log("Tower view:", await view("Tower"));
  await waitFor("the tower", () => ev(`!!document.querySelector(".tower")`), 5000);
  await sleep(600);
  log("shot:", await ps(`& '${ROOT}/scripts/evidence/shot.ps1' -Out 'G:/Dev/kolux-rs-lanes/look/evidence/T-546.png' -ProcessId ${PID}`));
}

if (is("restore")) {
  const r = JSON.parse(readFileSync(`${STANDIN}/restore.json`, "utf8"));
  log("settings restored:", JSON.stringify(await invoke("settings_patch", r)));
}
log("done");
