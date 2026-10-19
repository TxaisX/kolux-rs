//! SAFE-009..014: the built-in protected rules. When Claude Code is about to run a shell command
//! in a Kolux pane, its PreToolUse hook asks `check`; a hit makes Claude show its own permission
//! prompt with the rule's name, so the command waits for the user. Only Claude is guarded (Codex
//! hooks can refuse but not ask), only its Bash and PowerShell tools are read, and a command that
//! matches nothing gets no opinion, so Claude's usual permission flow carries on.
//!
//! Settings: `protectedAsk` (the master switch, never saved means on) and `protectedOff` (the ids
//! of built-ins switched off); both are read on every command, so a change applies at once.
//!
//! SAFE-013/014: a command is read as a chain (operators, grouping, `$( )` and backtick
//! substitutions four levels deep), wrappers and their option values are stepped over, and what
//! sh -c, cmd /c, PowerShell (-Command or encoded), eval, iex and wsl are given to run is read
//! too; the recursive-delete rule judges paths as text against the workspace and the temp roots.
//!
//! ponytail: the workspace is Claude's own hook `cwd` (a Kolux pane starts Claude in the worktree
//! folder); a pane variable naming the worktree would tell a cd before launch apart from it.

use serde_json::Value;

pub const ASK_FIELD: &str = "protectedAsk";
pub const OFF_FIELD: &str = "protectedOff";

/// One built-in rule: its id (kept in settings), the name Claude's prompt shows, and the test.
pub struct Rule {
    pub id: &'static str,
    pub name: &'static str,
    /// SAFE-015: two commands the rule asks about, shown as its examples on the Safety page.
    pub samples: [&'static str; 2],
    hit: fn(&str, &Base) -> bool,
}

pub static RULES: [Rule; 7] = [
    Rule { id: "stripe", name: "Stripe changes", samples: ["stripe refunds create --charge ch_1", "stripe customers delete cus_1"], hit: stripe },
    Rule { id: "force-push", name: "Force-push to main", samples: ["git push --force origin main", "git push origin +main"], hit: force_push },
    Rule { id: "db-drop", name: "Deleting database tables", samples: ["psql -c \"DROP TABLE users\"", "dropdb production"], hit: db_drop },
    Rule { id: "infra", name: "Infrastructure changes", samples: ["terraform apply -auto-approve", "pulumi destroy"], hit: infra },
    Rule { id: "prod-deploy", name: "Production deploys", samples: ["vercel --prod", "netlify deploy --prod"], hit: prod_deploy },
    Rule { id: "delete", name: "Deleting folders outside the workspace", samples: ["rm -rf ../other-project", "rm -rf ~"], hit: recursive_delete },
    Rule { id: "discard", name: "Throwing away uncommitted work", samples: ["git reset --hard", "git clean -fdx"], hit: discard },
];

/// The first rule `command` trips, honouring the master switch and the switched-off list.
pub fn check(command: &str, base: &Base, settings: &Value) -> Option<&'static Rule> {
    if settings.get(ASK_FIELD) == Some(&Value::Bool(false)) {
        return None;
    }
    let off: Vec<&str> = settings.get(OFF_FIELD).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    RULES.iter().find(|r| !off.contains(&r.id) && (r.hit)(command, base))
}

/// What Claude's prompt says (SAFE-009): the rule's name, cut to 120 characters, and what allowing
/// or refusing does.
pub fn reason(rule_name: &str) -> String {
    let name: String = rule_name.chars().take(120).collect();
    format!("Kolux protected action: {name}. The command waits for you; allow it once to run it, or refuse to leave it unrun.")
}

/// What a recursive delete is judged against (SAFE-013): the workspace, the folder the command
/// began in, the home folder and the temp roots, all as text; nothing is looked up on disk.
#[derive(Clone, Debug, Default)]
pub struct Base {
    pub workspace: Option<String>,
    pub cwd: Option<String>,
    pub home: Option<String>,
    pub temp: Vec<String>,
}

impl Base {
    /// From Claude's hook `cwd` (the folder its session began in, which is the worktree folder
    /// when a Kolux pane started it) and this process's environment.
    pub fn from_env(cwd: Option<&str>) -> Base {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let mut temp: Vec<String> = ["TMPDIR", "TEMP", "TMP"].iter().filter_map(|k| var(k)).collect();
        temp.extend(["/tmp".to_string(), "/var/tmp".to_string()]);
        Base { workspace: cwd.map(String::from), cwd: cwd.map(String::from), home: var("USERPROFILE").or_else(|| var("HOME")), temp }
    }
}

// SAFE-013: a recursive delete that reaches outside the workspace, or whose target is unknown.
// The chain is walked in order so an earlier cd, pushd or Set-Location shifts the base.
fn recursive_delete(command: &str, base: &Base) -> bool {
    let mut dir = base.cwd.clone().or_else(|| base.workspace.clone());
    for seg in segments(command) {
        let p = program(&seg);
        let args: Vec<&str> = seg[1..].iter().map(String::as_str).collect();
        match p.as_str() {
            "cd" | "chdir" | "set-location" | "sl" | "pushd" => {
                let target = args.iter().find(|a| !(a.starts_with('-') && a.len() > 1) && !a.eq_ignore_ascii_case("/d"));
                dir = match target {
                    None if p == "pushd" => None,
                    None => base.home.clone(),
                    Some(&"-") => None,
                    Some(t) => locate(t, dir.as_deref(), base),
                };
            }
            "popd" => dir = None,
            "rm" | "rd" | "rmdir" | "del" | "erase" | "remove-item" | "ri" => {
                if let Some(targets) = delete_targets(&p, &args) {
                    if targets.is_empty() || targets.iter().any(|t| risky(t, dir.as_deref(), base)) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }
    false
}

/// The targets of a recursive delete, or None when the command is not recursive: rm's -r in any
/// bundle, cmd's /s (run together with other switches too), PowerShell's -Recurse and every
/// shortening of it, with -Path and -LiteralPath values read as targets.
fn delete_targets(program: &str, args: &[&str]) -> Option<Vec<String>> {
    let cmd_style = matches!(program, "rd" | "rmdir" | "del" | "erase");
    let mut recursive = false;
    let mut targets = Vec::new();
    let mut literal = false;
    let mut i = 0;
    while i < args.len() {
        let a = args[i];
        i += 1;
        if literal {
            targets.push(a.to_string());
            continue;
        }
        if a == "--" {
            literal = true;
            continue;
        }
        if cmd_style && a.starts_with('/') && a[1..].split('/').all(|t| t.len() == 1 || (t.len() == 3 && t.as_bytes()[1] == b':')) {
            recursive |= a[1..].split('/').any(|t| t.eq_ignore_ascii_case("s"));
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            recursive |= rest == "recursive";
            continue;
        }
        if a.len() > 1 && a.starts_with('-') {
            let (name, attached) = match a[1..].split_once(':') {
                Some((n, v)) => (n.to_ascii_lowercase(), Some(v)),
                None => (a[1..].to_ascii_lowercase(), None),
            };
            if name == "lp" || ["path", "literalpath", "pspath"].iter().any(|s| s.starts_with(name.as_str())) {
                let value = attached.or_else(|| {
                    i += 1;
                    args.get(i - 1).copied()
                });
                targets.extend(value.unwrap_or("").split(',').map(str::to_string));
            } else if name.len() >= 2 && ["include", "exclude", "filter", "credential"].iter().any(|s| s.starts_with(name.as_str())) {
                i += usize::from(attached.is_none());
            } else if "recurse".starts_with(name.as_str()) || (name.len() <= 4 && name.contains('r') && name.chars().all(|c| "rfvdi".contains(c))) {
                recursive = true;
            }
            continue;
        }
        targets.push(a.to_string());
    }
    recursive.then_some(targets)
}

/// Whether deleting `target` must ask: unknown, outside the workspace, the workspace itself or
/// its git folder; a temp location runs; a wildcard is judged by its folder.
fn risky(target: &str, dir: Option<&str>, base: &Base) -> bool {
    let t = target.replace('\\', "/");
    let t = match t.rsplit_once('/') {
        Some((folder, last)) if last.contains(['*', '?']) => folder.to_string(),
        _ if t.contains(['*', '?']) => ".".to_string(),
        _ => t,
    };
    let Some(path) = locate(&t, dir, base) else { return true };
    if base.temp.iter().any(|r| under(&path, &norm(r))) {
        return false;
    }
    let Some(ws) = base.workspace.as_deref().or(base.cwd.as_deref()) else { return true };
    let ws = norm(ws);
    path == ws || under(&path, &format!("{ws}/.git")) || !under(&path, &ws)
}

/// Where `arg` points as text, or None when it cannot be known: a variable, another user's home,
/// a drive-relative path, or a relative path with no known base.
fn locate(arg: &str, dir: Option<&str>, base: &Base) -> Option<String> {
    let a = arg.trim();
    if a.is_empty() || a.contains(['$', '%', '`']) || drive_relative(a) {
        return None;
    }
    let a = match a.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => format!("{}{rest}", base.home.as_deref()?),
        Some(_) => return None,
        None => a.to_string(),
    };
    let full = if is_abs(&a) { a } else { format!("{}/{a}", dir?) };
    Some(norm(&full))
}

fn is_abs(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with(['/', '\\']) || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\'))
}

fn drive_relative(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && !is_abs(p)
}

/// A path as comparable text: backslashes to slashes, a Git Bash drive (`/c/x`) to `c:/x`, `.`
/// and `..` folded (never above the root), no trailing slash; letter case is ignored on Windows.
fn norm(path: &str) -> String {
    let mut p = path.replace('\\', "/");
    if cfg!(windows) {
        p = p.to_ascii_lowercase();
    }
    let b = p.as_bytes();
    if b.len() >= 2 && b[0] == b'/' && b[1].is_ascii_alphabetic() && (b.len() == 2 || b[2] == b'/') {
        p = format!("{}:{}", &p[1..2], &p[2..]);
    }
    let abs = p.starts_with('/');
    let drive = p.len() >= 2 && p.as_bytes()[1] == b':';
    let mut parts: Vec<&str> = Vec::new();
    for part in p.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.len() > usize::from(drive) {
                    parts.pop();
                }
            }
            x => parts.push(x),
        }
    }
    let joined = parts.join("/");
    if abs { format!("/{joined}") } else { joined }
}

