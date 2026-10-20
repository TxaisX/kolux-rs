//! T-156-b: the user's own protected rules (SAFE-016), per-project scopes (SAFE-017) and the
//! recent-attempts list (SAFE-018), every kept command masked through `protected::mask` first
//! (SAFE-019). The rules and scopes are read from the settings JSON on every hook event, so a
//! change applies to the next command; the attempts live in memory only and go with the app.
//! SAFE-020: the only answer this module ever produces is the PreToolUse "ask" block.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

/// Settings key: the global custom rules, a list of `Custom`.
pub const RULES_FIELD: &str = "protectedRules";
/// Settings key: per-project scopes, keyed by the project's root folder (see `Scope`).
pub const PROJECTS_FIELD: &str = "protectedProjects";
/// A regular expression has at most this many characters and sees at most `REGEX_SEES` of a command.
pub const MAX_REGEX: usize = 500;
pub const REGEX_SEES: usize = 4096;
/// The attempts list keeps this many, newest first, each command cut to `COMMAND_SHOWN` characters.
pub const ATTEMPTS: usize = 50;
pub const COMMAND_SHOWN: usize = 2000;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    StartsWith,
    Contains,
    Regex,
}

/// One rule of the user's own: how the pattern is read is `kind`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Custom {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub kind: Kind,
    pub pattern: String,
}

impl Custom {
    /// The name Claude's prompt shows: a nameless rule shows its pattern.
    pub fn shown_name(&self) -> &str {
        if self.name.trim().is_empty() {
            &self.pattern
        } else {
            &self.name
        }
    }

    pub fn hits(&self, command: &str) -> bool {
        match self.kind {
            Kind::StartsWith => {
                let want: Vec<String> = self.pattern.split_whitespace().map(str::to_lowercase).collect();
                !want.is_empty() && segments(command).iter().any(|seg| seg.len() >= want.len() && seg[..want.len()] == want[..])
            }
            Kind::Contains => {
                let want = squeeze(&self.pattern);
                !want.is_empty() && squeeze(command).contains(&want)
            }
            Kind::Regex => compile(&self.pattern).is_ok_and(|re| re.is_match(head(command, REGEX_SEES))),
        }
    }
}

/// The command's segments as lists of lowercase words: a starts-with rule reads the program and
/// the first words of each. ponytail: the split is not quote-aware (a `;` inside quotes also
/// splits); protected.rs's segments() is private and a false split only makes a rule ask more.
fn segments(command: &str) -> Vec<Vec<String>> {
    command.replace("&&", "\n").replace("||", "\n").split(['\n', ';', '|']).map(|s| s.split_whitespace().map(str::to_lowercase).collect::<Vec<_>>()).filter(|w| !w.is_empty()).collect()
}

/// Lowercase with runs of whitespace squeezed to one space, for a contains rule.
fn squeeze(s: &str) -> String {
    s.split_whitespace().map(str::to_lowercase).collect::<Vec<_>>().join(" ")
}

/// The first `n` characters of `s`.
fn head(s: &str, n: usize) -> &str {
    s.char_indices().nth(n).map_or(s, |(i, _)| &s[..i])
}

fn compile(pattern: &str) -> Result<regex::Regex, regex::Error> {
    regex::RegexBuilder::new(pattern).case_insensitive(true).size_limit(1 << 20).dfa_size_limit(1 << 20).build()
}

/// Whether a pattern can be saved as a rule of `kind`; `Err` is the sentence the page shows.
pub fn validate(kind: Kind, pattern: &str) -> Result<(), String> {
    if pattern.trim().is_empty() {
        return Err("The pattern is empty.".into());
    }
    if kind != Kind::Regex {
        return Ok(());
    }
    if pattern.chars().count() > MAX_REGEX {
        return Err(format!("A regular expression has at most {MAX_REGEX} characters."));
    }
    if risky(pattern) {
        return Err("This expression could take too long to check: a repeated group that repeats inside, or three overlapping repeats in a row.".into());
    }
    compile(pattern).map(|_| ()).map_err(|e| format!("Not a valid regular expression: {}", e.to_string().lines().last().unwrap_or("").trim()))
}

