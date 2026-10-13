//! SAFE-009..012: the built-in protected rules. When Claude Code is about to run a shell command
//! in a Kolux pane, its PreToolUse hook asks `check`; a hit makes Claude show its own permission
//! prompt with the rule's name, so the command waits for the user. Only Claude is guarded (Codex
//! hooks can refuse but not ask), only its Bash and PowerShell tools are read, and a command that
//! matches nothing gets no opinion, so Claude's usual permission flow carries on.
//!
//! Settings: `protectedAsk` (the master switch, never saved means on) and `protectedOff` (the ids
//! of built-ins switched off); both are read on every command, so a change applies at once.
//!
//! ponytail: `segments` splits only on the plain chain operators and sees through a few wrapper
//! words; substitutions, nested shells, encoded PowerShell and the recursive-delete rule are the
//! SAFE-013/014 task.

use serde_json::Value;

pub const ASK_FIELD: &str = "protectedAsk";
pub const OFF_FIELD: &str = "protectedOff";

/// One built-in rule: its id (kept in settings), the name Claude's prompt shows, and the test.
pub struct Rule {
    pub id: &'static str,
    pub name: &'static str,
    hit: fn(&str) -> bool,
}

pub static RULES: [Rule; 6] = [
    Rule { id: "stripe", name: "Stripe changes", hit: stripe },
    Rule { id: "force-push", name: "Force-push to main", hit: force_push },
    Rule { id: "db-drop", name: "Deleting database tables", hit: db_drop },
    Rule { id: "infra", name: "Infrastructure changes", hit: infra },
    Rule { id: "prod-deploy", name: "Production deploys", hit: prod_deploy },
    Rule { id: "discard", name: "Throwing away uncommitted work", hit: discard },
];

/// The first rule `command` trips, honouring the master switch and the switched-off list.
pub fn check(command: &str, settings: &Value) -> Option<&'static Rule> {
    if settings.get(ASK_FIELD) == Some(&Value::Bool(false)) {
        return None;
    }
    let off: Vec<&str> = settings.get(OFF_FIELD).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    RULES.iter().find(|r| !off.contains(&r.id) && (r.hit)(command))
}

/// What Claude's prompt says (SAFE-009): the rule's name, cut to 120 characters, and what allowing
/// or refusing does.
pub fn reason(rule_name: &str) -> String {
    let name: String = rule_name.chars().take(120).collect();
    format!("Kolux protected action: {name}. The command waits for you; allow it once to run it, or refuse to leave it unrun.")
}

/// The words of a command, quotes honoured and stripped.
fn words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut had = false;
    for c in s.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '\'' || c == '"' => {
                quote = Some(c);
                had = true;
            }
            None if c.is_whitespace() => {
                if !cur.is_empty() || had {
                    out.push(std::mem::take(&mut cur));
                }
                had = false;
            }
            None => cur.push(c),
        }
    }
    if !cur.is_empty() || had {
        out.push(cur);
    }
    out
}

/// The commands of a chain, each as its words with wrapper words dropped, so the program comes
/// first. Splits on `;`, `&`, `&&`, `|`, `||` and newlines outside quotes.
fn segments(command: &str) -> Vec<Vec<String>> {
    const WRAPPERS: [&str; 14] = ["sudo", "doas", "nohup", "time", "nice", "env", "exec", "command", "builtin", "npx", "bunx", "pnpm", "yarn", "start"];
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in command.chars() {
        match quote {
            Some(q) if c == q => {
                quote = None;
                cur.push(c);
            }
            Some(_) => cur.push(c),
            None if c == '\'' || c == '"' => {
                quote = Some(c);
                cur.push(c);
            }
            None if c == ';' || c == '&' || c == '|' || c == '\n' => parts.push(std::mem::take(&mut cur)),
            None => cur.push(c),
        }
    }
    parts.push(cur);
    parts
        .iter()
        .map(|p| {
            let mut w = words(p);
            // Leading NAME=value assignments, wrappers and timeout's length are not the program.
            while let Some(first) = w.first() {
                let f = first.to_ascii_lowercase();
                if f.contains('=') && !f.starts_with('-') || WRAPPERS.contains(&f.as_str()) {
                    w.remove(0);
                } else if f == "timeout" {
                    w.drain(..w.len().min(2));
                } else {
                    break;
                }
            }
            w
        })
        .filter(|w| !w.is_empty())
        .collect()
}