fn under(path: &str, root: &str) -> bool {
    path == root || (root == "/" && path.starts_with('/')) || path.starts_with(&format!("{root}/"))
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

/// The commands of a chain in order, each as its words with wrappers dropped so the program
/// comes first (SAFE-014): split on `;`, `&`, `|`, newlines and grouping outside quotes; `$( )`
/// and backtick substitutions are pulled out (four levels deep); what a shell is given to run
/// (sh -c, cmd /c, PowerShell -Command or encoded, eval, iex, wsl) is read in its place.
fn segments(command: &str) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    collect(command, 0, &mut out);
    out
}

fn collect(text: &str, depth: usize, out: &mut Vec<Vec<String>>) {
    if depth > 4 {
        return;
    }
    let (outer, inners) = substitutions(text);
    for inner in inners {
        collect(&inner, depth + 1, out);
    }
    for part in split(&outer) {
        let w = unwrap(words(&part));
        if w.is_empty() {
            continue;
        }
        match inner_command(&w) {
            Some(inner) => collect(&inner, depth + 1, out),
            None => out.push(w),
        }
    }
}

/// `$( )` and backtick substitutions pulled out of `text`: the outer text with each replaced by
/// `$sub` (so it reads as a variable), and the inner commands. Single quotes hide them.
fn substitutions(text: &str) -> (String, Vec<String>) {
    let c: Vec<char> = text.chars().collect();
    let mut outer = String::new();
    let mut inners = Vec::new();
    let mut single = false;
    let mut i = 0;
    while i < c.len() {
        if c[i] == '\'' {
            single = !single;
        } else if !single && c[i] == '$' && c.get(i + 1) == Some(&'(') {
            let mut depth = 0;
            let mut j = i + 1;
            while j < c.len() {
                if c[j] == '(' {
                    depth += 1;
                } else if c[j] == ')' {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                j += 1;
            }
            inners.push(c[(i + 2).min(j)..j.min(c.len())].iter().collect());
            outer.push_str("$sub");
            i = j + 1;
            continue;
        } else if !single && c[i] == '`' {
            let j = c[i + 1..].iter().position(|&x| x == '`').map_or(c.len(), |p| i + 1 + p);
            inners.push(c[i + 1..j].iter().collect());
            outer.push_str("$sub");
            i = j + 1;
            continue;
        }
        outer.push(c[i]);
        i += 1;
    }
    (outer, inners)
}

/// The pieces of a chain: split on `;`, `&`, `|`, newlines and grouping marks outside quotes.
fn split(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in text.chars() {
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
            None if matches!(c, ';' | '&' | '|' | '\n' | '(' | ')' | '{' | '}') => parts.push(std::mem::take(&mut cur)),
            None => cur.push(c),
        }
    }
    parts.push(cur);
    parts
}

/// Wrapper programs and the options of theirs that take a value, so neither is mistaken for the
/// program (SAFE-014, audit finding S2).
const WRAPPERS: [(&str, &[&str]); 19] = [
    ("sudo", &["u", "g", "C", "D", "h", "p", "r", "t", "T", "U", "user", "group", "host", "prompt", "chdir", "role", "type", "close-from"]),
    ("doas", &["u", "C"]),
    ("nohup", &[]),
    ("time", &[]),
    ("exec", &[]),
    ("command", &[]),
    ("builtin", &[]),
    ("start", &[]),
    ("nice", &["n", "adjustment"]),
    ("env", &["u", "C", "S", "unset", "chdir", "split-string"]),
    ("xargs", &["I", "i", "n", "P", "d", "s", "L", "E", "a", "max-args", "max-procs", "delimiter", "replace", "max-lines", "max-chars", "arg-file", "eof"]),
    ("timeout", &["s", "k", "signal", "kill-after"]),
    ("npx", &["p", "package"]),
    ("bunx", &["p", "package"]),
    ("pnpm", &[]),
    ("yarn", &[]),
    ("npm", &[]),
    ("bun", &[]),
    ("wsl", &["d", "u", "distribution", "user", "cd"]),
];

/// Drops leading assignments, wrapper programs with their options, the timeout length and a
/// package runner's exec subcommand, so the program comes first.
fn unwrap(mut w: Vec<String>) -> Vec<String> {
    loop {
        let Some(first) = w.first() else { return w };
        if first.contains('=') && !first.starts_with('-') {
            w.remove(0);
            continue;
        }
        let f = program(&w);
        let Some((_, values)) = WRAPPERS.iter().find(|(n, _)| *n == f) else { return w };
        w.remove(0);
        if matches!(f.as_str(), "pnpm" | "yarn" | "npm" | "bun") {
            if w.first().is_some_and(|s| matches!(s.as_str(), "exec" | "dlx" | "x")) {
                w.remove(0);
            }
            continue;
        }
        while let Some(o) = w.first().cloned() {
            if (f == "start" && (o.is_empty() || o.starts_with('/'))) || (f == "wsl" && matches!(o.as_str(), "--" | "-e" | "--exec")) {
                w.remove(0);
                continue;
            }
            if !o.starts_with('-') || o == "-" {
                break;
            }
            let body = o.trim_start_matches('-');
            let takes_next = if o.starts_with("--") { !body.contains('=') && values.contains(&body) } else { body.len() == 1 && values.contains(&body) };
            w.drain(..(1 + usize::from(takes_next)).min(w.len()));
        }
        if f == "timeout" && !w.is_empty() {
            w.remove(0);
        }
    }
}

enum Ps {
    Command,
    Encoded,
    File,
    Value,
    Flag,
}

/// What a PowerShell switch (lowercased, dashes off) means under any unambiguous shortening:
/// -Command, -EncodedCommand, -File, a switch that takes a value, or a plain flag (audit S1).
fn ps_switch(name: &str) -> Ps {
    const VALUES: [&str; 10] = ["executionpolicy", "windowstyle", "workingdirectory", "inputformat", "outputformat", "configurationname", "psconsolefile", "version", "settingsfile", "custompipename"];
    const SHORT: [&str; 8] = ["ep", "wd", "if", "of", "inp", "o", "w", "v"];
    if name.is_empty() || name == "i" {
        Ps::Flag
    } else if "command".starts_with(name) {
        Ps::Command
    } else if "encodedcommand".starts_with(name) || name == "ec" {
        Ps::Encoded
    } else if "file".starts_with(name) {
        Ps::File
    } else if SHORT.contains(&name) || VALUES.iter().any(|v| v.starts_with(name)) {
        Ps::Value
    } else {
        Ps::Flag
    }
}