// SAFE-016's refusals, read off the pattern text: a repeated group with a repeat inside ((a+)+)
// and three unbounded repeats in a row whose atoms can match the same character (.*.*.*.*x,
// a*a*a*a*a*b, [a-z]+[a-m]+[a-c]+$), while x+y+z+ and kubectl.*(delete|drain) pass.
// ponytail: a reading of the text, not of the parsed syntax; an escape the reader does not know
// counts as that one character, and a group counts as overlapping anything.
#[derive(Clone, Debug)]
enum Atom {
    Any,
    Char(char),
    Class { body: String, negated: bool },
    Digit(bool),
    Word(bool),
    Space(bool),
    Group(Vec<Vec<(Atom, bool)>>),
}

impl Atom {
    fn member(&self, c: char) -> bool {
        match self {
            Atom::Any => true,
            Atom::Char(x) => x.eq_ignore_ascii_case(&c),
            Atom::Digit(neg) => c.is_ascii_digit() != *neg,
            Atom::Word(neg) => (c.is_ascii_alphanumeric() || c == '_') != *neg,
            Atom::Space(neg) => c.is_ascii_whitespace() != *neg,
            Atom::Group(_) => true,
            Atom::Class { body, negated } => {
                let chars: Vec<char> = body.chars().collect();
                let mut i = 0;
                let mut inside = false;
                while i < chars.len() {
                    let (atom, used) = match chars[i] {
                        '\\' if i + 1 < chars.len() => (escape(chars[i + 1]), 2),
                        x => (Atom::Char(x), 1),
                    };
                    i += used;
                    if let (Atom::Char(lo), Some('-'), Some(&hi)) = (&atom, chars.get(i), chars.get(i + 1)) {
                        i += 2;
                        let lo = *lo;
                        if (lo..=hi).contains(&c) || (lo.to_ascii_lowercase()..=hi.to_ascii_lowercase()).contains(&c.to_ascii_lowercase()) {
                            inside = true;
                        }
                    } else if atom.member(c) {
                        inside = true;
                    }
                }
                inside != *negated
            }
        }
    }

    fn overlaps(&self, other: &Atom) -> bool {
        (32u8..127).map(char::from).any(|c| self.member(c) && other.member(c))
    }
}

fn escape(c: char) -> Atom {
    match c {
        'd' => Atom::Digit(false),
        'D' => Atom::Digit(true),
        'w' => Atom::Word(false),
        'W' => Atom::Word(true),
        's' => Atom::Space(false),
        'S' => Atom::Space(true),
        x => Atom::Char(x),
    }
}

/// The pattern as alternatives of (atom, repeated without bound) items; `i` starts after a `(`.
fn parse(chars: &[char], i: &mut usize) -> Vec<Vec<(Atom, bool)>> {
    let mut alternatives = vec![Vec::new()];
    while *i < chars.len() {
        let c = chars[*i];
        *i += 1;
        let atom = match c {
            ')' => return alternatives,
            '|' => {
                alternatives.push(Vec::new());
                continue;
            }
            '^' | '$' => continue,
            '.' => Atom::Any,
            '\\' => {
                let e = chars.get(*i).copied().unwrap_or('\\');
                *i += 1;
                match e {
                    'b' | 'B' | 'A' | 'z' => continue,
                    x => escape(x),
                }
            }
            '[' => {
                let start = *i;
                if chars.get(*i) == Some(&'^') {
                    *i += 1;
                }
                let body_start = *i;
                if chars.get(*i) == Some(&']') {
                    *i += 1;
                }
                while *i < chars.len() && chars[*i] != ']' {
                    *i += if chars[*i] == '\\' { 2 } else { 1 };
                }
                let body: String = chars[body_start..(*i).min(chars.len())].iter().collect();
                *i += 1;
                Atom::Class { body, negated: chars.get(start) == Some(&'^') }
            }
            '(' => {
                if chars.get(*i) == Some(&'?') {
                    while *i < chars.len() && chars[*i] != ':' && chars[*i] != ')' {
                        *i += 1;
                    }
                    if chars.get(*i) == Some(&')') {
                        *i += 1;
                        continue;
                    }
                    *i += 1;
                }
                Atom::Group(parse(chars, i))
            }
            x => Atom::Char(x),
        };
        let repeated = match chars.get(*i) {
            Some('*' | '+') => {
                *i += 1;
                true
            }
            Some('?') => {
                *i += 1;
                false
            }
            Some('{') => {
                let close = chars[*i..].iter().position(|&x| x == '}').map(|p| *i + p);
                let body: String = close.map(|e| chars[*i + 1..e].iter().collect()).unwrap_or_default();
                *i = close.map_or(*i, |e| e + 1);
                body.ends_with(',')
            }
            _ => false,
        };
        if chars.get(*i) == Some(&'?') {
            *i += 1;
        }
        alternatives.last_mut().expect("one alternative").push((atom, repeated));
    }
    alternatives
}

