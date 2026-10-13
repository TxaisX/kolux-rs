// Smoke run (T-542, T-542-b): five end-to-end flows through the dev app's own WebView2 debugging port, built
// on scripts/evidence/cdp.mjs (run as a child process: it is a command-line tool, not a library). Prints one
// PASS or FAIL line per flow, writes evidence/smoke-<short sha>.txt, and exits 1 when a required flow failed,
// so a merge or a structural move of App.tsx and lib.rs is checked by behaviour, not by screenshots.
//
//   pnpm smoke                       launch the app from this checkout with its own profile, run, close, clean up
//   pnpm smoke -- --attach           drive an app that is already running with --remote-debugging-port=<cdp>
//   options: --port 1431 (vite) · --cdp 9240 · --identifier com.txaisxiong.kolux-rs.smoke · --temp <folder>
//            --only 1,3 · --keep (leave the app and the temp folder for a look) · --timeout <minutes for the first build>
//            --require-quit (count flow 5 in the exit code before T-184 is ticked)
//
// Flow 1  a grid grows from 4 to 6 panes and the PTYs already running keep running: each shell gets a marker
//         in an environment variable before the change and writes that variable to a file after it (only the
//         same process can know it).
// Flow 2  Mod+S in an editor tab writes the file: the bytes on disk carry what was typed.
// Flow 3  Discard in Source Control asks first, and Cancel loses nothing: the file and git status are unchanged.
// Flow 4  a Claude pane's status dot turns Working: agentOptions.claude.command points at a stand-in program
//         that posts the same hook events Kolux's installed hook posts (SessionStart, UserPromptSubmit) from the
//         pane's own hook variables. CLAUDE_CONFIG_DIR, CODEX_HOME, USERPROFILE and HOME (with APPDATA and
//         LOCALAPPDATA below it) point at scratch folders under --temp for the launched app, so the user's real
//         Claude and Codex configuration and Kolux's real hook folder are never touched. FAILs when the app did
//         not install its hook into the scratch Claude settings.json, or the hook script that entry names is
//         missing on disk or not under the scratch home.
// Flow 5  quit and come back (council C2, T-542-b): with two or more shells, the Claude stand-in and one
//         non-default setting live, the app pid's descendant tree is captured (Win32_Process ParentProcessId
//         walk), the window is closed through the app's own path (window close over CDP, the same as the X
//         button; never taskkill) and every process from that tree still alive afterwards is a survivor: FAIL
//         on any. The same profile is relaunched (the built kolux-rs.exe from this checkout, vite restarted by
//         this script when tauri dev took it down): Kolux's settings.json must be byte-identical to its
//         pre-quit bytes before anything is touched, the setting must hold, and every restored shell must echo
//         a marker. Then a saved layout of 12 shell panes is written and the app is relaunched 10 times; 15 s
//         after each launch the descendant shells with ThreadCount <= 1 are counted as stalled: FAIL above 0.
//         Report-only until T-184 (Job Object kill-on-close) is on the checkout this runs from, detected by
//         the line `- [x] T-184 ` in its PLAN.md: the result is printed and written to evidence but does not
//         change the exit code. Once T-184 is ticked, flow 5 is required like the others. The final close of
//         the app is checked the same way (pre-close tree, survivors), and reported on the "close" line.
//
// Launch mode wipes and reuses the profile of --identifier (refused unless it ends in ".smoke"), seeds
// confirmCloseRunning=false so the close at the end is silent and agentStatusHooks=true so the hook install
// of flow 4 is on whether or not the switch exists yet (T-152-gate), and moves the window to the second screen
// when there is one. Attach mode changes the running app's settings for flow 4 and puts them back afterwards;
// it cannot run flow 5 (it has no exe path to relaunch).
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
const ATTACH = flag("attach");
const KEEP = flag("keep");
const ONLY = opt("only", ATTACH ? "1,2,3,4" : "1,2,3,4,5")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => n >= 1 && n <= 5);
const BUILD_MINUTES = Number(opt("timeout", "20"));
// T-184 detection: the task line ticked in this checkout's PLAN.md (the merge gate runs smoke on the checkout
// that carries the merge, so "on main" and "ticked here" are the same thing there).
const T184_ON = /^- \[x\] T-184 /m.test(existsSync(join(root, "PLAN.md")) ? readFileSync(join(root, "PLAN.md"), "utf8") : "");
const QUIT_REQUIRED = T184_ON || flag("require-quit");
const required = (n) => n !== 5 || QUIT_REQUIRED;

