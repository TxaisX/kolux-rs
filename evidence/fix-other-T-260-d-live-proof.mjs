// T-260-d live proof (LIVE PROOF PENDING: written by a builder, never run): nested lanes on the Floor.
// Run by the merge resolver on main after the merge. It drives an ALREADY RUNNING app over its WebView2
// debugging port (attach mode, like smoke.mjs --attach) and launches nothing itself.
//
//   node evidence/fix-other-T-260-d-live-proof.mjs --cdp <port> --pid <app pid> [--temp <dir>] [--cli <kolux-dev.exe>]
//
//   --cdp   the app's remote-debugging port (the one in WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>)
//   --pid   the app's process id. REQUIRED: the script moves that window to -32000,-32000 (hidden, not activated)
//           before touching anything and refuses to run without it
//   --temp  scratch folder, default G:/Temp/fix-other-T-260-d-proof (must sit under G:/Temp; wiped at start)
//   --cli   the built kolux-dev.exe, default <repo>/src-tauri/target/debug/kolux-dev.exe (cargo build --bin kolux-dev)
//
// Prints one line per check and ends with exactly one of
//   T-260-d live proof: PASS
//   T-260-d live proof: FAIL (<reason>)
// and exits 0 or 1 (2 for a bad command line). Safety: the app must have been started with scratch
// CLAUDE_CONFIG_DIR / CODEX_HOME / USERPROFILE / HOME (see evidence/fix-other-T-260-d-live-proof.txt); this script
// only changes the app's agentOptions.claude.command (to a stand-in program, no real agent ever starts) and the
// chord of view.floor, and puts both back at the end.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

for (const k of Object.keys(process.env)) if (k.startsWith("KOLUX_")) delete process.env[k];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const CDP = opt("cdp", "");
const PID = opt("pid", "");
const TEMP = resolve(opt("temp", "G:/Temp/fix-other-T-260-d-proof")).replace(/\\/g, "/");
const CLI = resolve(opt("cli", join(root, "src-tauri", "target", "debug", "kolux-dev.exe"))).replace(/\\/g, "/");
if (!/^\d+$/.test(CDP) || !/^\d+$/.test(PID)) {
  console.error("usage: node evidence/fix-other-T-260-d-live-proof.mjs --cdp <port> --pid <app pid> [--temp <dir under G:/Temp>] [--cli <kolux-dev.exe>]");
  process.exit(2);
}
if (!/^G:\/Temp\/[^/]+/i.test(TEMP)) {
  console.error(`refused: --temp must be a folder under G:/Temp (got ${TEMP})`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const win = (p) => p.replace(/\//g, "\\");
const run = (file, a, options = {}) =>
  new Promise((res, rej) => execFile(file, a, { windowsHide: true, maxBuffer: 1 << 24, ...options }, (err, stdout, stderr) => (err ? rej(Object.assign(err, { stdout, stderr })) : res({ stdout, stderr }))));
const ps = (script) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).then((r) => r.stdout.trim());

async function waitFor(what, probe, ms = 15000, every = 250) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await probe();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
    await sleep(every);
  }
}

