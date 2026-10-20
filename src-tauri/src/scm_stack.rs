//! GIT-034 (T-313-b): creating the next pull request of a stack and recording the stack in each
//! description. This builds the `gh pr create` / `gh pr edit` / `gh pr view` arguments and the note
//! block; the front end (src/scm/stack.ts, StackMap.tsx) decides which steps a stack needs.
//!
//! The note sits between two comment markers in the pull request's description. Writing it replaces
//! the block between the markers when there is one and adds it at the end otherwise, so recording a
//! stack twice leaves the description as it was after the first time (and a description that already
//! reads as it should is not edited at all). The block's text is the same as stack.ts's `stackNote`.
//!
//! Sources: GitHub CLI public manual (cli.github.com/manual): `gh pr create` (`--head`, `--base`,
//! `--title`, `--body`, `--draft`), `gh pr edit` (`--body-file`, `-` reads standard input) and
//! `gh pr view --json body`. Nothing here calls GitHub in a test: the runners take the calls as closures.

use crate::scm;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One pull request of a stack: its number and its branch.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Link {
    pub number: u64,
    pub head: String,
}

const START: &str = "<!-- kolux-stack:start -->";
const END: &str = "<!-- kolux-stack:end -->";

/// The block that records the stack, `number` marked as the pull request it is written into.
pub fn stack_note(items: &[Link], number: u64) -> String {
    let mut lines = vec![START.to_string(), "Stack (bottom first):".to_string()];
    lines.extend(items.iter().map(|p| if p.number == number { format!("- **#{}** (this pull request) {}", p.number, p.head) } else { format!("- #{} {}", p.number, p.head) }));
    lines.push(END.to_string());
    lines.join("\n")
}

/// `body` with its stack block replaced (or added at the end); applying it twice changes nothing more.
pub fn with_stack_note(body: &str, items: &[Link], number: u64) -> String {
    let note = stack_note(items, number);
    if let (Some(a), Some(b)) = (body.find(START), body.find(END)) {
        if b > a {
            return format!("{}{}{}", &body[..a], note, &body[b + END.len()..]);
        }
    }
    let kept = body.trim_end();
    if kept.is_empty() {
        format!("{note}\n")
    } else {
        format!("{kept}\n\n{note}\n")
    }
}

fn plain(name: &str, v: &str) -> Result<(), String> {
    if v.trim().is_empty() {
        return Err(format!("The {name} is empty."));
    }
    // A branch or title that starts with a dash would be read by gh as a flag.
    if v.starts_with('-') || v.contains('\0') {
        return Err(format!("The {name} \"{v}\" is not usable."));
    }
    Ok(())
}

/// `gh pr create` for the pull request of branch `head` resting on `base`.
pub fn create_args(head: &str, base: &str, title: &str, body: &str, draft: bool) -> Result<Vec<String>, String> {
    plain("branch", head)?;
    plain("base branch", base)?;
    plain("title", title)?;
    if head == base {
        return Err("The new pull request needs a branch of its own, on top of the current one.".to_string());
    }
    let mut a: Vec<String> = ["pr", "create", "--head", head, "--base", base, "--title", title, "--body", body].iter().map(|s| s.to_string()).collect();
    if draft {
        a.push("--draft".to_string());
    }
    Ok(a)
}

/// `gh pr view` for a description.
pub fn view_args(number: u64) -> Vec<String> {
    ["pr", "view", &number.to_string(), "--json", "body"].iter().map(|s| s.to_string()).collect()
}

/// `gh pr edit` that reads the new description from standard input.
pub fn edit_args(number: u64) -> Vec<String> {
    ["pr", "edit", &number.to_string(), "--body-file", "-"].iter().map(|s| s.to_string()).collect()
}

/// The description in `gh pr view --json body` output.
pub fn parse_body(json: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    Ok(v["body"].as_str().unwrap_or_default().to_string())
}

/// What `gh pr create` printed: the new pull request's number and address (the last line naming one).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Created {
    pub number: u64,
    pub url: String,
}

