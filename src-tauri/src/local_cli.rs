//! CLI-042 / CLI-043 / SKILL-030: the commands that answer from the program itself, with the app
//! closed: `agent-context` describes every command, and `skills list` and `skills get` print the
//! guides bundled into this build, so they always match its version.

use super::{commands, Fail, Parsed, HELP};
use serde_json::{json, Value};

pub const COMMANDS: &[super::Command] = &[
    ("agent-context", "agent-context", &[]),
    ("skills list", "skills.list", &[]),
    ("skills get", "skills.get", &["topic", "full", "references", "reference"]),
    ("skills show", "skills.get", &["topic", "full", "references", "reference"]),
];

/// The document's shape; agents read its field names, so a change to them bumps this.
const SCHEMA: u32 = 1;

/// One line each, in the words a person would use; keyed by the command's own words.
const SUMMARIES: &[(&str, &str)] = &[
    ("worktree create", "Make a worktree in a repo, optionally starting an agent in it."),
    ("worktree rm", "Remove a worktree and its folder."),
    ("orchestration worker-start", "Start a worker agent on a task, in a new or chosen worktree."),
    ("repo list", "List the repos Kolux knows."),
    ("repo add", "Add a folder as a repo."),
    ("repo show", "Show one repo."),
    ("repo set-base-ref", "Set the branch new worktrees of a repo start from."),
    ("repo search-refs", "Search a repo's branches and tags."),
    ("project list", "List the projects."),
    ("worktree list", "List the worktrees of a repo or of every repo."),
    ("worktree ps", "List worktrees with what is running in them."),
    ("worktree show", "Show one worktree."),
    ("worktree current", "Show the worktree this terminal is in."),
    ("worktree changes", "List what a worktree changed against its base."),
    ("worktree overlap", "List other worktrees touching the same files, and whether a merge would conflict."),
    ("orchestration run-create", "Open a Run and attach this terminal to it as the coordinator."),
    ("orchestration run-use", "Attach this terminal to an existing Run."),
    ("orchestration run-current", "Show the Run this terminal is attached to."),
    ("orchestration run-list", "List the Runs."),
    ("orchestration run-show", "Show one Run."),
    ("orchestration send", "Send a message to a terminal, a Run or a dispatch."),
    ("orchestration check", "Read new mail, or wait for it."),
    ("orchestration reply", "Answer a message in its thread."),
    ("orchestration inbox", "List the mail this terminal has received."),
    ("orchestration ask", "Ask the coordinator a question and wait for the answer."),
    ("orchestration gate-create", "Hold a task until the coordinator decides; needs an attached Run."),
    ("orchestration gate-resolve", "Settle a gate so its task can go on."),
    ("orchestration gate-list", "List the gates of this Run or of a named one."),
    ("orchestration reset", "Clear tasks, messages or both."),
    ("orchestration task-create", "Add a task to the Run."),
    ("orchestration task-list", "List the Run's tasks."),
    ("orchestration dispatch", "Give a task to a terminal that is already open."),
    ("orchestration dispatch-show", "Show how a task was dispatched."),
    ("orchestration worker-abandon", "Give up on a worker; its task goes back to ready."),
    ("automations list", "List the automations."),
    ("automations show", "Show one automation."),
    ("automations runs", "List an automation's runs, newest first."),
    ("automations create", "Save an automation that starts an agent on a timetable."),
    ("automations edit", "Change an automation."),
    ("automations remove", "Delete an automation."),
    ("automations run", "Start an automation now."),
    ("agent-context", "Describe every command, its flags and its usage."),
    ("skills list", "List the skill guides bundled with this CLI."),
    ("skills get", "Print a bundled skill guide, in short, in full, or one reference."),
    ("claude-teams", "Run Claude Code with Agent Teams in Kolux panes; arguments go to Claude untouched."),
];

/// The bare word some commands take after their verb, and the flag it stands for.
pub fn bare(path: &[String]) -> Option<&'static str> {
    match (path.len(), path.first().map(String::as_str), path.get(1).map(String::as_str)) {
        (3, Some("automations"), _) => Some("id"),
        (3, Some("skills"), Some("get" | "show")) => Some("topic"),
        _ => None,
    }
}