/// The program name of a segment, without its folder or `.exe`.
fn program(seg: &[String]) -> String {
    let p = seg.first().map(String::as_str).unwrap_or("");
    let mut p = p.rsplit(['/', '\\']).next().unwrap_or(p).to_ascii_lowercase();
    if p.ends_with(".exe") || p.ends_with(".cmd") {
        p.truncate(p.len() - 4);
    }
    p
}

fn is_search(seg: &[String]) -> bool {
    let p = program(seg);
    matches!(p.as_str(), "grep" | "rg" | "ag" | "ack" | "findstr" | "select-string" | "sls") || (p == "git" && seg.get(1).is_some_and(|s| s == "grep"))
}

// SAFE-010: force-push or deletion aimed at main/master (or an unclear target), by `git push`.
fn force_push(command: &str) -> bool {
    segments(command).iter().any(|seg| {
        let Some(args) = git_args(seg, "push") else { return false };
        let mut force = false;
        let mut delete = false;
        let mut all = false;
        let mut refspecs: Vec<&str> = Vec::new();
        let mut positional = 0;
        for a in args {
            if a.starts_with("--") {
                match a.split_once('=').map_or(a.as_str(), |(k, _)| k) {
                    "--force" | "--force-with-lease" | "--force-if-includes" | "--mirror" => force = true,
                    "--delete" => delete = true,
                    "--all" | "--branches" | "--tags" => all = true,
                    _ => {}
                }
            } else if a.starts_with('-') && a.len() > 1 {
                force |= a.contains('f');
                delete |= a.contains('d');
            } else if let Some(r) = a.strip_prefix('+') {
                force = true;
                refspecs.push(r);
            } else {
                positional += 1;
                if positional > 1 {
                    // An empty source (`:main`) deletes the branch it names.
                    delete |= a.starts_with(':');
                    refspecs.push(a);
                }
            }
        }
        if !force && !delete {
            return false;
        }
        if all || refspecs.is_empty() {
            return true;
        }
        refspecs.iter().any(|r| {
            let r: &str = r;
            let dst = r.split_once(':').map_or(r, |(_, d)| d);
            if dst.is_empty() {
                return false;
            }
            let name = dst.rsplit('/').next().unwrap_or(dst);
            matches!(name, "main" | "master" | "HEAD" | "@") || dst.contains('$') || dst.contains('`')
        })
    })
}

/// The arguments after git's subcommand `sub`, with git's own options before it skipped.
fn git_args<'a>(seg: &'a [String], sub: &str) -> Option<&'a [String]> {
    if program(seg) != "git" {
        return None;
    }
    let mut i = 1;
    while i < seg.len() {
        let w = seg[i].as_str();
        if w == sub {
            return Some(&seg[i + 1..]);
        }
        if !w.starts_with('-') {
            return None;
        }
        // These take their value as the next word unless written with `=`.
        let takes_value = matches!(w, "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace" | "--exec-path" | "--super-prefix");
        i += if takes_value { 2 } else { 1 };
    }
    None
}

// SAFE-010: a hard reset, or a forced clean that is not a dry run.
fn discard(command: &str) -> bool {
    segments(command).iter().any(|seg| {
        if let Some(args) = git_args(seg, "reset") {
            return args.iter().any(|a| a == "--hard");
        }
        if let Some(args) = git_args(seg, "clean") {
            let dry = args.iter().any(|a| a == "--dry-run" || (a.starts_with('-') && !a.starts_with("--") && a.contains('n')));
            let force = args.iter().any(|a| a == "--force" || (a.starts_with('-') && !a.starts_with("--") && a.contains('f')));
            return force && !dry;
        }
        false
    })
}

