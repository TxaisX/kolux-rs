//! T-121 (STAT-012..016): status hooks for Cursor Agent, Droid, Command Code, Kimi and Hermes, and
//! T-122 (STAT-017..021): Copilot CLI, Grok, Devin and Pi, from each vendor's public hook or plugin
//! docs (PROVENANCE.md, T-121 and T-122; the T-122 vendors are described above their code). Like T-120-b's `vendors`, each
//! event is turned into the one shape the status rules read (`normalize`) and then follows the
//! rules for an agent whose hook semantics are unverified (`status::Agent::Vendor`, which reads
//! `vendors::change`); nothing here answers for the agent except where its doc says a hook must.
//!
//! - Cursor: `~/.cursor/hooks.json`, `{"version": 1, "hooks": {event: [{command, timeout}]}}`;
//!   `beforeSubmitPrompt` is answered "continue"; its three permission hooks are never installed,
//!   so Kolux never answers one (FIX-2).
//! - Droid: `~/.factory/settings.json`, `hooks` groups like Claude Code's.
//! - Command Code: `~/.commandcode/settings.json`, `hooks` groups like Claude Code's.
//! - Kimi: `[[hooks]]` tables between Kolux marker lines in `~/.kimi-code/config.toml` (or under
//!   `KIMI_CODE_HOME`), each with only `event`, `matcher`, `command`, `timeout` (its doc: any other
//!   key stops the file loading); the command is a bash script run through Git Bash.
//! - Hermes: a `kolux-status` plugin folder under `~/.hermes/plugins` (or `HERMES_HOME`) that posts
//!   each hook point itself; Hermes's own `config.yaml` `plugins.disabled` list is the user's and
//!   is read, never written (as Antigravity's `enabled` switch is).

use super::super::{home_dir, install_groups, script, write_atomic, write_json, write_script, SCRIPT_DIR};
use super::{back_up, backup_of, drop_created, fenced, kept, names_mine, read_opt, remove_groups, saved::SPOOL_FILE, scratch_only, switch, target_dir, was_created, Plan, BACKUP_RECORD};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const CURSOR_SCRIPT: &str = "cursor.cmd";
pub const DROID_SCRIPT: &str = "droid.cmd";
pub const COMMAND_CODE_SCRIPT: &str = "command-code.cmd";
/// Kimi runs its hook through Git Bash (COMPAT 3.4), so its script is a shell script.
pub const KIMI_SCRIPT: &str = "kimi.sh";
/// The Hermes plugin folder's name.
pub const HERMES_PLUGIN: &str = "kolux-status";
/// Cursor's state events only. Its permission hooks (`preToolUse`, `beforeShellExecution`,
/// `beforeMCPExecution`) are never installed (council FIX-BEFORE 1, 2026-10-19): Cursor blocks the
/// action on any answer outside their schema, and a hook with nothing to say still prints `{}`, so
/// the one safe answer is to never be asked. They stay mapped in `normalize` for a file an older
/// Kolux wrote; the next status-hooks on takes those entries out (`clear_unused`).
pub const CURSOR_EVENTS: [&str; 5] = ["beforeSubmitPrompt", "stop", "postToolUse", "postToolUseFailure", "afterAgentResponse"];
pub const DROID_EVENTS: [&str; 8] = ["SessionStart", "UserPromptSubmit", "Stop", "SubagentStop", "PreToolUse", "PostToolUse", "PermissionRequest", "Notification"];
const DROID_TOOL_EVENTS: [&str; 3] = ["PreToolUse", "PostToolUse", "PermissionRequest"];
pub const COMMAND_CODE_EVENTS: [&str; 3] = ["PreToolUse", "PostToolUse", "Stop"];
const COMMAND_CODE_TOOL_EVENTS: [&str; 2] = ["PreToolUse", "PostToolUse"];
pub const KIMI_EVENTS: [&str; 7] = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Stop", "StopFailure"];
pub const HERMES_HOOKS: [&str; 10] = ["on_session_start", "pre_llm_call", "post_llm_call", "pre_tool_call", "post_tool_call", "pre_approval_request", "post_approval_response", "on_session_end", "on_session_finalize", "on_session_reset"];
/// A Hermes tool event is only worth its moment: never held in the spool (as Amp's, COMPAT 3.1).
const HERMES_TOOL_HOOKS: [&str; 4] = ["pre_tool_call", "post_tool_call", "pre_approval_request", "post_approval_response"];
/// Kimi's marker lines; an older block carried the agent's former name, so only the start of each
/// marker is matched.
pub const KIMI_START: &str = "# >>> Kolux RS hooks (Kimi) >>>";
pub const KIMI_END: &str = "# <<< Kolux RS hooks (Kimi) <<<";
const KIMI_START_PREFIX: &str = "# >>> Kolux RS hooks";
const KIMI_END_PREFIX: &str = "# <<< Kolux RS hooks";
/// The ask tool that makes a Droid or Hermes pane wait (`vendors::change` reads it).
const ASK: &str = "ask_permission";
const AGENTS: [&str; 9] = ["cursor", "droid", "command-code", "kimi", "hermes", "copilot", "grok", "devin", "pi"];

/// `id` is one of this module's agents.
pub fn manages(id: &str) -> bool {
    AGENTS.contains(&id)
}

/// A path the hook listener takes for one of these vendors.
pub fn is_route(path: &str) -> bool {
    agent_of(path).is_some()
}

/// The agent id a route reports for.
pub fn agent_of(path: &str) -> Option<&'static str> {
    let mut parts = path.trim_start_matches('/').splitn(2, '/');
    let first = parts.next()?;
    let agent = AGENTS.into_iter().find(|a| *a == first)?;
    // Only a routed vendor's path goes on (`copilot/<event>`); every other route is bare.
    (parts.next().is_none() || ROUTED.contains(&agent)).then_some(agent)
}

