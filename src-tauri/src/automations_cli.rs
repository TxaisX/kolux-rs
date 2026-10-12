//! CLI-028 / CLI-029 (AUTO-020): the `automations` command group. `list`, `show` and `runs` read
//! what the Automations page shows; `create`, `edit`, `remove` and `run` change it through the
//! same checks the page's dialog goes through, and the page follows along. An id is given bare
//! (`automations show auto-3`) or as `--id`. The precheck, session reuse, the missed-run grace
//! window and source context wait on T-193-b with the rest of the flag set.

use super::{pick_project, pick_worktree, Ctx, Fail, Request};
use crate::automations;
use serde_json::{json, Map, Value};

const FIELDS: &[&str] = &["name", "trigger", "schedule", "time", "day", "timezone", "prompt", "provider", "repo", "workspace", "workspace-mode", "enabled", "disabled"];
const EDIT: &[&str] = &["id", "name", "trigger", "schedule", "time", "day", "timezone", "prompt", "provider", "repo", "workspace", "workspace-mode", "enabled", "disabled"];
pub(super) const COMMANDS: &[(&str, &str, &[&str])] = &[
    ("automations list", "automations.list", &[]),
    ("automations show", "automations.show", &["id"]),
    ("automations runs", "automations.runs", &["id", "limit"]),
    ("automations create", "automations.create", FIELDS),
    ("automations edit", "automations.edit", EDIT),
    ("automations remove", "automations.remove", &["id"]),
    ("automations run", "automations.run", &["id"]),
];
/// Every one of these is a timetable: anything else given to `--trigger` is a cron line or RRULE.
const PRESETS: &[&str] = &["hourly", "daily", "weekdays", "weekly"];

/// Checked before the app is asked, so a bad day or a clash of flags never reaches it.
pub(super) fn check(command: &str, flags: &Map<String, Value>) -> Result<Map<String, Value>, Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim);
    if let Some(k) = flags.keys().find(|k| text(k).is_some_and(str::is_empty)) {
        return Err(Fail::args(format!("--{k} cannot be empty")));
    }
    let trigger = match (text("trigger"), text("schedule")) {
        (Some(a), Some(b)) if a != b => return Err(Fail::args("--schedule is another name for --trigger; give one of them")),
        (a, b) => a.or(b),
    };
    if command != "automations.list" && command != "automations.create" && text("id").is_none() {
        return Err(Fail::args("name the automation: its id, like auto-3, bare or as --id"));
    }
    if let Some(t) = text("time") {
        let ok = t.split_once(':').is_some_and(|(h, m)| m.len() == 2 && h.parse::<u8>().is_ok_and(|h| h < 24) && m.parse::<u8>().is_ok_and(|m| m < 60));
        if !ok {
            return Err(Fail::args(format!("--time takes HH:MM on a 24-hour clock, like 09:00, not {t}")));
        }
    }
    if let Some(d) = text("day") {
        if !d.parse::<u8>().is_ok_and(|d| d <= 6) {
            return Err(Fail::args(format!("--day takes 0 to 6, with Sunday as 0, not {d}")));
        }
    }
    if let Some(m) = text("workspace-mode") {
        if !["existing", "new-per-run"].contains(&m) {
            return Err(Fail::args("--workspace-mode takes existing or new-per-run"));
        }
    }
    if flags.contains_key("repo") && flags.contains_key("workspace") {
        return Err(Fail::args("give --repo or --workspace, not both"));
    }
    if flags.contains_key("enabled") && flags.contains_key("disabled") {
        return Err(Fail::args("give --enabled or --disabled, not both"));
    }
    if let Some(l) = text("limit") {
        if !l.parse::<u64>().is_ok_and(|n| n > 0) {
            return Err(Fail::args("--limit takes a number above zero"));
        }
    }
    if command == "automations.create" {
        for (k, what) in [("name", ""), ("prompt", ": what the agent starts with")] {
            if text(k).is_none() {
                return Err(Fail::args(format!("--{k} is required{what}")));
            }
        }
        if trigger.is_none() {
            return Err(Fail::args("--trigger is required: hourly, daily, weekdays, weekly, a cron line or an RRULE"));
        }
    }
    if command == "automations.edit" && trigger.is_none() {
        if let Some(k) = ["time", "day", "timezone"].into_iter().find(|k| flags.contains_key(*k)) {
            return Err(Fail::args(format!("--{k} changes the timetable; give --trigger with it")));
        }
    }
    let mut args = Map::new();
    for (k, v) in flags {
        let key = match k.as_str() {
            "schedule" => "trigger",
            "workspace-mode" => "workspaceMode",
            other => other,
        };
        args.insert(key.to_string(), v.clone());
    }
    Ok(args)
}