const repo = join(TEMP, "repo");
const marks = join(TEMP, "marks");
const standin = join(TEMP, "standin");
// T-152-c (5): the app's own temp folder (TEMP/TMP) holds the scratch agent config folders but not
// the scratch home below: a debug build refuses a temp folder that holds the home as scratch.
const appTemp = join(TEMP, "tmp");
const claudeConfig = join(appTemp, "claude-config");
const codexHome = join(appTemp, "codex-home");
// T-152-c (2): the app keeps its hook scripts, status line slot and backup record under the user's home
// (USERPROFILE on Windows, HOME elsewhere), so a run gets a scratch home and never writes the real one.
// Cargo and rustup find their own folders from the home too, so those stay pinned to the real ones.
const userHome = join(TEMP, "home");
const realHome = homedir();
// Windows finds AppData from the home too (%USERPROFILE%AppDataRoaming), and the app will not start
// when that folder is missing, so a launched app keeps its profile under the scratch home as well.
const roaming = join(userHome, "AppData", "Roaming");
const local = join(userHome, "AppData", "Local");
const profile = ATTACH ? join(process.env.APPDATA ?? "", IDENTIFIER) : join(roaming, IDENTIFIER);
const koluxSettings = join(profile, "settings.json");
// A plain text file: the Explorer opens it in the CodeMirror editor, whose save writes the text as typed.
const smokeFile = join(repo, "notes.txt");
const ORIGINAL = "original line\n";
// Flow 5's non-default setting: the needs strip is on by default (settings/general.ts stripOn).
const SETTING = "needsStrip";
const SHELL_NAMES = new Set(["powershell.exe", "pwsh.exe", "cmd.exe"]);

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
// T-545 (council flow-1 verdict 2026-10-13, harness-only): a pane makes its input field in its mount effect, so a pane
// shown this instant may not have the field yet. Poll for the field up to 10 s; the pane itself is never waited for.
const focusPane = async (paneSel, index, fieldSel) => {
  const started = Date.now();
  let r, polls = 0;
  for (;;) {
    r = await evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(paneSel)})].filter(e => e.offsetParent !== null)[${index}]; if (!p) return "missing pane"; p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); const f = p.querySelector(${JSON.stringify(fieldSel)}); if (!f) return "missing field"; f.focus(); return document.activeElement === f ? "focused" : "not-focused"; })()`);
    if (r !== "missing field") break;
    if (Date.now() - started > 10000) throw new Error(`${paneSel} #${index}: missing field after ${Date.now() - started} ms`);
    polls++;
    await sleep(100);
  }
  if (polls > 0) console.log(`focusPane ${paneSel} #${index}: field after ${Date.now() - started} ms`);
  if (r !== "focused") throw new Error(`${paneSel} #${index}: ${r}`);
};
const TERM = "section.pane[data-agent]";
// Shell panes only: data-agent is the agent name, so a Claude pane matches TERM but not SHELL.
const SHELL = 'section.pane[data-agent="shell"]';
const CHOOSER = "section.pane.chooser";
const CLAUDE = 'section.pane[data-agent*="claude"]';
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
const bytes = (file) => (existsSync(file) ? readFileSync(file) : null);
const slash = (p) => p.replace(/\\/g, "/");
// A file that nothing has written to for two seconds (the layout save follows every pane change).
async function settled(file, quiet = 2000, ms = 20000) {
  let last = bytes(file);
  let since = Date.now();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(250);
    const now = bytes(file);
    if (now === null ? last !== null : last === null || Buffer.compare(now, last) !== 0) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= quiet) break;
  }
  return last;
}