/// The help lines for these words: the one naming them and the indented ones under it.
fn usage(words: &str) -> String {
    let lines: Vec<&str> = HELP.lines().collect();
    let names = |l: &str| {
        l.trim_start().split(" | ").any(|part| {
            let part = part.strip_prefix("kolux-dev ").unwrap_or(part);
            part == words || part.starts_with(&format!("{words} "))
        })
    };
    let Some(at) = lines.iter().position(|l| l.starts_with("  kolux-dev ") && names(l)) else {
        return String::new();
    };
    let mut out = vec![lines[at].trim()];
    out.extend(lines[at + 1..].iter().take_while(|l| l.starts_with("      ")).map(|l| l.trim()));
    out.join(" ")
}

pub fn agent_context() -> Value {
    let all = commands();
    let mut entries = Vec::new();
    for (i, &(words, path, flags)) in all.iter().enumerate() {
        if all[..i].iter().any(|c| c.1 == path) {
            continue;
        }
        let aliases: Vec<&str> = all[i + 1..].iter().filter(|c| c.1 == path).map(|c| c.0).collect();
        let mut accepted: Vec<&str> = flags.to_vec();
        accepted.extend(["json", "help"]);
        let probe: Vec<String> = format!("{words} x").split(' ').map(String::from).collect();
        let bare: Vec<&str> = bare(&probe).into_iter().collect();
        entries.push(entry(words, path, &aliases, false, &accepted, &bare));
    }
    entries.push(entry("claude-teams", "claude-teams", &[], true, &[], &[]));
    json!({ "schemaVersion": SCHEMA, "commandCount": entries.len(), "commands": entries })
}

fn entry(words: &str, path: &str, aliases: &[&str], raw: bool, flags: &[&str], bare: &[&str]) -> Value {
    let summary = SUMMARIES.iter().find(|s| s.0 == words).map(|s| s.1).unwrap_or_default();
    json!({
        "words": words,
        "path": path.split('.').collect::<Vec<_>>(),
        "aliases": aliases,
        "arguments": if raw { "raw" } else { "parsed" },
        "summary": summary,
        "usage": usage(words),
        "flags": flags,
        "bareArguments": bare,
        "examples": [],
        "notes": if raw { vec!["every argument is handed to the program as typed; Kolux reads none of them"] } else { vec![] },
    })
}

struct Skill {
    name: &'static str,
    aliases: &'static [&'static str],
    guide: &'static str,
    refs: &'static [(&'static str, &'static str)],
}

/// SKILL-029's kept skills, in name order. Built into the program, so they match its version.
const SKILLS: &[Skill] = &[
    Skill {
        name: "kolux-cli",
        aliases: &["cli", "kolux"],
        guide: include_str!("../skills/kolux-cli/SKILL.md"),
        refs: &[
            ("automations", include_str!("../skills/kolux-cli/references/automations.md")),
            ("json", include_str!("../skills/kolux-cli/references/json.md")),
            ("worktrees", include_str!("../skills/kolux-cli/references/worktrees.md")),
        ],
    },
    Skill { name: "koluxsecurity", aliases: &["security"], guide: include_str!("../skills/koluxsecurity/SKILL.md"), refs: &[("checklist", include_str!("../skills/koluxsecurity/references/checklist.md"))] },
    Skill { name: "koluxward", aliases: &["ward", "injection"], guide: include_str!("../skills/koluxward/SKILL.md"), refs: &[("signs", include_str!("../skills/koluxward/references/signs.md"))] },
    Skill {
        name: "orchestration",
        aliases: &["orch"],
        guide: include_str!("../skills/orchestration/SKILL.md"),
        refs: &[
            ("gates", include_str!("../skills/orchestration/references/gates.md")),
            ("mail", include_str!("../skills/orchestration/references/mail.md")),
            ("tasks", include_str!("../skills/orchestration/references/tasks.md")),
        ],
    },
];