/// The timetable the flags describe, over `form` (what the automation had) on edit.
fn schedule(a: &Value, form: &Value, zone: &str) -> Value {
    let s = |k: &str| a[k].as_str().map(str::trim).map(String::from);
    let trigger = s("trigger").unwrap_or_default();
    let preset = if PRESETS.contains(&trigger.as_str()) { trigger.clone() } else { "custom".into() };
    let custom = if preset == "custom" { trigger } else { String::new() };
    let day = s("day").and_then(|d| d.parse::<u8>().ok()).map(Value::from).unwrap_or_else(|| form["day"].clone());
    let time = s("time").or_else(|| form["time"].as_str().filter(|t| !t.is_empty()).map(String::from)).unwrap_or_else(|| "09:00".into());
    json!({ "preset": preset, "time": time, "day": if day.is_null() { json!(1) } else { day }, "custom": custom, "timezone": s("timezone").unwrap_or_else(|| zone.to_string()) })
}

/// The saved automation `id`, as the page shows it.
fn find(ctx: &Ctx, id: &str) -> Result<Value, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let all = automations::list(&store)?;
    all["automations"].as_array().and_then(|l| l.iter().find(|a| a["id"] == id)).cloned().ok_or_else(|| Fail { code: "not_found", message: format!("no automation is called {id}"), data: json!({ "hint": "kolux-dev automations list shows them" }) })
}

/// A row as the command line prints it: the page's fields plus the project's name and the host.
// ponytail: every automation is owned by this computer until remote hosts exist, so none is orphaned.
fn row(ctx: &Ctx, a: &Value) -> Value {
    let mut a = a.clone();
    let project = ctx.store.lock().ok().and_then(|s| crate::projects::load_projects(&s).into_iter().find(|p| a["projectId"] == p.id.as_str()));
    a["project"] = json!(project.map(|p| p.name));
    a["host"] = json!("local");
    a["orphaned"] = json!(false);
    if let Some(o) = a.as_object_mut() {
        o.remove("requestId");
    }
    a
}

/// Tells the Automations page to read the list again.
fn changed(ctx: &Ctx, id: &str) {
    (ctx.notify)(json!({ "emit": automations::EVENT, "payload": { "id": id } }));
}

