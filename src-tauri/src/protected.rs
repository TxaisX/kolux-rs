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
    hit: fn(&str, &Base) -> bool,
}

pub static RULES: [Rule; 7] = [
    Rule { id: "stripe", name: "Stripe changes", hit: stripe },
    Rule { id: "force-push", name: "Force-push to main", hit: force_push },
    Rule { id: "db-drop", name: "Deleting database tables", hit: db_drop },
    Rule { id: "infra", name: "Infrastructure changes", hit: infra },
    Rule { id: "prod-deploy", name: "Production deploys", hit: prod_deploy },
    Rule { id: "delete", name: "Deleting folders outside the workspace", hit: recursive_delete },
    Rule { id: "discard", name: "Throwing away uncommitted work", hit: discard },
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
}