fn risky_in(alternatives: &[Vec<(Atom, bool)>]) -> bool {
    alternatives.iter().any(|items| {
        items.iter().any(|(atom, repeated)| match atom {
            Atom::Group(inner) => (*repeated && inner.iter().flatten().any(|(_, r)| *r)) || risky_in(inner),
            _ => false,
        }) || items.windows(3).any(|w| w.iter().all(|(_, r)| *r) && w[0].0.overlaps(&w[1].0) && w[1].0.overlaps(&w[2].0) && w[0].0.overlaps(&w[2].0))
    })
}

pub fn risky(pattern: &str) -> bool {
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;
    risky_in(&parse(&chars, &mut i))
}

/// SAFE-017: one project's scope, keyed in `PROJECTS_FIELD` by the project's root folder. `dirs`
/// are more folders that count as the project (its workspaces folder when it lies elsewhere).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Scope {
    pub off: Vec<String>,
    pub rules: Vec<Custom>,
    pub dirs: Vec<String>,
}

/// Folders compared as text: forward slashes, no trailing slash, lowercase (Windows folders are
/// case-insensitive; ponytail: so are the others here, a false match only widens a scope).
fn norm(path: &str) -> String {
    path.trim().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn under(cwd: &str, root: &str) -> bool {
    !root.is_empty() && (cwd == root || cwd.strip_prefix(root).is_some_and(|rest| rest.starts_with('/')))
}

/// The scope `cwd` falls in: the deepest project root or extra folder that contains it.
pub fn scope_of(settings: &Value, cwd: Option<&str>) -> Option<(String, Scope)> {
    let cwd = norm(cwd?);
    let projects = settings.get(PROJECTS_FIELD)?.as_object()?;
    let mut best: Option<(usize, String, Scope)> = None;
    for (root, v) in projects {
        let scope: Scope = serde_json::from_value(v.clone()).unwrap_or_default();
        let depth = std::iter::once(root.as_str()).chain(scope.dirs.iter().map(String::as_str)).map(norm).filter(|d| under(&cwd, d)).map(|d| d.len()).max();
        if let Some(d) = depth {
            if best.as_ref().is_none_or(|b| d > b.0) {
                best = Some((d, root.clone(), scope));
            }
        }
    }
    best.map(|(_, root, scope)| (root, scope))
}

/// The rules that apply in `cwd`: the built-in ids switched off (everywhere or for the project)
/// and the custom rules in force (the global ones not off for the project, then the project's own).
#[derive(Debug, Default, PartialEq)]
pub struct Working {
    pub off: Vec<String>,
    pub customs: Vec<Custom>,
}

fn customs_in(v: Option<&Value>) -> Vec<Custom> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|r| serde_json::from_value(r.clone()).ok()).collect()).unwrap_or_default()
}

pub fn working(settings: &Value, cwd: Option<&str>) -> Working {
    let mut off: Vec<String> = settings.get(crate::protected::OFF_FIELD).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    let mut customs = customs_in(settings.get(RULES_FIELD));
    if let Some((_, scope)) = scope_of(settings, cwd) {
        customs.retain(|c| !scope.off.contains(&c.id));
        customs.extend(scope.rules);
        off.extend(scope.off);
    }
    Working { off, customs }
}

/// The name of the first rule `command` trips in `cwd`, built-ins first, honouring the master switch.
pub fn check(command: &str, base: &crate::protected::Base, settings: &Value, cwd: Option<&str>) -> Option<String> {
    if settings.get(crate::protected::ASK_FIELD) == Some(&Value::Bool(false)) {
        return None;
    }
    let w = working(settings, cwd);
    let mut merged = settings.clone();
    merged[crate::protected::OFF_FIELD] = json!(w.off);
    if let Some(rule) = crate::protected::check(command, base, &merged) {
        return Some(rule.name.to_string());
    }
    w.customs.iter().find(|c| c.hits(command)).map(|c| c.shown_name().to_string())
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Waiting,
    Allowed,
    Denied,
}

/// SAFE-018: one paused command. `command` is already masked and cut; the session and tool call
/// ids only serve to settle the outcome and never leave the process.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub time: u64,
    pub worktree: String,
    pub command: String,
    pub rule: String,
    pub outcome: Outcome,
    #[serde(skip)]
    session: String,
    #[serde(skip)]
    call: String,
}