// ---------- processes: the app's descendant tree, survivors, graceful close ----------
// Every process under `pid` by Win32_Process ParentProcessId, with its name, thread count and creation time
// (a child created before its parent is a reused pid, not a child).
async function treeOf(pid) {
  const out = await ps(
    `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ThreadCount,CreationDate
     $byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
     $want = @([int]${pid}); $i = 0; $out = @()
     while ($i -lt $want.Count) { $p = $want[$i]; $i++; $pc = $byId[$p]
       foreach ($c in $all) { if ($c.ParentProcessId -eq $p -and $want -notcontains [int]$c.ProcessId -and ($null -eq $pc -or $null -eq $pc.CreationDate -or $null -eq $c.CreationDate -or $c.CreationDate -ge $pc.CreationDate)) { $want += [int]$c.ProcessId; $out += $c } } }
     $out | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.ParentProcessId)|$($_.ThreadCount)|$($_.CreationDate)" }`,
  );
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [pid, name, ppid, threads, created] = l.split("|");
      return { pid: Number(pid), name, ppid: Number(ppid), threads: Number(threads), created };
    });
}
// The entries of `tree` that are still the same processes (pid, name and creation time all match).
async function survivorsOf(tree) {
  if (tree.length === 0) return [];
  const ids = tree.map((t) => t.pid).join(",");
  const out = await ps(`Get-CimInstance Win32_Process | Where-Object { @(${ids}) -contains [int]$_.ProcessId } | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.CreationDate)" }`);
  const alive = new Set(out.split(/\r?\n/).filter(Boolean));
  return tree.filter((t) => alive.has(`${t.pid}|${t.name}|${t.created}`));
}
const byName = (list) => {
  const m = new Map();
  for (const t of list) m.set(t.name, (m.get(t.name) ?? 0) + 1);
  return [...m].map(([n, c]) => `${n} x${c}`).join(", ") || "none";
};
const killAll = async (list) => {
  for (const t of list) await run("taskkill", ["/PID", String(t.pid), "/F"]).catch(() => {});
};
const alive = async (pid) => (await ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`)) === "alive";
// The app's own quit path: a window close request over CDP (what the X button sends; App.tsx may ask about
// unsaved editor text, then the window is destroyed and the app exits). WM_CLOSE by PostMessage when the page
// cannot be reached. Never taskkill.
async function gracefulClose(pid) {
  const t0 = Date.now();
  let how = "window close over CDP";
  try {
    await invoke("plugin:window|close", { label: "main" });
  } catch {
    how = "WM_CLOSE by PostMessage (the page did not answer)";
    await ps(
      `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);' -Name M -Namespace U
       [U.M]::PostMessage((Get-Process -Id ${pid}).MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`,
    ).catch(() => {});
  }
  const gone = await waitFor("the app to exit", async () => !(await alive(pid)), 30000, 500).catch(() => false);
  if (!gone) throw new Error(`the app (pid ${pid}) did not exit within 30 s of a ${how}`);
  await sleep(2000); // children that are on their way out get a moment before they count as survivors
  return `${how}, exited in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
}
// Capture, close, count: what flow 5 and the final close share.
async function closeAndCount(pid) {
  const tree = await treeOf(pid);
  const how = await gracefulClose(pid);
  const survivors = await survivorsOf(tree);
  return { tree, how, survivors };
}