// ---- a small CDP client (one connection for the whole run) ----
let ws;
let nextId = 0;
const waiting = new Map();
async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = targets.find((t) => t.type === "page" && /localhost:\d+|tauri\.localhost/.test(t.url));
  if (!page) throw new Error(`no app page on CDP port ${CDP} (targets: ${targets.map((t) => t.url).join(", ")})`);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = no;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    }
  };
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++nextId;
    waiting.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`page threw: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
}
const invoke = (cmd, params = {}) => evalJs(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(params)}).then(v => v === undefined ? null : v)`);
const count = (sel) => evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const exists = async (sel) => (await count(sel)) > 0;
async function click(sel) {
  const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "missing"; e.click(); return "clicked"; })()`);
  if (r !== "clicked") throw new Error(`nothing to click at ${sel}`);
}
async function clickWhere(sel, textRe) {
  const r = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => ${textRe}.test((x.querySelector(".name") ?? x).textContent || "")); if (!e) return "missing"; e.click(); return "clicked"; })()`);
  if (r !== "clicked") throw new Error(`no ${sel} whose text matches ${textRe}`);
}
async function focusField(sel) {
  const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "missing"; e.focus(); return document.activeElement === e ? "focused" : "not-focused"; })()`);
  if (r !== "focused") throw new Error(`could not focus ${sel}: ${r}`);
}
async function chord(key, mods) {
  const k = { code: `Key${key.toUpperCase()}`, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: mods, ...k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: mods, ...k });
}

// ---- scratch material ----
const repo = `${TEMP}/repo`;
const standin = `${TEMP}/standin`;
const handlesFile = `${TEMP}/handles.txt`;
const events = (name, extra) => JSON.stringify({ hook_event_name: name, session_id: "t260d-standin", cwd: repo, ...extra });
const post = (file) =>
  `type "%~dp0${file}" | %SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1`;

// The stand-in for the Claude Code program: reports the same status events a session would (so the pane gets a
// Floor lane), notes its own terminal handle, then keeps polling for a command file named for that handle and
// runs it. Run from inside the pane, a kolux-dev call carries the pane's own identity (KOLUX_TERMINAL_HANDLE +
// KOLUX_PANE_KEY), which is what makes the pane a coordinator.
function writeStandin() {
  mkdirSync(standin, { recursive: true });
  writeFileSync(join(standin, "session-start.json"), events("SessionStart", { source: "startup" }));
  writeFileSync(join(standin, "prompt.json"), events("UserPromptSubmit", { prompt: "T-260-d proof: report status" }));
  const todo = `${win(TEMP)}\\do-%KOLUX_TERMINAL_HANDLE%.cmd`;
  writeFileSync(
    join(standin, "claude.cmd"),
    [
      "@echo off",
      "echo Kolux RS T-260-d proof stand-in for Claude Code: posts hook events, then runs command files for this pane.",
      'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
      "setlocal",
      'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
      'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
      'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
      post("session-start.json"),
      post("prompt.json"),
      `>>"${win(handlesFile)}" echo %KOLUX_TERMINAL_HANDLE%`,
      ":loop",
      `if exist "${todo}" (`,
      `  move /y "${todo}" "${todo}.run" >nul`,
      `  call "${todo}.run"`,
      `  del "${todo}.run" >nul 2>&1`,
      ")",
      "ping -n 2 127.0.0.1 >nul",
      "goto loop",
      "",
    ].join("\r\n"),
  );
  return `${standin}/claude.cmd`;
}

const handles = () => (existsSync(handlesFile) ? readFileSync(handlesFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []);
const outFile = (name) => `${TEMP}/out-${name}.json`;
// Hands one CLI call to the coordinator pane and returns the JSON answer it wrote.
async function coordinator(handle, name, line) {
  rmSync(outFile(name), { force: true });
  const body = ["@echo off", `"${win(CLI)}" ${line} --json > "${win(outFile(name))}" 2>&1`, ""].join("\r\n");
  writeFileSync(`${TEMP}/do-${handle}.cmd.tmp`, body);
  // Written under a temporary name and renamed, so the stand-in never reads half a file.
  await run("cmd", ["/c", "move", "/y", win(`${TEMP}/do-${handle}.cmd.tmp`), win(`${TEMP}/do-${handle}.cmd`)]);
  const text = await waitFor(`the answer to "${line}"`, () => {
    if (!existsSync(outFile(name))) return null;
    const t = readFileSync(outFile(name), "utf8");
    const from = t.indexOf("{");
    if (from < 0) return null;
    try {
      JSON.parse(t.slice(from));
      return t.slice(from);
    } catch {
      return null;
    }
  }, 120000, 500);
  return JSON.parse(text);
}
// First string value under a key anywhere in the answer.
const deep = (v, key, re) => {
  if (v && typeof v === "object") {
    if (typeof v[key] === "string" && (!re || re.test(v[key]))) return v[key];
    for (const x of Object.values(v)) {
      const hit = deep(x, key, re);
      if (hit) return hit;
    }
  }
  return null;
};

const results = [];
const check = (ok, what) => {
  results.push([ok, what]);
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};

async function main() {
  // 0. Hidden window first: nothing below touches a visible window.
  const moved = await ps(
    `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W -Namespace U
     $h = [IntPtr]::Zero; for ($i = 0; $i -lt 20 -and $h -eq [IntPtr]::Zero; $i++) { $h = (Get-Process -Id ${PID}).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 } }
     if ($h -eq [IntPtr]::Zero) { 'no window handle' } else { [U.W]::SetWindowPos($h,[IntPtr]::Zero,-32000,-32000,0,0,0x0015) | Out-Null; 'moved off-screen' }`,
  );
  if (moved !== "moved off-screen") throw new Error(`could not hide the window of pid ${PID}: ${moved}`);
  console.log(`window of pid ${PID}: ${moved}`);
  if (!existsSync(CLI)) throw new Error(`the CLI is not built: ${CLI} (cargo build --manifest-path src-tauri/Cargo.toml --bin kolux-dev)`);

  // 1. Scratch repo + stand-in.
  rmSync(TEMP, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "notes.txt"), "t260d\n");
  const git = (a) => run("git", a, { cwd: repo });
  await git(["init", "-q", "-b", "main"]);
  await git(["-c", "user.name=t260d", "-c", "user.email=t260d@example.invalid", "add", "."]);
  await git(["-c", "user.name=t260d", "-c", "user.email=t260d@example.invalid", "commit", "-q", "-m", "t260d"]);
  const command = writeStandin();

  await connect();
  await waitFor("the app page", () => exists("aside.sidebar"), 60000, 1000);
  const oldSettings = await invoke("get_settings");
  const had = oldSettings && typeof oldSettings === "object" && "agentOptions" in oldSettings;
  const restore = async () => {
    if (had) await invoke("settings_patch", { set: { agentOptions: oldSettings.agentOptions }, remove: [] }).catch(() => {});
    else await invoke("settings_patch", { set: {}, remove: ["agentOptions"] }).catch(() => {});
    await invoke("keybindings_write", { id: "view.floor", value: null, reset: true }).catch(() => {});
  };
  try {
    await invoke("settings_patch", { set: { agentOptions: { ...(had ? oldSettings.agentOptions : {}), claude: { ...(had ? oldSettings.agentOptions?.claude ?? {} : {}), command } } }, remove: [] });
    check(true, `stand-in set as the Claude command (${command})`);

    // 2. The scratch repo as a project, then four stand-in Claude panes: A (coordinator), B, C, D (workers).
    await waitFor("the add-project button", () => exists('.sb-foot button[title^="Add a project by path"]'), 30000);
    await click('.sb-foot button[title^="Add a project by path"]');
    await waitFor("the project folder field", () => exists('input[aria-label="project folder"]'), 5000);
    await focusField('input[aria-label="project folder"]');
    await send("Input.insertText", { text: win(repo) });
    await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Enter", key: "Enter", windowsVirtualKeyCode: 13 });
    await waitFor("the first pane", () => exists("section.pane[data-agent]"), 30000);
    for (let n = 1; n <= 4; n++) {
      await click("button.newtab");
      await waitFor("the New tab menu", () => exists('[role="menu"][aria-label="New tab"]'), 5000);
      await clickWhere('[role="menu"][aria-label="New tab"] [role="menuitem"]', "/^\\s*Claude Code\\s*$/");
      await waitFor(`stand-in pane ${n} to report its terminal`, () => handles().length >= n, 45000, 500);
    }
    const [A, B, C, D] = handles();
    check(new Set([A, B, C, D]).size === 4 && [A, B, C, D].every((h) => /^term-\d+$/.test(h)), `four stand-in panes: coordinator ${A}, workers ${B} ${C} ${D}`);

    // 3. A coordinates: a parent task and its worker B, a child task of it and its worker C, and a worker D
    //    from a spec with no parent task.
    await coordinator(A, "run", "orchestration run-create --objective T-260-d-nesting-proof");
    const parent = deep(await coordinator(A, "parent-task", "orchestration task-create --spec T260d-parent-task --task-title T260d-parent"), "id", /^task-/);
    if (!parent) throw new Error("task-create answered no task id (see out-parent-task.json)");
    const b = await coordinator(A, "start-b", `orchestration worker-start --task ${parent} --terminal ${B}`);
    const child = deep(await coordinator(A, "child-task", `orchestration task-create --spec T260d-child-task --task-title T260d-child --parent ${parent}`), "id", /^task-/);
    if (!child) throw new Error("child task-create answered no task id (see out-child-task.json)");
    const c = await coordinator(A, "start-c", `orchestration worker-start --task ${child} --terminal ${C}`);
    const d = await coordinator(A, "start-d", `orchestration worker-start --spec T260d-orphan-task --terminal ${D}`);
    const started = [b, c, d].map((x) => deep(x, "dispatchId"));
    check(started.every(Boolean), `three workers started by ${A}: dispatches ${started.join(", ")}`);
    const shown = await coordinator(A, "show-d", `orchestration dispatch-show --task ${deep(d, "taskId", /^task-/)}`);
    check(JSON.stringify(shown).includes(`"fromTerminal":${A.replace("term-", "")}`), `the no-parent dispatch records fromTerminal ${A}`);

    // 4. The Floor (bound to a chord for this run only; both put back afterwards).
    await invoke("keybindings_write", { id: "view.floor", value: "Mod+Alt+Shift+F", reset: false });
    await sleep(500);
    await chord("F", 1 | 2 | 8); // Alt + Ctrl + Shift
    await waitFor("the Floor page", () => exists('section.floor[aria-label="Floor"]'), 10000);
    const lanes = await waitFor(
      "four lanes on the Floor",
      async () => {
        const rows = await evalJs(`[...document.querySelectorAll(".floor-lane")].map(l => ({ depth: Number(l.dataset.depth), term: (/Terminal (\\d+)/.exec(l.querySelector(".floor-name")?.textContent ?? "") ?? [])[1] ?? null, name: l.querySelector(".floor-name")?.getBoundingClientRect().right ?? null, bar: l.lastElementChild?.getBoundingClientRect().left ?? null }))`);
        return rows.length >= 4 && [A, B, C, D].every((h) => rows.some((r) => r.term === h.replace("term-", ""))) ? rows : null;
      },
      60000,
      1000,
    );
    const depthOf = (h) => lanes.find((r) => r.term === h.replace("term-", ""))?.depth;
    check(depthOf(A) === 0, `coordinator ${A} is a top lane (depth ${depthOf(A)})`);
    check(depthOf(B) === 1, `${B}, started by ${A} for a task with no parent task, nests one level under it (depth ${depthOf(B)})`);
    check(depthOf(C) === 2, `${C}, whose task names ${B}'s task as its parent, nests under ${B} (depth ${depthOf(C)})`);
    check(depthOf(D) === 1, `${D}, started from a spec with no parent task, nests under ${A} (depth ${depthOf(D)})`);
    const bars = new Set(lanes.map((r) => Math.round(r.bar)));
    const axis = await evalJs(`Math.round(document.querySelector(".floor-axis")?.getBoundingClientRect().left ?? -1)`);
    check(bars.size === 1 && bars.has(axis), `every lane's bar starts at the axis (bars ${[...bars].join(",")}, axis ${axis})`);
  } finally {
    await restore();
    if (ws) ws.close();
  }
}

try {
  await main();
} catch (e) {
  check(false, `stopped: ${e instanceof Error ? e.message : e}`);
}
const failed = results.filter(([ok]) => !ok);
if (failed.length === 0) console.log("T-260-d live proof: PASS");
else console.log(`T-260-d live proof: FAIL (${failed.map(([, w]) => w).join("; ")})`);
process.exit(failed.length === 0 ? 0 : 1);
