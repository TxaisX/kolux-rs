//! T-121 (STAT-012..016): status hooks for Cursor Agent, Droid, Command Code, Kimi and Hermes, from
//! each vendor's public hook or plugin docs (PROVENANCE.md, T-121). Like T-120-b's `vendors`, each
//! event is turned into the one shape the status rules read (`normalize`) and then follows the
//! rules for an agent whose hook semantics are unverified (`status::Agent::Vendor`, which reads
//! `vendors::change`); nothing here answers for the agent except where its doc says a hook must.
//!
//! - Cursor: `~/.cursor/hooks.json`, `{"version": 1, "hooks": {event: [{command, timeout}]}}`;
//!   `beforeSubmitPrompt` is answered "continue", the three before-tool events "allow".
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
pub const CURSOR_EVENTS: [&str; 8] = ["beforeSubmitPrompt", "stop", "preToolUse", "postToolUse", "postToolUseFailure", "beforeShellExecution", "beforeMCPExecution", "afterAgentResponse"];
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
const AGENTS: [&str; 5] = ["cursor", "droid", "command-code", "kimi", "hermes"];

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
    AGENTS.into_iter().find(|a| path.trim_start_matches('/') == *a)
}

/// The vendor's event as the status rules read it (`hook_event_name` and Claude Code's field
/// names), or `None` when it changes nothing. The pane's state then comes from `vendors::change`
/// (Codex's mapping with the ask tools waiting), so a vendor's own "waiting" is said with `ASK`.
pub fn normalize(path: &str, event: &Value) -> Option<Value> {
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let flag = |k: &str| event.get(k).and_then(Value::as_bool) == Some(true);
    let tool = || json!({ "tool_name": str_of("tool_name"), "tool_input": event.get("tool_input") });
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
/// `beforeSubmitPrompt` gets "continue", its before-tool events "allow"; everything else nothing.
pub fn reply(path: &str, body: &[u8]) -> Option<String> {
    if agent_of(path)? != "cursor" {
        return None;
    }
    let event: Value = serde_json::from_slice(body).ok()?;
    match event.get("hook_event_name")?.as_str()? {
        "beforeSubmitPrompt" => Some(json!({ "continue": true }).to_string()),
        "preToolUse" | "beforeShellExecution" | "beforeMCPExecution" => Some(json!({ "permission": "allow" }).to_string()),
        _ => None,
    }
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
    write_kimi_script(home)
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
        if not port or not token:
            raise RuntimeError("no Kolux")
        # Loopback only: the same hook listener the .cmd scripts post to with curl.
        req = urllib.request.Request(
            "http://127.0.0.1:%s/hermes" % port,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Kolux-Token": token, "X-Kolux-Pane": env["KOLUX_HOOK_IDENTITY"]},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=1.5).read()
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

/// `agent_hooks::apply` for these five.
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

/// `kolux agent hooks status` rows for the five vendors.
pub fn rows(home: &Path) -> Vec<Value> {
    let row = |agent: &str, name: &str, file: PathBuf, (state, reason): (&str, Option<String>)| json!({ "agent": agent, "name": name, "state": state, "file": file.display().to_string(), "reason": reason });
    vec![
        row("cursor", "Cursor", cursor_file(home), switch::inspect(&cursor_file(home), &CURSOR_EVENTS)),
        row("droid", "Droid", droid_file(home), switch::inspect(&droid_file(home), &DROID_EVENTS)),
        row("command-code", "Command Code", command_code_file(home), switch::inspect(&command_code_file(home), &COMMAND_CODE_EVENTS)),
        row("kimi", "Kimi", kimi_file(home), inspect_kimi(&kimi_file(home))),
        row("hermes", "Hermes", hermes_dir(home), inspect_hermes(&hermes_dir(home))),
    ]
}

#[cfg(test)]
#[path = "vendors_more_tests.rs"]
mod tests;
