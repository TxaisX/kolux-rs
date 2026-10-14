// T-546: launches the look-lane dev app on the scratch profile the smoke left (same env as smoke.mjs's
// appEnv), runs T-546-proof.mjs against it, then closes it through the window close request.
import { spawn, execFile } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = "G:\\Dev\\kolux-rs-lanes\\look";
const TEMP = "G:/Temp/look-t546";
const appTemp = join(TEMP, "tmp");
const home = join(TEMP, "home");
const roaming = join(home, "AppData", "Roaming");
const profile = join(roaming, "com.txaisxiong.kolux-rs.look.smoke");
const steps = process.argv.slice(2);
const run = (f, a, o = {}) => new Promise((res) => execFile(f, a, { maxBuffer: 1 << 24, ...o }, (e, so, se) => res((so + se).trim())));
const ps = (s) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", s]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = (...a) => run(process.execPath, [join(ROOT, "scripts", "evidence", "cdp.mjs"), "main", ...a], { env: { ...process.env, CDP_PORT: "9249" } });

const settingsFile = join(profile, "settings.json");
const s = JSON.parse(readFileSync(settingsFile, "utf8"));
s.uiLook = "new";
s.appearanceMode = "dark";
writeFileSync(settingsFile, JSON.stringify(s, null, 2));

const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9249", CLAUDE_CONFIG_DIR: join(appTemp, "claude-config"), CODEX_HOME: join(appTemp, "codex-home"), TEMP: appTemp, TMP: appTemp, USERPROFILE: home, HOME: home, APPDATA: roaming, LOCALAPPDATA: join(home, "AppData", "Local"), KOLUX_APP_DIR: profile, CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup"), CARGO_BUILD_JOBS: "4" };
const out = openSync(join(TEMP, "tauri-dev-proof.log"), "w");
const dev = spawn(`pnpm tauri dev --config "${join(TEMP, "tauri.smoke.json")}"`, { cwd: ROOT, shell: true, windowsHide: true, stdio: ["ignore", out, out], env });
console.log("launched pnpm tauri dev, shell pid", dev.pid);
let up = false;
for (let i = 0; i < 300 && !up; i++) {
  await sleep(2000);
  try {
    const t = await (await fetch("http://127.0.0.1:9249/json")).json();
    up = t.some((x) => x.type === "page" && /localhost:1426/.test(x.url));
  } catch {}
}
if (!up) throw new Error("page never came up");
for (let i = 0; i < 60; i++) {
  if ((await cdp("eval", `!!document.querySelector('section.pane.editor[aria-label="notes.txt pane"] .cm-content')`)) === "true") break;
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
    console.log("waiting for G:/Temp/look-t546/stop");
    const { existsSync, rmSync } = await import("node:fs");
    while (!existsSync(join(TEMP, "stop"))) await sleep(1000);
    rmSync(join(TEMP, "stop"));
    continue;
  }
  console.log(`---- step ${st}`);
  console.log(await run(process.execPath, [join(import.meta.dirname, "T-546-proof.mjs"), pid, st]));
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
console.log("left over:", (await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*look-t546*' -or $_.CommandLine -like '*1426*' } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`)) || "none");
process.exit(0);
