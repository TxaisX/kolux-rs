//! SKILL-035: pages Claude publishes through its Artifact tool are kept in the Artifacts library.
//! Claude Code writes each session's transcript as JSON lines under its config folder's
//! `projects` folder. A watcher reads the lines added to them and stores each page whose publish
//! succeeded, with the session's folder and id. Only the Artifact tool's own results count, so
//! prose and other tools' output that looks like a publish are never picked up.

use crate::artifacts::{self, Library, Origin};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Sent to the window when the library changed behind its back.
pub const EVENT: &str = "artifacts-changed";
const POLL: Duration = Duration::from_secs(2);
/// A publish older than the watcher by more than this is history replayed into a resumed or
/// copied session, not a new publish.
const REPLAY_SLACK_MS: u64 = 60_000;

#[derive(Debug, PartialEq)]
pub struct Publish {
    pub url: String,
    pub path: String,
    pub cwd: Option<String>,
    pub session: Option<String>,
    pub at: Option<u64>,
}

fn text<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn is_artifact_url(url: &str) -> bool {
    url.starts_with("https://claude.ai/artifact/") || url.starts_with("https://claude.ai/code/artifact/")
}

fn is_html(path: &str) -> bool {
    let low = path.to_ascii_lowercase();
    low.ends_with(".html") || low.ends_with(".htm")
}

/// The publishes in a run of transcript lines. `calls` carries the ids of Artifact publish calls
/// seen so far in the same transcript, since a call and its result are separate lines.
pub fn scan(lines: &str, calls: &mut HashSet<String>) -> Vec<Publish> {
    let mut out = Vec::new();
    for line in lines.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let Some(parts) = v.pointer("/message/content").and_then(|c| c.as_array()) else { continue };
        for p in parts {
            match text(p, "type") {
                Some("tool_use") if text(p, "name") == Some("Artifact") => {
                    let input = &p["input"];
                    let publish = text(input, "file_path").is_some_and(is_html)
                        && input.get("asset").and_then(|a| a.as_bool()) != Some(true)
                        && text(input, "action").is_none_or(|a| a == "publish");
                    if let (true, Some(id)) = (publish, text(p, "id")) {
                        calls.insert(id.to_string());
                    }
                }
                Some("tool_result") => {
                    let Some(id) = text(p, "tool_use_id") else { continue };
                    if !calls.remove(id) || p.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
                        continue;
                    }
                    let r = &v["toolUseResult"];
                    let (Some(url), Some(path)) = (text(r, "url"), text(r, "path")) else { continue };
                    if is_artifact_url(url) && is_html(path) {
                        out.push(Publish { url: url.into(), path: path.into(), cwd: text(&v, "cwd").map(Into::into), session: text(&v, "sessionId").map(Into::into), at: text(&v, "timestamp").and_then(parse_time) });
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// Milliseconds since 1970 from a UTC time such as 2026-09-24T09:56:01.421Z.
/// ponytail: offsets other than Z are read as UTC; Claude Code writes Z.
pub fn parse_time(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d, hh, mm, ss) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    let frac: String = if b.get(19) == Some(&b'.') { s[20..].chars().take_while(|c| c.is_ascii_digit()).take(3).collect() } else { String::new() };
    let ms: i64 = format!("{frac:0<3}").parse().ok()?;
    // Days from the civil date (the well-known era / day-of-era method).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    u64::try_from((((days * 24 + hh) * 60 + mm) * 60 + ss) * 1000 + ms).ok()
}

/// Claude Code's config folder: CLAUDE_CONFIG_DIR when set, else .claude in the home folder.
pub fn claude_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(d.into());
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|h| PathBuf::from(h).join(".claude"))
}

/// Every session transcript: projects/<folder>/<session>.jsonl and the subagents' beside them.
fn transcripts(root: &Path) -> Vec<PathBuf> {
    let jsonl = |p: &Path| p.extension().is_some_and(|e| e == "jsonl");
    let mut out = Vec::new();
    for project in fs::read_dir(root).into_iter().flatten().flatten() {
        for f in fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let p = f.path();
            if jsonl(&p) {
                out.push(p);
            } else if f.file_type().is_ok_and(|t| t.is_dir()) {
                out.extend(fs::read_dir(p.join("subagents")).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| jsonl(p)));
            }
        }
    }
    out
}

fn read_span(path: &Path, from: u64, to: u64) -> Option<Vec<u8>> {
    let mut f = fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = Vec::new();
    f.take(to - from).read_to_end(&mut buf).ok()?;
    Some(buf)
}

#[derive(Default)]
struct Seen {
    offset: u64,
    calls: HashSet<String>,
}

