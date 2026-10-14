//! T-120-b (STAT-009 / STAT-010 / STAT-011): status hooks for Gemini CLI, Antigravity and Amp,
//! from each vendor's public hook or plugin docs (PROVENANCE.md, T-120-b). Each vendor's event is
//! turned into the one shape the status rules read (`normalize`), then follows Codex's rules for an
//! agent whose hook semantics are unverified (`status::Agent::Vendor`).
//!
//! - Gemini CLI: `~/.gemini/settings.json`, `hooks` groups like Claude Code's, timeouts in ms.
//! - Antigravity: `~/.gemini/config/hooks.json`, one named bundle of event groups; the payload has
//!   no event name, so each command passes it as its argument and the script puts it in the route.
//! - Amp: a plugin file in `~/.config/amp/plugins/` that posts each event itself.

use super::super::{codex_change, home_dir, install_groups, script, write_json, write_script, Change};
use super::{fenced, names_mine, read_opt, remove_groups, saved::SPOOL_FILE, scratch_only, switch, Plan};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const GEMINI_SCRIPT: &str = "gemini.cmd";
pub const ANTIGRAVITY_SCRIPT: &str = "antigravity.cmd";
/// The plugin file and the Antigravity bundle both carry this name.
pub const NAME: &str = "kolux-rs";
pub const GEMINI_EVENTS: [&str; 4] = ["BeforeAgent", "AfterAgent", "BeforeTool", "AfterTool"];
const GEMINI_TOOL_EVENTS: [&str; 2] = ["BeforeTool", "AfterTool"];
/// Gemini CLI takes hook timeouts in milliseconds.
const GEMINI_TIMEOUT: u64 = 10_000;
pub const ANTIGRAVITY_EVENTS: [&str; 5] = ["PreInvocation", "PreToolUse", "PostToolUse", "PostInvocation", "Stop"];
pub const AMP_EVENTS: [&str; 5] = ["session.start", "agent.start", "tool.call", "tool.result", "agent.end"];
/// Antigravity's tools that put a question to the user: the pane waits on them (STAT-010).
const ASK_TOOLS: [&str; 2] = ["ask_question", "ask_permission"];
const ANTIGRAVITY_ROUTE: &str = "/antigravity/";

/// A path the hook listener takes for one of these vendors.
pub fn is_route(path: &str) -> bool {
    path == "/gemini" || path == "/amp" || path.starts_with(ANTIGRAVITY_ROUTE)
}

/// The agent id a route reports for.
pub fn agent_of(path: &str) -> Option<&'static str> {
    let path = format!("/{}", path.trim_start_matches('/'));
    match path.as_str() {
        "/gemini" => Some("gemini"),
        "/amp" => Some("amp"),
        p if p.starts_with(ANTIGRAVITY_ROUTE) => Some("antigravity"),
        _ => None,
    }
}

/// The vendor's event as the status rules read it (`hook_event_name` and Claude Code's field
/// names), or `None` when it changes nothing.
pub fn normalize(path: &str, event: &Value) -> Option<Value> {
    let path = format!("/{}", path.trim_start_matches('/'));
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    let (name, session, mut out) = if path == "/gemini" {
        let tool = || json!({ "tool_name": str_of("tool_name"), "tool_input": event.get("tool_input").or_else(|| event.get("arguments")) });
        let (name, out) = match str_of("hook_event_name")? {
            "BeforeAgent" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
            "AfterAgent" => ("Stop", json!({ "last_assistant_message": str_of("prompt_response") })),
            "BeforeTool" | "PreToolUse" => ("PreToolUse", tool()),
            "AfterTool" | "PostToolUse" => ("PostToolUse", tool()),
            _ => return None,
        };
        (name, str_of("session_id"), out)
    } else if let Some(name) = path.strip_prefix(ANTIGRAVITY_ROUTE) {
        let call = event.get("toolCall");
        let tool = || json!({ "tool_name": call.and_then(|c| c.get("name")), "tool_input": call.and_then(|c| c.get("args")) });
        let (name, out) = match name {
            "PreInvocation" => ("UserPromptSubmit", json!({ "prompt": str_of("prompt") })),
            "PreToolUse" => ("PreToolUse", tool()),
            "PostToolUse" | "PostInvocation" => ("PostToolUse", tool()),
            // STAT-010: only a Stop with the agent fully idle ends the turn.
            "Stop" if event.get("fullyIdle").and_then(Value::as_bool) == Some(true) => ("Stop", json!({})),
            _ => return None,
        };
        (name, str_of("conversationId"), out)
    } else if path == "/amp" {
        let (name, out) = match str_of("event")? {
            "agent.start" => ("UserPromptSubmit", json!({ "prompt": str_of("message") })),
            "tool.call" => ("PreToolUse", json!({ "tool_name": str_of("tool"), "tool_input": event.get("input") })),
            "tool.result" => ("PostToolUse", json!({ "tool_name": str_of("tool") })),
            // STAT-011: an end that is not `done` (cancelled, an error) is an interruption.
            "agent.end" => ("Stop", json!({ "kolux_interrupted": str_of("status") != Some("done") })),
            _ => return None,
        };
        (name, str_of("thread"), out)
    } else {
        return None;
    };
    let o = out.as_object_mut()?;
    o.retain(|_, v| !v.is_null());
    o.insert("hook_event_name".into(), name.into());
    if let Some(s) = session {
        o.insert("session_id".into(), s.into());
    }
    Some(out)
}

