// T-546-b (2) + T-070 live proof launcher: builds a scratch profile under G:/Temp/look-t070 (the same
// shape and env as scripts/evidence/smoke.mjs launch(): scratch Claude config dir with the
// .kolux-rs-scratch marker, scratch Codex home, scratch home with AppData, the app's TEMP kept apart
// from that home), seeds a layout of two shells and two stand-in Claude Code panes under two account
// names, launches the look-lane dev app on vite 1426 / CDP 9249 with the smoke identifier, runs
// T-070-proof.mjs steps against it, then closes it through the window close request.
// Usage: node evidence/T-070-run.mjs <step...>   (steps: tour cards usage, or "wait" to pause on a stop file)
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = "G:\\Dev\\kolux-rs-lanes\\look";
const TEMP = "G:/Temp/look-t070";
const LOGS = "G:/Temp/look-t070-logs";
const IDENTIFIER = "com.txaisxiong.kolux-rs.look.smoke";
const appTemp = join(TEMP, "tmp");
const claudeConfig = join(appTemp, "claude-config");
const codexHome = join(appTemp, "codex-home");
const home = join(TEMP, "home");
const roaming = join(home, "AppData", "Roaming");
const local = join(home, "AppData", "Local");
const profile = join(roaming, IDENTIFIER);
const repo = join(TEMP, "repo");
const standin = join(TEMP, "standin");
const steps = process.argv.slice(2);
const run = (f, a, o = {}) => new Promise((res) => execFile(f, a, { maxBuffer: 1 << 24, ...o }, (e, so, se) => res((so + se).trim())));
const ps = (s) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", s]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = (...a) => run(process.execPath, [join(ROOT, "scripts", "evidence", "cdp.mjs"), "main", ...a], { env: { ...process.env, CDP_PORT: "9249" } });

// The scratch profile, from nothing.
rmSync(TEMP, { recursive: true, force: true });
for (const d of [profile, claudeConfig, codexHome, local, repo, standin, LOGS]) mkdirSync(d, { recursive: true });
writeFileSync(join(claudeConfig, ".kolux-rs-scratch"), "");
writeFileSync(join(repo, "notes.txt"), "original line\n");
const git = (a) => run("git", ["-c", "user.name=proof", "-c", "user.email=proof@example.invalid", ...a], { cwd: repo });
await git(["init", "-q", "-b", "main"]);
await git(["add", "."]);
await git(["commit", "-q", "-m", "proof"]);