/// Watches the transcripts from now on: files already there are read from their current end, so
/// publishes made before Kolux started are not replayed.
/// ponytail: polls every 2 s, and a call made before start whose result lands after it is missed.
pub fn start(app: tauri::AppHandle) {
    let Some(root) = claude_dir().map(|d| d.join("projects")) else { return };
    std::thread::spawn(move || {
        let started = artifacts::now_ms();
        let mut seen: HashMap<PathBuf, Seen> = HashMap::new();
        let mut first = true;
        loop {
            for f in transcripts(&root) {
                let Ok(len) = fs::metadata(&f).map(|m| m.len()) else { continue };
                let s = seen.entry(f.clone()).or_insert_with(|| Seen { offset: if first { len } else { 0 }, ..Default::default() });
                if len < s.offset {
                    *s = Seen::default(); // rewritten from the start
                }
                if len == s.offset {
                    continue;
                }
                let Some(bytes) = read_span(&f, s.offset, len) else { continue };
                let Some(cut) = bytes.iter().rposition(|&c| c == b'\n') else { continue }; // a line still being written
                s.offset += cut as u64 + 1;
                for p in scan(&String::from_utf8_lossy(&bytes[..cut]), &mut s.calls) {
                    keep(&app, p, started);
                }
            }
            first = false;
            std::thread::sleep(POLL);
        }
    });
}

fn keep(app: &tauri::AppHandle, p: Publish, started: u64) {
    let at = p.at.unwrap_or_else(artifacts::now_ms);
    if at + REPLAY_SLACK_MS < started {
        return;
    }
    let project = p.cwd.as_deref().and_then(|c| Path::new(c).file_name()).map(|n| n.to_string_lossy().into_owned());
    let from = Origin { origin: p.url, source: "claude", project, session: p.session, at };
    match app.state::<Library>().add(Path::new(&p.path), from, &artifacts::fetch_script) {
        Ok(_) => {
            let _ = app.emit(EVENT, ());
        }
        Err(e) => eprintln!("artifacts: could not keep {}: {e}", p.path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(v: serde_json::Value) -> String {
        v.to_string() + "\n"
    }

    fn call(id: &str, name: &str, input: serde_json::Value) -> String {
        line(serde_json::json!({"type": "assistant", "sessionId": "s-1", "cwd": "G:\\Dev\\repo", "message": {"content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}}))
    }

    fn result(id: &str, url: &str, path: &str, error: bool) -> String {
        line(serde_json::json!({"type": "user", "sessionId": "s-1", "cwd": "G:\\Dev\\repo", "timestamp": "2026-09-24T09:56:01.421Z",
            "message": {"content": [{"type": "tool_result", "tool_use_id": id, "is_error": error, "content": format!("Published {path} at {url} (Version 1)")}]},
            "toolUseResult": {"url": url, "path": path, "title": "T"}}))
    }

    #[test]
    fn only_successful_artifact_publishes_are_picked_up() {
        let url = "https://claude.ai/artifact/RtHRJW2CNxVSVEfdBezseR";
        let page = "G:\\Temp\\page.html";
        let mut t = String::new();
        t += &call("a", "Artifact", serde_json::json!({"file_path": page}));
        t += &result("a", url, page, false);
        // Another tool's result that looks the same, a failed publish, an asset upload, a read,
        // a Markdown page, and prose that mentions a publish: none count.
        t += &call("b", "Bash", serde_json::json!({"command": "echo"}));
        t += &result("b", url, page, false);
        t += &call("c", "Artifact", serde_json::json!({"file_path": page}));
        t += &result("c", url, page, true);
        t += &call("d", "Artifact", serde_json::json!({"file_path": "G:\\Temp\\a.png", "asset": true, "url": url}));
        t += &result("d", url, "G:\\Temp\\a.png", false);
        t += &call("e", "Artifact", serde_json::json!({"action": "read", "url": url}));
        t += &result("e", url, page, false);
        t += &call("f", "Artifact", serde_json::json!({"file_path": "G:\\Temp\\notes.md"}));
        t += &result("f", url, "G:\\Temp\\notes.md", false);
        t += &line(serde_json::json!({"type": "assistant", "message": {"content": [{"type": "text", "text": format!("Published {page} at {url}")}]}}));
        t += "not json\n";
        let mut calls = HashSet::new();
        let got = scan(&t, &mut calls);
        assert_eq!(got, [Publish { url: url.into(), path: page.into(), cwd: Some("G:\\Dev\\repo".into()), session: Some("s-1".into()), at: Some(1_790_243_761_421) }]);
        // A call in one read and its result in the next still pair up.
        let mut calls = HashSet::new();
        assert!(scan(&call("g", "Artifact", serde_json::json!({"file_path": page, "action": "publish"})), &mut calls).is_empty());
        assert_eq!(scan(&result("g", url, page, false), &mut calls).len(), 1);
    }

    #[test]
    fn times_parse_as_utc_milliseconds() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("2026-09-24T09:56:01.421Z"), Some(1_790_243_761_421));
        assert_eq!(parse_time("2000-02-29T12:00:00.5Z"), Some(951_825_600_500));
        assert_eq!(parse_time("yesterday"), None);
    }
}
