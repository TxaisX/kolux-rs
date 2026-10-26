// Writes the Claude stand-in for the ux audit (same posting as scripts/evidence/smoke.mjs flow 4, plus a PermissionRequest
// that is posted once G:/Temp/ux-v3/standin/go-permission exists, so the driver times Working -> Needs you).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const BS = String.fromCharCode(92);
export function writeStandin(dir, repo) {
  mkdirSync(dir, { recursive: true });
  const event = (name, extra) => JSON.stringify({ hook_event_name: name, session_id: "ux-standin", cwd: repo, ...extra });
  writeFileSync(join(dir, "session-start.json"), event("SessionStart", { source: "startup" }));
  writeFileSync(join(dir, "prompt.json"), event("UserPromptSubmit", { prompt: "ux audit stand-in prompt" }));
  writeFileSync(join(dir, "permission.json"), event("PermissionRequest", { tool_name: "Write", tool_input: { file_path: "C:/x/hello.txt" } }));
  const post = (file) =>
    `type "%~dp0${file}" | %SystemRoot%${BS}System32${BS}curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1`;
  writeFileSync(
    join(dir, "claude.cmd"),
    [
      "@echo off",
      "echo Kolux RS ux-audit stand-in for Claude Code: posts the hook events a session would.",
      'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
      "setlocal",
      'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
      'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
      'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
      post("session-start.json"),
      post("prompt.json"),
      "echo working; waiting for the permission trigger",
      ":wait",
      `if exist "${join(dir, "go-permission").split("/").join(BS)}" goto go`,
      "ping -n 2 127.0.0.1 >nul",
      "goto wait",
      ":go",
      post("permission.json"),
      "echo needs you posted; staying up",
      "ping -n 3600 127.0.0.1 >nul",
      "",
    ].join("\r\n"),
  );
  return join(dir, "claude.cmd");
}