/// The command a shell in `w` is told to run (SAFE-014), or None for a plain program, a
/// PowerShell -File run, or a shell reading its script from a file or stdin.
fn inner_command(w: &[String]) -> Option<String> {
    let args = &w[1..];
    match program(w).as_str() {
        "sh" | "bash" | "zsh" | "dash" | "ksh" | "fish" | "ash" | "busybox" => {
            let i = args.iter().position(|a| a.starts_with('-') && !a.starts_with("--") && a[1..].contains('c'))?;
            args.get(i + 1).cloned()
        }
        "eval" | "iex" | "invoke-expression" => Some(args.join(" ")).filter(|s| !s.is_empty()),
        "cmd" => {
            let i = args.iter().position(|a| {
                let s = a.trim_start_matches('/').to_ascii_lowercase();
                a.starts_with('/') && (s == "c" || s == "k" || s.ends_with("/c") || s.ends_with("/k"))
            })?;
            Some(args[i + 1..].join(" ")).filter(|s| !s.is_empty())
        }
        "powershell" | "pwsh" => {
            let mut i = 0;
            while i < args.len() {
                let a = &args[i];
                i += 1;
                let Some(sw) = a.strip_prefix('-') else {
                    // A bare word is a command to run, unless it is a script file.
                    return if a.to_ascii_lowercase().ends_with(".ps1") { None } else { Some(args[i - 1..].join(" ")) };
                };
                let (name, attached) = match sw.split_once(':') {
                    Some((n, v)) => (n.to_ascii_lowercase(), Some(v.to_string())),
                    None => (sw.to_ascii_lowercase(), None),
                };
                match ps_switch(&name) {
                    Ps::Command => {
                        let rest: Vec<String> = attached.into_iter().chain(args[i..].iter().cloned()).collect();
                        return Some(rest.join(" ")).filter(|s| !s.is_empty() && s != "-");
                    }
                    Ps::Encoded => {
                        let value = attached.or_else(|| args.get(i).cloned())?;
                        return decode_ps(&value);
                    }
                    Ps::File => return None,
                    Ps::Value => i += usize::from(attached.is_none()),
                    Ps::Flag => {}
                }
            }
            None
        }
        _ => None,
    }
}