/// The text after the `---` header block, and the header's description line.
fn split(md: &str) -> (&str, &str) {
    let md = md.trim_start_matches('\u{feff}');
    let Some(rest) = md.strip_prefix("---") else { return ("", md) };
    let Some((head, body)) = rest.split_once("\n---") else { return ("", md) };
    let desc = head.lines().find_map(|l| l.strip_prefix("description:")).unwrap_or_default().trim();
    (desc, body.trim_start_matches(['\r', '\n']))
}

fn topics() -> String {
    SKILLS.iter().map(|s| s.name).collect::<Vec<_>>().join(", ")
}

fn skill(topic: &str) -> Result<&'static Skill, Fail> {
    let t = topic.trim().to_lowercase();
    SKILLS.iter().find(|s| s.name == t || s.aliases.contains(&t.as_str())).ok_or_else(|| Fail {
        code: "not_found",
        message: format!("there is no skill called {topic}; the topics are {}", topics()),
        data: json!({ "topics": SKILLS.iter().map(|s| s.name).collect::<Vec<_>>(), "hint": "kolux-dev skills list shows them with what each is for" }),
    })
}

fn skills_get(a: &serde_json::Map<String, Value>) -> Result<Value, Fail> {
    let topic = a.get("topic").and_then(Value::as_str).filter(|t| !t.trim().is_empty()).ok_or_else(|| Fail::args(format!("name a topic: {}", topics())))?;
    let s = skill(topic)?;
    let full = a.get("full") == Some(&json!(true));
    let list = a.get("references") == Some(&json!(true));
    let one = a.get("reference").map(|r| r.as_str().unwrap_or_default().trim().to_string());
    if [full, list, one.is_some()].iter().filter(|b| **b).count() > 1 {
        return Err(Fail::args("--full, --references and --reference cannot be combined: pick one"));
    }
    let names: Vec<&str> = s.refs.iter().map(|r| r.0).collect();
    let (_, guide) = split(s.guide);
    let (selected, reference, markdown) = if let Some(r) = one {
        if names.is_empty() {
            return Err(Fail::args(format!("{} has no references", s.name)));
        }
        // A reference can be named as its path inside the guide's references folder too.
        let key = r.replace('\\', "/");
        let key = key.trim_start_matches("references/").trim_end_matches(".md");
        let Some(&(name, md)) = s.refs.iter().find(|x| x.0 == key) else {
            return Err(Fail::args(format!("{} has no reference called {r}; its references are {}", s.name, names.join(", "))));
        };
        ("reference", Some(name), md.to_string())
    } else if list {
        ("references", None, names.iter().map(|n| format!("- {n}")).collect::<Vec<_>>().join("\n"))
    } else if full {
        let mut out = vec![guide.trim_end().to_string()];
        out.extend(s.refs.iter().map(|r| r.1.trim_end().to_string()));
        ("full", None, out.join("\n\n"))
    } else {
        ("guide", None, guide.to_string())
    };
    Ok(json!({ "name": s.name, "selected": selected, "reference": reference, "references": names, "markdown": markdown.trim_end() }))
}

/// The answer to a local command, or `None` when the command needs the app.
pub fn run(p: &Parsed) -> Option<Result<Value, Fail>> {
    Some(match p.command.as_str() {
        "agent-context" => Ok(agent_context()),
        "skills.list" => Ok(json!({ "skills": SKILLS.iter().map(|s| json!({ "name": s.name, "description": split(s.guide).0, "aliases": s.aliases, "references": s.refs.iter().map(|r| r.0).collect::<Vec<_>>() })).collect::<Vec<_>>() })),
        "skills.get" => skills_get(&p.args),
        _ => return None,
    })
}