pub fn parse_created(output: &str) -> Option<Created> {
    output.lines().rev().find_map(|l| {
        let l = l.trim();
        let (_, tail) = l.rsplit_once("/pull/")?;
        let number: u64 = tail.split(['/', '?', '#']).next()?.parse().ok()?;
        l.starts_with("http").then(|| Created { number, url: l.to_string() })
    })
}

/// Records the stack in every pull request's description, lowest first. A description that already
/// reads right is left alone. Returns the numbers that were edited. A stack of one has nothing to record.
pub fn record(items: &[Link], read: &mut dyn FnMut(u64) -> Result<String, String>, write: &mut dyn FnMut(u64, &str) -> Result<(), String>) -> Result<Vec<u64>, String> {
    let mut edited = Vec::new();
    if items.len() < 2 {
        return Ok(edited);
    }
    for p in items {
        let step = (|| {
            let now = read(p.number)?;
            let next = with_stack_note(&now, items, p.number);
            if next != now {
                write(p.number, &next)?;
                edited.push(p.number);
            }
            Ok::<(), String>(())
        })();
        if let Err(e) = step {
            let done = if edited.is_empty() { String::new() } else { format!("The stack was recorded in {} before that. ", edited.iter().map(|n| format!("#{n}")).collect::<Vec<_>>().join(", ")) };
            return Err(format!("#{} was not updated: {e} {done}Run it again to finish; it changes nothing that is already recorded.", p.number));
        }
    }
    Ok(edited)
}