// ---------- the app: launch, relaunch or attach ----------
let dev = null; // the `pnpm tauri dev` child in launch mode
let vite = null; // a vite started by this script for a relaunch, when tauri dev took its own down
let appPid = null;
let exePath = null; // the built kolux-rs.exe inside this checkout, learned from the first launch
let closeReport = null; // the final close's line

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
// Second-screen rule: dev windows go to the screen at X=-1920 when it is there.
const moveWindow = (pid) =>
  ps(
    `Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Screen]::AllScreens.Count -lt 2) { 'one screen'; exit }
     Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W -Namespace U
     $h = [IntPtr]::Zero; for ($i = 0; $i -lt 20 -and $h -eq [IntPtr]::Zero; $i++) { $h = (Get-Process -Id ${pid}).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 } }
     if ($h -eq [IntPtr]::Zero) { 'no window handle' } else { [U.W]::SetWindowPos($h,[IntPtr]::Zero,-1920,0,0,0,0x0005) | Out-Null; 'moved' }`,
  );
const appEnv = () => ({ ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`, CLAUDE_CONFIG_DIR: claudeConfig, CODEX_HOME: codexHome, TEMP: appTemp, TMP: appTemp, USERPROFILE: userHome, HOME: userHome, APPDATA: roaming, LOCALAPPDATA: local, CARGO_HOME: process.env.CARGO_HOME ?? join(realHome, ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(realHome, ".rustup") });

async function launch() {
  if (!IDENTIFIER.endsWith(".smoke")) throw new Error(`refusing to wipe the profile of ${IDENTIFIER}: use an identifier ending in ".smoke" or --attach`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  writeFileSync(koluxSettings, JSON.stringify({ confirmCloseRunning: false, agentStatusHooks: true }, null, 2));
  mkdirSync(claudeConfig, { recursive: true });
  // T-152-b (2): a dev run writes a Claude settings file only below this scratch marker.
  writeFileSync(join(claudeConfig, ".kolux-rs-scratch"), "");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(local, { recursive: true });
  const cfg = join(TEMP, "tauri.smoke.json");
  writeFileSync(cfg, JSON.stringify({ identifier: IDENTIFIER, build: { devUrl: `http://localhost:${PORT}`, beforeDevCommand: `pnpm exec vite --port ${PORT} --strictPort` } }));
  const logFile = join(TEMP, "tauri-dev.log");
  const out = openSync(logFile, "w");
  // One command string through the shell: pnpm is a .cmd on Windows, which Node will not spawn directly.
  dev = spawn(`pnpm tauri dev --config "${cfg}"`, {
    cwd: root,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: { ...appEnv(), CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4" },
  });
  log(`launching: pnpm tauri dev (identifier ${IDENTIFIER}, vite ${PORT}, CDP ${CDP}; log ${logFile})`);
  await pageUp(BUILD_MINUTES * 60_000);
  // The app's pid comes from its executable path inside this checkout, never from a window title.
  const exe = join(root, "src-tauri", "target").replace(/'/g, "''");
  const found = await waitFor(
    "the app process",
    async () => {
      const line = await ps(`$p = Get-CimInstance Win32_Process -Filter "Name='kolux-rs.exe'" | Where-Object { $_.ExecutablePath -like '${exe}*' } | Select-Object -First 1; if ($p) { "$($p.ProcessId)|$($p.ExecutablePath)" }`);
      return line.includes("|") ? line : null;
    },
    30000,
    1000,
  );
  appPid = Number(found.split("|")[0]);
  exePath = found.split("|")[1];
  log(`app pid ${appPid} (${exePath}); window: ${await moveWindow(appPid)}`);
}

const viteServing = async () => {
  try {
    return (await fetch(`http://localhost:${PORT}/`)).ok;
  } catch {
    return false;
  }
};
// The same profile again: the exe tauri dev built (its devUrl and identifier were compiled in from the
// --config above), started straight from this script so its pid is known at once.
async function relaunch() {
  if (!exePath) throw new Error("no exe path from a first launch: flow 5 needs launch mode");
  if (!(await viteServing())) {
    if (vite?.pid) await run("taskkill", ["/PID", String(vite.pid), "/T", "/F"]).catch(() => {});
    const out = openSync(join(TEMP, "vite.log"), "a");
    vite = spawn(`pnpm exec vite --port ${PORT} --strictPort`, { cwd: root, shell: true, windowsHide: true, stdio: ["ignore", out, out], env: process.env });
    await waitFor(`vite on ${PORT}`, viteServing, 60000, 1000);
  }
  const out = openSync(join(TEMP, "app.log"), "a");
  const child = spawn(exePath, [], { cwd: join(root, "src-tauri"), windowsHide: true, stdio: ["ignore", out, out], env: appEnv() });
  child.on("error", (e) => log(`WARN relaunch: ${e.message}`));
  if (!child.pid) throw new Error("the relaunched app has no pid");
  appPid = child.pid;
  await pageUp(90_000);
  await moveWindow(appPid);
}

// The orphan scan: survivors of the tree captured before the close, never a taskkill first. The dev tree,
// a vite this script started and the survivors are ended afterwards as cleanup, not as the check.
async function closeApp() {
  if (ATTACH || KEEP) return;
  if (appPid && (await alive(appPid))) {
    const { tree, how, survivors } = await closeAndCount(appPid);
    const ok = survivors.length === 0;
    closeReport = [ok, `${how}; pre-close tree ${tree.length} (${byName(tree)}); survivors ${survivors.length} (${byName(survivors)})`];
    await killAll(survivors);
  }
  appPid = null;
  if (dev?.pid) await run("taskkill", ["/PID", String(dev.pid), "/T", "/F"]).catch(() => {});
  if (vite?.pid) await run("taskkill", ["/PID", String(vite.pid), "/T", "/F"]).catch(() => {});
  // Cleanup only: a shell or stand-in still running from the temp folder that no tree covered. Its names are
  // fixed and this script's own ancestors (the cmd and pnpm chain that ran it carries --temp too) are skipped.
  const left = await ps(
    `$names = @('kolux-rs.exe','powershell.exe','pwsh.exe','cmd.exe','conhost.exe','OpenConsole.exe','ping.exe','curl.exe')
     $all = Get-CimInstance Win32_Process; $mine = @(); $p = $PID; while ($p -and $mine -notcontains $p) { $mine += $p; $p = ($all | Where-Object ProcessId -eq $p).ParentProcessId }
     $all | Where-Object { $names -contains $_.Name -and $_.CommandLine -like '*${TEMP.replace(/'/g, "''")}*' -and $mine -notcontains $_.ProcessId } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`,
  ).catch(() => "");
  if (left) {
    log(`cleanup: processes still running from the temp folder, ended now:\n${left}`);
    for (const line of left.split(/\r?\n/)) await run("taskkill", ["/PID", line.split(" ")[0], "/F"]).catch(() => {});
  }
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
  await waitFor("the first shell pane's input field", () => exists(`${TERM} .xterm-helper-textarea`), 30000);
  log(`setup: ${repo} added as a project; ${await shown(TERM)} shell pane shown`);
}

// Types a line into the n-th shown shell and waits for the file it writes; a shell still starting up may
// swallow the first keystrokes, so the line is sent again until the file is there.
async function shellWrites(index, line, file, what, tries = 3) {
  for (let t = 1; ; t++) {
    await focusPane(SHELL, index, ".xterm-helper-textarea");
    await cdp("insert", line, "enter");
    try {
      return await waitFor(what, () => read(file), 15000, 500);
    } catch (e) {
      if (t >= tries) throw e;
    }
  }
}

// ---------- flow 1 ----------
async function flow1() {
  const start = await shown(TERM);
  for (const want of [start + 1, start + 2]) {
    // A shown pane takes the focus first: after setup it may still sit on the workspace-less pane in its zero-width cell.
    await focusPane(TERM, 0, ".xterm-helper-textarea");
    await click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} shell panes`, async () => (await shown(TERM)) === want, 30000);
  }
  await pickLayout(4);
  await waitFor("Layout 4", async () => (await layoutCount()) === "4", 5000);
  const grid = async () => ({ cells: Number(await layoutCount()), shells: await shown(TERM), choosers: await shown(CHOOSER) });
  const before = await grid();
  if (before.shells !== start + 2 || before.choosers !== 4 - before.shells) throw new Error(`expected ${start + 2} shells and ${4 - start - 2} empty pane(s) at Layout 4, got ${JSON.stringify(before)}`);
  const stamp = Date.now().toString(36);
  const markOf = (i) => `smoke-${stamp}-${i}`;
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
// The stand-in for Claude Code: the same guards, endpoint file read and curl post as Kolux's installed hook
// script (hooks.rs), fed the JSON Claude Code would pipe in; then it stays up like a session would.
function writeStandin() {
  mkdirSync(standin, { recursive: true });
  const event = (name, extra) => JSON.stringify({ hook_event_name: name, session_id: "smoke-standin", cwd: repo, ...extra });
  writeFileSync(join(standin, "session-start.json"), event("SessionStart", { source: "startup" }));
  writeFileSync(join(standin, "prompt.json"), event("UserPromptSubmit", { prompt: "smoke: turn the dot to Working" }));
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
  return join(standin, "claude.cmd");
}
// Points agentOptions.claude.command at the stand-in; the returned function puts the old value back.
async function standinOn() {
  const command = writeStandin();
  const old = await invoke("get_settings");
  const had = old && typeof old === "object" && "agentOptions" in old;
  const agentOptions = { ...(had ? old.agentOptions : {}), claude: { ...(had ? old.agentOptions?.claude ?? {} : {}), command } };
  await invoke("settings_patch", { set: { agentOptions }, remove: [] });
  return async () => {
    if (had) await invoke("settings_patch", { set: { agentOptions: old.agentOptions }, remove: [] }).catch(() => {});
    else await invoke("settings_patch", { set: {}, remove: ["agentOptions"] }).catch(() => {});
  };
}
const dotWorking = () =>
  waitFor(
    "the status dot to turn Working",
    async () => {
      const w = await evalJs(`[...document.querySelectorAll(${JSON.stringify(CLAUDE + " .st")})].map(e => e.getAttribute("aria-label"))`);
      return w.find((x) => x === "status: Working") ?? null;
    },
    30000,
    500,
  );
// The hook the app installed for the launched app's Claude: the scratch settings.json must name the hook
// script, and that script must be on disk. Attach mode has no scratch folder to look in.
function installedHook() {
  if (ATTACH) return "attach mode: the running app's own config folder, not checked";
  const settingsFile = join(claudeConfig, "settings.json");
  const text = read(settingsFile);
  if (text === null) throw new Error(`the installed hook file is missing: no ${settingsFile} (the app did not install its Claude hooks into the scratch config folder)`);
  const m = text.match(/([A-Za-z]:\/[^"\\]*agent-hooks\/claude\.cmd)/);
  if (!m) throw new Error(`the installed hook file ${settingsFile} names no agent-hooks/claude.cmd script`);
  if (!existsSync(m[1])) throw new Error(`the installed hook script ${m[1]} named by ${settingsFile} is missing on disk`);
  const norm = (s) => s.replace(/\\/g, "/").toLowerCase();
  if (!norm(m[1]).startsWith(norm(userHome) + "/")) throw new Error(`the installed hook script ${m[1]} is not under the scratch home ${userHome}`);
  return `hook installed into the scratch ${settingsFile}, script ${m[1]} on disk`;
}
async function flow4() {
  const restore = await standinOn();
  try {
    await newTab("/^\\s*Claude Code\\s*$/");
    await waitFor("a Claude pane", () => shown(CLAUDE), 15000);
    const word = await dotWorking();
    return `Claude pane's dot reads "${word}" after the stand-in posted SessionStart + UserPromptSubmit; ${installedHook()}`;
  } finally {
    await restore();
  }
}

// ---------- flow 5 ----------
async function flow5() {
  if (ATTACH) throw new Error("flow 5 needs launch mode (it quits and relaunches the app from its exe)");
  const parts = [];
  const fails = [];
  // Live state: two or more shells, the Claude stand-in (its command stays set so the relaunch starts the
  // stand-in, never the real claude), one non-default setting.
  // Split right makes a shell in a new cell from any terminal pane, even when a Claude tab hides the shell under it.
  while ((await shown(SHELL)) < 2) {
    const want = (await shown(SHELL)) + 1;
    await focusPane(TERM, 0, ".xterm-helper-textarea");
    await click('.pane.focused button[title^="Split right"]');
    await waitFor(`${want} shell panes`, async () => (await shown(SHELL)) >= want, 30000);
  }
  await standinOn();
  if (!(await shown(CLAUDE))) {
    await newTab("/^\\s*Claude Code\\s*$/");
    await waitFor("a Claude pane", () => shown(CLAUDE), 15000);
  }
  await dotWorking();
  await invoke("settings_patch", { set: { [SETTING]: false }, remove: [] });
  const shells = await shown(SHELL);
  const claudePanes = await count(CLAUDE);
  const before = await settled(koluxSettings);
  if (!before) throw new Error(`no ${koluxSettings} before the quit`);
  parts.push(`live: ${shells} shells, ${claudePanes} Claude stand-in pane, ${SETTING}=false; settings.json ${before.length} bytes`);
  // Quit: the tree first, then the app's own close, then the survivors.
  const first = await closeAndCount(appPid);
  parts.push(`quit: ${first.how}; pre-close tree ${first.tree.length} (${byName(first.tree)}); survivors ${first.survivors.length} (${byName(first.survivors)})`);
  if (first.survivors.length > 0) fails.push(`${first.survivors.length} process(es) from the pre-close tree survived the quit: ${byName(first.survivors)}`);
  await killAll(first.survivors);
  // Come back: bytes before anything is touched, the setting, the shells.
  await relaunch();
  const after = await settled(koluxSettings);
  const identical = after !== null && Buffer.compare(before, after) === 0;
  if (!identical) {
    let note = after === null ? "the file is gone" : `${before.length} -> ${after.length} bytes`;
    try {
      const a = JSON.parse(before.toString("utf8"));
      const b = JSON.parse(after.toString("utf8"));
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      note += `; keys that differ: ${keys.join(", ") || "none (whitespace or key order)"}`;
    } catch {
      /* not JSON on one side; the byte note stands */
    }
    fails.push(`settings.json is not byte-identical after the relaunch (${note})`);
  }
  const settings = await invoke("get_settings");
  const holds = settings && settings[SETTING] === false;
  if (!holds) fails.push(`${SETTING}=false did not hold across the relaunch (now ${JSON.stringify(settings?.[SETTING])})`);
  let restored = 0;
  try {
    restored = await waitFor(`${shells} restored shells`, async () => ((await shown(SHELL)) >= shells ? shown(SHELL) : null), 30000, 500);
  } catch {
    restored = await shown(SHELL);
  }
  const echoed = [];
  for (let i = 0; i < restored; i++) {
    const file = join(marks, `back-${i}.txt`);
    try {
      await shellWrites(i, `'back-${i}' | Set-Content '${slash(file)}'`, file, `restored shell ${i + 1} to echo`);
      if (read(file)?.includes(`back-${i}`)) echoed.push(i);
    } catch {
      /* counted below */
    }
  }
  if (restored !== shells || echoed.length !== shells) fails.push(`restore: ${restored} of ${shells} shells came back, ${echoed.length} echoed the marker`);
  const claudeBack = await count(CLAUDE);
  parts.push(`come back: settings.json ${identical ? "byte-identical" : "CHANGED"}; ${SETTING}=false ${holds ? "holds" : "LOST"}; ${restored}/${shells} shells restored, ${echoed.length} echoed a marker; ${claudeBack} Claude pane back`);
  // The storm: 12 saved shell panes, 10 relaunches, stalled shells (ThreadCount <= 1) 15 s after each launch.
  const second = await closeAndCount(appPid);
  await killAll(second.survivors);
  const cfg = JSON.parse(read(koluxSettings));
  const template = (cfg.savedLayout?.panes ?? []).find((p) => p.agent === "shell");
  if (!template) throw new Error(`the saved layout has no shell pane to copy: ${JSON.stringify(cfg.savedLayout).slice(0, 300)}`);
  cfg.savedLayout = { panes: Array.from({ length: 12 }, (_, i) => ({ ...template, key: i + 1, cwd: repo })), activeTab: {}, focused: 1, activeDir: repo, stacked: {} };
  writeFileSync(koluxSettings, JSON.stringify(cfg, null, 2));
  const seen = [];
  const stalled = [];
  const left = [second.survivors.length];
  for (let r = 1; r <= 10; r++) {
    const t0 = Date.now();
    await relaunch();
    await sleep(Math.max(0, 15000 - (Date.now() - t0)));
    const tree = await treeOf(appPid);
    const sh = tree.filter((t) => SHELL_NAMES.has(t.name));
    seen.push(sh.length);
    stalled.push(sh.filter((t) => t.threads <= 1).length);
    const c = await closeAndCount(appPid);
    left.push(c.survivors.length);
    await killAll(c.survivors);
  }
  appPid = null;
  const stalledTotal = stalled.reduce((a, b) => a + b, 0);
  parts.push(`storm: 10 relaunches with 12 saved shell panes; shells seen [${seen.join(" ")}]; stalled (ThreadCount <= 1 at 15 s) [${stalled.join(" ")}] = ${stalledTotal}; survivors per close [${left.join(" ")}]`);
  if (stalledTotal > 0) fails.push(`${stalledTotal} stalled shell(s) across the 10 relaunches`);
  const text = parts.join(" · ");
  if (fails.length > 0) throw new Error(`${fails.join("; ")} · ${text}`);
  return text;
}

// ---------- run ----------
const flows = { 1: flow1, 2: flow2, 3: flow3, 4: flow4, 5: flow5 };
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
  const [, ok, note] = results[results.length - 1];
  log(`flow ${n}: ${ok ? "PASS" : "FAIL"}: ${note}`);
}
try {
  await closeApp();
} catch (e) {
  log(`WARN close: ${e.message}`);
}
if (!KEEP) rmSync(TEMP, { recursive: true, force: true });
else log(`kept ${TEMP}${ATTACH ? "" : ` and the app (pid ${appPid})`}`);
log("");
const lines = [];
const tag = (n) => (required(n) ? "" : " [report-only]");
for (const [n, ok, note] of results) lines.push(`${ok ? "PASS" : "FAIL"} ${n}${tag(n)}: ${note}`);
if (closeReport) lines.push(`${closeReport[0] ? "PASS" : "FAIL"} close${tag(5)}: ${closeReport[1]}`);
const counted = results.filter(([n]) => required(n));
const failed = counted.filter((r) => !r[1]).length + (closeReport && required(5) && !closeReport[0] ? 1 : 0);
const reportOnly = results.filter(([n]) => !required(n));
let summary = `smoke: ${counted.length - failed}/${counted.length} flows passed`;
if (reportOnly.length > 0) summary += ` (flow 5 report-only until T-184 is ticked in PLAN.md: ${reportOnly.every((r) => r[1]) && (!closeReport || closeReport[0]) ? "PASS" : "FAIL"})`;
lines.push(summary);
for (const l of lines) log(l);
let sha = "nosha";
try {
  sha = (await run("git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim() || sha;
} catch {
  /* not a git checkout */
}
const evidence = join(root, "evidence", `smoke-${sha}.txt`);
mkdirSync(join(root, "evidence"), { recursive: true });
writeFileSync(
  evidence,
  [`pnpm smoke at ${new Date().toISOString()} on ${sha} (${root})`, `args: ${args.join(" ") || "(none)"}; T-184 ticked: ${T184_ON}; flow 5 ${QUIT_REQUIRED ? "required" : "report-only"}`, ...lines, ""].join("\n"),
);
log(`evidence: ${evidence}`);
process.exit(failed ? 1 : 0);