/// The vendor's event as the status rules read it (`hook_event_name` and Claude Code's field
/// names), or `None` when it changes nothing. The pane's state then comes from `vendors::change`
/// (Codex's mapping with the ask tools waiting), so a vendor's own "waiting" is said with `ASK`.
pub fn normalize(path: &str, event: &Value) -> Option<Value> {
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let flag = |k: &str| event.get(k).and_then(Value::as_bool) == Some(true);
    let tool = || json!({ "tool_name": str_of("tool_name"), "tool_input": event.get("tool_input") });
    // Copilot and Grok spell their fields camel-case in their own payload shape.
    let either = |a: &str, b: &str| str_of(a).or_else(|| str_of(b));
    let camel_tool = || json!({ "tool_name": either("tool_name", "toolName"), "tool_input": event.get("tool_input").or_else(|| event.get("toolArgs")).or_else(|| event.get("toolInput")) });
    let (name, session, mut out) = match agent_of(path)? {
        "cursor" => {
            let (name, out) = match str_of("hook_event_name")? {
                "beforeSubmitPrompt" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                // STAT-012: a stop that is not "completed" (aborted, error) is an interruption.
                "stop" => ("Stop", json!({ "kolux_interrupted": str_of("status").is_some_and(|s| s != "completed") })),
                "preToolUse" | "beforeMCPExecution" => ("PreToolUse", tool()),
                "beforeShellExecution" => ("PreToolUse", json!({ "tool_name": "Shell", "tool_input": { "command": str_of("command") } })),
                "postToolUse" | "postToolUseFailure" => ("PostToolUse", tool()),
                "sessionStart" => ("SessionStart", json!({})),
                "sessionEnd" => ("Stop", json!({})),
                // COMPAT 3.5: the reply text ends nothing by itself; `stop` does.
                _ => return None,
            };
            (name, str_of("conversation_id"), out)
        }
        "droid" => {
            let (name, out) = match str_of("hook_event_name")? {
                "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                "Stop" => ("Stop", json!({})),
                "PreToolUse" => ("PreToolUse", tool()),
                "PostToolUse" => ("PostToolUse", tool()),
                // COMPAT 3.5: Droid's permission request waits (the ask tool), its answer carries on.
                "PermissionRequest" => ("PreToolUse", json!({ "tool_name": ASK, "tool_input": event.get("tool_input") })),
                // COMPAT 3.5: a permission prompt waits, an idle prompt is a finished turn.
                "Notification" => match str_of("notification_type") {
                    Some("permission_prompt") => ("PreToolUse", json!({ "tool_name": ASK })),
                    Some("idle_prompt") => ("Stop", json!({})),
                    _ => return None,
                },
                _ => return None,
            };
            (name, str_of("session_id"), out)
        }
        "command-code" => {
            let (name, out) = match str_of("hook_event_name")? {
                "PreToolUse" => ("PreToolUse", tool()),
                "PostToolUse" => ("PostToolUse", tool()),
                "Stop" => ("Stop", json!({})),
                _ => return None,
            };
            (name, str_of("session_id"), out)
        }
        "kimi" => {
            let (name, out) = match str_of("hook_event_name")? {
                "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                "PreToolUse" => ("PreToolUse", tool()),
                "PostToolUse" | "PostToolUseFailure" => ("PostToolUse", tool()),
                "PermissionRequest" => ("PermissionRequest", tool()),
                "Stop" => ("Stop", json!({ "kolux_interrupted": flag("interrupted") || flag("is_interrupt"), "last_assistant_message": str_of("last_assistant_message") })),
                // DT-C13: no cause is read for Kimi yet (`vendors::change` carries none); a failed
                // stop still ends the turn.
                "StopFailure" => ("Stop", json!({})),
                _ => return None,
            };
            (name, str_of("session_id"), out)
        }
        "hermes" => {
            let (name, out) = match str_of("event")? {
                "on_session_start" => ("SessionStart", json!({})),
                "pre_llm_call" => ("UserPromptSubmit", json!({ "prompt": str_of("user_message") })),
                "post_llm_call" => ("Stop", json!({ "last_assistant_message": str_of("assistant_response") })),
                "pre_tool_call" => ("PreToolUse", json!({ "tool_name": str_of("tool_name") })),
                "pre_approval_request" => ("PreToolUse", json!({ "tool_name": ASK })),
                "post_tool_call" | "post_approval_response" => ("PostToolUse", json!({ "tool_name": str_of("tool_name") })),
                "on_session_end" => ("Stop", json!({ "kolux_interrupted": flag("interrupted") })),
                "on_session_finalize" | "on_session_reset" => ("Stop", json!({})),
                _ => return None,
            };
            (name, str_of("session_id"), out)
        }
        "copilot" => {
            let name = routed_event(path).or_else(|| str_of("hook_event_name"))?;
            let (name, out) = match name {
                "sessionStart" | "SessionStart" => ("SessionStart", json!({})),
                "sessionEnd" | "SessionEnd" => ("Stop", json!({})),
                "userPromptSubmitted" | "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                "preToolUse" | "PreToolUse" => ("PreToolUse", camel_tool()),
                "postToolUse" | "postToolUseFailure" | "PostToolUse" | "PostToolUseFailure" => ("PostToolUse", camel_tool()),
                "agentStop" | "Stop" => ("Stop", json!({})),
                // STAT-017: an error Copilot can recover from keeps the turn going; any other ends it.
                "errorOccurred" | "ErrorOccurred" if flag("recoverable") => ("PostToolUse", json!({})),
                "errorOccurred" | "ErrorOccurred" => ("Stop", json!({})),
                "permissionRequest" | "PermissionRequest" => ("PermissionRequest", camel_tool()),
                "notification" | "Notification" => match str_of("notification_type") {
                    Some("permission_prompt") => ("PreToolUse", json!({ "tool_name": ASK })),
                    _ => return None,
                },
                // subagentStart, subagentStop and preCompact are registered and change nothing (COMPAT 3.5).
                _ => return None,
            };
            (name, either("session_id", "sessionId"), out)
        }
        "grok" => {
            let (name, out) = match either("hook_event_name", "hookEventName")? {
                "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                "Stop" | "StopFailure" | "SessionEnd" => ("Stop", json!({})),
                "PreToolUse" => ("PreToolUse", camel_tool()),
                "PostToolUse" | "PostToolUseFailure" => ("PostToolUse", camel_tool()),
                // STAT-018: a routine notice changes nothing and never notifies; the wording rule for
                // the notices that mean needs-you or done waits on Grok's payload doc (T-122-b).
                _ => return None,
            };
            (name, either("session_id", "sessionId"), out)
        }
        "devin" => {
            let name = routed_event(path).or_else(|| str_of("hook_event_name"))?;
            let (name, out) = match name {
                "UserPromptSubmit" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                // STAT-019: a stop flagged as the user's interruption is one.
                "Stop" => ("Stop", json!({ "kolux_interrupted": flag("interrupted") || flag("is_interrupt") || flag("user_interrupted") })),
                "PostCompaction" => ("PostToolUse", json!({})),
                "SessionEnd" => ("Stop", json!({})),
                "PreToolUse" => ("PreToolUse", tool()),
                "PostToolUse" => ("PostToolUse", tool()),
                "PermissionRequest" => ("PreToolUse", json!({ "tool_name": ASK, "tool_input": event.get("tool_input") })),
                // SessionStart changes nothing (COMPAT 3.5).
                _ => return None,
            };
            (name, str_of("session_id"), out)
        }
        "pi" => {
            let (name, out) = match str_of("event")? {
                "session_start" => ("SessionStart", json!({})),
                "before_agent_start" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
                "tool_execution_start" => ("PreToolUse", json!({ "tool_name": str_of("tool_name") })),
                "tool_execution_end" => ("PostToolUse", json!({ "tool_name": str_of("tool_name") })),
                // Pi's doc: agent_end is not a final-idle signal; agent_settled is.
                "agent_settled" | "session_shutdown" => ("Stop", json!({})),
                _ => return None,
            };
            (name, str_of("session_id"), out)
        }
        _ => return None,
    };
    let o = out.as_object_mut()?;
    o.retain(|_, v| !v.is_null());
    o.insert("hook_event_name".into(), name.into());
    if let Some(s) = session {
        o.insert("session_id".into(), s.into());
    }
    Some(out)
}

/// What the hook prints back when the vendor's doc says it must answer (COMPAT 3.1): Cursor's
/// `beforeSubmitPrompt` gets "continue"; everything else nothing (the listener then prints `{}`,
/// which is why Cursor's permission hooks are not installed at all: see `CURSOR_EVENTS`). Cursor asks
/// as it would without Kolux and the pane's state comes from the events alone.
pub fn reply(path: &str, body: &[u8]) -> Option<String> {
    if agent_of(path)? != "cursor" {
        return None;
    }
    let event: Value = serde_json::from_slice(body).ok()?;
    (event.get("hook_event_name")?.as_str()? == "beforeSubmitPrompt").then(|| json!({ "continue": true }).to_string())
}

pub fn write_cursor_script(home: &Path) -> Result<String, String> {
    write_script(home, CURSOR_SCRIPT, &script("cursor", "cursor", true))
}

pub fn write_droid_script(home: &Path) -> Result<String, String> {
    write_script(home, DROID_SCRIPT, &script("droid", "droid", false))
}

pub fn write_command_code_script(home: &Path) -> Result<String, String> {
    write_script(home, COMMAND_CODE_SCRIPT, &script("command-code", "command-code", false))
}

pub fn write_kimi_script(home: &Path) -> Result<String, String> {
    write_script(home, KIMI_SCRIPT, &kimi_script())
}

/// `agent_hooks::sync`'s refresh of every script here.
pub fn write_scripts(home: &Path) -> Result<String, String> {
    write_cursor_script(home)?;
    write_droid_script(home)?;
    write_command_code_script(home)?;
    write_kimi_script(home)?;
    write_copilot_script(home)?;
    write_grok_script(home)?;
    write_devin_script(home)
}

