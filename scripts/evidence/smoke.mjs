// Smoke run (T-542): four end-to-end flows through the dev app's own WebView2 debugging port, built on
// scripts/evidence/cdp.mjs (run as a child process: it is a command-line tool, not a library). Prints one
// PASS or FAIL line per flow and exits 1 when any flow failed, so a merge or a structural move of App.tsx
// and lib.rs is checked by behaviour, not by screenshots.
//
//   pnpm smoke                       launch the app from this checkout with its own profile, run, close, clean up
//   pnpm smoke -- --attach           drive an app that is already running with --remote-debugging-port=<cdp>
//   options: --port 1431 (vite) · --cdp 9240 · --identifier com.txaisxiong.kolux-rs.smoke · --temp <folder>
//            --only 1,3 · --keep (leave the app and the temp folder for a look) · --timeout <minutes for the first build>
//
// Flow 1  a grid grows from 4 to 6 panes and the PTYs already running keep running: each shell gets a marker
//         in an environment variable before the change and writes that variable to a file after it (only the
//         same process can know it).
// Flow 2  Mod+S in an editor tab writes the file: the bytes on disk carry what was typed.
// Flow 3  Discard in Source Control asks first, and Cancel loses nothing: the file and git status are unchanged.
// Flow 4  a Claude pane's status dot turns Working: agentOptions.claude.command points at a stand-in program
//         that posts the same hook events Kolux's installed hook posts (SessionStart, UserPromptSubmit) from the
//         pane's own hook variables. CLAUDE_CONFIG_DIR and CODEX_HOME point at scratch folders under --temp for
//         the launched app, so the user's real Claude and Codex configuration is never touched.
//
// Launch mode wipes and reuses the profile of --identifier (refused unless it ends in ".smoke"), seeds
// confirmCloseRunning=false so the close at the end is silent, and moves the window to the second screen when
// there is one. Attach mode changes the running app's settings for flow 4 and puts them back afterwards.
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "");
const cdpScript = join(root, "scripts", "evidence", "cdp.mjs");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const PORT = opt("port", "1431");
const CDP = opt("cdp", "9240");
const IDENTIFIER = opt("identifier", "com.txaisxiong.kolux-rs.smoke");
const TEMP = opt("temp", "G:\\Temp\\kolux-rs-smoke");
const ONLY = opt("only", "1,2,3,4").split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 4);
const ATTACH = flag("attach");
const KEEP = flag("keep");
const BUILD_MINUTES = Number(opt("timeout", "20"));

const repo = join(TEMP, "repo");
const marks = join(TEMP, "marks");
const standin = join(TEMP, "standin");
const claudeConfig = join(TEMP, "claude-config");
const codexHome = join(TEMP, "codex-home");
// A plain text file: the Explorer opens it in the CodeMirror editor, whose save writes the text as typed.
const smokeFile = join(repo, "notes.txt");
const ORIGINAL = "original line\n";

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (file, a, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(file, a, { windowsHide: true, maxBuffer: 1 << 24, ...options }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
const ps = (script) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).then((r) => r.stdout.trim());
const git = (a) => run("git", a, { cwd: repo });

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

// cdp.mjs as a child: every call is one connection to the page, which keeps this file free of protocol code.
const cdp = async (...a) => (await run(process.execPath, [cdpScript, "main", ...a], { env: { ...process.env, CDP_PORT: CDP } })).stdout.trim();
const evalJs = async (expr) => {
  const out = await cdp("eval", expr);
  let v;
  try {
    v = JSON.parse(out);
  } catch {
    throw new Error(`eval gave no JSON: ${out.slice(0, 200)}`);
  }
  if (v && typeof v === "object" && v.exceptionDetails) throw new Error(`page threw: ${v.exceptionDetails.exception?.description ?? v.exceptionDetails.text}`);
  return v;
};
const invoke = (cmd, params = {}) => evalJs(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(params)}).then(v => v === undefined ? null : v)`);
const count = (sel) => evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const exists = async (sel) => (await count(sel)) > 0;
// Panes outside the grid (a tab behind another, the workspace-less "Terminal 1" in a zero-width cell) have
// no offsetParent; only the ones a user sees count.
const shown = (sel) => evalJs(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null).length`);
const click = async (sel) => {
  const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "missing"; e.click(); return "clicked"; })()`);
  if (r !== "clicked") throw new Error(`nothing to click at ${sel}`);
};
// Matches the element's own text, or its .name child when it has one (menu items also carry a shortcut).
const clickWhere = async (sel, textRe) => {
  const r = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => ${textRe}.test((x.querySelector(".name") ?? x).textContent || "")); if (!e) return "missing"; e.click(); return "clicked"; })()`);
  if (r !== "clicked") throw new Error(`no ${sel} whose text matches ${textRe}`);
};
const focusField = async (sel) => {
  const r = await cdp("focus", sel);
  if (r !== "focused") throw new Error(`could not focus ${sel}: ${r}`);
};
// The n-th shown pane takes the focus the way a click would (App.tsx listens for mousedown), then its text field.
const focusPane = async (paneSel, index, fieldSel) => {
  const r = await evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(paneSel)})].filter(e => e.offsetParent !== null)[${index}]; if (!p) return "missing pane"; p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); const f = p.querySelector(${JSON.stringify(fieldSel)}); if (!f) return "missing field"; f.focus(); return document.activeElement === f ? "focused" : "not-focused"; })()`);
  if (r !== "focused") throw new Error(`${paneSel} #${index}: ${r}`);
};
const TERM = "section.pane[data-agent]";
const CHOOSER = "section.pane.chooser";
// The right sidebar's tab by name; the panel button opens the sidebar when it is closed.
const rightTab = async (name) => {
  if (!(await exists('aside.rside [role="tab"]'))) await click("button.ib.panel");
  await waitFor("the right sidebar", () => exists('aside.rside [role="tab"]'), 5000);
  await clickWhere('aside.rside [role="tab"]', `/^\\s*${name}\\s*$/`);
};
const LAYOUT_ON = '.layouts button[aria-pressed="true"]';
const layoutCount = () => evalJs(`document.querySelector(${JSON.stringify(LAYOUT_ON)})?.textContent.trim() ?? null`);
const pickLayout = (n) => clickWhere(".layouts button", `/^\\s*${n}\\s*$/`);
const newTab = async (label) => {
  await click("button.newtab");
  await waitFor("the New tab menu", () => exists('[role="menu"][aria-label="New tab"]'), 5000);
  await clickWhere('[role="menu"][aria-label="New tab"] [role="menuitem"]', label);
};
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

