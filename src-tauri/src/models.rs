//! SESS-029: the model lists that come from asking the installed program.
//!
//! Grok (`grok models`) and Cursor (`cursor-agent --list-models`) print the models they have right
//! now, one per line. Claude Code publishes no listing command, so its list stays built in
//! (DT-R67). The listing is read strictly: banner lines are allowed only before the first model
//! row and after the last; anything else in between, or no row at all, means the format is not
//! one Kolux knows and the whole listing is dropped, never used in part.

use crate::agents;
use crate::claude_key::{run_hidden, strip_ansi, Ended};
use portable_pty::CommandBuilder;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

/// How long a listing may take before Kolux gives up on it.
const LIST_LIMIT: Duration = Duration::from_secs(10);

/// One discovered model: its id, a readable name (built from the id when the program gives none).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Found {
    pub id: String,
    pub label: String,
}

/// The listing arguments for the agents that have one.
pub fn listing_args(agent: &str) -> Option<&'static [&'static str]> {
    match agent {
        "grok" => Some(&["models"]),
        "cursor" => Some(&["--list-models"]),
        _ => None,
    }
}

fn id_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-' | ':' | '/' | '[' | ']')
}

/// A model id: lower-case letters, digits and `._-:/[]`, starting with a letter or digit and not
/// ending in punctuation (so "loading..." is banner text, not a model).
fn is_id(s: &str) -> bool {
    let first = s.chars().next();
    let last = s.chars().last();
    first.is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && last.is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == ']')
        && s.chars().all(id_char)
}

enum Line {
    Row { id: String, label: Option<String>, disabled: bool },
    Other,
}

/// One line of a listing: an optional list bullet, the id, then (after ` - `, ` : `, a tab or two
/// or more spaces) an optional name; bracketed marks such as "(current)" are dropped, and a
/// "(disabled)" mark is kept as the agent's own word that the model is off.
fn line(raw: &str) -> Line {
    let mut s = raw.trim();
    for bullet in ["* ", "- ", "> ", "• "] {
        if let Some(rest) = s.strip_prefix(bullet) {
            s = rest.trim_start();
        }
    }
    let end = s.find(|c: char| c.is_whitespace()).unwrap_or(s.len());
    let (id, rest) = s.split_at(end);
    if !is_id(id) {
        return Line::Other;
    }
    let mut disabled = false;
    let mut rest = rest.to_string();
    while let (Some(open), true) = (rest.rfind('('), rest.trim_end().ends_with(')')) {
        let mark = rest[open + 1..rest.trim_end().len() - 1].trim().to_ascii_lowercase();
        disabled |= mark == "disabled" || mark == "unavailable";
        rest.truncate(open);
    }
    let gap = rest.trim_end();
    let label = if gap.trim().is_empty() {
        None
    } else if let Some(name) = [" - ", " – ", " : ", "\t"].iter().find_map(|sep| gap.strip_prefix(sep)).or_else(|| gap.starts_with("  ").then(|| gap.trim_start())) {
        Some(name.trim().to_string()).filter(|n| !n.is_empty())
    } else {
        return Line::Other;
    };
    Line::Row { id: id.to_string(), label, disabled }
}

