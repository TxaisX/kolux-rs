// Wave 1 (T-282, T-237, T-318, T-328, T-263-b) live proof launcher. A scratch profile under
// G:/Temp/look-w1/live built the way scripts/evidence/smoke.mjs launch() builds one (scratch Claude
// config with the .kolux-rs-scratch marker, scratch Codex home, scratch home with AppData, the app's
// TEMP kept apart from that home), a throwaway repo with a code file and a note, a layout of one
// shell and the two files open as editor tabs, the new look in dark; the look-lane dev app on vite
// 1426 / CDP 9249 with the smoke identifier; then evidence/T-282-proof.mjs steps; then it closes the
// window through its close request. Usage: node evidence/T-282-run.mjs <step...>
import { spawn, execFile } from "node:child_process";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = "G:\\Dev\\kolux-rs-lanes\\look";
const TEMP = "G:/Temp/look-w1/live";
const IDENTIFIER = "com.txaisxiong.kolux-rs.look.smoke";
const appTemp = join(TEMP, "tmp");
const claudeConfig = join(appTemp, "claude-config");
const codexHome = join(appTemp, "codex-home");
const home = join(TEMP, "home");
const roaming = join(home, "AppData", "Roaming");
const local = join(home, "AppData", "Local");
const profile = join(roaming, IDENTIFIER);
const repo = join(TEMP, "repo");
const steps = process.argv.slice(2);
const run = (f, a, o = {}) => new Promise((res) => execFile(f, a, { maxBuffer: 1 << 24, ...o }, (e, so, se) => res((so + se).trim())));
const ps = (s) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", s]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = (...a) => run(process.execPath, [join(ROOT, "scripts", "evidence", "cdp.mjs"), "main", ...a], { env: { ...process.env, CDP_PORT: "9249" } });

rmSync(TEMP, { recursive: true, force: true });
for (const d of [profile, claudeConfig, codexHome, local, repo, join(repo, ".kolux", "templates")]) mkdirSync(d, { recursive: true });
writeFileSync(join(claudeConfig, ".kolux-rs-scratch"), "");
writeFileSync(join(repo, "notes.txt"), "original line\n");
writeFileSync(join(repo, "note.md"), "# A note\n\nSome text.\n");
const git = (a) => run("git", ["-c", "user.name=proof", "-c", "user.email=proof@example.invalid", ...a], { cwd: repo });
await git(["init", "-q", "-b", "main"]);
await git(["add", "."]);
await git(["commit", "-q", "-m", "proof"]);
const repoWin = repo.replace(/\//g, "\\");
const settings = {
  confirmCloseRunning: false,
  uiLook: "new",
  appearanceMode: "dark",
  lastScreen: "terminals",
  savedLayout: {
    panes: [
      { key: 2, cwd: repoWin, branch: "main", agent: "shell", program: null, args: [] },
      { key: 3, cwd: repoWin, branch: "main", agent: "shell", program: null, args: [], kind: "editor", path: `${repoWin}\\notes.txt` },
      { key: 4, cwd: repoWin, branch: "main", agent: "shell", program: null, args: [], kind: "editor", path: `${repoWin}\\note.md` },
    ],
    focused: 3,
    activeDir: repoWin,
    stacked: {},
  },
};
writeFileSync(join(profile, "settings.json"), JSON.stringify(settings, null, 2));
const cfg = join(TEMP, "tauri.smoke.json");
writeFileSync(cfg, JSON.stringify({ identifier: IDENTIFIER, build: { devUrl: "http://localhost:1426", beforeDevCommand: "pnpm exec vite --port 1426 --strictPort" } }));

const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("KOLUX_")));
const env = { ...clean, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9249", CLAUDE_CONFIG_DIR: claudeConfig, CODEX_HOME: codexHome, TEMP: appTemp, TMP: appTemp, USERPROFILE: home, HOME: home, APPDATA: roaming, LOCALAPPDATA: local, KOLUX_APP_DIR: profile, CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup"), CARGO_BUILD_JOBS: "4" };
const out = openSync(join(TEMP, "tauri-dev-proof.log"), "w");
const dev = spawn(`pnpm tauri dev --config "${cfg}"`, { cwd: ROOT, shell: true, windowsHide: true, stdio: ["ignore", out, out], env });
console.log("launched pnpm tauri dev, shell pid", dev.pid, "profile", profile);
let up = false;
for (let i = 0; i < 600 && !up; i++) {
  await sleep(2000);
  try {
    const t = await (await fetch("http://127.0.0.1:9249/json")).json();
    up = t.some((x) => x.type === "page" && /localhost:1426/.test(x.url));
  } catch {}
}
if (!up) throw new Error("page never came up");
for (let i = 0; i < 60; i++) {
  if ((await cdp("eval", `!!document.querySelector('section.pane.editor .cm-content')`)) === "true") break;
  await sleep(1000);
}
const exe = join(ROOT, "src-tauri", "target").replace(/'/g, "''");
const pid = (await ps(`Get-CimInstance Win32_Process -Filter "Name='kolux-rs.exe'" | Where-Object { $_.ExecutablePath -like '${exe}*' } | Select-Object -First 1 -ExpandProperty ProcessId`)).trim();
console.log("app pid", pid);
console.log("move:", await ps(`Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Screen]::AllScreens.Count -lt 2) { 'one screen'; exit }; Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);' -Name W -Namespace U; [U.W]::SetWindowPos((Get-Process -Id ${pid}).MainWindowHandle,[IntPtr]::Zero,-1920,0,0,0,0x0005) | Out-Null; 'moved'`));
console.log("maximise:", await ps(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);' -Name S -Namespace U; [U.S]::ShowWindow((Get-Process -Id ${pid}).MainWindowHandle, 3)`));
await sleep(1500);
for (const st of steps) {
  console.log(`---- step ${st}`);
  console.log(await run(process.execPath, [join(import.meta.dirname, "T-282-proof.mjs"), pid, st, TEMP]));
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
console.log("left over:", (await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*look-w1*live*' -or $_.CommandLine -like '*1426*' } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`)) || "none");
process.exit(0);