// SAFE-011: a database client given a drop or truncate anywhere on the line, or dropdb itself.
fn db_drop(command: &str) -> bool {
    const CLIENTS: [&str; 18] = ["psql", "mysql", "mariadb", "sqlite3", "sqlcmd", "mongosh", "mongo", "supabase", "prisma", "wrangler", "bq", "duckdb", "turso", "pscale", "neonctl", "cockroach", "clickhouse-client", "usql"];
    let segs = segments(command);
    if segs.iter().any(|s| program(s) == "dropdb") {
        return true;
    }
    if !segs.iter().any(|s| CLIENTS.contains(&program(s).as_str())) {
        return false;
    }
    let text = command.to_ascii_lowercase();
    if text.contains("truncate") || text.contains(".drop(") || text.contains("dropdatabase(") || text.contains("dropcollection(") {
        return true;
    }
    let toks: Vec<&str> = text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|t| !t.is_empty()).collect();
    toks.iter().enumerate().any(|(i, t)| {
        *t == "drop"
            && toks[i + 1..]
                .iter()
                .take(3)
                .any(|k| matches!(*k, "table" | "database" | "schema" | "view" | "index" | "user" | "role" | "collection" | "type" | "sequence" | "function" | "trigger"))
    })
}

// SAFE-012: live Stripe data changes.
fn stripe(command: &str) -> bool {
    const VERBS: [&str; 12] = ["create", "update", "delete", "cancel", "refund", "post", "capture", "confirm", "void", "detach", "attach", "trigger"];
    let segs = segments(command);
    let lower = command.to_ascii_lowercase();
    if (lower.contains("sk_live_") || lower.contains("rk_live_")) && !segs.iter().all(|s| is_search(s)) {
        return true;
    }
    segs.iter().any(|seg| program(seg) == "stripe" && (seg.iter().any(|a| a == "--live") || seg.iter().skip(1).take(3).any(|w| VERBS.contains(&w.to_ascii_lowercase().as_str()))))
}

// SAFE-012: applying or tearing down infrastructure.
fn infra(command: &str) -> bool {
    segments(command).iter().any(|seg| {
        let subs: Vec<String> = seg.iter().skip(1).filter(|a| !a.starts_with('-')).take(2).map(|s| s.to_ascii_lowercase()).collect();
        let first = subs.first().map(String::as_str).unwrap_or("");
        let second = subs.get(1).map(String::as_str).unwrap_or("");
        match program(seg).as_str() {
            "terraform" | "tofu" => matches!(first, "apply" | "destroy"),
            "terragrunt" => matches!(first, "apply" | "destroy") || (first == "run-all" && matches!(second, "apply" | "destroy")),
            "pulumi" => matches!(first, "up" | "update" | "destroy"),
            "cdk" => matches!(first, "deploy" | "destroy"),
            _ => false,
        }
    })
}