pub(super) fn dispatch(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let id = text("id").unwrap_or_default();
    match req.command.as_str() {
        "automations.list" => {
            let all = {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                automations::list(&store)?
            };
            let rows: Vec<Value> = all["automations"].as_array().cloned().unwrap_or_default().iter().map(|x| row(ctx, x)).collect();
            Ok(json!({ "automations": rows, "runsError": all["runsError"] }))
        }
        "automations.show" => {
            let one = row(ctx, &find(ctx, &id)?);
            let all = automations::list(&*ctx.store.lock().map_err(|e| e.to_string())?)?;
            let runs = all["runs"].as_array().map(|r| r.iter().filter(|r| r["automationId"] == id.as_str()).count());
            Ok(json!({ "automation": one, "runs": if all["runsError"].is_null() { json!(runs) } else { Value::Null } }))
        }
        "automations.runs" => {
            find(ctx, &id)?;
            let all = automations::list(&*ctx.store.lock().map_err(|e| e.to_string())?)?;
            if let Some(e) = all["runsError"].as_str() {
                return Err(Fail::new("failed", e.to_string()));
            }
            let mut runs: Vec<Value> = all["runs"].as_array().cloned().unwrap_or_default().into_iter().filter(|r| r["automationId"] == id.as_str()).collect();
            runs.sort_by_key(|r| std::cmp::Reverse(r["number"].as_u64().unwrap_or(0)));
            runs.truncate(text("limit").and_then(|l| l.parse().ok()).unwrap_or(usize::MAX));
            Ok(json!({ "id": id, "runs": runs }))
        }
        "automations.create" | "automations.edit" => {
            let old = if req.command == "automations.edit" { Some(find(ctx, &id)?) } else { None };
            let mut input = json!({ "requestId": if old.is_some() { String::new() } else { req.id.clone() } });
            if let Some(o) = &old {
                for k in ["id", "name", "prompt", "provider", "projectId", "workspaceMode", "workspace", "baseBranch", "enabled"] {
                    input[k] = o[k].clone();
                }
            }
            for k in ["name", "prompt", "provider"] {
                if let Some(v) = text(k) {
                    input[k] = json!(v);
                }
            }
            // The target: the worktree it was run in, unless --repo or --workspace says otherwise;
            // a new worktree for every run unless asked (--workspace alone means that one).
            let retarget = old.is_none() || ["repo", "workspace", "workspaceMode"].iter().any(|k| text(k).is_some());
            if retarget {
                let (project, here) = match (text("workspace"), text("repo")) {
                    (Some(sel), _) => pick_worktree(ctx, &sel, &req.cwd).map(|(p, w)| (p, Some(w.path)))?,
                    (None, Some(sel)) => (pick_project(ctx, Some(&sel), &req.cwd)?, None),
                    (None, None) if old.is_some() => (pick_project(ctx, Some(&format!("id:{}", input["projectId"].as_str().unwrap_or_default())), &req.cwd)?, input["workspace"].as_str().map(String::from)),
                    (None, None) => pick_worktree(ctx, "current", &req.cwd).map(|(p, w)| (p, Some(w.path)))?,
                };
                let mode = text("workspaceMode").unwrap_or_else(|| if text("workspace").is_some() { "existing".into() } else { "new-per-run".into() });
                input["projectId"] = json!(project.id);
                input["workspace"] = json!(if mode == "existing" { here.unwrap_or_default() } else { String::new() });
                input["workspaceMode"] = json!(mode);
            }
            let form = old.as_ref().map(|o| o["form"].clone()).unwrap_or(Value::Null);
            let zone = old.as_ref().and_then(|o| o["trigger"]["timezone"].as_str()).unwrap_or("").to_string();
            input["schedule"] = if text("trigger").is_some() {
                schedule(a, &form, &zone)
            } else {
                // Unchanged: the timetable it had, read back as the page reads it.
                json!({ "preset": form["preset"], "time": form["time"], "day": form["day"], "custom": if form["preset"] == "custom" { old.as_ref().map(|o| o["trigger"]["cron"].clone()).unwrap_or_default() } else { json!("") }, "timezone": zone })
            };
            if a["enabled"] == true || a["disabled"] == true {
                input["enabled"] = json!(a["enabled"] == true);
            }
            let saved = automations::save_automation(&*ctx.store.lock().map_err(|e| e.to_string())?, &input, automations::now_ms() as i64)?;
            changed(ctx, saved["id"].as_str().unwrap_or_default());
            Ok(row(ctx, &saved))
        }
        "automations.remove" => {
            let gone = find(ctx, &id)?;
            automations::delete(&*ctx.store.lock().map_err(|e| e.to_string())?, &id)?;
            changed(ctx, &id);
            Ok(json!({ "id": id, "name": gone["name"], "removed": true }))
        }
        "automations.run" => {
            find(ctx, &id)?;
            let installed = |agent: &str| crate::agents::agent_list().iter().any(|x| x.id == agent && x.installed);
            let notify = |event: &str, v: Value| {
                if event == super::EVENT {
                    (ctx.notify)(v)
                } else {
                    (ctx.notify)(json!({ "emit": event, "payload": v }))
                }
            };
            let launch = automations::Launch { git: ctx.git, store: ctx.store, claude_config: ctx.claude_config.clone(), installed: &installed, notify: &notify };
            Ok(automations::run(&launch, &id, "manual")?)
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

/// What a success looks like without `--json`.
pub(super) fn text(command: &str, r: &Value) -> Option<String> {
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let line = |a: &Value| {
        let target = if a["workspaceMode"] == "existing" { format!("in {}", s(a, "workspace")) } else { "a new worktree every run".into() };
        let state = if a["enabled"] == true { a["nextRunLabel"].as_str().map(|n| format!("next {n}")).unwrap_or_else(|| "on".into()) } else { "paused".into() };
        format!("{}  {}  {} · {} · {} ({}) · host {} · {}", s(a, "id"), s(a, "name"), a["timetable"].as_str().unwrap_or("waits for events"), s(a, "provider"), a["project"].as_str().unwrap_or("project gone"), target, s(a, "host"), state)
    };
    let run = |r: &Value| format!("#{}  {}  {}{}", r["number"], s(r, "trigger"), s(r, "status"), r["detail"].as_str().or(r["cause"].as_str()).map(|d| format!(" ({d})")).unwrap_or_default());
    Some(match command {
        "automations.list" => {
            let rows = r["automations"].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                "no automations yet; make one with kolux-dev automations create".into()
            } else {
                rows.iter().map(line).collect::<Vec<_>>().join("\n")
            }
        }
        "automations.show" => format!("{}\nruns: {}\nprompt:\n{}", line(&r["automation"]), r["runs"].as_u64().map(|n| n.to_string()).unwrap_or_else(|| "unknown (the run history could not be read)".into()), s(&r["automation"], "prompt")),
        "automations.runs" => {
            let rows = r["runs"].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                format!("{} has not run yet", s(r, "id"))
            } else {
                rows.iter().map(run).collect::<Vec<_>>().join("\n")
            }
        }
        "automations.create" | "automations.edit" => format!("saved {}", line(r)),
        "automations.remove" => format!("removed {} ({})", s(r, "id"), s(r, "name")),
        "automations.run" => format!("started {}", run(r)),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::super::{dispatch as app, parse, Ctx, Request};
    use crate::git::Git;
    use crate::state::Store;
    use crate::terminal::Terminals;
    use serde_json::{json, Value};
    use std::path::Path;
    use std::process::Command;
    use std::sync::Mutex;

    fn words(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn automation_flags_are_checked_before_the_app_is_asked() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        // An id bare or by flag.
        let p = ok("automations show auto-3");
        assert_eq!((p.command.as_str(), &p.args["id"]), ("automations.show", &json!("auto-3")));
        assert_eq!(ok("automations runs --id auto-3 --limit 5").args["id"], "auto-3");
        assert!(refused("automations show auto-3 --id auto-4").contains("twice"));
        assert!(refused("automations remove").contains("auto-3"));
        // --schedule is --trigger.
        assert_eq!(ok("automations create --name r --schedule daily --time 09:00 --prompt review --provider claude").args["trigger"], "daily");
        assert!(refused("automations create --name r --trigger daily --schedule weekly --prompt p").contains("another name"));
        assert!(refused("automations create --name r --prompt p").contains("--trigger is required"));
        assert!(refused("automations create --trigger daily --prompt p").contains("--name"));
        // CLI-029: a bad day never reaches the app, and modifiers need a schedule on edit.
        assert!(refused("automations edit auto-1 --day 7").contains("0 to 6"));
        assert!(refused("automations edit auto-1 --time 09:00").contains("give --trigger"));
        assert!(refused("automations create --name r --trigger daily --time 9:5 --prompt p").contains("HH:MM"));
        assert!(refused("automations create --name r --trigger daily --time 24:00 --prompt p").contains("HH:MM"));
        assert!(refused("automations create --name r --trigger daily --prompt p --repo name:a --workspace name:b").contains("not both"));
        assert!(refused("automations create --name r --trigger daily --prompt p --enabled --disabled").contains("not both"));
        assert!(refused("automations create --name r --trigger daily --prompt p --workspace-mode sometimes").contains("existing or new-per-run"));
        assert_eq!(ok("automations edit auto-1 --trigger weekly --day 0 --disabled").args["disabled"], true);
        assert!(refused("automations frobnicate").contains("unknown command"));
        for (name, _, _) in super::COMMANDS {
            assert!(super::super::HELP.contains(&format!("kolux-dev {name} ")), "{name} has no help line");
        }
    }

    #[test]
    fn automations_are_made_changed_listed_and_removed_from_the_command_line() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-autocli-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&repo).output().unwrap().status.success(), "{args:?}");
        git(&["init", "-q", "-b", "main"]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"]);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        crate::projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        let seen = Mutex::new(Vec::<Value>::new());
        let notify = |v: Value| seen.lock().unwrap().push(v);
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify };
        let call_words = |w: Vec<String>, cwd: &Path| {
            let p = parse(&w).1.unwrap().unwrap();
            app(&ctx, &Request { id: format!("r-{}", w.join(" ")), token: String::new(), command: p.command, cwd: cwd.display().to_string(), args: Value::Object(p.args), pane: None })
        };
        let call = |line: &str, cwd: &Path| call_words(words(line), cwd);

        // CLI-029's example: a daily 9:00 automation in the repo it was run in, a new worktree each run.
        let made = call("automations create --name r --trigger daily --time 09:00 --prompt review --provider claude --timezone UTC", &repo).unwrap();
        let id = made["id"].as_str().unwrap().to_string();
        assert_eq!((&made["trigger"]["cron"], &made["workspaceMode"], &made["host"], &made["enabled"]), (&json!("0 9 * * *"), &json!("new-per-run"), &json!("local"), &json!(true)));
        assert_eq!(made["project"], "repo");
        assert!(seen.lock().unwrap().iter().any(|v| v["emit"] == crate::automations::EVENT), "the page is told");

        // Edit: the timetable with its modifiers; the rest is kept.
        let ed = call(&format!("automations edit {id} --trigger weekly --day 2 --time 10:30 --disabled"), &repo).unwrap();
        assert_eq!((&ed["trigger"]["cron"], &ed["trigger"]["timezone"], &ed["enabled"], &ed["prompt"]), (&json!("30 10 * * 2"), &json!("UTC"), &json!(false), &json!("review")));
        let ed = call(&format!("automations edit {id} --name renamed --workspace-mode existing"), &repo).unwrap();
        assert_eq!((&ed["name"], &ed["trigger"]["cron"], &ed["workspaceMode"]), (&json!("renamed"), &json!("30 10 * * 2"), &json!("existing")));
        assert!(Path::new(ed["workspace"].as_str().unwrap()).ends_with("repo"), "{ed}");
        // A cron line is a timetable too.
        assert_eq!(call(&format!("automations edit {id} --trigger */15 --enabled"), &repo).unwrap_err().code, "failed");
        let cron = call_words(["automations", "edit", &id, "--trigger", "0 9 * * 1-5"].map(String::from).to_vec(), &repo).unwrap();
        assert_eq!((&cron["trigger"]["cron"], &cron["enabled"]), (&json!("0 9 * * 1-5"), &json!(false)));

        // list, show and runs read what the page shows.
        let l = call("automations list", &dir).unwrap();
        assert_eq!(l["automations"].as_array().unwrap().len(), 1);
        assert_eq!(l["automations"][0]["id"], id.as_str());
        let sh = call(&format!("automations show {id}"), &dir).unwrap();
        assert_eq!((&sh["automation"]["name"], &sh["runs"]), (&json!("renamed"), &json!(0)));
        assert_eq!(call(&format!("automations runs {id}"), &dir).unwrap()["runs"], json!([]));
        assert!(super::text("automations.list", &l).unwrap().contains("host local"));
        assert_eq!(call("automations show auto-99", &dir).unwrap_err().code, "not_found");

        // Outside every project, create needs --repo; remove then empties the list.
        assert_eq!(call("automations create --name x --trigger daily --prompt p --provider claude", &dir).unwrap_err().code, "not_found");
        assert_eq!(call(&format!("automations remove {id}"), &dir).unwrap()["removed"], true);
        assert_eq!(call("automations list", &dir).unwrap()["automations"], json!([]));
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