// ---------- the app: launch or attach ----------
let dev = null; // the `pnpm tauri dev` child in launch mode
let appPid = null;

async function pageUp(ms) {
  await waitFor(
    "the app page over CDP",
    async () => {
      const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
      return targets.some((t) => t.type === "page" && new RegExp(`localhost:${PORT}|tauri\\.localhost`).test(t.url));
    },
    ms,
    2000,
  );
  await waitFor("the sidebar", () => exists("aside.sidebar"), 60000, 1000);
}

async function launch() {
  const profile = join(process.env.APPDATA ?? "", IDENTIFIER);
  if (!IDENTIFIER.endsWith(".smoke")) throw new Error(`refusing to wipe the profile of ${IDENTIFIER}: use an identifier ending in ".smoke" or --attach`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "settings.json"), JSON.stringify({ confirmCloseRunning: false }, null, 2));
  mkdirSync(claudeConfig, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  const cfg = join(TEMP, "tauri.smoke.json");
  writeFileSync(cfg, JSON.stringify({ identifier: IDENTIFIER, build: { devUrl: `http://localhost:${PORT}`, beforeDevCommand: `pnpm exec vite --port ${PORT} --strictPort` } }));
  const logFile = join(TEMP, "tauri-dev.log");
  const out = (await import("node:fs")).openSync(logFile, "w");
  // One command string through the shell: pnpm is a .cmd on Windows, which Node will not spawn directly.
  dev = spawn(`pnpm tauri dev --config "${cfg}"`, {
    cwd: root,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`,
      CLAUDE_CONFIG_DIR: claudeConfig,
      CODEX_HOME: codexHome,
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4",
    },
  });
  log(`launching: pnpm tauri dev (identifier ${IDENTIFIER}, vite ${PORT}, CDP ${CDP}; log ${logFile})`);
  await pageUp(BUILD_MINUTES * 60_000);
  // The app's pid comes from its executable path inside this checkout, never from a window title.
  const exe = join(root, "src-tauri", "target").replace(/'/g, "''");
  appPid = await waitFor(
    "the app process",
    async () => Number(await ps(`(Get-CimInstance Win32_Process -Filter "Name='kolux-rs.exe'" | Where-Object { $_.ExecutablePath -like '${exe}*' } | Select-Object -First 1).ProcessId`)) || null,
    30000,
    1000,
  );
  // Second-screen rule: dev windows go to the screen at X=-1920 when it is there.
  const moved = await ps(
    `Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Screen]::AllScreens.Count -lt 2) { 'one screen'; exit }
     Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W -Namespace U
     $h = [IntPtr]::Zero; for ($i = 0; $i -lt 20 -and $h -eq [IntPtr]::Zero; $i++) { $h = (Get-Process -Id ${appPid}).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 } }
     if ($h -eq [IntPtr]::Zero) { 'no window handle' } else { [U.W]::SetWindowPos($h,[IntPtr]::Zero,-1920,0,0,0,0x0005) | Out-Null; 'moved' }`,
  );
  log(`app pid ${appPid}; window: ${moved}`);
}

async function closeApp() {
  if (ATTACH || KEEP) return;
  if (appPid) {
    try {
      await invoke("plugin:window|close", { label: "main" });
    } catch {
      /* the page may already be gone */
    }
    const gone = await waitFor("the app to exit", async () => (await ps(`if (Get-Process -Id ${appPid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`)) === "gone", 20000, 1000).catch(() => false);
    if (!gone) {
      log(`WARN the app did not exit on close; killing pid ${appPid}`);
      await run("taskkill", ["/PID", String(appPid), "/T", "/F"]).catch(() => {});
    }
  }
  if (dev?.pid) await run("taskkill", ["/PID", String(dev.pid), "/T", "/F"]).catch(() => {});
  // Orphans: anything still running from the temp folder (the stand-in, a shell started there) is reported and
  // ended; this script and its own ancestors (pnpm, the shell that ran it) carry the folder on their command line too.
  const left = await ps(
    `$all = Get-CimInstance Win32_Process; $mine = @(); $p = $PID; while ($p -and $mine -notcontains $p) { $mine += $p; $p = ($all | Where-Object ProcessId -eq $p).ParentProcessId }
     $all | Where-Object { $_.CommandLine -like '*${TEMP.replace(/'/g, "''")}*' -and $mine -notcontains $_.ProcessId } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
  ).catch(() => "");
  if (left) {
    log(`WARN processes left after close:\n${left}`);
    for (const line of left.split(/\r?\n/)) await run("taskkill", ["/PID", line.split(" ")[0], "/T", "/F"]).catch(() => {});
  } else log("no process from the temp folder survived the close");
}