// SAFE-012: a production marker together with a deployment tool or a deploy verb.
fn prod_deploy(command: &str) -> bool {
    const CLIS: [&str; 14] = ["vercel", "netlify", "firebase", "wrangler", "fly", "flyctl", "railway", "heroku", "gcloud", "az", "serverless", "sls", "sst", "eb"];
    segments(command).iter().any(|seg| {
        let lower: Vec<String> = seg.iter().map(|w| w.to_ascii_lowercase()).collect();
        let marker = lower.iter().any(|w| {
            let bare = w.trim_start_matches('-');
            matches!(bare.rsplit_once('=').map_or(bare, |(_, v)| v), "prod" | "production")
        });
        marker && (CLIS.contains(&program(seg).as_str()) || lower.iter().any(|w| w == "deploy"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn hit(cmd: &str) -> Option<&'static str> {
        check(cmd, &json!({})).map(|r| r.id)
    }

    #[test]
    fn safe010_force_push_and_deletion_aimed_at_main_ask_feature_branches_and_plain_pushes_run() {
        for c in ["git push -f", "git push origin :main", "git push --force origin main", "git push -f origin @:main", "git push --force origin @", "git push --mirror origin", "git -C repo push --force origin HEAD", "git -c core.autocrlf=false push --force-with-lease origin master", "git push origin +main", "git push --delete origin main", "git push -fu origin $(git branch --show-current)", "cd app && git push -f"] {
            assert_eq!(hit(c), Some("force-push"), "{c}");
        }
        for c in ["git push -f origin feature", "git push origin main", "git push origin @", "git push --delete origin feature", "git status", "git push --force-with-lease origin topic:refs/heads/topic", "echo 'git push -f'"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe010_hard_reset_and_forced_clean_ask_soft_reset_and_dry_run_run() {
        for c in ["git reset --hard", "git reset --hard HEAD~1", "git clean -fdx", "git clean --force -d", "git -C x clean -xdf"] {
            assert_eq!(hit(c), Some("discard"), "{c}");
        }
        for c in ["git reset --soft HEAD~1", "git reset", "git clean -n", "git clean -fdn", "git clean -d --dry-run"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe011_database_clients_dropping_or_truncating_ask_but_the_words_elsewhere_run() {
        for c in ["psql -c \"DROP TABLE users\"", "echo 'TRUNCATE sessions;' | psql mydb", "dropdb production", "mysql -e 'drop database if exists shop'", "psql <<EOF\nDROP SCHEMA public CASCADE;\nEOF", "mongosh --eval 'db.users.drop()'", "npx prisma db execute --stdin < drop.sql; psql -c 'drop view v'"] {
            assert_eq!(hit(c), Some("db-drop"), "{c}");
        }
        for c in ["git commit -m 'drop the users table'", "grep -r 'DROP TABLE' migrations", "psql -c 'select 1'", "cat schema.sql"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe012_stripe_changes_and_live_keys_ask_listening_listing_and_searching_run() {
        for c in ["stripe subscriptions cancel sub_1", "stripe customers delete cus_1", "stripe refunds create --charge ch_1", "stripe customers list --live", "curl -u sk_live_abc: https://api.stripe.com/v1/charges", "STRIPE_KEY=rk_live_x node pay.js"] {
            assert_eq!(hit(c), Some("stripe"), "{c}");
        }
        for c in ["stripe listen --forward-to localhost:3000", "stripe customers list", "grep -r sk_live_ src", "rg sk_live_ .", "stripe --help"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe012_infrastructure_apply_and_destroy_ask_plan_and_init_run() {
        for c in ["terraform apply -auto-approve", "npx cdk deploy", "terraform destroy", "tofu apply", "terragrunt run-all apply", "terragrunt destroy", "pulumi up -y", "pulumi destroy", "cdk destroy --all"] {
            assert_eq!(hit(c), Some("infra"), "{c}");
        }
        for c in ["terraform plan", "terraform init", "terragrunt run-all plan", "pulumi preview", "cdk diff", "cdk synth"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe012_production_deploys_ask_plain_deploys_and_production_installs_run() {
        for c in ["vercel --prod", "wrangler deploy --env production", "netlify deploy --prod", "firebase deploy -P prod", "fly deploy -e production", "railway up --environment production", "npm run deploy -- --stage=prod", "gcloud run deploy api --env=prod"] {
            assert_eq!(hit(c), Some("prod-deploy"), "{c}");
        }
        for c in ["vercel deploy", "npm install --production", "wrangler deploy", "NODE_ENV=production npm run build", "ls production", "vercel env pull"] {
            assert_eq!(hit(c), None, "{c}");
        }
    }

    #[test]
    fn safe009_the_master_switch_and_a_switched_off_rule_stop_asking_at_once() {
        let s = json!({ ASK_FIELD: false });
        assert!(check("git push -f", &s).is_none());
        let s = json!({ OFF_FIELD: ["force-push"] });
        assert!(check("git push -f", &s).is_none());
        assert_eq!(check("git reset --hard", &s).map(|r| r.id), Some("discard"));
        assert_eq!(check("git push -f", &json!({ ASK_FIELD: true, OFF_FIELD: [] })).map(|r| r.name), Some("Force-push to main"));
        let long = "x".repeat(200);
        let r = reason(&long);
        assert!(r.starts_with(&format!("Kolux protected action: {}.", "x".repeat(120))) && !r.contains(&"x".repeat(121)));
        assert_eq!(RULES.len(), 6);
    }
}