/// Kimi's hook as a POSIX shell script (LF line ends): the `.cmd` script's steps in sh, posting to
/// the Kolux that opened the pane and spooling a whole line when none answers. The spooled line
/// holds the event's name, session and tool only, never the prompt, the reply or a tool's input.
pub fn kimi_script() -> String {
    [
        "#!/bin/sh",
        "# Kolux RS agent hook for kimi. Written by Kolux RS; edits are overwritten.",
        "# Outside a Kolux pane there is nothing to report: leave before reading stdin.",
        "[ -n \"$KOLUX_PANE_KEY\" ] || exit 0",
        "[ -n \"$KOLUX_HOOK_IDENTITY\" ] || exit 0",
        "KP=$KOLUX_AGENT_HOOK_PORT; KT=$KOLUX_AGENT_HOOK_TOKEN; KE=$KOLUX_HOOK_ENDPOINT",
        "# The endpoint file names the Kolux running now, so a pane outlives a Kolux restart.",
        "if [ -n \"$KE\" ] && [ -f \"$KE\" ]; then read -r p t < \"$KE\"; [ -n \"$p\" ] && [ -n \"$t\" ] && KP=$p && KT=$t; fi",
        "KF=${TMPDIR:-${TEMP:-/tmp}}/kolux-rs-hook-$KOLUX_PANE_KEY-$$.json",
        "cat > \"$KF\"",
        "if [ -n \"$KP\" ] && [ -n \"$KT\" ] && curl -s -m 1.5 --connect-timeout 0.5 --noproxy '*' -X POST -H 'Content-Type: application/json' -H \"X-Kolux-Token: $KT\" -H \"X-Kolux-Pane: $KOLUX_HOOK_IDENTITY\" -H \"X-Kolux-Config: $CLAUDE_CONFIG_DIR\" --data-binary \"@$KF\" \"http://127.0.0.1:$KP/kimi\" >/dev/null 2>&1; then :",
        "elif [ -n \"$KE\" ] && [ -s \"$KF\" ]; then",
        "  # Kolux is closed or not answering: the event waits, one whole line, for the next start.",
        "  # Only what the status needs is held: never the tool's input or output, the prompt or the reply.",
        "  n=$(sed -n 's/.*\"hook_event_name\"[[:space:]]*:[[:space:]]*\"\\([A-Za-z]*\\)\".*/\\1/p' \"$KF\" | head -n 1)",
        "  s=$(sed -n 's/.*\"session_id\"[[:space:]]*:[[:space:]]*\"\\([A-Za-z0-9._:-]*\\)\".*/\\1/p' \"$KF\" | head -n 1)",
        "  t=$(sed -n 's/.*\"tool_name\"[[:space:]]*:[[:space:]]*\"\\([A-Za-z0-9._:-]*\\)\".*/\\1/p' \"$KF\" | head -n 1)",
        "  [ -n \"$n\" ] && printf 'kimi|%s|%s|{\"hook_event_name\":\"%s\",\"session_id\":\"%s\",\"tool_name\":\"%s\"}\\n' \"$KOLUX_HOOK_IDENTITY\" \"$CLAUDE_CONFIG_DIR\" \"$n\" \"$s\" \"$t\" >> \"$(dirname \"$KE\")/{SPOOL}\" 2>/dev/null",
        "fi",
        "rm -f \"$KF\"",
        "exit 0",
        "",
    ]
    .join("\n")
    .replace("{SPOOL}", SPOOL_FILE)
}

pub fn cursor_file(home: &Path) -> PathBuf {
    home.join(".cursor").join("hooks.json")
}

pub fn droid_file(home: &Path) -> PathBuf {
    home.join(".factory").join("settings.json")
}

pub fn command_code_file(home: &Path) -> PathBuf {
    home.join(".commandcode").join("settings.json")
}

/// `$KIMI_CODE_HOME/config.toml` when that variable is set, else `~/.kimi-code/config.toml`.
pub fn kimi_file(home: &Path) -> PathBuf {
    kimi_file_in(home, std::env::var_os("KIMI_CODE_HOME").filter(|v| !v.is_empty()).map(PathBuf::from))
}

pub fn kimi_file_in(home: &Path, kimi_home: Option<PathBuf>) -> PathBuf {
    kimi_home.unwrap_or_else(|| home.join(".kimi-code")).join("config.toml")
}

/// `$HERMES_HOME` when set, else `~/.hermes`.
pub fn hermes_home(home: &Path) -> PathBuf {
    std::env::var_os("HERMES_HOME").filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".hermes"))
}

/// The plugin folder: `<hermes home>/plugins/kolux-status`.
pub fn hermes_dir(home: &Path) -> PathBuf {
    hermes_home(home).join("plugins").join(HERMES_PLUGIN)
}

/// The Hermes plugin's manifest.
pub fn hermes_manifest() -> String {
    format!("# Written by Kolux RS; edits are overwritten.\nname: {HERMES_PLUGIN}\nversion: \"1\"\ndescription: Tells Kolux RS what this pane's Hermes is doing. It never answers for Hermes.\n")
}

/// The Hermes plugin: it reports each hook point to the Kolux that opened the pane and answers
/// nothing (every hook returns `None`). Hook callbacks take their fields by name where Hermes passes
/// them so, else in the documented order.
pub fn hermes_plugin() -> String {
    r#"# Kolux RS status plugin for Hermes. Written by Kolux RS; edits are overwritten.
# It tells Kolux RS what this pane's agent is doing and never answers for Hermes.
import json
import os
import re
import urllib.request

HOOKS = {HOOKS}
TOOL_HOOKS = {TOOL_HOOKS}
# Each hook's fields as its doc names them, in the order they are passed.
FIELDS = {
    "on_session_start": ["session_id"],
    "pre_llm_call": ["session_id", "user_message"],
    "post_llm_call": ["session_id", "user_message", "assistant_response"],
    "pre_tool_call": ["tool_name"],
    "post_tool_call": ["tool_name"],
    "pre_approval_request": ["tool_name"],
    "post_approval_response": ["tool_name"],
    "on_session_end": ["session_id", "completed", "interrupted"],
    "on_session_finalize": ["session_id"],
    "on_session_reset": ["session_id"],
}
SENT = ("session_id", "user_message", "assistant_response", "tool_name", "interrupted")
HELD = ("session_id", "tool_name", "interrupted")


def _text(v, n=16000):
    return v[:n] if isinstance(v, str) else (v if isinstance(v, bool) else None)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # Whatever holds the port, a 301/302/303/307/308 is never followed: the default handler would
    # re-send the token and pane name to the Location target. None here leaves the 30x to the
    # default error handler, which raises into _send's except.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _send(name, fields):
    env = os.environ
    if not env.get("KOLUX_PANE_KEY") or not env.get("KOLUX_HOOK_IDENTITY"):
        return
    port, token = env.get("KOLUX_AGENT_HOOK_PORT"), env.get("KOLUX_AGENT_HOOK_TOKEN")
    try:
        with open(env["KOLUX_HOOK_ENDPOINT"], encoding="utf-8") as f:
            p, t = f.read().split()[:2]
        port, token = p, t
    except Exception:
        pass
    body = {"event": name}
    body.update({k: _text(v) for k, v in fields.items() if k in SENT and _text(v) is not None})
    try:
        # A port that is not 1-5 digits is not Kolux's.
        if not port or not token or not re.fullmatch(r"[0-9]{1,5}", port):
            raise RuntimeError("no Kolux")
        # Loopback only: the same hook listener the .cmd scripts post to with curl --noproxy, through
        # an opener with no proxies at all, so neither HTTP_PROXY nor the system proxy sees a hook,
        # and no redirects, so the token never leaves for a Location target.
        req = urllib.request.Request(
            "http://127.0.0.1:%s/hermes" % port,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Kolux-Token": token, "X-Kolux-Pane": env["KOLUX_HOOK_IDENTITY"]},
            method="POST",
        )
        urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect()).open(req, timeout=1.5).read()
    except Exception:
        # Kolux is closed or not answering: the event waits, one whole line, for the next start.
        # A tool event is only worth its moment: it is never held. Only what the status needs is
        # held: never the prompt or the reply.
        if name in TOOL_HOOKS or not env.get("KOLUX_HOOK_ENDPOINT"):
            return
        held = {k: v for k, v in body.items() if k == "event" or k in HELD}
        try:
            with open(os.path.join(os.path.dirname(env["KOLUX_HOOK_ENDPOINT"]), "{SPOOL}"), "a", encoding="utf-8") as f:
                f.write("hermes|%s||%s\n" % (env["KOLUX_HOOK_IDENTITY"], json.dumps(held)))
        except Exception:
            pass


