//! EDIT-041 (T-035-c): a question or a permission answered on the spot from the Inbox. It works
//! only while the agent's terminal is alive and its prompt can be read off the screen through the
//! ORCH-056 grid scan; the keys come from the menu's own shape (a highlighted option takes Enter, a
//! numbered one its number, a y/n tail y or n). Anything the scan is not sure of is refused and the
//! item keeps offering Answer in Code. An answer goes once per reading of the screen: the same
//! prompt on the same output is never typed into twice.

use crate::prompt_scan::{self, Prompt, FRAME_LINES};
use std::collections::HashMap;
use std::sync::Mutex;

/// One answer the menu on screen takes, and the keys that give it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Choice {
    pub label: String,
    pub keys: String,
}

/// Why an answer was not sent. The words reach the Inbox as the button's explanation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The pane has no running terminal.
    Gone,
    /// Nothing on the screen reads as an open menu.
    NoPrompt,
    /// The screen shows a different prompt from the one the user answered.
    Moved,
    /// The menu's keys cannot be read with confidence, or the choice is not one of its options.
    Unsure,
    /// This prompt was already answered from here on this same output.
    Repeat,
}

impl Refusal {
    pub fn message(self) -> &'static str {
        match self {
            Refusal::Gone => "This agent's terminal has exited; answer it in Code.",
            Refusal::NoPrompt => "No open prompt can be read on this pane's screen; answer it in Code.",
            Refusal::Moved => "The prompt on screen changed; read it again before answering.",
            Refusal::Unsure => "This menu's keys cannot be read with confidence; answer it in Code.",
            Refusal::Repeat => "This prompt was already answered; wait for the agent to go on.",
        }
    }
}

/// Glyphs a menu puts before its highlighted option.
const POINTERS: [char; 4] = ['❯', '›', '●', '◉'];

/// The number and the label of a numbered option ("1. Yes", "2) No"), when the line is one.
fn numbered(body: &str) -> Option<(char, &str)> {
    let mut chars = body.chars();
    let digit = chars.next().filter(char::is_ascii_digit)?;
    chars.next().filter(|c| *c == '.' || *c == ')')?;
    Some((digit, body[2..].trim()))
}

/// The option's label with the menu's own markers (pointer, bullet, number) taken off.
fn label_of(body: &str) -> String {
    let body = body.trim_start_matches(['○', '•', '*', '[', ']', '(', ')', ' ']).trim();
    numbered(body).map(|(_, l)| l.to_string()).unwrap_or_else(|| body.to_string())
}

/// The answers the menu on screen takes, top to bottom; empty when any of its options has no key
/// the scan is sure of (an accept/reject toggle, an unnumbered option that is not highlighted).
pub fn choices(prompt: &Prompt) -> Vec<Choice> {
    let mut out = Vec::new();
    for line in &prompt.options {
        let low = line.to_lowercase();
        if ["[y/n]", "(y/n)", "[y/n/a]", "[yes/no]"].iter().any(|t| low.contains(t)) {
            out.push(Choice { label: "Yes".into(), keys: "y".into() });
            out.push(Choice { label: "No".into(), keys: "n".into() });
            continue;
        }
        if low.contains("accept") && low.contains("reject") {
            return Vec::new();
        }
        let highlighted = line.trim_start().starts_with(POINTERS);
        let body = line.trim_start_matches(|c: char| POINTERS.contains(&c) || c == ' ');
        let label = label_of(body);
        let keys = if highlighted {
            "\r".to_string()
        } else if let Some((digit, _)) = numbered(body.trim_start_matches(['○', '•', '*', '[', ']', '(', ')', ' '])) {
            digit.to_string()
        } else {
            return Vec::new();
        };
        if label.is_empty() || out.iter().any(|c: &Choice| c.keys == keys) {
            return Vec::new();
        }
        out.push(Choice { label, keys });
    }
    out
}

/// The core decision: the keys for `choice` on the prompt the screen shows, or the refusal.
/// `expected` is the prompt text the user saw; a screen that moved on is not answered.
pub fn decide(prompt: Option<&Prompt>, alive: bool, expected: &str, choice: usize) -> Result<Choice, Refusal> {
    if !alive {
        return Err(Refusal::Gone);
    }
    let prompt = prompt.ok_or(Refusal::NoPrompt)?;
    if prompt.text != expected {
        return Err(Refusal::Moved);
    }
    choices(prompt).into_iter().nth(choice).ok_or(Refusal::Unsure)
}

/// Which reading of each terminal's screen has been answered: (output cursor, pending text, prompt).
#[derive(Default, Debug)]
pub struct Once {
    sent: HashMap<u32, (u64, String, String)>,
}