// ---------- setup: a throwaway repo as a project, its main checkout open with one shell ----------
async function setup() {
  rmSync(TEMP, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  mkdirSync(marks, { recursive: true });
  writeFileSync(smokeFile, ORIGINAL);
  await git(["init", "-q", "-b", "main"]);
  await git(["-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid", "add", "."]);
  await git(["-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid", "commit", "-q", "-m", "smoke"]);
  if (!ATTACH) await launch();
  else await pageUp(30000);
  if (await exists('.onboarding, [aria-label="Welcome"]')) log("WARN a first-run dialog is open; the flows may not reach the grid");
  await click('.sb-foot button[title^="Add a project by path"]');
  await waitFor("the project folder field", () => exists('input[aria-label="project folder"]'), 5000);
  await focusField('input[aria-label="project folder"]');
  await cdp("insert", repo, "enter");
  await waitFor("the first shell pane", async () => (await shown(TERM)) >= 1, 30000);
  log(`setup: ${repo} added as a project; ${await shown(TERM)} shell pane shown`);
}

// ---------- flow 1 ----------
async function flow1() {
  const start = await shown(TERM);
  for (const want of [start + 1, start + 2]) {
    await click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} shell panes`, async () => (await shown(TERM)) === want, 10000);
  }
  await pickLayout(4);
  await waitFor("Layout 4", async () => (await layoutCount()) === "4", 5000);
  const grid = async () => ({ cells: Number(await layoutCount()), shells: await shown(TERM), choosers: await shown(CHOOSER) });
  const before = await grid();
  if (before.shells !== start + 2 || before.choosers !== 4 - before.shells) throw new Error(`expected ${start + 2} shells and ${4 - start - 2} empty pane(s) at Layout 4, got ${JSON.stringify(before)}`);
  const stamp = Date.now().toString(36);
  const markOf = (i) => `smoke-${stamp}-${i}`;
  const slash = (p) => p.replace(/\\/g, "/");
  for (let i = 0; i < before.shells; i++) {
    await focusPane(TERM, i, ".xterm-helper-textarea");
    await cdp("insert", `$env:SMOKE_MARK = '${markOf(i)}'; 'ready' | Set-Content '${slash(join(marks, `ready-${i}.txt`))}'`, "enter");
    await waitFor(`shell ${i + 1} to answer`, () => read(join(marks, `ready-${i}.txt`))?.includes("ready"), 45000, 500);
  }
  await pickLayout(6);
  await waitFor("Layout 6", async () => (await layoutCount()) === "6", 5000);
  const after = await grid();
  if (after.shells !== before.shells || after.choosers !== 6 - after.shells) throw new Error(`after Layout 6 expected the ${before.shells} shells plus ${6 - before.shells} empty panes, got ${JSON.stringify(after)}`);
  for (let i = 0; i < after.shells; i++) {
    await focusPane(TERM, i, ".xterm-helper-textarea");
    await cdp("insert", `$env:SMOKE_MARK | Set-Content '${slash(join(marks, `after-${i}.txt`))}'`, "enter");
  }
  const wanted = new Set(Array.from({ length: before.shells }, (_, i) => markOf(i)));
  await waitFor(
    "every shell to echo its marker",
    () => {
      const got = Array.from({ length: after.shells }, (_, i) => read(join(marks, `after-${i}.txt`))?.trim()).filter(Boolean);
      return got.length === wanted.size && got.every((m) => wanted.has(m)) && new Set(got).size === wanted.size;
    },
    45000,
    500,
  );
  return `grid 4 -> 6 (${before.shells} shells + ${before.choosers} empty -> ${after.shells} shells + ${after.choosers} empty); all ${after.shells} shells echoed the marker set before the change (same PTY processes)`;
}

// ---------- flow 2 ----------
const TYPED = "typed by smoke ";
async function flow2() {
  // The file was committed before the project was added, so the Explorer lists it (the tree is read once per open).
  await rightTab("Explorer");
  await waitFor("notes.txt in the Explorer", () => exists('[role="tree"] .ex-row[role="treeitem"]'), 10000);
  await clickWhere('[role="tree"] .ex-row[role="treeitem"]', "/^\\s*notes\\.txt\\s*$/");
  const editor = 'section.pane.editor[aria-label="notes.txt pane"]';
  await waitFor("the editor tab", () => shown(`${editor} .cm-content`), 10000);
  await focusPane(editor, 0, ".cm-content");
  const text = `${TYPED}${Date.now()}`;
  await cdp("insert", text);
  await waitFor("the editor to hold the text", () => evalJs(`[...document.querySelectorAll(${JSON.stringify(editor + " .cm-content")})].some(e => e.textContent.includes(${JSON.stringify(text)}))`), 5000);
  const before = read(smokeFile);
  if (before !== ORIGINAL) throw new Error("notes.txt changed on disk before Mod+S");
  await cdp("key", "s", "2"); // Ctrl+S (Mod+S on Windows)
  await waitFor("the bytes on disk", () => (read(smokeFile) ?? "").includes(text), 10000, 200);
  const now = read(smokeFile);
  if (!now.includes("original line")) throw new Error("the save lost the original line");
  return `Mod+S wrote notes.txt: disk now holds "${text}" plus the original line (${Buffer.byteLength(now)} bytes)`;
}

// ---------- flow 3 ----------
async function flow3() {
  const before = read(smokeFile);
  if (before === ORIGINAL) {
    // Flow 2 did not run or did not change the file: make a change by hand so Discard has something to ask about.
    writeFileSync(smokeFile, ORIGINAL + "changed by smoke\n");
  }
  const changed = read(smokeFile);
  const status = (await git(["status", "--porcelain"])).stdout.trim();
  if (!status.includes("notes.txt")) throw new Error(`git does not see notes.txt as changed: "${status}"`);
  await rightTab("Source Control");
  // The panel re-reads git status every 4 s.
  await waitFor("the Discard button for notes.txt", () => exists('button[aria-label="Discard notes.txt"]'), 15000, 500);
  await click('button[aria-label="Discard notes.txt"]');
  const ask = await waitFor("the discard prompt", () => evalJs(`(() => { const d = document.querySelector('[role="alertdialog"]'); if (!d) return null; return { title: d.getAttribute("aria-label"), body: d.querySelector(".ask-body")?.textContent ?? "", buttons: [...d.querySelectorAll(".btn-row button")].map(b => ({ text: b.textContent.trim(), cls: b.className })) }; })()`), 5000);
  if (ask.buttons.length < 2) throw new Error(`the prompt has no choice to cancel: ${JSON.stringify(ask)}`);
  if (read(smokeFile) !== changed) throw new Error("the file changed while the prompt was open");
  const cancel = ask.buttons.findIndex((b) => !/danger|primary/.test(b.cls));
  if (cancel < 0) throw new Error(`no cancel button in ${JSON.stringify(ask.buttons)}`);
  await evalJs(`document.querySelectorAll('[role="alertdialog"] .btn-row button')[${cancel}].click()`);
  await waitFor("the prompt to close", async () => !(await exists('[role="alertdialog"]')), 5000);
  await sleep(1000);
  if (read(smokeFile) !== changed) throw new Error("Cancel lost the change on disk");
  const statusAfter = (await git(["status", "--porcelain"])).stdout.trim();
  if (!statusAfter.includes("notes.txt")) throw new Error(`git no longer sees the change after Cancel: "${statusAfter}"`);
  return `Discard asked first ("${ask.title}", buttons ${ask.buttons.map((b) => b.text).join(" / ")}); after "${ask.buttons[cancel].text}" notes.txt and git status are unchanged`;
}

// ---------- flow 4 ----------
async function flow4() {
  mkdirSync(standin, { recursive: true });
  const event = (name, extra) => JSON.stringify({ hook_event_name: name, session_id: "smoke-standin", cwd: repo, ...extra });
  writeFileSync(join(standin, "session-start.json"), event("SessionStart", { source: "startup" }));
  writeFileSync(join(standin, "prompt.json"), event("UserPromptSubmit", { prompt: "smoke: turn the dot to Working" }));
  // The same guards, endpoint file read and curl post as Kolux's installed hook script (hooks.rs), fed the
  // JSON Claude Code would pipe in; then the stand-in stays up like a session would.
  const post = (file) =>
    `type "%~dp0${file}" | %SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1`;
  writeFileSync(
    join(standin, "claude.cmd"),
    [
      "@echo off",
      "echo Kolux RS smoke stand-in for Claude Code (T-542): posts the hook events a session would.",
      'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
      "setlocal",
      'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
      'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
      'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
      post("session-start.json"),
      post("prompt.json"),
      "echo hook events posted; staying up",
      "ping -n 3600 127.0.0.1 >nul",
      "",
    ].join("\r\n"),
  );
  const old = await invoke("get_settings");
  const had = old && typeof old === "object" && "agentOptions" in old;
  const agentOptions = { ...(had ? old.agentOptions : {}), claude: { ...(had ? old.agentOptions?.claude ?? {} : {}), command: join(standin, "claude.cmd") } };
  await invoke("settings_patch", { set: { agentOptions }, remove: [] });
  try {
    await newTab("/^\\s*Claude Code\\s*$/");
    const pane = 'section.pane[data-agent*="claude"]';
    await waitFor("a Claude pane", () => shown(pane), 15000);
    const word = await waitFor(
      "the status dot to turn Working",
      async () => {
        const w = await evalJs(`[...document.querySelectorAll(${JSON.stringify(pane + " .st")})].map(e => e.getAttribute("aria-label"))`);
        return w.find((x) => x === "status: Working") ?? null;
      },
      30000,
      500,
    );
    const settingsFile = join(claudeConfig, "settings.json");
    const hooksInstalled = ATTACH ? "attach mode: the running app's own config folder" : existsSync(settingsFile) && /agent-hooks/.test(read(settingsFile)) ? `hooks installed into the scratch ${settingsFile}` : "no hooks file in the scratch config folder";
    return `Claude pane's dot reads "${word}" after the stand-in posted SessionStart + UserPromptSubmit; ${hooksInstalled}`;
  } finally {
    if (had) await invoke("settings_patch", { set: { agentOptions: old.agentOptions }, remove: [] }).catch(() => {});
    else await invoke("settings_patch", { set: {}, remove: ["agentOptions"] }).catch(() => {});
  }
}

// ---------- run ----------
const flows = { 1: flow1, 2: flow2, 3: flow3, 4: flow4 };
const results = [];
let setupError = null;
try {
  await setup();
} catch (e) {
  setupError = e;
}
for (const n of ONLY) {
  if (setupError) {
    results.push([n, false, `setup failed: ${setupError.message}`]);
    continue;
  }
  try {
    results.push([n, true, await flows[n]()]);
  } catch (e) {
    results.push([n, false, e.message]);
  }
}
try {
  await closeApp();
} catch (e) {
  log(`WARN close: ${e.message}`);
}
if (!KEEP) rmSync(TEMP, { recursive: true, force: true });
else log(`kept ${TEMP}${ATTACH ? "" : ` and the app (pid ${appPid})`}`);
log("");
for (const [n, ok, note] of results) log(`${ok ? "PASS" : "FAIL"} ${n}: ${note}`);
const failed = results.filter((r) => !r[1]).length;
log(`smoke: ${results.length - failed}/${results.length} flows passed`);
process.exit(failed ? 1 : 0);