def _hook(name):
    def cb(*args, **kwargs):
        fields = dict(zip(FIELDS[name], args))
        fields.update(kwargs)
        try:
            _send(name, fields)
        except Exception:
            pass
        return None

    return cb


def register(ctx):
    for name in HOOKS:
        try:
            ctx.register_hook(name, _hook(name))
        except Exception:
            pass
"#
    .replace("{SPOOL}", SPOOL_FILE)
    .replace("{HOOKS}", &json!(HERMES_HOOKS).to_string())
    .replace("{TOOL_HOOKS}", &json!(HERMES_TOOL_HOOKS).to_string())
}

/// A fenced run (test, dev, lane) writes only below a scratch marker in the temp folder; the
/// deepest folder of `file` that exists already is the one checked.
fn target(profile: &Path, file: PathBuf) -> Result<PathBuf, String> {
    if fenced(profile) {
        let probe = file.ancestors().skip(1).find(|a| a.is_dir()).map(|a| a.join("probe")).unwrap_or_else(|| file.clone());
        scratch_only(&probe, &std::env::temp_dir(), &home_dir()).map_err(|e| e.replace(&probe.display().to_string(), &file.display().to_string()))?;
    }
    Ok(file)
}

fn parse(file: &Path, text: Option<&str>) -> Result<Value, String> {
    match text {
        Some(t) => serde_json::from_str(t).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display())),
        None => Ok(json!({})),
    }
}