/// A readable name built from a model id: "grok-code-fast-1" reads "Grok Code Fast 1".
pub fn label_of(id: &str) -> String {
    id.split(['-', '_', '/'])
        .filter(|w| !w.is_empty())
        .map(|w| match w {
            "gpt" | "ai" => w.to_ascii_uppercase(),
            _ => {
                let mut c = w.chars();
                c.next().map(|f| f.to_ascii_uppercase().to_string() + c.as_str()).unwrap_or_default()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The models in a listing, or `None` when its format is not one Kolux knows. Repeated entries,
/// banner text and mixed line endings are ignored; a model is dropped only when it is marked off.
pub fn parse_listing(text: &str) -> Option<Vec<Found>> {
    let clean = strip_ansi(text);
    let lines: Vec<Line> = clean.split(['\n', '\r']).filter(|l| !l.trim().is_empty()).map(line).collect();
    let first = lines.iter().position(|l| matches!(l, Line::Row { .. }))?;
    let last = lines.iter().rposition(|l| matches!(l, Line::Row { .. }))?;
    let mut found: Vec<Found> = Vec::new();
    for l in &lines[first..=last] {
        let Line::Row { id, label, disabled } = l else { return None };
        if *disabled || found.iter().any(|f| &f.id == id) {
            continue;
        }
        found.push(Found { id: id.clone(), label: label.clone().unwrap_or_else(|| label_of(id)) });
    }
    Some(found)
}

/// SESS-029: asks the installed agent for its models; `None` when it has no listing, is not
/// installed, fails, or prints a format Kolux does not know.
#[tauri::command]
pub async fn agent_models(id: String) -> Option<Vec<Found>> {
    let args = listing_args(&id)?;
    let path = agents::catalogue().into_iter().find(|a| a.id == id)?.path?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = CommandBuilder::new(&path);
        cmd.args(args);
        let (out, ended) = run_hidden(cmd, LIST_LIMIT, Arc::new(AtomicBool::new(false)), || {}, |_| false);
        match ended {
            Ended::Exited(Some(0)) | Ended::Exited(None) => parse_listing(&out),
            _ => None,
        }
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: Option<Vec<Found>>) -> Option<Vec<String>> {
        v.map(|f| f.into_iter().map(|m| m.id).collect())
    }

    #[test]
    fn a_listing_with_banners_repeats_and_mixed_line_endings_gives_each_model_once() {
        let text = "\x1b[1mAvailable models:\x1b[0m\r\n\r\n* grok-code-fast-1 - Grok Code Fast 1 (current)\ngrok-4\r\ngrok-5-preview  Grok 5 Preview\r\ngrok-4\n\nTip: pass --model to pick one.\n";
        let got = parse_listing(text).unwrap();
        assert_eq!(got.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["grok-code-fast-1", "grok-4", "grok-5-preview"]);
        assert_eq!(got[0].label, "Grok Code Fast 1");
        assert_eq!(got[1].label, "Grok 4", "no name given: built from the id");
        assert_eq!(got[2].label, "Grok 5 Preview");
    }

    #[test]
    fn only_a_model_the_agent_marks_disabled_is_dropped() {
        assert_eq!(ids(parse_listing("auto\ngpt-5 - GPT-5 (disabled)\nsonnet-4.5 (default)\n")), Some(vec!["auto".into(), "sonnet-4.5".into()]));
    }

    #[test]
    fn an_unexpected_format_yields_no_models_never_part_of_them() {
        assert_eq!(parse_listing("[{\"id\":\"grok-4\"}]"), None, "JSON is not the line format");
        assert_eq!(parse_listing("Error: not signed in\n"), None, "no model row at all");
        assert_eq!(parse_listing("grok-4\nGrok 5 is coming soon, stay tuned\ngrok-3\n"), None, "a stray line between rows");
        assert_eq!(parse_listing("grok-4 is the best model\n"), None, "a sentence is not a row");
        assert_eq!(parse_listing(""), None);
    }

    #[test]
    fn labels_are_built_from_ids_when_none_is_given() {
        assert_eq!(label_of("gpt-5-codex"), "GPT 5 Codex");
        assert_eq!(label_of("grok-code-fast-1"), "Grok Code Fast 1");
    }

    #[test]
    fn only_grok_and_cursor_have_a_listing() {
        assert_eq!(listing_args("grok"), Some(&["models"][..]));
        assert_eq!(listing_args("cursor"), Some(&["--list-models"][..]));
        assert_eq!(listing_args("claude"), None);
        assert_eq!(listing_args("codex"), None);
    }
}