/// GIT-034: creates the pull request of `head` on `base` (the branch below it in the stack).
#[tauri::command]
pub async fn scm_stack_create(worktree: String, head: String, base: String, title: String, body: String, draft: bool) -> Result<Created, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let args = create_args(&head, &base, &title, &body, draft)?;
        let out = scm::gh_run(&scm::gh_program()?, Path::new(&worktree), &args.iter().map(String::as_str).collect::<Vec<_>>(), None)?;
        parse_created(&out).ok_or_else(|| format!("gh did not say where the pull request is: {}", out.trim()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-034: writes the stack note into each pull request of `items` (bottom first).
#[tauri::command]
pub async fn scm_stack_record(worktree: String, items: Vec<Link>) -> Result<Vec<u64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        let gh = scm::gh_program()?;
        let mut read = |n: u64| parse_body(&scm::gh_run(&gh, dir, &view_args(n).iter().map(String::as_str).collect::<Vec<_>>(), None)?);
        let mut write = |n: u64, body: &str| scm::gh_run(&gh, dir, &edit_args(n).iter().map(String::as_str).collect::<Vec<_>>(), Some(body)).map(|_| ());
        record(&items, &mut read, &mut write)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(number: u64, head: &str) -> Link {
        Link { number, head: head.to_string() }
    }

    #[test]
    fn git034_create_args_use_the_public_gh_flags_and_refuse_flag_like_or_empty_values() {
        let a = create_args("feat-2", "feat-1", "Add the second part", "Body\ntext", false).unwrap();
        assert_eq!(a, ["pr", "create", "--head", "feat-2", "--base", "feat-1", "--title", "Add the second part", "--body", "Body\ntext"]);
        assert_eq!(create_args("b", "a", "t", "", true).unwrap().last().unwrap(), "--draft");
        assert!(create_args("-x", "a", "t", "", false).is_err() && create_args("b", "--base", "t", "", false).is_err());
        assert!(create_args("", "a", "t", "", false).is_err() && create_args("b", "a", "  ", "", false).is_err());
        assert!(create_args("a", "a", "t", "", false).unwrap_err().contains("branch of its own"));
    }

    #[test]
    fn git034_view_and_edit_args_read_and_write_the_description() {
        assert_eq!(view_args(12), ["pr", "view", "12", "--json", "body"]);
        assert_eq!(edit_args(12), ["pr", "edit", "12", "--body-file", "-"]);
        assert_eq!(parse_body("{\"body\":\"Hello\"}").unwrap(), "Hello");
        assert_eq!(parse_body("{\"body\":null}").unwrap(), "");
        assert!(parse_body("nope").is_err());
    }

    #[test]
    fn git034_the_new_pull_request_is_read_from_what_gh_printed() {
        let out = "Creating pull request for feat-2 into feat-1 in o/r\n\nhttps://github.com/o/r/pull/27\n";
        assert_eq!(parse_created(out), Some(Created { number: 27, url: "https://github.com/o/r/pull/27".into() }));
        assert_eq!(parse_created("https://github.com/o/r/pull/9/files"), Some(Created { number: 9, url: "https://github.com/o/r/pull/9/files".into() }));
        assert_eq!(parse_created("a pull request already exists\n"), None);
        assert_eq!(parse_created("see /pull/5 for it"), None);
    }

    #[test]
    fn git034_the_note_is_the_same_text_the_front_end_writes() {
        let items = [link(1, "a"), link(2, "b")];
        assert_eq!(stack_note(&items, 2), "<!-- kolux-stack:start -->\nStack (bottom first):\n- #1 a\n- **#2** (this pull request) b\n<!-- kolux-stack:end -->");
    }

    #[test]
    fn git034_the_note_block_is_added_once_and_replaced_after() {
        let items = [link(1, "a"), link(2, "b")];
        let once = with_stack_note("Fixes the login.", &items, 2);
        assert!(once.starts_with("Fixes the login.\n\n<!-- kolux-stack:start -->") && once.ends_with("<!-- kolux-stack:end -->\n"));
        assert_eq!(with_stack_note(&once, &items, 2), once, "recording twice changes nothing");
        let grown = with_stack_note(&once, &[link(1, "a"), link(2, "b"), link(3, "c")], 2);
        assert_eq!(grown.matches("kolux-stack:start").count(), 1);
        assert!(grown.contains("- #3 c") && grown.starts_with("Fixes the login."));
        assert_eq!(with_stack_note("", &items[..1], 1), format!("{}\n", stack_note(&items[..1], 1)));
        // Text after the block survives, and a lone start marker (no end) does not eat the description.
        let after = with_stack_note(&format!("{once}\nFooter"), &items, 2);
        assert!(after.ends_with("<!-- kolux-stack:end -->\n\nFooter") || after.ends_with("<!-- kolux-stack:end -->\nFooter"), "{after:?}");
        let broken = with_stack_note("Intro <!-- kolux-stack:start --> tail", &items, 1);
        assert!(broken.starts_with("Intro <!-- kolux-stack:start --> tail\n\n"));
    }

    #[test]
    fn git034_recording_edits_only_what_changed_and_a_second_run_edits_nothing() {
        let items = [link(1, "a"), link(2, "b"), link(3, "c")];
        let bodies = std::cell::RefCell::new(std::collections::BTreeMap::from([(1u64, "One".to_string()), (2, "Two".to_string()), (3, "Three".to_string())]));
        let writes = std::cell::RefCell::new(Vec::<u64>::new());
        let run = || {
            record(
                &items,
                &mut |n| Ok(bodies.borrow()[&n].clone()),
                &mut |n, b| {
                    bodies.borrow_mut().insert(n, b.to_string());
                    writes.borrow_mut().push(n);
                    Ok(())
                },
            )
        };
        assert_eq!(run().unwrap(), [1, 2, 3]);
        assert!(bodies.borrow()[&2].contains("- **#2** (this pull request) b") && bodies.borrow()[&3].starts_with("Three\n\n"));
        assert_eq!(run().unwrap(), Vec::<u64>::new(), "nothing is edited the second time");
        assert_eq!(writes.borrow().len(), 3);
    }

    #[test]
    fn git034_a_single_pull_request_is_not_a_stack_and_a_failure_names_where_it_stopped() {
        assert_eq!(record(&[link(1, "a")], &mut |_| panic!("no read"), &mut |_, _| panic!("no write")).unwrap(), Vec::<u64>::new());
        let items = [link(1, "a"), link(2, "b")];
        let err = record(&items, &mut |_| Ok(String::new()), &mut |n, _| if n == 2 { Err("HTTP 403".into()) } else { Ok(()) }).unwrap_err();
        assert!(err.contains("#2 was not updated: HTTP 403") && err.contains("recorded in #1") && err.contains("Run it again"), "{err}");
        let read_err = record(&items, &mut |_| Err("gh auth login".into()), &mut |_, _| Ok(())).unwrap_err();
        assert!(read_err.starts_with("#1 was not updated: gh auth login"), "{read_err}");
    }
}