/// A copy of the user's `file` is kept (and checked against its record) before Kolux writes it
/// (`agent_hooks::back_up`); see `vendors::keep_copy`.
fn keep_copy(home: &Path, file: &Path, agent: &str, existed: bool, mine_already: bool) -> Result<(), String> {
    if existed && mine_already && !backup_of(file).exists() {
        return Ok(());
    }
    // The record names the file by its resolved path, which a folder that does not exist yet cannot
    // give; so the folder is there before the "created" line is written, as it is at removal.
    if let Some(dir) = file.parent().filter(|d| !d.is_dir()) {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    if let Some((original, copy)) = back_up(file, &target_dir(home, file).join(BACKUP_RECORD))? {
        eprintln!("kolux-rs: {agent} hooks: kept a copy before the first write: sha256 original {original}, backup {copy}");
    }
    Ok(())
}

/// `v` goes back into `file`; when it reads the same as the copy kept before Kolux's first write,
/// the copy's own bytes are written; a file Kolux created and left holding nothing is deleted.
fn write_back(home: &Path, file: &Path, v: &Value, text: &str) -> Result<(), String> {
    match kept(file).filter(|(_, c)| c == v) {
        Some((bytes, _)) => write_atomic(file, &bytes, Some(text)),
        None if drop_created(file, &target_dir(home, file).join(BACKUP_RECORD), v, text)? => Ok(()),
        None => write_json(file, v, Some(text)),
    }
}

/// A value Kolux would have to replace to add its own entries is the user's: refused, never rewritten.
fn refuse_shape(file: &Path, v: &Value, events: &[&str]) -> Result<(), String> {
    let bad = |what: String| Err(format!("{} has {what}; left alone", file.display()));
    let Some(root) = v.as_object() else { return bad("a top level that is not an object".into()) };
    let Some(hooks) = root.get("hooks") else { return Ok(()) };
    let Some(hooks) = hooks.as_object() else { return bad("a \"hooks\" value that is not an object".into()) };
    match events.iter().find(|e| hooks.get(**e).is_some_and(|g| !g.is_array())) {
        Some(e) => bad(format!("a \"{e}\" value that is not a list")),
        None => Ok(()),
    }
}

/// Claude-style groups (Droid, Command Code): one Kolux group under each event; the user's own stay.
fn install_hooks(home: &Path, file: &Path, agent: &str, command: &str, events: &[&str], matched: &[&str]) -> Result<bool, String> {
    let text = read_opt(file)?;
    let mut v = parse(file, text.as_deref())?;
    refuse_shape(file, &v, events)?;
    let mine_already = remove_groups(&mut v.clone(), false);
    let changed = install_groups(&mut v, events, matched, command, 10);
    if changed {
        keep_copy(home, file, agent, text.is_some(), mine_already)?;
        write_json(file, &v, text.as_deref())?;
    }
    Ok(changed)
}

/// Takes Kolux's entries out of a `{"hooks": {...}}` file. A `hooks` object left empty goes too
/// unless the copy kept before the install had one (as for Claude Code); Cursor's `version` key
/// goes with it when it is all that is left of a file Kolux created.
pub fn remove_hooks(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut v = parse(file, Some(&text))?;
    let had = kept(file);
    let changed = remove_groups(&mut v, had.as_ref().is_none_or(|(_, c)| c.get("hooks").is_none()));
    if changed {
        if let Some(o) = v.as_object_mut().filter(|o| o.len() == 1 && o.contains_key("version") && had.is_none()) {
            if was_created(&target_dir(home, file).join(BACKUP_RECORD), file) {
                o.remove("version");
            }
        }
        write_back(home, file, &v, &text)?;
    }
    Ok(changed)
}

pub fn install_droid(home: &Path, file: &Path) -> Result<bool, String> {
    let command = write_droid_script(home)?;
    install_hooks(home, file, "droid", &command, &DROID_EVENTS, &DROID_TOOL_EVENTS)
}

pub fn install_command_code(home: &Path, file: &Path) -> Result<bool, String> {
    let command = write_command_code_script(home)?;
    install_hooks(home, file, "command-code", &command, &COMMAND_CODE_EVENTS, &COMMAND_CODE_TOOL_EVENTS)
}

/// Cursor: one Kolux entry (`{command, timeout}`, no group) under each event, `"version": 1` set
/// when the file has none; the user's own entries stay.
pub fn install_cursor(home: &Path, file: &Path) -> Result<bool, String> {
    let command = write_cursor_script(home)?;
    let text = read_opt(file)?;
    let mut v = parse(file, text.as_deref())?;
    refuse_shape(file, &v, &CURSOR_EVENTS)?;
    let mine_already = remove_groups(&mut v.clone(), false);
    let before = v.clone();
    let root = v.as_object_mut().unwrap();
    root.entry("version").or_insert(json!(1));
    let hooks = root.entry("hooks").or_insert_with(|| json!({})).as_object_mut().unwrap();
    for event in CURSOR_EVENTS {
        let entries = hooks.entry(event).or_insert_with(|| json!([])).as_array_mut().unwrap();
        let mine = json!({ "command": command, "timeout": 10 });
        match entries.iter().position(names_mine) {
            Some(i) => {
                entries.retain(|e| !names_mine(e));
                entries.insert(i.min(entries.len()), mine);
            }
            None => entries.push(mine),
        }
    }
    super::clear_unused(hooks, &CURSOR_EVENTS);
    let changed = v != before;
    if changed {
        keep_copy(home, file, "cursor", text.is_some(), mine_already)?;
        write_json(file, &v, text.as_deref())?;
    }
    Ok(changed)
}

/// Kimi's block: one `[[hooks]]` table per event, nothing but the four keys its doc allows.
pub fn kimi_block(command: &str) -> String {
    let mut out = format!("{KIMI_START}\n");
    for event in KIMI_EVENTS {
        out.push_str(&format!("[[hooks]]\nevent = \"{event}\"\nmatcher = \"*\"\ncommand = \"bash {}\"\ntimeout = 10\n", toml_str(command)));
    }
    out.push_str(KIMI_END);
    out.push('\n');
    out
}

/// `s` as the inside of a TOML basic string.
fn toml_str(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// `text` with every Kolux block (current or former marker name) taken out; true when one was.
fn strip_kimi(text: &str) -> (String, bool) {
    let mut out = String::with_capacity(text.len());
    let (mut inside, mut found) = (false, false);
    for line in text.split_inclusive('\n') {
        let l = line.trim_end();
        if !inside && l.starts_with(KIMI_START_PREFIX) {
            inside = true;
            found = true;
            continue;
        }
        if inside {
            if l.starts_with(KIMI_END_PREFIX) {
                inside = false;
            }
            continue;
        }
        out.push_str(line);
    }
    (out, found)
}

/// Kimi: the block goes at the end of `config.toml` (replacing an older Kolux block where it
/// stands is not worth its risk: the file is rewritten whole either way). A file that is not TOML
/// is refused, never rewritten.
pub fn install_kimi(home: &Path, file: &Path) -> Result<bool, String> {
    let command = write_kimi_script(home)?;
    let text = read_opt(file)?;
    let (rest, mine_already) = strip_kimi(text.as_deref().unwrap_or(""));
    rest.parse::<toml_edit::DocumentMut>().map_err(|e| format!("{} is not TOML ({e}); left alone", file.display()))?;
    let mut new = rest.clone();
    if !new.is_empty() && !new.ends_with('\n') {
        new.push('\n');
    }
    if !new.is_empty() && !new.ends_with("\n\n") {
        new.push('\n');
    }
    new.push_str(&kimi_block(&command));
    if text.as_deref() == Some(new.as_str()) {
        return Ok(false);
    }
    keep_copy(home, file, "kimi", text.is_some(), mine_already)?;
    write_atomic(file, new.as_bytes(), text.as_deref())?;
    Ok(true)
}

/// Kimi: the block goes; a file that then reads as the kept copy gets the copy's bytes, and a file
/// Kolux created and left empty is deleted.
pub fn remove_kimi(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let (rest, found) = strip_kimi(&text);
    if !found {
        return Ok(false);
    }
    let record = target_dir(home, file).join(BACKUP_RECORD);
    let copy = fs::read(backup_of(file)).ok();
    let bytes = match copy {
        Some(c) if String::from_utf8_lossy(&c).trim() == rest.trim() => c,
        None if rest.trim().is_empty() && was_created(&record, file) => {
            fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
            let _ = fs::remove_file(record);
            return Ok(true);
        }
        _ => rest.into_bytes(),
    };
    write_atomic(file, &bytes, Some(&text))?;
    Ok(true)
}

/// Kolux's plugin files say so on their first line; the words anywhere else are the user's.
fn hermes_mine(text: &str) -> bool {
    text.lines().next().is_some_and(|l| l.starts_with('#') && l.contains("Written by Kolux RS"))
}

/// Hermes: Kolux's plugin folder; a file of the user's under either name is never replaced.
pub fn install_hermes(dir: &Path) -> Result<bool, String> {
    let files = [("plugin.yaml", hermes_manifest()), ("__init__.py", hermes_plugin())];
    // Both files are checked before either is written, so a refusal leaves nothing of Kolux's.
    let mut olds = Vec::new();
    for (name, _) in &files {
        let old = read_opt(&dir.join(name))?;
        if old.as_deref().is_some_and(|o| !hermes_mine(o)) {
            return Err(format!("{} is not Kolux's own plugin; left alone", dir.join(name).display()));
        }
        olds.push(old);
    }
    let mut changed = false;
    for ((name, want), old) in files.iter().zip(olds) {
        if old.as_deref() == Some(want.as_str()) {
            continue;
        }
        write_atomic(&dir.join(name), want.as_bytes(), old.as_deref())?;
        changed = true;
    }
    Ok(changed)
}

pub fn remove_hermes(dir: &Path) -> Result<bool, String> {
    let mut changed = false;
    for name in ["plugin.yaml", "__init__.py"] {
        let file = dir.join(name);
        if read_opt(&file)?.is_some_and(|t| hermes_mine(&t)) {
            fs::remove_file(&file).map_err(|e| format!("{}: {e}", file.display()))?;
            changed = true;
        }
    }
    // The folder goes only when Kolux's files were all it held.
    let _ = fs::remove_dir(dir);
    Ok(changed)
}

/// Hermes's `config.yaml` lists the plugin under `plugins:` / `disabled:`: the user switched it off
/// in Hermes's own file, which Kolux reads and never writes.
pub fn hermes_disabled(config: &Path) -> bool {
    let Ok(text) = fs::read_to_string(config) else { return false };
    let mut in_disabled = false;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('#') || l.is_empty() {
            continue;
        }
        if in_disabled {
            if let Some(item) = l.strip_prefix("- ") {
                if item.trim().trim_matches(['"', '\'']) == HERMES_PLUGIN {
                    return true;
                }
                continue;
            }
        }
        // ponytail: a line scan, not a YAML parser; a `disabled:` list anywhere counts.
        in_disabled = l.starts_with("disabled:") && l["disabled:".len()..].trim().is_empty();
        if let Some(list) = l.strip_prefix("disabled:") {
            if list.trim_start().starts_with('[') && list.split(',').any(|i| i.trim().trim_matches(['[', ']', '"', '\'', ' ']) == HERMES_PLUGIN) {
                return true;
            }
        }
    }
    false
}

/// `agent_hooks::apply` for these nine.
pub fn apply(home: &Path, profile: &Path, id: &str, plan: Plan) -> Result<&'static str, String> {
    let done = |installed: bool| if installed { "installed" } else { "removed" };
    let install = plan == Plan::Install;
    match id {
        "cursor" => {
            let file = target(profile, cursor_file(home))?;
            if install { install_cursor(home, &file) } else { remove_hooks(home, &file) }
        }
        "droid" => {
            let file = target(profile, droid_file(home))?;
            if install { install_droid(home, &file) } else { remove_hooks(home, &file) }
        }
        "command-code" => {
            let file = target(profile, command_code_file(home))?;
            if install { install_command_code(home, &file) } else { remove_hooks(home, &file) }
        }
        "kimi" => {
            let file = target(profile, kimi_file(home))?;
            if install { install_kimi(home, &file) } else { remove_kimi(home, &file) }
        }
        "hermes" => {
            let dir = target(profile, hermes_dir(home).join("__init__.py"))?;
            let dir = dir.parent().unwrap_or(&dir);
            if install { install_hermes(dir) } else { remove_hermes(dir) }
        }
        "copilot" => {
            let file = target(profile, copilot_file(home))?;
            if install { install_copilot(home, &file) } else { remove_copilot(&file) }
        }
        "grok" => {
            let file = target(profile, grok_file(home))?;
            if install { install_grok(home, &file) } else { remove_grok(home, &file) }
        }
        "devin" => {
            let file = target(profile, devin_file(home))?;
            if install { install_devin(home, &file) } else { remove_devin(home, &file) }
        }
        "pi" => {
            let file = target(profile, pi_file(home))?;
            if install { install_pi(&file) } else { remove_pi(&file) }
        }
        _ => return Ok("left as it was"),
    }
    .map(|_| done(install))
}