/// The list, newest first, at most `ATTEMPTS` long.
#[derive(Debug, Default)]
pub struct Attempts(VecDeque<Attempt>);

impl Attempts {
    /// A command was paused: the raw text is masked before anything keeps it, and an earlier
    /// attempt of the same session still waiting is taken as refused.
    pub fn paused(&mut self, session: &str, call: &str, worktree: &str, raw: &str, rule: &str, time: u64) {
        self.turn_ended(session);
        let masked = crate::protected::mask(raw);
        let command = head(&masked, COMMAND_SHOWN).to_string();
        self.0.push_front(Attempt { time, worktree: worktree.into(), command, rule: rule.into(), outcome: Outcome::Waiting, session: session.into(), call: call.into() });
        self.0.truncate(ATTEMPTS);
    }

    /// The tool call ran (or failed while running): the attempt was allowed.
    pub fn ended(&mut self, session: &str, call: &str) {
        if let Some(a) = self.0.iter_mut().find(|a| a.outcome == Outcome::Waiting && a.session == session && a.call == call) {
            a.outcome = Outcome::Allowed;
        }
    }

    /// The turn ended, a new prompt came or the session ended: what still waited was refused.
    pub fn turn_ended(&mut self, session: &str) {
        for a in self.0.iter_mut().filter(|a| a.outcome == Outcome::Waiting && a.session == session) {
            a.outcome = Outcome::Denied;
        }
    }

    pub fn list(&self) -> Vec<Attempt> {
        self.0.iter().cloned().collect()
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }
}

static STORE: LazyLock<Mutex<Attempts>> = LazyLock::new(Mutex::default);

fn with_store<T>(f: impl FnOnce(&mut Attempts) -> T) -> T {
    f(&mut STORE.lock().unwrap_or_else(|e| e.into_inner()))
}