/// A PowerShell encoded command: base64 of UTF-16LE text.
fn decode_ps(b64: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
    Some(String::from_utf16_lossy(&units))
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
fn force_push(command: &str, _base: &Base) -> bool {
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
fn discard(command: &str, _base: &Base) -> bool {
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
fn db_drop(command: &str, _base: &Base) -> bool {
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
fn stripe(command: &str, _base: &Base) -> bool {
    const VERBS: [&str; 12] = ["create", "update", "delete", "cancel", "refund", "post", "capture", "confirm", "void", "detach", "attach", "trigger"];
    let segs = segments(command);
    let lower = command.to_ascii_lowercase();
    if (lower.contains("sk_live_") || lower.contains("rk_live_")) && !segs.iter().all(|s| is_search(s)) {
        return true;
    }
    segs.iter().any(|seg| program(seg) == "stripe" && (seg.iter().any(|a| a == "--live") || seg.iter().skip(1).take(3).any(|w| VERBS.contains(&w.to_ascii_lowercase().as_str()))))
}

// SAFE-012: applying or tearing down infrastructure.
fn infra(command: &str, _base: &Base) -> bool {
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
fn prod_deploy(command: &str, _base: &Base) -> bool {
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

// SAFE-015: what the Safety page lists. The page reads this so its names and examples can never
// drift from the rules that actually ask.
#[derive(serde::Serialize)]
pub struct RuleInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub samples: [&'static str; 2],
}

/// The built-in rules in the order they are checked.
pub fn catalog() -> Vec<RuleInfo> {
    RULES.iter().map(|r| RuleInfo { id: r.id, name: r.name, samples: r.samples }).collect()
}

#[tauri::command]
pub fn protected_rules() -> Vec<RuleInfo> {
    catalog()
}

// SAFE-019: a command that was paused is masked before it is kept or shown. Pure text in, text
// out; nothing here reads a file or the clock. Stripe secret keys keep their prefix and last four
// characters (enough to tell two keys apart); everything else a secret could be is replaced by
// HIDDEN. The passes run in this order, and a second run changes nothing.
pub const HIDDEN: &str = "[hidden]";

const STRIPE_PREFIXES: [&str; 5] = ["sk_live_", "sk_test_", "rk_live_", "rk_test_", "whsec_"];

#[allow(dead_code)] // the recent-attempts list (T-156-b, SAFE-018) is its first caller
pub fn mask(text: &str) -> String {
    let t = stripe_keys(text);
    let t = pem_blocks(&t);
    let t = url_credentials(&t);
    let t = provider_keys(&t);
    let t = auth_headers(&t);
    let t = header_values(&t);
    let t = json_values(&t);
    let t = secret_flags(&t);
    let t = labelled_values(&t);
    env_lines(&t)
}

/// Rewrites `t`: at each byte offset `f` may claim a span `i..end` and give its replacement.
fn scan(t: &str, f: impl Fn(&str, usize) -> Option<(usize, String)>) -> String {
    let mut out = String::with_capacity(t.len());
    let (mut i, mut last) = (0, 0);
    while i < t.len() {
        match f(t, i) {
            Some((end, rep)) if end > i && t.is_char_boundary(end) => {
                out.push_str(&t[last..i]);
                out.push_str(&rep);
                i = end;
                last = end;
            }
            _ => i += 1,
        }
    }
    out.push_str(&t[last..]);
    out
}

/// How many leading bytes of `s` are accepted by `ok` (ASCII only, so the cut is a char boundary).
fn run(s: &str, ok: impl Fn(u8) -> bool) -> usize {
    s.bytes().take_while(|b| ok(*b)).count()
}

/// A word begins at `i` when the byte before it is not a letter or digit.
fn word_start(t: &str, i: usize) -> bool {
    i == 0 || !t.as_bytes()[i - 1].is_ascii_alphanumeric()
}

fn key_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn stripe_keys(t: &str) -> String {
    scan(t, |t, i| {
        let rest = t.get(i..)?;
        // Not inside a longer name such as `my_sk_live_...` (a file name), unlike `KEY=sk_live_...`.
        if !word_start(t, i) || (i > 0 && t.as_bytes()[i - 1] == b'_') {
            return None;
        }
        for p in STRIPE_PREFIXES {
            if let Some(tail) = rest.strip_prefix(p) {
                let n = run(tail, |b| b.is_ascii_alphanumeric());
                if n >= 8 {
                    return Some((i + p.len() + n, format!("{p}....{}", &tail[n - 4..n])));
                }
            }
        }
        None
    })
}

/// A private key block (any `-----BEGIN ... PRIVATE KEY-----`) up to its END line, or to the end
/// of the text when it was cut short.
fn pem_blocks(t: &str) -> String {
    scan(t, |t, i| {
        let head = t.get(i..)?.strip_prefix("-----BEGIN ")?;
        let close = head.find("-----")?;
        if !head[..close].ends_with("PRIVATE KEY") {
            return None;
        }
        let after = i + "-----BEGIN ".len() + close + 5;
        let end = match t[after..].find("-----END ") {
            Some(k) => {
                let e = after + k + "-----END ".len();
                t[e..].find("-----").map_or(t.len(), |m| e + m + 5)
            }
            None => t.len(),
        };
        Some((end, HIDDEN.to_string()))
    })
}

/// `scheme://user:password@host`: the user and password go, in any scheme.
fn url_credentials(t: &str) -> String {
    scan(t, |t, i| {
        let rest = t.get(i..)?.strip_prefix("://")?;
        let auth = run(rest, |b| !(b.is_ascii_whitespace() || matches!(b, b'/' | b'?' | b'#' | b'\'' | b'"' | b'`' | b'<' | b'>')));
        let at = rest[..auth].rfind('@')?;
        let info = &rest[..at];
        (info.contains(':') && info != HIDDEN).then(|| (i + 3 + at, format!("://{HIDDEN}")))
    })
}

/// Well-known provider keys: Anthropic, OpenAI, xAI, Google, GitHub, GitLab, npm, Hugging Face, AWS, Slack and JSON web tokens.
fn provider_keys(t: &str) -> String {
    // (prefix, shortest tail) over letters, digits, `_` and `-`.
    const KEYS: [(&str, usize); 12] = [("sk-ant-", 16), ("sk-", 20), ("xai-", 20), ("AIza", 30), ("ghp_", 30), ("gho_", 30), ("ghu_", 30), ("ghs_", 30), ("ghr_", 30), ("github_pat_", 20), ("glpat-", 20), ("xox", 0)];
    // npm and Hugging Face tokens are letters and digits only after the prefix, so an identifier
    // such as `npm_config_cache` or `hf_hub_download` is never mistaken for one.
    const PLAIN_KEYS: [(&str, usize); 2] = [("npm_", 36), ("hf_", 30)];
    scan(t, |t, i| {
        if !word_start(t, i) {
            return None;
        }
        let rest = t.get(i..)?;
        for (p, min) in KEYS {
            if let Some(tail) = rest.strip_prefix(p) {
                if p == "xox" {
                    // Slack: xoxb-, xoxa-, xoxp-, xoxr-, xoxs- and a long run after it.
                    let kind = tail.as_bytes().first().copied();
                    let after = tail.get(1..)?.strip_prefix('-')?;
                    let n = run(after, |b| b.is_ascii_alphanumeric() || b == b'-');
                    if matches!(kind, Some(b'a' | b'b' | b'p' | b'r' | b's')) && n >= 10 {
                        return Some((i + 5 + n, HIDDEN.to_string()));
                    }
                    continue;
                }
                let n = run(tail, key_char);
                if n >= min {
                    return Some((i + p.len() + n, HIDDEN.to_string()));
                }
            }
        }
        for (p, min) in PLAIN_KEYS {
            if let Some(tail) = rest.strip_prefix(p) {
                let n = run(tail, |b| b.is_ascii_alphanumeric());
                if n >= min {
                    return Some((i + p.len() + n, HIDDEN.to_string()));
                }
            }
        }
        for p in ["AKIA", "ASIA"] {
            if let Some(tail) = rest.strip_prefix(p) {
                let n = run(tail, |b| b.is_ascii_uppercase() || b.is_ascii_digit());
                if n >= 16 {
                    return Some((i + 4 + n, HIDDEN.to_string()));
                }
            }
        }
        if rest.starts_with("eyJ") {
            let a = run(rest, key_char);
            let r1 = rest[a..].strip_prefix('.')?;
            let b = run(r1, key_char);
            let r2 = r1[b..].strip_prefix('.')?;
            let c = run(r2, key_char);
            if a >= 8 && b >= 4 && c >= 1 {
                return Some((i + a + 1 + b + 1 + c, HIDDEN.to_string()));
            }
        }
        None
    })
}

/// `Bearer <token>` and `Basic <encoded>` as an Authorization header carries them.
fn auth_headers(t: &str) -> String {
    scan(t, |t, i| {
        if !word_start(t, i) {
            return None;
        }
        let rest = t.get(i..)?;
        for word in ["bearer ", "basic "] {
            let head = rest.get(..word.len())?;
            if head.eq_ignore_ascii_case(word) {
                let tail = &rest[word.len()..];
                let n = run(tail, |b| b.is_ascii_alphanumeric() || b"._~+/=-".contains(&b));
                // Plain prose after "basic" is not a token: a token has a digit or a symbol in it,
                // or, where a header carries it, mixes upper and lower case the way encoded text does.
                let body = &tail[..n];
                let mixed = body.bytes().any(|b| b.is_ascii_uppercase()) && body.bytes().any(|b| b.is_ascii_lowercase());
                if n >= 8 && (body.bytes().any(|b| !b.is_ascii_alphabetic()) || (mixed && header_context(t, i))) {
                    return Some((i + word.len() + n, format!("{head}{HIDDEN}")));
                }
            }
        }
        None
    })
}

/// Whether the text before `i` on its line says a header is being written: `Authorization`,
/// `--header` or `-H`.
fn header_context(t: &str, i: usize) -> bool {
    let line = t[..i].rfind('\n').map_or(0, |p| p + 1);
    let head = t[line..i].to_ascii_lowercase();
    head.contains("authorization") || head.contains("--header") || head.split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'')).any(|w| w == "-h")
}

/// The words of the command before byte `i`, back to the nearest `;`, `|`, `&`, `(`, backtick or
/// line break: lower case, without a folder or `.exe`, so `sudo /usr/bin/MySQL -p..` reads as
/// `sudo`, `mysql`. Quotes split words too, so a wrapped command (`bash -c "mysql ..`) still shows
/// its program.
fn words_before(t: &str, i: usize) -> Vec<String> {
    let head = &t[..i];
    let start = head.rfind([';', '|', '&', '(', '`', '\n']).map_or(0, |p| p + 1);
    head[start..]
        .split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '\\'))
        .filter(|w| !w.is_empty())
        .map(|w| {
            let name = w.rsplit('/').next().unwrap_or(w).to_ascii_lowercase();
            name.strip_suffix(".exe").map_or(name.clone(), str::to_string)
        })
        .collect()
}

/// Programs that take their password attached to a short flag (`-pSecret`). That flag is read as a
/// password only for them: elsewhere `-p` words are ordinary (`find -print`, `gcc -pthread`).
fn takes_attached_password(word: &str) -> bool {
    word.starts_with("mysql") || word.starts_with("mariadb") || matches!(word, "7z" | "7za" | "7zr" | "7zz" | "rar" | "unrar" | "sshpass")
}

/// Whether a setting, variable or flag name holds a secret. A flag also hides a value that names
/// a file or folder less often than it hides a secret, so those names are let through.
fn secretish(name: &str, flag: bool) -> bool {
    const PARTS: [&str; 12] = ["token", "secret", "password", "passwd", "passphrase", "credential", "apikey", "api_key", "api-key", "accesskey", "access_key", "access-key"];
    let lower = name.to_ascii_lowercase();
    if ["file", "path", "dir", "folder"].iter().any(|s| lower.ends_with(s)) {
        return false;
    }
    // Limits, tokenizers and "read it from stdin" only sound like secrets (`--max-tokens`, `--password-stdin`).
    const NOT_SECRET: [&str; 14] = ["stdin", "tokens", "tokenizer", "tokenize", "through", "limit", "max", "min", "count", "length", "ttl", "expiry", "expires", "type"];
    if lower.split(['_', '-', '.']).any(|s| NOT_SECRET.contains(&s)) {
        return false;
    }
    if PARTS.iter().any(|p| lower.contains(p)) || lower.contains("privatekey") || lower.contains("private_key") || lower.contains("private-key") {
        return true;
    }
    lower.split(['_', '-', '.']).any(|s| matches!(s, "pwd" | "auth" | "pass") || (!flag && s == "key"))
}

/// The value that begins `rest`: a quoted one (also `\"..\"` inside a quoted command) to its
/// closing quote, or a bare one to the next space, quote or any byte in `stops`. 0 when none.
fn value_span(rest: &str, stops: &[u8]) -> usize {
    let b = rest.as_bytes();
    let skip = usize::from(b.first() == Some(&b'\\') && matches!(b.get(1), Some(b'"' | b'\'')));
    match b.get(skip) {
        Some(q @ (b'"' | b'\'')) => rest[skip + 1..].find(*q as char).map_or(rest.len(), |k| skip + 1 + k + 1),
        _ => run(rest, |c| !(c.is_ascii_whitespace() || matches!(c, b'"' | b'\'' | b'`') || stops.contains(&c))),
    }
}

/// A value that needs no hiding: already hidden, a Stripe key already masked, a variable
/// reference such as `$TOKEN`, `${TOKEN}` or `$(cmd)`, or nothing at all. A `$` inside single
/// quotes is text, not a reference, and `$3cr3t` is not a name, so both are hidden.
fn already(value: &str) -> bool {
    let single = value.trim_start_matches('\\').starts_with('\'');
    let v = value.trim_matches(|c| matches!(c, '"' | '\'' | '\\'));
    let reference = !single && v.strip_prefix('$').and_then(|r| r.bytes().next()).is_some_and(|b| b.is_ascii_alphabetic() || matches!(b, b'_' | b'{' | b'('));
    v.is_empty() || v == HIDDEN || reference || STRIPE_PREFIXES.iter().any(|p| v.strip_prefix(p).is_some_and(|r| r.starts_with("....")))
}

/// `--password hunter2` and `--token abc` (a space before the value; `--token=abc` is the labelled
/// pass), curl's `-u user:password`, sshpass's `-p secret`, and a short password flag with the value
/// attached, `-pS3cret`, for the programs that take one (MySQL and MariaDB clients, 7z, rar, sshpass).
fn secret_flags(t: &str) -> String {
    scan(t, |t, i| {
        let prev = if i == 0 { b' ' } else { t.as_bytes()[i - 1] };
        if !(prev.is_ascii_whitespace() || matches!(prev, b'"' | b'\'' | b'\\' | b'(' | b'`')) {
            return None;
        }
        let rest = t.get(i..)?;
        // curl: `-u user:password` (also `-U`, `--user`, `--proxy-user`; a space, or `=` for the long ones).
        for f in ["--proxy-user", "--user", "-u", "-U"] {
            let Some(after) = rest.strip_prefix(f) else { continue };
            let gap = run(after, |b| b == b' ' || b == b'\t');
            let eq = f.starts_with("--") && after.starts_with('=');
            if (gap == 0 && !eq) || !words_before(t, i).iter().any(|w| w == "curl") {
                continue;
            }
            let at = if eq { 1 } else { gap };
            let value = &after[at..];
            let len = value_span(value, &[]);
            let bare = value[..len].trim_matches(|c| matches!(c, '"' | '\'' | '\\'));
            if bare.split_once(':').is_some_and(|(_, pw)| !pw.is_empty() && !already(pw)) {
                return Some((i + f.len() + at + len, format!("{f}{}{HIDDEN}", &after[..at])));
            }
        }
        // sshpass: `-p secret` straight after the program (only its own options before the value).
        if let Some(after) = rest.strip_prefix("-p") {
            let gap = run(after, |b| b == b' ' || b == b'\t');
            let words = words_before(t, i);
            let own = words.iter().rposition(|w| w == "sshpass").is_some_and(|p| words[p + 1..].iter().all(|w| w.starts_with('-')));
            if gap > 0 && own {
                let value = &after[gap..];
                let len = value_span(value, &[]);
                if len > 0 && !value.starts_with('-') && !already(&value[..len]) {
                    return Some((i + 2 + gap + len, format!("-p{}{HIDDEN}", &after[..gap])));
                }
            }
        }
        if let Some(flag) = rest.strip_prefix("--") {
            let n = run(flag, key_char);
            if n == 0 || !secretish(&flag[..n], true) {
                return None;
            }
            let after = &flag[n..];
            let gap = run(after, |b| b == b' ' || b == b'\t');
            if gap == 0 {
                return None;
            }
            let value = &after[gap..];
            let len = value_span(value, &[]);
            if len == 0 || value.starts_with('-') || already(&value[..len]) {
                return None;
            }
            return Some((i + 2 + n + gap + len, format!("--{}{}{HIDDEN}", &flag[..n], &after[..gap])));
        }
        let tail = rest.strip_prefix("-p")?;
        let len = value_span(tail, &[]);
        let value = &tail[..len];
        let program = words_before(t, i).iter().any(|w| takes_attached_password(w));
        (program && !value.is_empty() && !value.starts_with('-') && !value.starts_with('=') && !already(value)).then(|| (i + 2 + len, format!("-p{HIDDEN}")))
    })
}

/// A header written `Name: value` (a curl `-H` argument, a raw request): `Authorization` and
/// cookies whatever their value, and any other hyphenated name that says it holds a secret
/// (`X-Api-Key`, `PRIVATE-TOKEN`). For `Authorization` the scheme word stays (`token`, `Bearer`).
fn header_values(t: &str) -> String {
    scan(t, |t, i| {
        let prev = if i == 0 { b' ' } else { t.as_bytes()[i - 1] };
        if key_char(prev) {
            return None;
        }
        let rest = t.get(i..)?;
        let n = run(rest, key_char);
        let name = &rest[..n];
        let lower = name.to_ascii_lowercase();
        let auth = matches!(lower.as_str(), "authorization" | "proxy-authorization");
        let header_like = name.contains('-') || matches!(lower.as_str(), "authorization" | "cookie" | "apikey");
        if n < 3 || !header_like || !(auth || matches!(lower.as_str(), "cookie" | "set-cookie") || secretish(name, false)) {
            return None;
        }
        let after = rest[n..].strip_prefix(':')?;
        let gap = run(after, |b| b == b' ' || b == b'\t');
        let value = &after[gap..];
        let len = run(value, |b| !matches!(b, b'"' | b'\'' | b'\\' | b'\n' | b'\r' | b'`'));
        let value = value[..len].trim_end();
        if value.is_empty() || value.contains(HIDDEN) || value.starts_with("//") {
            return None;
        }
        let shown = match (auth, value.split_once(char::is_whitespace)) {
            (true, Some((scheme, _))) => format!("{scheme} {HIDDEN}"),
            _ => HIDDEN.to_string(),
        };
        Some((i + n + 1 + gap + value.len(), format!("{name}:{}{shown}", &after[..gap])))
    })
}

/// A JSON string value whose key says it holds a secret: `"password":"..."`, also written with
/// escaped quotes inside a quoted command (`{\"token\":\"..\"}`).
fn json_values(t: &str) -> String {
    scan(t, |t, i| {
        let rest = t.get(i..)?;
        let q = if rest.starts_with("\\\"") {
            "\\\""
        } else if rest.starts_with('"') {
            "\""
        } else {
            return None;
        };
        let body = &rest[q.len()..];
        let n = run(body, key_char);
        if n == 0 || !secretish(&body[..n], true) {
            return None;
        }
        let after = body[n..].strip_prefix(q)?.trim_start().strip_prefix(':')?.trim_start();
        let value = after.strip_prefix(q)?;
        let end = value.find(q)?;
        if already(&value[..end]) {
            return None;
        }
        let consumed = rest.len() - value.len();
        Some((i + consumed + end, format!("{}{HIDDEN}", &rest[..consumed])))
    })
}

/// `NAME=value` where the name says it holds a secret.
fn labelled_values(t: &str) -> String {
    scan(t, |t, i| {
        if t.as_bytes()[i] != b'=' {
            return None;
        }
        let before = &t.as_bytes()[..i];
        let start = before.iter().rposition(|b| !(b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))).map_or(0, |p| p + 1);
        let name = &t[start..i];
        if name.len() < 2 || !secretish(name, name.starts_with('-')) {
            return None;
        }
        let rest = &t[i + 1..];
        let len = value_span(rest, b"&;,)");
        (len > 0 && !already(&rest[..len])).then(|| (i + 1 + len, format!("={HIDDEN}")))
    })
}

/// A line written as an env file writes it (`NAME=value`, optionally after `export`): its value
/// goes whatever the name says, because such lines are where secrets are pasted.
fn env_lines(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    for (n, line) in t.split('\n').enumerate() {
        if n > 0 {
            out.push('\n');
        }
        out.push_str(&env_line(line));
    }
    out
}

fn env_line(line: &str) -> String {
    let body = line.trim_end_matches('\r');
    let ending = &line[body.len()..];
    let lead = body.len() - body.trim_start().len();
    let rest = &body[lead..];
    let rest_nx = rest.strip_prefix("export ").map_or(rest, str::trim_start);
    let name_len = run(rest_nx, |b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
    let name = &rest_nx[..name_len];
    let Some(raw) = rest_nx[name_len..].strip_prefix('=') else { return line.to_string() };
    let value = raw.trim_end();
    let single = match value.chars().next() {
        Some(q @ ('"' | '\'')) => value.len() >= 2 && value.ends_with(q) && !value[1..value.len() - 1].contains(q),
        Some(_) => !value.contains(char::is_whitespace),
        None => false,
    };
    if name.len() < 2 || !name.starts_with(|c: char| c.is_ascii_uppercase() || c == '_') || !single || already(value) {
        return line.to_string();
    }
    let start = body.len() - raw.len();
    format!("{}{HIDDEN}{}{ending}", &body[..start], &body[start + value.len()..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Base {
        Base { workspace: Some("/home/me/app".into()), cwd: Some("/home/me/app".into()), home: Some("/home/me".into()), temp: vec!["/tmp".into(), "/var/tmp".into()] }
    }

    fn hit(cmd: &str) -> Option<&'static str> {
        check(cmd, &base(), &json!({})).map(|r| r.id)
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
        assert!(check("git push -f", &Base::default(), &s).is_none());
        let s = json!({ OFF_FIELD: ["force-push"] });
        assert!(check("git push -f", &Base::default(), &s).is_none());
        assert_eq!(check("git reset --hard", &Base::default(), &s).map(|r| r.id), Some("discard"));
        assert_eq!(check("git push -f", &Base::default(), &json!({ ASK_FIELD: true, OFF_FIELD: [] })).map(|r| r.name), Some("Force-push to main"));
        let long = "x".repeat(200);
        let r = reason(&long);
        assert!(r.starts_with(&format!("Kolux protected action: {}.", "x".repeat(120))) && !r.contains(&"x".repeat(121)));
        assert_eq!(RULES.len(), 7);
    }

    /// SAFE-013: the acceptance commands, with the workspace at /home/me/app.
    #[test]
    fn safe013_recursive_deletes_outside_unknown_or_piped_ask_inside_and_temp_run() {
        let del = |c: &str| hit(c) == Some("delete");
        for c in [
            "rm -rf /", "rm -rf ~/Documents/old", "rm -rf ..", "rm -rf .", "rm -rf .git", "rm -rf $DIR", "rm -rf \"$DIR\"",
            "cd $HOME && rm -rf build", "cd && rm -rf build", "popd && rm -rf build", "find . -name node_modules | xargs rm -rf",
            "Remove-Item -Recurse -Force ~", "Get-ChildItem . | Remove-Item -Recurse", "rd /s /q C:\\Users\\me\\Documents",
            "rm -rf ~alice/tmp", "rm -r C:build", "rm -rf /tmp/../etc", "cd - && rm -rf build", "rm -rf $(pwd)",
        ] {
            assert!(del(c), "asks: {c}");
        }
        for c in [
            "rm -rf node_modules dist", "rm -rf build/*", "cd packages/web && rm -rf dist", "rm -rf /tmp/scratch", "rd /s /q node_modules",
            "rm -rf ./build/", "cd /tmp && rm -rf cache", "rm file.txt", "rmdir -p a/b", "Remove-Item -Path dist -Recurse -Force", "del /s /q dist\\*.o",
        ] {
            assert!(!del(c), "runs: {c}");
        }
        // No workspace and no cwd: a relative delete asks, a temp one still runs.
        let none = Base { home: Some("/home/me".into()), temp: vec!["/tmp".into()], ..Base::default() };
        assert!(check("rm -rf build", &none, &json!({})).is_some());
        assert!(check("rm -rf /tmp/x", &none, &json!({})).is_none());
        // Windows form: Git Bash drive paths and letter case are read as the same workspace.
        let win = Base { workspace: Some("C:\\Users\\me\\app".into()), cwd: Some("C:\\Users\\me\\app".into()), home: Some("C:\\Users\\me".into()), temp: vec!["C:\\Users\\me\\AppData\\Local\\Temp".into()] };
        let w = |c: &str| check(c, &win, &json!({})).map(|r| r.id) == Some("delete");
        assert!(w("rm -rf /c/Users/me/app/.git") && w("rd /s /q C:\\Users\\me") && w("Remove-Item -Recurse -Force -LiteralPath C:\\Users\\me\\app"));
        assert!(!w("rm -rf /c/users/ME/app/dist") && !w("rd /s /q node_modules") && !w("rm -rf C:\\Users\\me\\AppData\\Local\\Temp\\x"));
    }

    /// SAFE-014: wrapped, chained, nested and encoded commands, and the harmless lookalikes.
    #[test]
    fn safe014_wrapped_chained_nested_and_encoded_commands_still_ask_and_lookalikes_run() {
        use base64::Engine;
        let enc = |c: &str| base64::engine::general_purpose::STANDARD.encode(c.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
        let ta = "terraform apply -auto-approve";
        for (c, id) in [
            ("bash -c \"rm -rf /\"", "delete"), ("echo $(rm -rf /)", "delete"), ("echo `rm -rf /`", "delete"), ("cmd /c rd /s /q C:\\Users", "delete"),
            (&*format!("powershell -ExecutionPolicy Bypass -Command \"{ta}\""), "infra"), (&*format!("powershell -ep bypass -Command {ta}"), "infra"),
            (&*format!("powershell -WindowStyle Hidden -Command \"{ta}\""), "infra"), (&*format!("pwsh -of text -c \"{ta}\""), "infra"),
            (&*format!("powershell -EncodedCommand {}", enc(ta)), "infra"), (&*format!("powershell -nop -e {}", enc(ta)), "infra"), (&*format!("powershell -enc {}", enc(ta)), "infra"),
            (&*format!("powershell -File deploy.ps1; {ta}"), "infra"),
            ("cmd //c rd /s /q C:\\Windows", "delete"), ("rd /s/q C:\\Windows", "delete"), ("del /q/s C:\\Windows\\system32\\x.dll", "delete"),
            ("sudo -u root rm -rf /usr", "delete"), ("sudo -uroot rm -rf /usr", "delete"), ("nice -n 10 rm -rf /usr", "delete"), ("env -u NAME rm -rf /usr", "delete"),
            ("timeout 5 rm -rf /usr", "delete"), (&*format!("timeout 30s {ta}"), "infra"), ("wsl -d Ubuntu -- rm -rf /usr", "delete"), ("eval \"rm -rf /\"", "delete"),
            ("echo $(echo $(echo $(echo $(rm -rf /))))", "delete"), ("( rm -rf / )", "delete"), ("true || { rm -rf /; }", "delete"),
        ] {
            assert_eq!(hit(c), Some(id), "asks: {c}");
        }
        for c in [
            "sudo -u root ls build", "timeout 5 ls", "nice -n 10 echo hi", "powershell -ExecutionPolicy Bypass -Command \"Write-Host hi\"", "rd /s/q build",
            "echo \"rm -rf /\"", "echo 'rm -rf /'", "bash -c \"echo 'rm -rf /'\"", "powershell -File rm.ps1 -rf /", "echo $(echo $(echo $(echo $(echo $(rm -rf /)))))",
        ] {
            assert_eq!(hit(c), None, "runs: {c}");
        }
    }

    /// SAFE-015: the page lists the seven rules by plain name with two examples each, and every
    /// example really trips its own rule (so the page never shows a command that would not ask).
    #[test]
    fn safe015_the_catalog_lists_seven_plain_names_and_each_example_trips_its_own_rule() {
        let names: Vec<&str> = catalog().iter().map(|r| r.name).collect();
        assert_eq!(names, ["Stripe changes", "Force-push to main", "Deleting database tables", "Infrastructure changes", "Production deploys", "Deleting folders outside the workspace", "Throwing away uncommitted work"]);
        for r in catalog() {
            for s in r.samples {
                assert_eq!(hit(s), Some(r.id), "{} example {s}", r.id);
            }
        }
        let v = serde_json::to_value(catalog()).unwrap();
        assert_eq!((v[1]["id"].as_str(), v[1]["samples"][0].as_str()), (Some("force-push"), Some("git push --force origin main")));
    }

    /// SAFE-015 acceptance, through the real hook answer with a stand-in PreToolUse event: the
    /// settings are written exactly as the Safety page writes them.
    #[test]
    fn safe015_switching_force_push_off_and_on_and_the_master_switch_change_the_next_answer() {
        let ev = br#"{"hook_event_name":"PreToolUse","tool_name":"Bash","cwd":"/home/me/app","tool_input":{"command":"git push --force origin main"}}"#;
        let ask = |s: &Value| crate::hooks::reply_body("/claude", ev, s) != "{}";
        // Never saved: the master switch is on and every rule asks.
        assert!(ask(&json!({})));
        // The rule's switch off: the page saves protectedOff holding the id, and the next one runs.
        assert!(!ask(&json!({ OFF_FIELD: ["force-push"] })));
        // Switched back on: the page saves the list without it, and it asks again.
        assert!(ask(&json!({ OFF_FIELD: [] })));
        // Another rule off leaves this one asking.
        assert!(ask(&json!({ OFF_FIELD: ["discard"] })));
        // The master switch off: no protected command asks, whatever the list says.
        assert!(!ask(&json!({ ASK_FIELD: false })));
        assert!(!ask(&json!({ ASK_FIELD: false, OFF_FIELD: [] })));
        assert!(ask(&json!({ ASK_FIELD: true })));
        // A garbled list (hand-edited file) fails closed: the rules stay on.
        assert!(ask(&json!({ OFF_FIELD: "force-push" })));
        assert!(ask(&json!({ OFF_FIELD: [7, null] })));
    }

    /// mask, and a second run over its own answer must change nothing (SAFE-019): every input of
    /// every safe019 test below goes through this, so the whole set is proven twice-safe.
    fn masked(text: &str) -> String {
        let once = mask(text);
        assert_eq!(mask(&once), once, "a second mask changed {text:?}");
        once
    }

    const STRIPE_LIVE: &str = "sk_live_51HabcdEFGH1234567890WXYZ";

    #[test]
    fn safe019_stripe_secret_keys_keep_their_prefix_and_last_four_and_nothing_else() {
        let cmd = format!("curl -u {STRIPE_LIVE}: https://api.stripe.com/v1/charges");
        assert_eq!(masked(&cmd), "curl -u sk_live_....WXYZ: https://api.stripe.com/v1/charges");
        for (raw, shown) in [("sk_test_4eC39HqLyjWDarjtT1zdp7dc", "sk_test_....p7dc"), ("rk_live_51HabcdEFGH1234567890Qrst", "rk_live_....Qrst"), ("rk_test_abcdefgh12345678", "rk_test_....5678"), ("whsec_8f3a9c1d2e4b5a6c7d8e9f0a", "whsec_....9f0a")] {
            assert_eq!(masked(&format!("echo {raw} | tee k")), format!("echo {shown} | tee k"), "{raw}");
        }
        assert!(!masked(&format!("STRIPE_SECRET_KEY={STRIPE_LIVE} node pay.js")).contains("51Habcd"));
        // Too short to be a key, a publishable key, and a name in a path stay as typed.
        assert_eq!(masked("grep -r sk_live_ src"), "grep -r sk_live_ src");
        assert_eq!(masked("echo pk_live_51HabcdEFGH1234567890WXYZ"), "echo pk_live_51HabcdEFGH1234567890WXYZ");
        assert_eq!(masked("cat my_sk_live_51HabcdEFGH1234567890WXYZ.txt"), "cat my_sk_live_51HabcdEFGH1234567890WXYZ.txt");
    }

    #[test]
    fn safe019_a_value_already_masked_passes_the_general_pass_untouched_and_a_second_run_changes_nothing() {
        for already in ["curl -u sk_live_....WXYZ: https://x", "STRIPE_KEY=sk_live_....WXYZ", "export WEBHOOK_SECRET=whsec_....9f0a", "--token sk_test_....p7dc", "API_KEY=[hidden]", "DB_PASSWORD=$DB_PASSWORD"] {
            assert_eq!(masked(already), already);
        }
        for c in [format!("STRIPE_KEY={STRIPE_LIVE}"), "mysql -u root -pS3cretPass".to_string(), "psql postgres://admin:hunter2@db:5432/app".to_string(), "FOO=bar\nTOKEN=abc123".to_string()] {
            let once = masked(&c);
            assert_eq!(masked(&once), once, "{c}");
        }
    }

    /// SAFE-019 acceptance: a short password flag with the value attached, a token flag, and a
    /// connection URL carrying a user and password.
    #[test]
    fn safe019_attached_password_flags_token_flags_and_url_credentials_are_hidden() {
        let m = masked("mysql -u root -pS3cretPass -h db.example.com shop");
        assert_eq!(m, "mysql -u root -p[hidden] -h db.example.com shop");
        assert_eq!(masked("mysqldump -pa shop"), "mysqldump -p[hidden] shop", "a one-letter password to a MySQL client");
        assert_eq!(masked("gh auth login --token ghp_not_a_real_one_but_long_enough_xx"), "gh auth login --token [hidden]");
        assert_eq!(masked("deploy --token abc123def456 --env x"), "deploy --token [hidden] --env x");
        assert_eq!(masked("deploy --token=abc123def456 --env x"), "deploy --token=[hidden] --env x");
        assert_eq!(masked("deploy --password \"two words\" go"), "deploy --password [hidden] go");
        assert_eq!(masked("bash -c \"deploy --password \\\"two words\\\" go\""), "bash -c \"deploy --password [hidden] go\"");
        assert_eq!(masked("psql postgres://admin:hunter2@db.example.com:5432/app -c 'select 1'"), "psql postgres://[hidden]@db.example.com:5432/app -c 'select 1'");
        assert_eq!(masked("redis-cli -u redis://:pw0rd@cache:6379"), "redis-cli -u redis://[hidden]@cache:6379");
        assert_eq!(masked("git clone https://user:glpat-abcdef@gitlab.com/o/r.git"), "git clone https://[hidden]@gitlab.com/o/r.git");
        assert_eq!(masked("amqp://guest:guest@localhost/vhost"), "amqp://[hidden]@localhost/vhost");
        let m = masked(&format!("psql postgres://admin:hunter2@db:5432/app && mysql -pHunter2x && curl --token {STRIPE_LIVE}"));
        assert!(!m.contains("hunter2") && !m.contains("Hunter2x") && !m.contains("51Habcd"), "{m}");
    }

    #[test]
    fn safe019_labelled_secrets_provider_keys_headers_and_env_file_lines_are_hidden() {
        assert_eq!(masked("API_KEY=abc123 node app.js"), "API_KEY=[hidden] node app.js");
        assert_eq!(masked("PGPASSWORD='my pass' psql"), "PGPASSWORD=[hidden] psql");
        assert_eq!(masked("curl 'https://x.test/hook?token=abc123&x=1'"), "curl 'https://x.test/hook?token=[hidden]&x=1'");
        assert_eq!(masked("aws configure set aws_secret_access_key=wJalrXUtnFEMI"), "aws configure set aws_secret_access_key=[hidden]");
        let tail = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
        for key in [format!("sk-ant-api03-{tail}"), format!("sk-proj-{tail}"), format!("xai-{tail}"), format!("AIzaSy{tail}x"), format!("ghp_{tail}abcd"), format!("github_pat_{tail}"), "AKIAIOSFODNN7EXAMPLE".to_string(), "ASIAIOSFODNN7EXAMPLE".to_string(), "xoxb-1234567890-abcdefghij".to_string(), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP".to_string()] {
            assert_eq!(masked(&format!("echo {key} > out")), "echo [hidden] > out", "{key}");
        }
        assert_eq!(masked("curl -H 'Authorization: Bearer abcDEF123.456_xyz' https://x"), "curl -H 'Authorization: Bearer [hidden]' https://x");
        assert_eq!(masked("curl -H \"Authorization: Basic dXNlcjpwYXNz\" https://x"), "curl -H \"Authorization: Basic [hidden]\" https://x");
        let pem = "echo '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----' > id";
        assert_eq!(masked(pem), "echo '[hidden]' > id");
        assert_eq!(masked("echo '-----BEGIN PRIVATE KEY-----\nMIIBOg"), "echo '[hidden]", "a block cut short hides to the end");
        // An env-file style line hides its value whatever the name, and keeps the export and the line ending.
        assert_eq!(masked("cat > .env <<EOF\nDATABASE_HOST=db.internal\r\nexport SESSION_SALT=\"s a l t\"\nEOF"), "cat > .env <<EOF\nDATABASE_HOST=[hidden]\r\nexport SESSION_SALT=[hidden]\nEOF");
    }

    #[test]
    fn safe019_ordinary_commands_and_prose_are_left_exactly_as_typed() {
        for c in [
            "git commit -m \"fix the token bug\"", "ls -p", "ssh -p 2222 host", "docker run -p 8080:80 nginx", "perl -pe 's/a/b/' f", "git push origin main",
            "NODE_ENV=production npm run build", "echo author=bob", "npm run build -- --prefix /usr", "tool --password-file ./pw.txt run", "echo basic configuration", "cat key.pem",
            "curl https://example.com/a@b", "git clone git@github.com:o/r.git", "ssh://git@host/repo", "echo $TOKEN", "TOKEN=$OTHER run", "tool --token --verbose", "rm -rf build", "",
        ] {
            assert_eq!(masked(c), c, "{c}");
        }
        // Non-ASCII text next to a secret never splits a character.
        assert_eq!(masked("echo héllo ünï --token sécrét-é wörld"), "echo héllo ünï --token [hidden] wörld");
        assert_eq!(masked("naïve=ü TOKEN=é"), "naïve=ü TOKEN=[hidden]");
    }

    /// FIX-SOON 1: the attached -pVALUE form belongs to password-taking programs only.
    #[test]
    fn safe019_attached_p_is_hidden_for_password_programs_and_left_alone_for_everything_else() {
        for c in ["find . -name x -print", "find . -perm 644 -path src -prune -printf x", "gcc -pthread -pedantic -pipe main.c", "tar -pxzf backup.tgz", "ls -la -pq", "sort -pfoo f", "cp -pfoo a b"] {
            assert_eq!(masked(c), c, "{c}");
        }
        assert_eq!(masked("7z a -pS3cret out.7z src"), "7z a -p[hidden] out.7z src");
        assert_eq!(masked("sudo mysql -u root -pS3cretPass shop"), "sudo mysql -u root -p[hidden] shop");
        assert_eq!(masked("cd x && mariadb-dump -pab db > out.sql"), "cd x && mariadb-dump -p[hidden] db > out.sql");
        assert_eq!(masked("bash -c \"mysql -e 'select 1' -pHunter2x\""), "bash -c \"mysql -e 'select 1' -p[hidden]\"");
        assert_eq!(masked("/usr/bin/mysqladmin -pHunter2x status"), "/usr/bin/mysqladmin -p[hidden] status");
        // A different command later in the line is not a password program, though an earlier one was.
        assert_eq!(masked("mysql -pHunter2x db; find . -perm 644"), "mysql -p[hidden] db; find . -perm 644");
    }

    /// FIX-SOON 2: limits, tokenizers and "read it from stdin" are not secrets.
    #[test]
    fn safe019_flags_that_only_sound_like_secrets_are_left_as_typed() {
        for c in ["llm --max-tokens 500 go", "llm --tokenizer gpt2 go", "echo x | docker login --password-stdin ghcr.io", "tool --pass-through x run", "tool --token-limit 20 run", "tool --max-token-count 20 run", "MAX_TOKENS=500 node app.js", "tool --tokens 5 run"] {
            assert_eq!(masked(c), c, "{c}");
        }
        assert_eq!(masked("tool --password hunter2 run"), "tool --password [hidden] run", "the real flag still hides");
    }

    /// FIX-SOON 3: Bearer/Basic with a mixed-case word is a token only where a header carries it.
    #[test]
    fn safe019_bearer_and_basic_words_in_prose_stay_and_in_a_header_go() {
        for c in ["git commit -m \"Add Basic HttpClient\"", "echo basic Configuration", "echo Bearer Application", "git commit -m 'Bearer TokenRefresh support'"] {
            assert_eq!(masked(c), c, "{c}");
        }
        assert_eq!(masked("curl -H 'Authorization: Bearer AbcdEfghIj' https://x"), "curl -H 'Authorization: Bearer [hidden]' https://x");
        assert_eq!(masked("curl --header \"Authorization: Basic AbcdEfghIj\" https://x"), "curl --header \"Authorization: Basic [hidden]\" https://x");
        assert_eq!(masked("curl -H 'Authorization:Bearer AbcdEfghIj' https://x"), "curl -H 'Authorization:Bearer [hidden]' https://x");
        // Outside a header a digit still marks a token.
        assert_eq!(masked("echo Bearer abc123def456"), "echo Bearer [hidden]");
    }

    /// FIX-SOON 4: forms of the same secrets that the first pass missed.
    #[test]
    fn safe019_user_pass_pairs_sshpass_colon_headers_json_keys_new_prefixes_and_single_quoted_dollars_are_hidden() {
        assert_eq!(masked("curl -u admin:hunter2 https://api.example.com"), "curl -u [hidden] https://api.example.com");
        assert_eq!(masked("curl --user admin:hunter2 https://api.example.com"), "curl --user [hidden] https://api.example.com");
        assert_eq!(masked("curl -sS -u 'admin:hunter2' https://api.example.com"), "curl -sS -u [hidden] https://api.example.com");
        assert_eq!(masked("sshpass -p secret ssh host"), "sshpass -p [hidden] ssh host");
        assert_eq!(masked("sshpass -p secret ssh -p 2222 host"), "sshpass -p [hidden] ssh -p 2222 host");
        assert_eq!(masked("sshpass -pSecret ssh host"), "sshpass -p[hidden] ssh host");
        assert_eq!(masked("curl -H \"X-Api-Key: v4lue\" https://x"), "curl -H \"X-Api-Key: [hidden]\" https://x");
        assert_eq!(masked("curl -H 'PRIVATE-TOKEN: v4lue' https://x"), "curl -H 'PRIVATE-TOKEN: [hidden]' https://x");
        assert_eq!(masked("curl -H 'Authorization: token v4lue' https://x"), "curl -H 'Authorization: token [hidden]' https://x");
        assert_eq!(masked("curl -H 'Authorization: v4lue' https://x"), "curl -H 'Authorization: [hidden]' https://x");
        assert_eq!(masked("curl -H 'Cookie: sid=abc; theme=dark' https://x"), "curl -H 'Cookie: [hidden]' https://x");
        assert_eq!(masked("curl -d '{\"password\":\"v4lue\"}' https://x"), "curl -d '{\"password\":\"[hidden]\"}' https://x");
        assert_eq!(masked("curl -d '{\"user\": \"bob\", \"api_key\": \"v4lue\"}' https://x"), "curl -d '{\"user\": \"bob\", \"api_key\": \"[hidden]\"}' https://x");
        assert_eq!(masked("bash -c \"curl -d '{\\\"token\\\":\\\"v4lue\\\"}' x\""), "bash -c \"curl -d '{\\\"token\\\":\\\"[hidden]\\\"}' x\"");
        let tail = "a1B2c3D4e5F6g7H8i9J0";
        for key in [format!("glpat-{tail}"), format!("npm_{tail}{tail}abcdefghijklmn"), format!("hf_{tail}{tail}abcdefghij")] {
            assert_eq!(masked(&format!("echo {key} > out")), "echo [hidden] > out", "{key}");
        }
        assert_eq!(masked("PASSWORD='$3cr3t' ./run"), "PASSWORD=[hidden] ./run");
        assert_eq!(masked("export API_TOKEN='$up3r'"), "export API_TOKEN=[hidden]");
        assert_eq!(masked("tool --token '$up3r' go"), "tool --token [hidden] go");
        // A real variable reference (bare or in double quotes) is not a secret; id:gid pairs and header names with no secret in them stay.
        for c in ["PASSWORD=\"$DB_PASS\" ./run", "PASSWORD=${DB_PASS} ./run", "PASSWORD=$(cat pw.txt) ./run", "docker exec -u 1000:1000 c ls", "docker run --user 1000:1000 img", "curl -H 'Accept: application/json' https://x", "curl -H 'Content-Type: text/plain' https://x", "echo \"note: remember the password\"", "curl -d '{\"name\":\"bob\",\"key\":\"abc\"}' https://x", "env npm_config_update_notifier_disabled=true npm i", "python -c 'from huggingface_hub import hf_hub_download_all_the_files_please'"] {
            assert_eq!(masked(c), c, "{c}");
        }
    }
}