fn inspect_kimi(file: &Path) -> (&'static str, Option<String>) {
    let text = match read_opt(file) {
        Ok(Some(t)) => t,
        Ok(None) => return ("not installed", None),
        Err(e) => return ("error", Some(e)),
    };
    let (_, found) = strip_kimi(&text);
    if !found {
        return ("not installed", None);
    }
    let block: String = text.lines().skip_while(|l| !l.starts_with(KIMI_START_PREFIX)).take_while(|l| !l.starts_with(KIMI_END_PREFIX)).collect::<Vec<_>>().join("\n");
    let has = |e: &str| block.contains(&format!("event = \"{e}\"")) && block.contains(SCRIPT_DIR);
    let missing: Vec<&str> = KIMI_EVENTS.iter().copied().filter(|e| !has(e)).collect();
    if missing.is_empty() {
        ("installed", None)
    } else {
        ("partial", Some(format!("no Kolux entry for {}", missing.join(", "))))
    }
}

fn inspect_hermes(dir: &Path) -> (&'static str, Option<String>) {
    let mut have = 0;
    for (name, want) in [("plugin.yaml", hermes_manifest()), ("__init__.py", hermes_plugin())] {
        match read_opt(&dir.join(name)) {
            Ok(None) => {}
            Ok(Some(t)) if t == want => have += 1,
            Ok(Some(t)) if hermes_mine(&t) => return ("partial", Some("an older Kolux plugin".into())),
            Ok(Some(_)) => return ("error", Some(format!("{} is not Kolux's own plugin; left alone", dir.join(name).display()))),
            Err(e) => return ("error", Some(e)),
        }
    }
    match have {
        0 => ("not installed", None),
        1 => ("partial", Some("one of the plugin's two files is missing".into())),
        _ if hermes_disabled(&dir.parent().and_then(Path::parent).unwrap_or(dir).join("config.yaml")) => ("disabled", Some(format!("{HERMES_PLUGIN} is listed under plugins.disabled in Hermes's config.yaml"))),
        _ => ("installed", None),
    }
}

/// `kolux agent hooks status` rows for the nine vendors.
pub fn rows(home: &Path) -> Vec<Value> {
    let row = |agent: &str, name: &str, file: PathBuf, (state, reason): (&str, Option<String>)| json!({ "agent": agent, "name": name, "state": state, "file": file.display().to_string(), "reason": reason });
    vec![
        row("cursor", "Cursor", cursor_file(home), switch::inspect(&cursor_file(home), &CURSOR_EVENTS)),
        row("droid", "Droid", droid_file(home), switch::inspect(&droid_file(home), &DROID_EVENTS)),
        row("command-code", "Command Code", command_code_file(home), switch::inspect(&command_code_file(home), &COMMAND_CODE_EVENTS)),
        row("kimi", "Kimi", kimi_file(home), inspect_kimi(&kimi_file(home))),
        row("hermes", "Hermes", hermes_dir(home), inspect_hermes(&hermes_dir(home))),
        row("copilot", "GitHub Copilot", copilot_file(home), inspect_copilot(&copilot_file(home))),
        row("grok", "Grok", grok_file(home), switch::inspect(&grok_file(home), &GROK_EVENTS)),
        row("devin", "Devin", devin_file(home), inspect_devin(&devin_file(home))),
        row("pi", "Pi", pi_file(home), inspect_pi(&pi_file(home))),
    ]
}
// ---- T-122 (STAT-017..021): Copilot CLI, Grok, Devin, Pi ----
//
// - Copilot: Kolux's own `~/.copilot/hooks/kolux.json` (or under `COPILOT_HOME`): `version` 1,
//   `disableAllHooks` false, one `{type, powershell, timeoutSec}` entry per event in its PowerShell
//   slot. Its camel-case payload carries no event name, so the entry names the event as the
//   script's argument and the route is `copilot/<event>`; a Pascal-case `hook_event_name` in the
//   body (its VS Code shape) is read too.
// - Grok: Kolux's own `~/.grok/hooks/kolux-status.json` (or under `GROK_HOME`), Claude-style groups
//   (no matcher: Grok's is a regex, and none matches everything). Removal at quit is T-122-b.
// - Devin: `hooks` groups inside Kolux marker comment lines at the top of Devin's `config.json`
//   (`%APPDATA%\devin` here, `~/.config/devin` elsewhere); the file is JSON with comments, so the
//   text around the block is never rewritten, only read (comments stripped) to check it.
// - Pi: a Kolux extension file `~/.pi/agent/extensions/kolux-status.js` that posts Pi's events
//   itself. Dialogs, titles and OMP are T-122-b.

pub const COPILOT_SCRIPT: &str = "copilot.cmd";
pub const GROK_SCRIPT: &str = "grok.cmd";
pub const DEVIN_SCRIPT: &str = "devin.cmd";
pub const PI_EXTENSION: &str = "kolux-status.js";
pub const COPILOT_EVENTS: [&str; 13] = ["sessionStart", "sessionEnd", "userPromptSubmitted", "preToolUse", "postToolUse", "postToolUseFailure", "subagentStart", "subagentStop", "preCompact", "agentStop", "errorOccurred", "permissionRequest", "notification"];
pub const GROK_EVENTS: [&str; 9] = ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SessionEnd", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification"];
pub const DEVIN_EVENTS: [&str; 8] = ["SessionStart", "UserPromptSubmit", "Stop", "PostCompaction", "SessionEnd", "PreToolUse", "PostToolUse", "PermissionRequest"];
const DEVIN_TOOL_EVENTS: [&str; 3] = ["PreToolUse", "PostToolUse", "PermissionRequest"];
pub const PI_EVENTS: [&str; 6] = ["session_start", "before_agent_start", "tool_execution_start", "tool_execution_end", "agent_settled", "session_shutdown"];
pub const DEVIN_START: &str = "// >>> Kolux RS hooks (Devin) >>>";
pub const DEVIN_END: &str = "// <<< Kolux RS hooks (Devin) <<<";
/// The vendors whose hook names the event as the script's argument, so the route carries it.
const ROUTED: [&str; 2] = ["copilot", "devin"];

fn routed_event(path: &str) -> Option<&str> {
    path.trim_start_matches('/').split_once('/').map(|x| x.1).filter(|s| !s.is_empty())
}

pub fn write_copilot_script(home: &Path) -> Result<String, String> {
    write_script(home, COPILOT_SCRIPT, &script("copilot", "copilot/%~1", false))
}

pub fn write_grok_script(home: &Path) -> Result<String, String> {
    write_script(home, GROK_SCRIPT, &script("grok", "grok", false))
}

pub fn write_devin_script(home: &Path) -> Result<String, String> {
    write_script(home, DEVIN_SCRIPT, &script("devin", "devin/%~1", false))
}

pub fn copilot_file(home: &Path) -> PathBuf {
    copilot_file_in(home, home_var(std::env::var_os("COPILOT_HOME")))
}