impl Once {
    /// True the first time this reading of `terminal` is answered; false for the same reading again.
    pub fn first(&mut self, terminal: u32, key: (u64, String, String)) -> bool {
        if self.sent.get(&terminal) == Some(&key) {
            return false;
        }
        self.sent.insert(terminal, key);
        true
    }

    /// The keys did not reach the terminal: the reading may be answered again.
    pub fn undo(&mut self, terminal: u32) {
        self.sent.remove(&terminal);
    }
}

static ONCE: std::sync::LazyLock<Mutex<Once>> = std::sync::LazyLock::new(|| Mutex::new(Once::default()));

fn with_once<T>(f: impl FnOnce(&mut Once) -> T) -> T {
    let mut o = ONCE.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut o)
}

/// What the Inbox can answer on the spot for a pane: the prompt and its choices.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readable {
    pub prompt: Prompt,
    pub choices: Vec<Choice>,
}

/// EDIT-041: the prompt open on pane `pane_key`'s live terminal with the answers it takes, or none
/// when the terminal is gone, the screen shows no menu or its keys are not read with confidence.
/// Registered by the coordinator (evidence/hooks-T-035-c-lib.rs.patch).
#[tauri::command]
pub fn prompt_read(terminals: tauri::State<'_, crate::terminal::Terminals>, pane_key: u32) -> Option<Readable> {
    let terminal = terminals.attached(pane_key)?;
    let read = terminals.read(terminal, None, Some(FRAME_LINES))?;
    let prompt = prompt_scan::live_prompt(terminal, &read)?;
    let choices = choices(&prompt);
    (!choices.is_empty()).then_some(Readable { prompt, choices })
}