/// What the hook prints back for a Claude event, or None for no opinion (`{}`): the PreToolUse
/// ask block when a Bash or PowerShell command trips a rule in force for its folder. Along the
/// way the attempts list is kept: paused on the ask, allowed when the same tool call ends, refused
/// when the turn, the prompt or the session moves on.
pub fn listen(path: &str, body: &[u8], settings: &Value) -> Option<String> {
    if path != "/claude" {
        return None;
    }
    let event: Value = serde_json::from_slice(body).ok()?;
    let field = |k: &str| event.get(k).and_then(Value::as_str);
    let session = field("session_id").unwrap_or("");
    match field("hook_event_name")? {
        "PreToolUse" => {
            if !matches!(field("tool_name")?, "Bash" | "PowerShell") {
                return None;
            }
            let command = event.get("tool_input")?.get("command")?.as_str()?;
            let cwd = field("cwd");
            let rule = check(command, &crate::protected::Base::from_env(cwd), settings, cwd)?;
            with_store(|s| s.paused(session, field("tool_use_id").unwrap_or(""), cwd.unwrap_or(""), command, &rule, crate::automations::now_ms()));
            Some(json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": crate::protected::reason(&rule) } }).to_string())
        }
        "PostToolUse" | "PostToolUseFailure" => {
            if let Some(call) = field("tool_use_id") {
                with_store(|s| s.ended(session, call));
            }
            None
        }
        "Stop" | "UserPromptSubmit" | "SessionEnd" => {
            with_store(|s| s.turn_ended(session));
            None
        }
        _ => None,
    }
}

/// Whether the Safety page may save `pattern` as a rule of `kind`; `Err` is the sentence to show.
#[tauri::command]
pub fn protected_rule_check(kind: Kind, pattern: String) -> Result<(), String> {
    validate(kind, &pattern)
}

/// The recent attempts, newest first, every command masked.
#[tauri::command]
pub fn protected_attempts() -> Vec<Attempt> {
    with_store(|s| s.list())
}

#[tauri::command]
pub fn protected_attempts_clear() {
    with_store(Attempts::clear)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(kind: Kind, pattern: &str) -> Custom {
        Custom { id: pattern.into(), name: String::new(), kind, pattern: pattern.into() }
    }

    #[test]
    fn t156b_a_starts_with_rule_reads_the_program_and_first_words_of_each_segment() {
        let r = rule(Kind::StartsWith, "Kubectl delete");
        assert!(r.hits("kubectl delete pod x"));
        assert!(r.hits("KUBECTL   DELETE ns"));
        assert!(r.hits("echo hi && kubectl delete pod"));
        assert!(!r.hits("echo kubectl delete"));
        assert!(!r.hits("kubectl get pods"));
        assert!(!rule(Kind::StartsWith, "   ").hits("anything"));
    }

    #[test]
    fn t156b_a_contains_rule_ignores_case_and_squeezes_whitespace() {
        let r = rule(Kind::Contains, "DROP   table");
        assert!(r.hits("psql -c \"drop\ttable users\""));
        assert!(!r.hits("psql -c \"drop column\""));
    }

    #[test]
    fn t156b_a_regex_rule_is_case_insensitive_and_sees_the_first_4096_characters() {
        let r = rule(Kind::Regex, "git push.*--force");
        assert!(r.hits("GIT PUSH origin main --force"));
        assert!(!r.hits("git push origin main"));
        let r = rule(Kind::Regex, "danger");
        assert!(r.hits(&format!("danger{}", "x".repeat(5000))));
        assert!(!r.hits(&format!("{}danger", "x".repeat(5000))));
        assert!(!rule(Kind::Regex, "(").hits("("), "an expression that does not compile never asks");
    }

    #[test]
    fn t156b_validate_refuses_what_safe_016_names_and_allows_the_rest() {
        for bad in ["", "  ", "(", "(a+)+", ".*.*.*.*x", "a*a*a*a*a*b", "[a-z]+[a-m]+[a-c]+$", "(?:\\d+)*", &"a".repeat(501)] {
            assert!(validate(Kind::Regex, bad).is_err(), "{bad:?} must be refused");
        }
        for good in ["x+y+z+", "kubectl.*(delete|drain)", "git push.*--force", "a{1,3}b{2}c", "(ab)+", "\\d+\\s+\\w+", "[0-9]+[a-f]+[g-z]+"] {
            assert_eq!(validate(Kind::Regex, good), Ok(()), "{good:?} must pass");
        }
        assert!(validate(Kind::StartsWith, "").is_err());
        assert_eq!(validate(Kind::Contains, "(a+)+"), Ok(()), "only expressions are checked for repeats");
        assert!(validate(Kind::Regex, "(").unwrap_err().starts_with("Not a valid regular expression"));
    }

    fn settings() -> Value {
        json!({
            "protectedOff": ["stripe"],
            "protectedRules": [
                { "id": "g1", "name": "Pod deletes", "kind": "starts-with", "pattern": "kubectl delete" },
                { "id": "g2", "kind": "contains", "pattern": "flush all" }
            ],
            "protectedProjects": {
                "G:\\Dev\\shop": { "off": ["g1", "force-push"], "rules": [{ "id": "p1", "name": "Migrations", "kind": "regex", "pattern": "^prisma migrate" }], "dirs": ["G:/Dev/shop-lanes"] },
                "G:/Dev/shop/vendor": { "off": [], "rules": [] }
            }
        })
    }

    #[test]
    fn t156b_scopes_join_the_built_in_off_lists_and_the_custom_rules_per_folder() {
        let s = settings();
        let w = working(&s, Some("G:\\Dev\\other"));
        assert_eq!(w.off, vec!["stripe"]);
        assert_eq!(w.customs.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["g1", "g2"]);
        let w = working(&s, Some("G:/Dev/shop/src"));
        assert_eq!(w.off, vec!["stripe", "g1", "force-push"]);
        assert_eq!(w.customs.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["g2", "p1"], "the global rule off here is gone, the project's own is in");
        let w = working(&s, Some("g:/dev/shop-lanes/hooks"));
        assert_eq!(w.customs.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["g2", "p1"], "an extra folder counts as the project");
        assert_eq!(scope_of(&s, Some("G:/Dev/shop/vendor/x")).map(|(r, _)| r).as_deref(), Some("G:/Dev/shop/vendor"), "the deepest root wins");
        assert_eq!(scope_of(&s, Some("G:/Dev/shopping")), None, "a folder that only shares a prefix is outside");
        assert_eq!(working(&s, None).customs.len(), 2);
    }

    #[test]
    fn t156b_check_runs_built_ins_first_then_the_customs_in_force_and_a_nameless_rule_shows_its_pattern() {
        let s = settings();
        let base = crate::protected::Base::default();
        assert_eq!(check("git push --force origin main", &base, &s, Some("G:/Dev/other")).as_deref(), Some("Force-push to main"));
        assert_eq!(check("git push --force origin main", &base, &s, Some("G:/Dev/shop")), None, "off for this project");
        assert_eq!(check("stripe customers delete cus_1", &base, &s, Some("G:/Dev/other")), None, "off everywhere");
        assert_eq!(check("kubectl delete pod", &base, &s, Some("G:/Dev/other")).as_deref(), Some("Pod deletes"));
        assert_eq!(check("kubectl delete pod", &base, &s, Some("G:/Dev/shop")), None);
        assert_eq!(check("redis-cli FLUSH  ALL", &base, &s, Some("G:/Dev/shop")).as_deref(), Some("flush all"));
        assert_eq!(check("prisma migrate reset", &base, &s, Some("G:/Dev/shop")).as_deref(), Some("Migrations"));
        assert_eq!(check("prisma migrate reset", &base, &s, Some("G:/Dev/other")), None);
        let mut off = s.clone();
        off["protectedAsk"] = json!(false);
        assert_eq!(check("kubectl delete pod", &base, &off, Some("G:/Dev/other")), None, "the master switch covers custom rules too");
    }

    #[test]
    fn t156b_attempts_are_masked_newest_first_capped_and_settled_by_what_follows() {
        let mut a = Attempts::default();
        a.paused("s1", "c1", "G:/w", "stripe refunds create --api-key sk_live_abc123def456xyz9 --password hunter2", "Stripe changes", 1);
        let kept = &a.list()[0].command;
        assert!(kept.starts_with("stripe refunds create --api-key sk_live_"), "{kept}");
        assert!(!kept.contains("abc123def456") && !kept.contains("hunter2"), "{kept}");
        assert!(kept.contains(crate::protected::HIDDEN), "{kept}");
        a.paused("s1", "c2", "G:/w", "git push --force", "Force-push to main", 2);
        let l = a.list();
        assert_eq!((l[0].time, l[0].outcome, l[1].outcome), (2, Outcome::Waiting, Outcome::Denied), "a newer attempt from the same session refuses the older one");
        a.paused("s2", "c9", "G:/v", "rm -rf ~", "Deleting", 3);
        a.ended("s1", "c2");
        a.ended("s2", "nope");
        let l = a.list();
        assert_eq!((l[1].outcome, l[0].outcome), (Outcome::Allowed, Outcome::Waiting));
        a.turn_ended("s2");
        assert_eq!(a.list()[0].outcome, Outcome::Denied);
        for i in 0..60 {
            a.paused("s3", &i.to_string(), "", &"x".repeat(3000), "r", 10 + i);
        }
        let l = a.list();
        assert_eq!(l.len(), ATTEMPTS);
        assert_eq!((l[0].time, l[0].command.len()), (69, COMMAND_SHOWN));
        a.clear();
        assert!(a.list().is_empty());
    }

    #[test]
    fn t156b_listen_asks_once_for_a_custom_rule_and_keeps_the_attempt() {
        let s = settings();
        let pre = |tool: &str, cmd: &str| json!({ "hook_event_name": "PreToolUse", "session_id": "t156b-listen", "tool_use_id": "tu1", "cwd": "G:/Dev/t156b", "tool_name": tool, "tool_input": { "command": cmd } }).to_string();
        assert_eq!(listen("/codex", pre("Bash", "kubectl delete pod").as_bytes(), &s), None);
        assert_eq!(listen("/claude", pre("Write", "kubectl delete pod").as_bytes(), &s), None);
        assert_eq!(listen("/claude", pre("Bash", "kubectl get pods").as_bytes(), &s), None);
        let ask = listen("/claude", pre("Bash", "kubectl delete pod --token sk_live_1234567890abcd").as_bytes(), &s).expect("asks");
        assert!(ask.contains("\"permissionDecision\":\"ask\"") && ask.contains("Pod deletes"), "{ask}");
        let mine = |l: Vec<Attempt>| l.into_iter().filter(|a| a.worktree == "G:/Dev/t156b").collect::<Vec<_>>();
        let l = mine(protected_attempts());
        assert_eq!((l.len(), l[0].outcome, l[0].rule.as_str()), (1, Outcome::Waiting, "Pod deletes"));
        assert!(!l[0].command.contains("1234567890abcd"), "{}", l[0].command);
        let post = json!({ "hook_event_name": "PostToolUse", "session_id": "t156b-listen", "tool_use_id": "tu1" }).to_string();
        assert_eq!(listen("/claude", post.as_bytes(), &s), None, "never more than the ask");
        assert_eq!(mine(protected_attempts())[0].outcome, Outcome::Allowed);
    }
}