/// A vendor's home variable as a path; an empty one is unset, never a path relative to the current
/// folder (council AFTER 2).
fn home_var(v: Option<std::ffi::OsString>) -> Option<PathBuf> {
    v.filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The folder of a file Kolux just removed goes too when nothing else is in it (council AFTER 4),
/// whoever made the folder: `remove_dir` only ever removes an empty folder, so an empty `hooks` or
/// `extensions` folder the user made by hand goes as well and nothing of theirs is lost with it.
fn drop_empty_dir(file: &Path) {
    if let Some(dir) = file.parent() {
        let _ = fs::remove_dir(dir);
    }
}

pub fn copilot_file_in(home: &Path, copilot_home: Option<PathBuf>) -> PathBuf {
    copilot_home.unwrap_or_else(|| home.join(".copilot")).join("hooks").join("kolux.json")
}

pub fn grok_file(home: &Path) -> PathBuf {
    grok_file_in(home, home_var(std::env::var_os("GROK_HOME")))
}

pub fn grok_file_in(home: &Path, grok_home: Option<PathBuf>) -> PathBuf {
    grok_home.unwrap_or_else(|| home.join(".grok")).join("hooks").join("kolux-status.json")
}

/// Devin's settings: the roaming application-data folder on Windows (read from `home`, never from
/// the environment, so a fenced run stays in its scratch home).
pub fn devin_file(home: &Path) -> PathBuf {
    if cfg!(windows) {
        home.join("AppData").join("Roaming").join("devin").join("config.json")
    } else {
        home.join(".config").join("devin").join("config.json")
    }
}

pub fn pi_file(home: &Path) -> PathBuf {
    home.join(".pi").join("agent").join("extensions").join(PI_EXTENSION)
}

/// Copilot's whole file: the script, with the event as its argument, in each event's PowerShell slot.
pub fn copilot_hooks(command: &str) -> Value {
    let hooks: serde_json::Map<String, Value> = COPILOT_EVENTS
        .iter()
        .map(|e| (e.to_string(), json!([{ "type": "command", "powershell": format!("& '{}' {e}", command.replace('\'', "''")), "timeoutSec": 5 }])))
        .collect();
    json!({ "version": 1, "disableAllHooks": false, "hooks": hooks })
}

/// Every entry in the file calls Kolux's script (the `powershell` slot, which `names_mine` does not read).
fn copilot_mine(v: &Value) -> bool {
    let entry_mine = |e: &Value| e.get("powershell").and_then(Value::as_str).is_some_and(|c| c.contains(SCRIPT_DIR));
    v.get("hooks").and_then(Value::as_object).is_some_and(|h| h.values().all(|g| g.as_array().is_some_and(|a| a.iter().all(entry_mine))))
}

/// Copilot: Kolux's own file is written whole; one holding entries that are not Kolux's is refused.
pub fn install_copilot(home: &Path, file: &Path) -> Result<bool, String> {
    let command = write_copilot_script(home)?;
    let want = copilot_hooks(&command);
    let text = read_opt(file)?;
    if let Some(t) = &text {
        let v = parse(file, Some(t))?;
        if v == want {
            return Ok(false);
        }
        if !copilot_mine(&v) {
            return Err(format!("{} holds entries that are not Kolux's; left alone", file.display()));
        }
    }
    write_json(file, &want, text.as_deref())?;
    Ok(true)
}

pub fn remove_copilot(file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    if !copilot_mine(&parse(file, Some(&text))?) {
        return Err(format!("{} holds entries that are not Kolux's; left alone", file.display()));
    }
    fs::remove_file(file).map_err(|e| format!("{}: {e}", file.display()))?;
    drop_empty_dir(file);
    Ok(true)
}

fn inspect_copilot(file: &Path) -> (&'static str, Option<String>) {
    let v = match read_opt(file) {
        Ok(Some(t)) => match parse(file, Some(&t)) {
            Ok(v) => v,
            Err(e) => return ("error", Some(e)),
        },
        Ok(None) => return ("not installed", None),
        Err(e) => return ("error", Some(e)),
    };
    if !copilot_mine(&v) {
        return ("error", Some(format!("{} holds entries that are not Kolux's", file.display())));
    }
    let hooks = v.get("hooks").and_then(Value::as_object);
    let missing: Vec<&str> = COPILOT_EVENTS.iter().copied().filter(|e| hooks.and_then(|h| h.get(*e)).and_then(Value::as_array).is_none_or(Vec::is_empty)).collect();
    if missing.len() == COPILOT_EVENTS.len() {
        ("not installed", None)
    } else if !missing.is_empty() {
        ("partial", Some(format!("no Kolux entry for {}", missing.join(", "))))
    } else if v.get("disableAllHooks").and_then(Value::as_bool) == Some(true) {
        ("disabled", Some("disableAllHooks is true in Kolux's Copilot hook file".into()))
    } else {
        ("installed", None)
    }
}

/// Grok: Claude-style groups in Kolux's own file, no matcher (Grok's is a regex).
pub fn install_grok(home: &Path, file: &Path) -> Result<bool, String> {
    let command = write_grok_script(home)?;
    install_hooks(home, file, "grok", &command, &GROK_EVENTS, &[])
}

/// Grok: Kolux's entries go through the T-121 helper; a file Kolux created goes with them, and the
/// `hooks` folder when nothing else is in it.
pub fn remove_grok(home: &Path, file: &Path) -> Result<bool, String> {
    let removed = remove_hooks(home, file)?;
    if removed && !file.exists() {
        drop_empty_dir(file);
    }
    Ok(removed)
}

/// Devin's block: the groups, pretty-printed two spaces in, between the marker comment lines.
pub fn devin_block(command: &str, comma: &str) -> String {
    // The script's route is `devin/<event>`, so each event's command carries its own name (the
    // block is Kolux's alone, so the groups are built outright rather than merged in).
    let groups: serde_json::Map<String, Value> = DEVIN_EVENTS
        .iter()
        .map(|e| {
            let hook = json!([{ "type": "command", "command": format!("\"{command}\" {e}"), "timeout": 10 }]);
            let group = if DEVIN_TOOL_EVENTS.contains(e) { json!({ "matcher": "*", "hooks": hook }) } else { json!({ "hooks": hook }) };
            (e.to_string(), json!([group]))
        })
        .collect();
    let hooks = serde_json::to_string_pretty(&Value::Object(groups)).unwrap_or_default().replace('\n', "\n  ");
    format!("  {DEVIN_START}\n  \"hooks\": {hooks}{comma}\n  {DEVIN_END}\n")
}

/// The JSON of a file with comments: `//` and `/* */` outside strings become spaces, one per byte
/// (line ends kept), so what is left parses and an index in it is the same index in `text`.
pub fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let (mut in_str, mut esc, mut line, mut block) = (false, false, false, false);
    let mut chars = text.chars().peekable();
    let blank = |out: &mut String, c: char| {
        if c == '\n' || c == '\r' {
            out.push(c);
        } else {
            for _ in 0..c.len_utf8() {
                out.push(' ');
            }
        }
    };
    while let Some(c) = chars.next() {
        if line {
            if c == '\n' {
                line = false;
            }
            blank(&mut out, c);
            continue;
        }
        if block {
            if c == '*' && chars.peek() == Some(&'/') {
                chars.next();
                block = false;
                out.push_str("  ");
            } else {
                blank(&mut out, c);
            }
            continue;
        }
        if in_str {
            out.push(c);
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_str = true;
                esc = false;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                chars.next();
                line = true;
                out.push_str("  ");
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                block = true;
                out.push_str("  ");
            }
            _ => out.push(c),
        }
    }
    out
}

/// The text without Kolux's block (marker lines included), and whether there was one. A start
/// marker that shares the opening brace's line (a one-line file, see `install_devin`) leaves the
/// text before it, so the file comes back byte for byte.
fn strip_devin(text: &str) -> (String, bool) {
    let mut out = String::with_capacity(text.len());
    let (mut inside, mut found) = (false, false);
    for line in text.split_inclusive('\n') {
        if !inside {
            if let Some(at) = line.find(DEVIN_START) {
                inside = true;
                found = true;
                out.push_str(line[..at].trim_end_matches(' '));
                continue;
            }
        }
        if inside {
            if line.contains(DEVIN_END) {
                inside = false;
            }
            continue;
        }
        out.push_str(line);
    }
    (out, found)
}