pub fn text(command: &str, r: &Value) -> Option<String> {
    Some(match command {
        "agent-context" => format!("{} commands; kolux-dev agent-context --json prints the whole document", r["commandCount"]),
        "skills.list" => r["skills"].as_array().into_iter().flatten().map(|s| format!("{:<15}{}", s["name"].as_str().unwrap_or_default(), s["description"].as_str().unwrap_or_default())).collect::<Vec<_>>().join("\n"),
        "skills.get" => r["markdown"].as_str().unwrap_or_default().to_string(),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::super::parse;
    use super::*;

    fn local(line: &str) -> Result<Value, Fail> {
        let words: Vec<String> = line.split(' ').map(str::to_string).collect();
        let p = parse(&words).1?.expect("a command");
        run(&p).expect("answered without the app")
    }

    #[test]
    fn agent_context_describes_every_command_from_the_program_itself() {
        let doc = local("agent-context").unwrap();
        assert_eq!(doc["schemaVersion"], 1);
        let list = doc["commands"].as_array().unwrap();
        assert_eq!(doc["commandCount"], list.len());
        let find = |w: &str| list.iter().find(|c| c["words"] == w).unwrap_or_else(|| panic!("{w} is missing"));
        let rm = find("worktree rm");
        assert_eq!(rm["aliases"], json!(["worktree remove", "worktree delete"]));
        assert!(list.iter().all(|c| c["words"] != "worktree remove"), "an alias is not its own entry");
        assert_eq!(rm["path"], json!(["worktree", "rm"]));
        assert!(rm["flags"].as_array().unwrap().contains(&json!("json")), "global flags are listed");
        let teams = find("claude-teams");
        assert_eq!((teams["arguments"].as_str(), teams["flags"].as_array().unwrap().len()), (Some("raw"), 0));
        assert_eq!(find("automations show")["bareArguments"], json!(["id"]));
        assert_eq!(find("skills get")["aliases"], json!(["skills show"]));
        for c in list {
            assert!(!c["summary"].as_str().unwrap().is_empty(), "{} has no summary", c["words"]);
            assert!(c["usage"].as_str().unwrap().contains(c["words"].as_str().unwrap()), "{} has no usage", c["words"]);
            for k in ["aliases", "flags", "bareArguments", "examples", "notes"] {
                assert!(c[k].is_array(), "{k} of {} is a list even when empty", c["words"]);
            }
        }
        assert_eq!(doc, local("agent-context").unwrap(), "the order is stable");
        assert!(text("agent-context", &doc).unwrap().starts_with(&format!("{} commands", list.len())));
    }

    #[test]
    fn bundled_skill_guides_are_listed_and_printed_offline() {
        let l = local("skills list").unwrap();
        let names: Vec<&str> = l["skills"].as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["kolux-cli", "koluxsecurity", "koluxward", "orchestration"]);
        assert!(l["skills"].as_array().unwrap().iter().all(|s| !s["description"].as_str().unwrap().is_empty()));
        let short = local("skills get orchestration").unwrap();
        let full = local("skills get orchestration --full").unwrap();
        assert_eq!((short["name"].as_str(), short["selected"].as_str()), (Some("orchestration"), Some("guide")));
        assert!(!short["markdown"].as_str().unwrap().starts_with("---"), "the header block is not printed");
        assert!(full["markdown"].as_str().unwrap().len() > short["markdown"].as_str().unwrap().len());
        assert!(full["markdown"].as_str().unwrap().contains("# Decision gates"));
        assert_eq!(local("skills show --topic orch").unwrap(), short, "show, --topic and an alias reach the same guide");
        let gates = local("skills get orchestration --reference gates").unwrap();
        assert_eq!(local("skills get orchestration --reference references/gates.md").unwrap(), gates);
        assert!(gates["markdown"].as_str().unwrap().starts_with("# Decision gates"));
        assert_eq!(local("skills get kolux-cli --references").unwrap()["markdown"], "- automations\n- json\n- worktrees");
        let nope = local("skills get nope").unwrap_err();
        assert_eq!(nope.code, "not_found");
        assert!(nope.message.contains("kolux-cli, koluxsecurity, koluxward, orchestration"), "{}", nope.message);
        assert!(local("skills get orchestration --full --references").unwrap_err().message.contains("cannot be combined"));
        assert!(local("skills get orchestration --reference nope").unwrap_err().message.contains("gates, mail, tasks"));
        assert!(local("skills get").unwrap_err().message.contains("name a topic"));
    }
}