/// EDIT-041: type the answer `choice` (an index into the choices read) for the prompt `text` into
/// pane `pane_key`'s terminal, once. Refused with a sentence when the terminal is gone, the screen
/// no longer shows that prompt, the keys are unsure or the same reading was already answered.
#[tauri::command]
pub fn prompt_answer(app: tauri::AppHandle, terminals: tauri::State<'_, crate::terminal::Terminals>, pane_key: u32, text: String, choice: usize) -> Result<Choice, String> {
    let gone = || Refusal::Gone.message().to_string();
    let terminal = terminals.attached(pane_key).ok_or_else(gone)?;
    let read = terminals.read(terminal, None, Some(FRAME_LINES)).ok_or_else(gone)?;
    let prompt = prompt_scan::live_prompt(terminal, &read);
    let picked = decide(prompt.as_ref(), true, &text, choice).map_err(|r| r.message().to_string())?;
    if !with_once(|o| o.first(terminal, (read.cursor, read.pending.clone(), text.clone()))) {
        return Err(Refusal::Repeat.message().into());
    }
    if let Err(e) = terminals.write(terminal, &picked.keys) {
        with_once(|o| o.undo(terminal));
        return Err(e);
    }
    // A pane whose hooks report nothing is marked working the way the scan would on the next read;
    // a hooked pane is left to its hooks.
    if crate::status::state_of(terminal).is_none() {
        crate::status::status_inband(app, pane_key, Some(terminal), r#"{"state":"working"}"#.into());
    }
    Ok(picked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prompt_scan::find_prompt;

    fn grid(s: &[&str]) -> Prompt {
        find_prompt(&s.iter().map(|l| l.to_string()).collect::<Vec<_>>()).expect("the grid holds a prompt")
    }

    fn keys(p: &Prompt) -> Vec<(String, String)> {
        choices(p).into_iter().map(|c| (c.label, c.keys)).collect()
    }

    #[test]
    fn edit041_claude_menu_highlighted_option_takes_enter_and_the_others_their_number() {
        let p = grid(&["Reading src/main.rs", "", "\x1b[1mDo you want to make this edit to main.rs?\x1b[0m", "│ ❯ 1. Yes", "│   2. Yes, and don't ask again this session", "│   3. No, and tell Claude what to do differently", "", "Esc to cancel"]);
        assert_eq!(p.options, vec!["❯ 1. Yes", "2. Yes, and don't ask again this session", "3. No, and tell Claude what to do differently"], "options read top to bottom, borders off");
        assert_eq!(keys(&p), vec![("Yes".to_string(), "\r".to_string()), ("Yes, and don't ask again this session".into(), "2".into()), ("No, and tell Claude what to do differently".into(), "3".into())]);
        // The trust screen is the same shape.
        let t = grid(&["Do you trust the files in this folder?", "", "  G:\\Temp\\hooks-v3\\repo", "", "❯ 1. Yes, proceed", "  2. No, exit", "", "Enter to confirm · Esc to exit"]);
        assert_eq!(keys(&t), vec![("Yes, proceed".to_string(), "\r".to_string()), ("No, exit".into(), "2".into())]);
        // A question with the pointer on a later option: Enter picks it, numbers pick the rest.
        let q = grid(&["Keep the current branch name?", "  1. Yes, keep it", "❯ 2. No, rename it", "  3. Skip this question", "  ↑/↓ to navigate"]);
        assert_eq!(keys(&q), vec![("Yes, keep it".to_string(), "1".to_string()), ("No, rename it".into(), "\r".into()), ("Skip this question".into(), "3".into())]);
    }

    #[test]
    fn edit041_a_yes_no_tail_takes_y_or_n() {
        let c = grid(&["$ cargo test --lib", "Allow command? [y/n]"]);
        assert_eq!(keys(&c), vec![("Yes".to_string(), "y".to_string()), ("No".into(), "n".into())]);
        let d = grid(&["ok, running", "Apply this change? [y/N]"]);
        assert_eq!(keys(&d).len(), 2);
    }

    #[test]
    fn edit041_menus_whose_keys_are_not_sure_offer_nothing() {
        // Cursor's accept/reject toggle: Tab switches, the keys are not read.
        let u = grid(&["Run this command?", "  pnpm exec vitest run", "", "● Accept    ○ Reject", "Tab to switch"]);
        assert_eq!(choices(&u), Vec::<Choice>::new());
        // An unnumbered option that is not highlighted has no key, so the whole menu is refused.
        let m = grid(&["Do you want to proceed?", "❯ Yes", "  No"]);
        assert_eq!(choices(&m), Vec::<Choice>::new());
        // Two options with the same number are not a menu the scan trusts.
        let twice = grid(&["Do you want to proceed?", "  1. Yes", "  1. No"]);
        assert_eq!(choices(&twice), Vec::<Choice>::new());
    }

    #[test]
    fn edit041_the_answer_is_sent_only_for_a_live_pane_showing_the_same_prompt_and_a_known_choice() {
        let p = grid(&["Do you want to proceed?", "❯ 1. Yes", "  2. No"]);
        assert_eq!(decide(Some(&p), false, "Do you want to proceed?", 0), Err(Refusal::Gone), "a dead pane is never typed into");
        assert_eq!(decide(None, true, "Do you want to proceed?", 0), Err(Refusal::NoPrompt), "no readable menu");
        assert_eq!(decide(Some(&p), true, "Allow command? [y/n]", 0), Err(Refusal::Moved), "the screen shows another prompt");
        assert_eq!(decide(Some(&p), true, "Do you want to proceed?", 2), Err(Refusal::Unsure), "not one of its options");
        let unsure = grid(&["Run this command?", "● Accept    ○ Reject"]);
        assert_eq!(decide(Some(&unsure), true, "Run this command?", 0), Err(Refusal::Unsure));
        assert_eq!(decide(Some(&p), true, "Do you want to proceed?", 1), Ok(Choice { label: "No".into(), keys: "2".into() }));
        assert_eq!(decide(Some(&p), true, "Do you want to proceed?", 0).map(|c| c.keys), Ok("\r".to_string()));
        // Every refusal has a sentence for the Inbox.
        for r in [Refusal::Gone, Refusal::NoPrompt, Refusal::Moved, Refusal::Unsure, Refusal::Repeat] {
            assert!(r.message().ends_with('.'), "{r:?}");
        }
    }

    #[test]
    fn edit041_one_reading_of_the_screen_is_answered_once_unless_the_keys_did_not_reach_it() {
        let mut once = Once::default();
        let key = || (12_u64, String::new(), "Do you want to proceed?".to_string());
        assert!(once.first(7, key()));
        assert!(!once.first(7, key()), "the same prompt on the same output is not typed into twice");
        // New output, a new prompt: answered again.
        assert!(once.first(7, (15, String::new(), "Allow command? [y/n]".into())));
        // Another terminal keeps its own memory.
        assert!(once.first(8, key()));
        // A write that failed frees the reading for another try.
        once.undo(8);
        assert!(once.first(8, key()));
    }

    #[test]
    fn edit041_a_prompt_carries_its_options_in_screen_order_through_the_scanner() {
        use crate::prompt_scan::Scanner;
        use crate::terminal::{Line, Read};
        let lines = ["Do you want to proceed?", "❯ 1. Yes", "  2. No"];
        let read = Read { lines: lines.iter().enumerate().map(|(i, t)| Line { cursor: 1 + i as u64, text: t.to_string() }).collect(), cursor: 3, oldest: 1, ..Read::default() };
        let mut s = Scanner::default();
        let p = s.scan(3, &read).expect("a menu");
        assert_eq!(p.options, vec!["❯ 1. Yes", "2. No"]);
    }
}