/// Devin: the block goes right after the file's opening brace; comments, layout and the other keys
/// stay as they were. A file that is not JSON (once its comments are stripped), or that has hooks of
/// its own, is refused and never rewritten.
pub fn install_devin(home: &Path, file: &Path) -> Result<bool, String> {
    let command = write_devin_script(home)?;
    let text = read_opt(file)?;
    let (bare, mine_already) = strip_devin(text.as_deref().unwrap_or("{\n}\n"));
    let not_json = |e: String| format!("{} is not JSON with comments ({e}); left alone", file.display());
    let stripped = strip_comments(&bare);
    let v: Value = serde_json::from_str(&stripped).map_err(|e| not_json(e.to_string()))?;
    let obj = v.as_object().ok_or_else(|| not_json("the top level is not an object".into()))?;
    // ponytail: Kolux adds hooks only to a file without any; merging into the user's own
    // groups while keeping their comments is T-122-b if a user ever has both.
    if obj.contains_key("hooks") {
        return Err(format!("{} has hooks of its own; left alone", file.display()));
    }
    // The brace is looked for in the stripped text, so one inside a leading comment is passed over;
    // its index is the same in `bare`, since comments become spaces byte for byte.
    let brace = stripped.find('{').ok_or_else(|| not_json("no opening brace".into()))?;
    let rest = &bare[brace + 1..];
    let eol = if bare.contains("\r\n") { "\r\n" } else { "\n" };
    let block = devin_block(&command, if obj.is_empty() { "" } else { "," }).replace('\n', eol);
    // Nothing around the block is trimmed or reshaped (council FIX-SOON 1): after the brace's own
    // line end the block takes whole lines of its own; in a one-line file the start marker shares
    // the brace's line, and `strip_devin` gives that line back as it was.
    let new = match rest.strip_prefix(eol).or_else(|| rest.strip_prefix('\n')) {
        Some(after) => format!("{}{}{block}{after}", &bare[..=brace], &rest[..rest.len() - after.len()]),
        None => format!("{} {}{rest}", &bare[..=brace], block.trim_start_matches(' ')),
    };
    serde_json::from_str::<Value>(&strip_comments(&new)).map_err(|e| not_json(format!("after Kolux's block it would not parse: {e}")))?;
    if text.as_deref() == Some(new.as_str()) {
        return Ok(false);
    }
    keep_copy(home, file, "devin", text.is_some(), mine_already)?;
    write_atomic(file, new.as_bytes(), text.as_deref())?;
    Ok(true)
}

/// Devin: the block goes; the kept copy's bytes come back when the rest reads as it did, and a
/// file Kolux created is deleted.
pub fn remove_devin(home: &Path, file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let (rest, found) = strip_devin(&text);
    if !found {
        return Ok(false);
    }
    let record = target_dir(home, file).join(BACKUP_RECORD);
    let copy = fs::read(backup_of(file)).ok();
    let bytes = match copy {
        Some(c) if String::from_utf8_lossy(&c).trim() == rest.trim() => c,
        None if rest.trim() == "{\n}" || rest.trim() == "{}" => {
            if was_created(&record, file) {
                fs::remove_file(file).map_err(|e| format!("{}: {e}; nothing removed", file.display()))?;
                let _ = fs::remove_file(record);
                drop_empty_dir(file);
                return Ok(true);
            }
            rest.into_bytes()
        }
        _ => rest.into_bytes(),
    };
    write_atomic(file, &bytes, Some(&text))?;
    Ok(true)
}

fn inspect_devin(file: &Path) -> (&'static str, Option<String>) {
    let text = match read_opt(file) {
        Ok(Some(t)) => t,
        Ok(None) => return ("not installed", None),
        Err(e) => return ("error", Some(e)),
    };
    let (_, found) = strip_devin(&text);
    if !found {
        return ("not installed", None);
    }
    let block: String = text.lines().skip_while(|l| !l.contains(DEVIN_START)).take_while(|l| !l.contains(DEVIN_END)).collect::<Vec<_>>().join("\n");
    let missing: Vec<&str> = DEVIN_EVENTS.iter().copied().filter(|e| !block.contains(&format!("\"{e}\""))).collect();
    if missing.is_empty() && block.contains(SCRIPT_DIR) {
        ("installed", None)
    } else {
        ("partial", Some(format!("no Kolux entry for {}", if missing.is_empty() { "the script".to_string() } else { missing.join(", ") })))
    }
}

/// The Pi extension: it reports Pi's events to the Kolux that opened the pane and answers nothing
/// (no handler returns a value, so nothing is blocked or continued). Nothing is held while Kolux is
/// away: Pi's next event says what it is doing.
pub fn pi_extension() -> String {
    r#"// Kolux RS status extension for Pi. Written by Kolux RS; edits are overwritten.
// It tells Kolux RS what this pane's agent is doing and never answers for Pi.
import fs from "node:fs";
import http from "node:http";

const EVENTS = {EVENTS};

function send(event, fields) {
  const env = process.env;
  if (!env.KOLUX_PANE_KEY || !env.KOLUX_HOOK_IDENTITY) return;
  let port = env.KOLUX_AGENT_HOOK_PORT;
  let token = env.KOLUX_AGENT_HOOK_TOKEN;
  try {
    [port, token] = fs.readFileSync(env.KOLUX_HOOK_ENDPOINT, "utf8").split(/\s+/);
  } catch {}
  // A port that is not 1-5 digits, or above 65535 (http.request would throw), is not Kolux's.
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535 || !token) return;
  const body = { event };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string" && v) body[k] = v.slice(0, 16000);
  }
  const data = JSON.stringify(body);
  // Loopback only: the same hook listener the .cmd scripts post to with curl --noproxy. The host is
  // fixed, and `agent: false` gives the request its own agent instead of http.globalAgent, which
  // Node 24.5+ points at HTTP_PROXY when NODE_USE_ENV_PROXY=1 is set (Bun's node:http is unverified,
  // so the same option applies there). Anything http.request throws stays here.
  try {
    const req = http.request({ host: "127.0.0.1", port: Number(port), path: "/pi", method: "POST", agent: false, timeout: 1500, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "X-Kolux-Token": token, "X-Kolux-Pane": env.KOLUX_HOOK_IDENTITY } }, (res) => res.resume());
    req.on("timeout", () => req.destroy());
    req.on("error", () => {});
    req.end(data);
  } catch {}
}

export default function (pi) {
  for (const event of EVENTS) {
    pi.on(event, (ev) => {
      send(event, { prompt: ev && ev.prompt, tool_name: ev && ev.toolName });
    });
  }
}
"#
    .replace("{EVENTS}", &json!(PI_EVENTS).to_string())
}

fn pi_mine(text: &str) -> bool {
    text.lines().next().is_some_and(|l| l.starts_with("//") && l.contains("Written by Kolux RS"))
}

/// Pi: Kolux's extension file; a file of the user's under its name is never replaced.
pub fn install_pi(file: &Path) -> Result<bool, String> {
    let want = pi_extension();
    let old = read_opt(file)?;
    if old.as_deref().is_some_and(|o| !pi_mine(o)) {
        return Err(format!("{} is not Kolux's own extension; left alone", file.display()));
    }
    if old.as_deref() == Some(want.as_str()) {
        return Ok(false);
    }
    write_atomic(file, want.as_bytes(), old.as_deref())?;
    Ok(true)
}

pub fn remove_pi(file: &Path) -> Result<bool, String> {
    if !read_opt(file)?.is_some_and(|t| pi_mine(&t)) {
        return Ok(false);
    }
    fs::remove_file(file).map_err(|e| format!("{}: {e}", file.display()))?;
    drop_empty_dir(file);
    Ok(true)
}

fn inspect_pi(file: &Path) -> (&'static str, Option<String>) {
    match read_opt(file) {
        Ok(None) => ("not installed", None),
        Ok(Some(t)) if t == pi_extension() => ("installed", None),
        Ok(Some(t)) if pi_mine(&t) => ("partial", Some("an older Kolux extension".into())),
        Ok(Some(_)) => ("error", Some(format!("{} is not Kolux's own extension; left alone", file.display()))),
        Err(e) => ("error", Some(e)),
    }
}


#[cfg(test)]
#[path = "vendors_more_tests.rs"]
mod tests;