/// A normalized event's change: Codex's mapping, with Antigravity's ask tools waiting on the user.
pub fn change(event: &Value) -> Option<Change> {
    let mut change = codex_change(event)?;
    if event.get("hook_event_name").and_then(Value::as_str) == Some("PreToolUse") && change.tool.as_deref().is_some_and(|t| ASK_TOOLS.contains(&t)) {
        change.state = "waiting";
    }
    Some(change)
}

pub fn write_gemini_script(home: &Path) -> Result<String, String> {
    write_script(home, GEMINI_SCRIPT, &script("gemini", "gemini", true))
}

pub fn write_antigravity_script(home: &Path) -> Result<String, String> {
    write_script(home, ANTIGRAVITY_SCRIPT, &script("antigravity", "antigravity/%~1", true))
}

pub fn gemini_file(home: &Path) -> PathBuf {
    home.join(".gemini").join("settings.json")
}

pub fn antigravity_file(home: &Path) -> PathBuf {
    home.join(".gemini").join("config").join("hooks.json")
}

pub fn amp_file(home: &Path) -> PathBuf {
    home.join(".config").join("amp").join("plugins").join(format!("{NAME}.js"))
}

/// Amp's plugin: it reports each event to the Kolux that opened the pane and answers nothing.
pub fn amp_plugin() -> String {
    r#"// Kolux RS status plugin for Amp. Written by Kolux RS; edits are overwritten.
// It tells Kolux RS what this pane's agent is doing and never answers for Amp.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const EVENTS = {EVENTS}
const text = (v) => (typeof v === 'string' ? v : undefined)

async function send(name, event) {
  const env = process.env
  if (!env.KOLUX_PANE_KEY || !env.KOLUX_HOOK_IDENTITY) return
  let port = env.KOLUX_AGENT_HOOK_PORT
  let token = env.KOLUX_AGENT_HOOK_TOKEN
  try {
    const [p, t] = readFileSync(env.KOLUX_HOOK_ENDPOINT, 'utf8').trim().split(/\s+/)
    if (p && t) { port = p; token = t }
  } catch {}
  const body = JSON.stringify({ event: name, thread: text(event?.thread?.id), message: text(event?.message), tool: text(event?.tool), input: event?.input, status: text(event?.status) })
  try {
    if (!port || !token) throw new Error('no Kolux')
    // Loopback only: the same hook listener the .cmd scripts post to with curl.
    const local = `http://127.0.0.1:${port}/amp`
    await fetch(local, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kolux-Token': token, 'X-Kolux-Pane': env.KOLUX_HOOK_IDENTITY }, body, signal: AbortSignal.timeout(1500) })
  } catch {
    // Kolux is closed or not answering: the event waits, one whole line, for the next start.
    try {
      if (env.KOLUX_HOOK_ENDPOINT) appendFileSync(join(dirname(env.KOLUX_HOOK_ENDPOINT), '{SPOOL}'), `amp|${env.KOLUX_HOOK_IDENTITY}||${body}` + String.fromCharCode(10))
    } catch {}
  }
}

export default function (amp) {
  for (const name of EVENTS) amp.on(name, async (event) => { await send(name, event) })
}
"#
    .replace("{SPOOL}", SPOOL_FILE)
    .replace("{EVENTS}", &json!(AMP_EVENTS).to_string())
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

/// Gemini CLI: one Kolux group under each event; the user's own hooks stay.
pub fn install_gemini(home: &Path, file: &Path) -> Result<bool, String> {
    let command = format!("\"{}\"", write_gemini_script(home)?);
    let text = read_opt(file)?;
    let mut v = parse(file, text.as_deref())?;
    let changed = install_groups(&mut v, &GEMINI_EVENTS, &GEMINI_TOOL_EVENTS, &command, GEMINI_TIMEOUT);
    if changed {
        write_json(file, &v, text.as_deref())?;
    }
    Ok(changed)
}

/// Takes Kolux's entries out of a `{"hooks": {...}}` file (Gemini CLI's settings).
pub fn remove_hooks(file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut v = parse(file, Some(&text))?;
    let changed = remove_groups(&mut v, false);
    if changed {
        write_json(file, &v, Some(&text))?;
    }
    Ok(changed)
}

/// A bundle every command of which is Kolux's.
fn bundle_mine(bundle: &Value) -> bool {
    let hooks = || bundle.as_object().into_iter().flat_map(|o| o.values()).filter_map(Value::as_array).flatten().filter_map(|g| g.get("hooks")).filter_map(Value::as_array).flatten();
    bundle.is_object() && hooks().next().is_some() && hooks().all(names_mine)
}

/// Antigravity: Kolux's own bundle, one command per event naming it.
pub fn install_antigravity(home: &Path, file: &Path) -> Result<bool, String> {
    let path = write_antigravity_script(home)?;
    let text = read_opt(file)?;
    let mut v = parse(file, text.as_deref())?;
    let Some(root) = v.as_object_mut() else { return Err(format!("{} is not an object; left alone", file.display())) };
    if root.get(NAME).is_some_and(|b| !bundle_mine(b)) {
        return Err(format!("{} has a {NAME} bundle that is not Kolux's; left alone", file.display()));
    }
    let bundle: Map<String, Value> = ANTIGRAVITY_EVENTS.iter().map(|e| (e.to_string(), json!([{ "hooks": [{ "type": "command", "command": format!("\"{path}\" {e}"), "timeout": 10 }] }]))).collect();
    let bundle = Value::Object(bundle);
    if root.get(NAME) == Some(&bundle) {
        return Ok(false);
    }
    root.insert(NAME.into(), bundle);
    write_json(file, &v, text.as_deref())?;
    Ok(true)
}

pub fn remove_antigravity(file: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut v = parse(file, Some(&text))?;
    let Some(root) = v.as_object_mut() else { return Ok(false) };
    if !root.get(NAME).is_some_and(bundle_mine) {
        return Ok(false);
    }
    root.remove(NAME);
    write_json(file, &v, Some(&text))?;
    Ok(true)
}

/// Amp: Kolux's plugin file; a file of the user's under that name is never replaced.
pub fn install_amp(file: &Path) -> Result<bool, String> {
    let plugin = amp_plugin();
    let old = read_opt(file)?;
    if old.as_deref() == Some(plugin.as_str()) {
        return Ok(false);
    }
    if old.is_some_and(|o| !o.contains("Written by Kolux RS")) {
        return Err(format!("{} is not Kolux's own plugin; left alone", file.display()));
    }
    fs::create_dir_all(file.parent().ok_or("no plugin folder")?).map_err(|e| e.to_string())?;
    fs::write(file, plugin).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(true)
}

pub fn remove_amp(file: &Path) -> Result<bool, String> {
    match read_opt(file)? {
        Some(t) if t.contains("Written by Kolux RS") => fs::remove_file(file).map(|_| true).map_err(|e| format!("{}: {e}", file.display())),
        _ => Ok(false),
    }
}

/// `agent_hooks::apply` for these three.
pub fn apply(home: &Path, profile: &Path, id: &str, plan: Plan) -> Result<&'static str, String> {
    let done = |installed: bool| if installed { "installed" } else { "removed" };
    let install = plan == Plan::Install;
    match id {
        "gemini" => {
            let file = target(profile, gemini_file(home))?;
            if install { install_gemini(home, &file) } else { remove_hooks(&file) }
        }
        "antigravity" => {
            let file = target(profile, antigravity_file(home))?;
            if install { install_antigravity(home, &file) } else { remove_antigravity(&file) }
        }
        "amp" => {
            let file = target(profile, amp_file(home))?;
            if install { install_amp(&file) } else { remove_amp(&file) }
        }
        _ => return Ok("left as it was"),
    }
    .map(|_| done(install))
}

fn inspect_antigravity(file: &Path) -> (&'static str, Option<String>) {
    let v: Value = match read_opt(file).map(|t| t.map(|t| serde_json::from_str::<Value>(&t))) {
        Ok(None) => return ("not installed", None),
        Ok(Some(Ok(v))) => v,
        Ok(Some(Err(e))) => return ("error", Some(format!("{} is not JSON ({e}); left alone", file.display()))),
        Err(e) => return ("error", Some(e)),
    };
    let Some(bundle) = v.get(NAME) else { return ("not installed", None) };
    if !bundle_mine(bundle) {
        return ("error", Some(format!("a {NAME} bundle that is not Kolux's")));
    }
    let missing: Vec<&str> = ANTIGRAVITY_EVENTS.iter().copied().filter(|e| bundle.get(e).is_none()).collect();
    if missing.is_empty() {
        ("installed", None)
    } else {
        ("partial", Some(format!("no Kolux entry for {}", missing.join(", "))))
    }
}

fn inspect_amp(file: &Path) -> (&'static str, Option<String>) {
    match read_opt(file) {
        Ok(None) => ("not installed", None),
        Ok(Some(t)) if t == amp_plugin() => ("installed", None),
        Ok(Some(t)) if t.contains("Written by Kolux RS") => ("partial", Some("an older Kolux plugin".into())),
        Ok(Some(_)) => ("error", Some(format!("{} is not Kolux's own plugin; left alone", file.display()))),
        Err(e) => ("error", Some(e)),
    }
}

/// `kolux agent hooks status` rows for the three vendors.
pub fn rows(home: &Path) -> Vec<Value> {
    let row = |agent: &str, name: &str, file: PathBuf, (state, reason): (&str, Option<String>)| json!({ "agent": agent, "name": name, "state": state, "file": file.display().to_string(), "reason": reason });
    vec![
        row("gemini", "Gemini CLI", gemini_file(home), switch::inspect(&gemini_file(home), &GEMINI_EVENTS)),
        row("antigravity", "Antigravity", antigravity_file(home), inspect_antigravity(&antigravity_file(home))),
        row("amp", "Amp", amp_file(home), inspect_amp(&amp_file(home))),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::{Agent, Session};

    fn state(s: &mut Session, path: &str, j: Value) -> Option<&'static str> {
        let e = normalize(path, &j)?;
        s.apply(Agent::Vendor, &e).map(|(c, _)| c.state)
    }

    #[test]
    fn gemini_events_drive_the_dot() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"BeforeAgent","prompt":"fix it","session_id":"g1"})), Some("working"));
        assert_eq!(normalize("/gemini", &json!({"hook_event_name":"BeforeAgent","prompt":"fix it","session_id":"g1"})).unwrap(), json!({"hook_event_name":"UserPromptSubmit","prompt":"fix it","session_id":"g1"}));
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"BeforeTool","tool_name":"read_file","tool_input":{"file_path":"a.rs"}})), Some("working"));
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"AfterTool","tool_name":"read_file"})), Some("working"));
        assert_eq!(state(&mut s, "/gemini", json!({"hook_event_name":"AfterAgent","prompt_response":"All fixed."})), Some("done"));
        assert_eq!(s.reply.as_deref(), Some("All fixed."));
        assert_eq!(normalize("/gemini", &json!({"hook_event_name":"Notification"})), None);
    }

    #[test]
    fn antigravity_events_drive_the_dot() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, "antigravity/PreInvocation", json!({"conversationId":"c1"})), Some("working"));
        let ask = normalize("/antigravity/PreToolUse", &json!({"toolCall":{"name":"ask_question","args":{}}})).unwrap();
        assert_eq!(ask["tool_name"], "ask_question");
        assert_eq!(s.apply(Agent::Vendor, &ask).map(|(c, _)| c.state), Some("waiting"));
        assert_eq!(state(&mut s, "/antigravity/PostToolUse", json!({"toolCall":{"name":"ask_question"}})), Some("working"));
        assert_eq!(normalize("/antigravity/Stop", &json!({"fullyIdle":false,"terminationReason":"tool"})), None, "a Stop that is not fully idle leaves the turn running");
        assert_eq!(state(&mut s, "/antigravity/Stop", json!({"fullyIdle":true})), Some("done"));
        assert_eq!(normalize("/antigravity/Mystery", &json!({})), None);
    }

    #[test]
    fn amp_events_drive_the_dot_and_a_cancel_is_an_interruption() {
        let mut s = Session::default();
        assert_eq!(normalize("/amp", &json!({"event":"session.start","thread":"t1"})), None);
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.start","thread":"t1","message":"go"})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"tool.call","tool":"Bash","input":{"cmd":"ls"}})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.end","status":"done"})), Some("done"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.start","message":"again"})), Some("working"));
        assert_eq!(state(&mut s, "/amp", json!({"event":"agent.end","status":"cancelled"})), Some("interrupted"));
    }

    #[test]
    fn routes_and_agents() {
        assert!(is_route("/gemini") && is_route("/amp") && is_route("/antigravity/Stop") && !is_route("/claude"));
        assert_eq!((agent_of("gemini"), agent_of("antigravity/Stop"), agent_of("/amp"), agent_of("codex")), (Some("gemini"), Some("antigravity"), Some("amp"), None));
    }

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-vendors-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn gemini_install_keeps_the_users_hooks_and_removal_takes_only_kolux() {
        let home = scratch("gemini");
        let file = gemini_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, r#"{"theme":"dark","hooks":{"BeforeTool":[{"matcher":"write_file","hooks":[{"type":"command","command":"my-check"}]}]}}"#).unwrap();
        assert!(install_gemini(&home, &file).unwrap());
        assert!(!install_gemini(&home, &file).unwrap(), "a second install changes nothing");
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["hooks"]["BeforeTool"].as_array().unwrap().len(), 2);
        assert_eq!(v["hooks"]["AfterAgent"][0]["hooks"][0]["timeout"], 10_000);
        assert_eq!(v["hooks"]["BeforeTool"][1]["matcher"], "*");
        assert_eq!(switch::inspect(&file, &GEMINI_EVENTS).0, "installed");
        assert!(remove_hooks(&file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v["hooks"]["BeforeTool"][0]["hooks"][0]["command"], "my-check");
        assert!(v["hooks"].get("AfterAgent").is_none());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn antigravity_bundle_is_ours_alone() {
        let home = scratch("agy");
        let file = antigravity_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, r#"{"mine":{"Stop":[{"hooks":[{"type":"command","command":"notify"}]}]}}"#).unwrap();
        assert!(install_antigravity(&home, &file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert!(v[NAME]["PreToolUse"][0]["hooks"][0]["command"].as_str().unwrap().ends_with("antigravity.cmd\" PreToolUse"));
        assert_eq!(inspect_antigravity(&file).0, "installed");
        assert!(remove_antigravity(&file).unwrap());
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v, json!({"mine":{"Stop":[{"hooks":[{"type":"command","command":"notify"}]}]}}));
        fs::write(&file, r#"{"kolux-rs":{"Stop":[{"hooks":[{"type":"command","command":"someone else"}]}]}}"#).unwrap();
        assert!(install_antigravity(&home, &file).is_err(), "a same-named bundle of the user's is left alone");
        assert!(!remove_antigravity(&file).unwrap());
        assert_eq!(inspect_antigravity(&file).0, "error");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn amp_plugin_is_never_put_over_the_users_file() {
        let home = scratch("amp");
        let file = amp_file(&home);
        assert_eq!(inspect_amp(&file).0, "not installed");
        assert!(install_amp(&file).unwrap());
        assert_eq!(inspect_amp(&file).0, "installed");
        let text = fs::read_to_string(&file).unwrap();
        assert!(AMP_EVENTS.iter().all(|e| text.contains(&format!("\"{e}\""))) && text.contains(SPOOL_FILE) && text.contains("/amp"));
        assert!(remove_amp(&file).unwrap() && !file.exists());
        fs::write(&file, "export default () => {}").unwrap();
        assert!(install_amp(&file).is_err());
        assert!(!remove_amp(&file).unwrap() && file.exists(), "the user's plugin stays");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_antigravity_script_routes_by_its_argument() {
        let s = script("antigravity", "antigravity/%~1", true);
        assert!(s.contains("/antigravity/%~1\"") && s.contains("antigravity/%~1|"));
    }
}