// The stand-in for Claude Code (as evidence/T-546-proof.mjs): records its hook endpoint, posts
// SessionStart through curl, stays up like a session. Never a real agent, never a real account.
const standinWin = standin.replace(/\//g, "\\");
writeFileSync(join(standin, "session-start.json"), JSON.stringify({ hook_event_name: "SessionStart", session_id: "t070", cwd: repo.replace(/\//g, "\\"), source: "startup" }));
writeFileSync(
  join(standin, "claude.cmd"),
  [
    "@echo off",
    "echo Kolux RS T-070 stand-in for Claude Code: records its hook endpoint, posts SessionStart, stays up.",
    'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
    "setlocal",
    'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
    'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
    'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
    '(echo %KP%& echo %KT%& echo %KOLUX_HOOK_IDENTITY%& echo %CLAUDE_CONFIG_DIR%) > "%~dp0pane-%KOLUX_PANE_KEY%.env"',
    'type "%~dp0session-start.json" | %SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1',
    "echo stand-in pane %KOLUX_PANE_KEY%: endpoint recorded; staying up",
    "ping -n 3600 127.0.0.1 >nul",
    "",
  ].join("\r\n"),
);

// Two shells and two stand-in Claude panes under two account names (src/terminal/layout.ts keeps
// `account` per pane), the new look in dark, the tour already seen is not assumed (the driver closes it).
const repoWin = repo.replace(/\//g, "\\");
const settings = {
  confirmCloseRunning: false,
  agentStatusHooks: true,
  uiLook: "new",
  appearanceMode: "dark",
  lastScreen: "terminals",
  agentOptions: { claude: { command: `${standinWin}\\claude.cmd` } },
  savedLayout: {
    panes: [
      { key: 2, cwd: repoWin, branch: "main", agent: "shell", program: null, args: [] },
      { key: 3, cwd: repoWin, branch: "main", agent: "shell", program: null, args: [], group: 2 },
      { key: 4, cwd: repoWin, branch: "main", agent: "claude", program: null, args: [], account: "work" },
      { key: 5, cwd: repoWin, branch: "main", agent: "claude", program: null, args: [], account: "personal" },
    ],
    activeTab: { 2: 3 },
    focused: 4,
    activeDir: repoWin,
    stacked: {},
  },
};
writeFileSync(join(profile, "settings.json"), JSON.stringify(settings, null, 2));
const cfg = join(TEMP, "tauri.smoke.json");
writeFileSync(cfg, JSON.stringify({ identifier: IDENTIFIER, build: { devUrl: "http://localhost:1426", beforeDevCommand: "pnpm exec vite --port 1426 --strictPort" } }));

const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9249", CLAUDE_CONFIG_DIR: claudeConfig, CODEX_HOME: codexHome, TEMP: appTemp, TMP: appTemp, USERPROFILE: home, HOME: home, APPDATA: roaming, LOCALAPPDATA: local, KOLUX_APP_DIR: profile, CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup"), CARGO_BUILD_JOBS: "4" };
const out = openSync(join(LOGS, "tauri-dev-proof.log"), "w");
const dev = spawn(`pnpm tauri dev --config "${cfg}"`, { cwd: ROOT, shell: true, windowsHide: true, stdio: ["ignore", out, out], env });
console.log("launched pnpm tauri dev, shell pid", dev.pid, "profile", profile);
let up = false;
for (let i = 0; i < 450 && !up; i++) {
  await sleep(2000);
  try {
    const t = await (await fetch("http://127.0.0.1:9249/json")).json();
    up = t.some((x) => x.type === "page" && /localhost:1426/.test(x.url));
  } catch {}
}
if (!up) throw new Error("page never came up");
for (let i = 0; i < 60; i++) {
  if ((await cdp("eval", `document.querySelectorAll("section.pane").length >= 2`)) === "true") break;
  await sleep(1000);
}
const exe = join(ROOT, "src-tauri", "target").replace(/'/g, "''");
const pid = (await ps(`Get-CimInstance Win32_Process -Filter "Name='kolux-rs.exe'" | Where-Object { $_.ExecutablePath -like '${exe}*' } | Select-Object -First 1 -ExpandProperty ProcessId`)).trim();
console.log("app pid", pid);
console.log("move:", await ps(`Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Screen]::AllScreens.Count -lt 2) { 'one screen'; exit }; Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W -Namespace U; [U.W]::SetWindowPos((Get-Process -Id ${pid}).MainWindowHandle,[IntPtr]::Zero,-1920,0,0,0,0x0005) | Out-Null; 'moved'`));
console.log("maximise:", await ps(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);' -Name S -Namespace U; [U.S]::ShowWindow((Get-Process -Id ${pid}).MainWindowHandle, 3)`));
console.log("look:", await cdp("eval", `[document.documentElement.dataset.look ?? null, document.documentElement.dataset.theme ?? null, document.documentElement.className, innerWidth, innerHeight]`));
await sleep(1500);
for (const st of steps) {
  if (st === "wait") {
    console.log(`waiting for ${TEMP}/stop`);
    while (!existsSync(join(TEMP, "stop"))) await sleep(1000);
    rmSync(join(TEMP, "stop"));
    continue;
  }
  console.log(`---- step ${st}`);
  console.log(await run(process.execPath, [join(import.meta.dirname, "T-070-proof.mjs"), pid, st]));
}
console.log("---- close");
console.log(await cdp("eval", `window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }).then(() => "close sent")`));
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  if (!(await ps(`Get-Process -Id ${pid} -ErrorAction SilentlyContinue`))) {
    console.log(`app exited after ${i + 1} s`);
    break;
  }
}
await sleep(3000);
console.log("left over:", (await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*look-t070*' -or $_.CommandLine -like '*1426*' } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`)) || "none");
process.exit(0);
