//! ORCH-042 (T-255): Agent Teams teammates as real side-by-side panes, Kolux's side of it.
//!
//! Claude Code's public agent-teams page (code.claude.com/docs/en/agent-teams) documents split-pane
//! mode only through tmux or iTerm2's `it2` command; it documents no way for a host terminal to
//! receive the teammate pane requests itself. So this module is the host-neutral half, ready for
//! the day such a path exists: it reads one request written in tmux's public command language
//! (man.openbsd.org/tmux.1: split-window, send-keys, display-message, list-panes, kill-pane,
//! respawn-pane, `-V`), decides where a teammate pane goes (the first to the right of the leader,
//! later ones stacked downward in that column), keeps the team's panes so the leader's exit clears
//! the whole team, answers format queries with unknown fields empty, and writes the pane open and
//! close as the same `cli-workspace` events `terminal split` and `terminal close` already send.
//! Nothing here installs a tmux stand-in or sets tmux's variables: T-255 stays open for that.
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

/// The window's pane ceiling per workspace (the grid's own limit), leader included.
pub const MAX_PANES: usize = 12;
/// What a version check is answered with (coordinator default; see the after-list row).
pub const VERSION_LINE: &str = "tmux 3.4";

/// A pane size in tmux's `-l` form: cells, or a percentage of the space (`70%`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Size {
    Cells(u32),
    Percent(u8),
}

/// One `split-window` request.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Split {
    pub target: Option<String>,
    /// `-h`: side by side. Without it tmux splits one above the other (`-v`, its default).
    pub side_by_side: bool,
    pub size: Option<Size>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    /// `-P`: print the new pane's details, in `-F`'s format when given.
    pub print: bool,
    pub format: Option<String>,
    /// The shell command and its arguments (tmux joins them with spaces).
    pub command: Vec<String>,
}

/// One request read from tmux's command language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Request {
    Version,
    Split(Split),
    SendKeys { target: Option<String>, literal: bool, keys: Vec<String> },
    /// `display-message -p`: the expanded format printed to standard output.
    Display { target: Option<String>, format: String },
    ListPanes { format: Option<String> },
    Kill { target: Option<String> },
    Respawn { target: Option<String> },
    /// A command tmux has that Kolux does not answer.
    Other(String),
}

/// Flags that take a value, per command, as tmux's manual lists them.
fn value_flags(cmd: &str) -> Option<(&'static str, &'static str)> {
    // (flags with a value, flags without)
    Some(match cmd {
        "split-window" => ("BceFlpt", "bdEfhIkPvWZ"),
        "send-keys" => ("cNt", "FHKlMRX"),
        "display-message" => ("cdt", "aIlNpv"),
        "list-panes" => ("FfOt", "ars"),
        "kill-pane" => ("ft", "a"),
        "respawn-pane" => ("cet", "Ek"),
        _ => return None,
    })
}

fn canonical(cmd: &str) -> &str {
    match cmd {
        "splitw" => "split-window",
        "send" => "send-keys",
        "display" => "display-message",
        "lsp" => "list-panes",
        "killp" => "kill-pane",
        "respawnp" => "respawn-pane",
        other => other,
    }
}

type Flags = BTreeMap<char, Vec<String>>;

/// getopt-style: `-dhP`, `-l30%` and `-l 30%` all read; `--` or the first plain word ends the flags.
fn flags(cmd: &str, args: &[String]) -> Result<(Flags, Vec<String>), String> {
    let (with, without) = value_flags(cmd).ok_or_else(|| format!("{cmd} is not answered"))?;
    let mut out = Flags::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            i += 1;
            break;
        }
        if !a.starts_with('-') || a.len() < 2 {
            break;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut j = 0;
        while j < chars.len() {
            let c = chars[j];
            if with.contains(c) {
                let rest: String = chars[j + 1..].iter().collect();
                let v = if !rest.is_empty() {
                    rest
                } else {
                    i += 1;
                    args.get(i).cloned().ok_or_else(|| format!("{cmd}: -{c} needs a value"))?
                };
                out.entry(c).or_default().push(v);
                break;
            } else if without.contains(c) {
                out.entry(c).or_default().push(String::new());
                j += 1;
            } else {
                return Err(format!("{cmd}: unknown flag -{c}"));
            }
        }
        i += 1;
    }
    Ok((out, args[i.min(args.len())..].to_vec()))
}

fn size(v: &str) -> Result<Size, String> {
    let bad = || format!("size {v} is not a number of cells or a percentage");
    match v.strip_suffix('%') {
        Some(p) => p.parse::<u8>().ok().filter(|n| (1..=100).contains(n)).map(Size::Percent).ok_or_else(bad),
        None => v.parse::<u32>().ok().filter(|n| *n > 0).map(Size::Cells).ok_or_else(bad),
    }
}

/// Reads one tmux invocation's arguments (without the program name). tmux's own leading options
/// (`-L name`, `-S path`, `-f file`, `-T features`, `-2CDlNuv`) are skipped; `-V` is a version check.
pub fn parse(argv: &[String]) -> Result<Request, String> {
    let mut i = 0;
    while let Some(a) = argv.get(i) {
        match a.as_str() {
            "-V" => return Ok(Request::Version),
            "-L" | "-S" | "-f" | "-T" | "-c" => i += 2,
            s if s.starts_with('-') && s.len() > 1 && s[1..].chars().all(|c| "2CDlNuv".contains(c)) => i += 1,
            _ => break,
        }
    }
    let cmd = canonical(argv.get(i).ok_or("no command given")?);
    let rest = &argv[i + 1..];
    if value_flags(cmd).is_none() {
        return Ok(Request::Other(cmd.to_string()));
    }
    let (f, words) = flags(cmd, rest)?;
    let one = |c: char| f.get(&c).and_then(|v| v.last().cloned());
    let has = |c: char| f.contains_key(&c);
    Ok(match cmd {
        "split-window" => {
            let size = match (one('l'), one('p')) {
                (Some(l), _) => Some(size(&l)?),
                (None, Some(p)) => Some(size(&format!("{p}%"))?),
                _ => None,
            };
            let env = f
                .get(&'e')
                .map(|v| v.iter().filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string()))).collect())
                .unwrap_or_default();
            Request::Split(Split { target: one('t'), side_by_side: has('h'), size, cwd: one('c'), env, print: has('P'), format: one('F'), command: words })
        }
        "send-keys" => Request::SendKeys { target: one('t'), literal: has('l'), keys: words },
        "display-message" if has('p') => Request::Display { target: one('t'), format: words.join(" ") },
        "display-message" => Request::Other("display-message without -p".into()),
        "list-panes" => Request::ListPanes { format: one('F') },
        "kill-pane" => Request::Kill { target: one('t') },
        _ => Request::Respawn { target: one('t') },
    })
}

/// Expands tmux's `#{name}` format variables (and the `#D #P #S #I` short forms, `##` for `#`).
/// A field Kolux does not know comes back empty (ORCH-042).
pub fn expand(fmt: &str, vars: &BTreeMap<&str, String>) -> String {
    let get = |k: &str| vars.get(k).cloned().unwrap_or_default();
    let mut out = String::new();
    let mut it = fmt.chars().peekable();
    while let Some(c) = it.next() {
        if c != '#' {
            out.push(c);
            continue;
        }
        match it.peek().copied() {
            Some('{') => {
                it.next();
                let name: String = it.by_ref().take_while(|&c| c != '}').collect();
                out.push_str(&get(&name));
            }
            Some('#') => {
                it.next();
                out.push('#');
            }
            Some(a @ ('D' | 'P' | 'S' | 'I')) => {
                it.next();
                out.push_str(&get(match a {
                    'D' => "pane_id",
                    'P' => "pane_index",
                    'S' => "session_name",
                    _ => "window_index",
                }));
            }
            _ => out.push('#'),
        }
    }
    out
}

/// Which side of the source pane a new pane opens on (the grid's own two split directions).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dir {
    Right,
    Down,
}

impl Dir {
    pub fn word(self) -> &'static str {
        match self {
            Dir::Right => "right",
            Dir::Down => "down",
        }
    }
}

/// Where the next teammate pane opens: split `from` (a terminal handle) towards `dir`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    pub from: String,
    pub dir: Dir,
}

/// One pane of a team: its Kolux terminal handle and the tmux-style pane id it answers to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub handle: String,
    pub pane: String,
}

/// A key typed into a teammate's pane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Key {
    Text(String),
    Enter,
}

/// What Kolux does with one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Print this to the caller's standard output.
    Answer(String),
    /// Open a teammate pane here, running `command` (none: a shell); `print` is the `-P` format.
    Open { placement: Placement, command: Option<String>, cwd: Option<String>, print: Option<String> },
    /// Type these keys into a pane.
    Type { handle: String, keys: Vec<Key> },
    /// Close these panes.
    Close(Vec<String>),
    /// Turned away, with the reason printed to the caller's standard error.
    Refuse(String),
}

/// A leader and its teammate panes, in the order they opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Team {
    pub leader: Member,
    pub mates: Vec<Member>,
    pub cwd: Option<String>,
    next: u32,
}

impl Team {
    pub fn new(leader: &str, cwd: Option<String>) -> Team {
        Team { leader: Member { handle: leader.into(), pane: "%0".into() }, mates: vec![], cwd, next: 1 }
    }

    /// ORCH-042: the first teammate opens to the right of the leader; every later one stacks
    /// downward under the newest teammate, so the team fills one column beside the leader.
    pub fn place(&self) -> Placement {
        match self.mates.last() {
            None => Placement { from: self.leader.handle.clone(), dir: Dir::Right },
            Some(m) => Placement { from: m.handle.clone(), dir: Dir::Down },
        }
    }

    /// The window opened a teammate pane: it joins the team and gets the next pane id.
    pub fn joined(&mut self, handle: &str) -> Member {
        let m = Member { handle: handle.into(), pane: format!("%{}", self.next) };
        self.next += 1;
        self.mates.push(m.clone());
        m
    }

    fn members(&self) -> impl Iterator<Item = &Member> {
        std::iter::once(&self.leader).chain(self.mates.iter())
    }

    /// A tmux target: a `%n` pane id or a Kolux handle; none means the caller's own pane, or the
    /// leader when the caller is not one of the team.
    fn find(&self, target: Option<&str>, caller: Option<&str>) -> Option<&Member> {
        let want = target.or(caller);
        match want {
            None => Some(&self.leader),
            Some(t) => self.members().find(|m| m.pane == t || m.handle == t).or_else(|| (target.is_none()).then_some(&self.leader)),
        }
    }

    pub fn vars(&self, m: &Member) -> BTreeMap<&'static str, String> {
        let index = self.members().position(|x| x == m).unwrap_or(0);
        BTreeMap::from([
            ("pane_id", m.pane.clone()),
            ("pane_index", index.to_string()),
            ("session_name", "kolux".to_string()),
            ("window_index", "0".to_string()),
            ("pane_current_path", self.cwd.clone().unwrap_or_default()),
        ])
    }

    /// Decides one request from a pane of this team (`caller` is its pane id or handle, if known).
    pub fn decide(&self, caller: Option<&str>, req: &Request) -> Action {
        let gone = |t: &Option<String>| Action::Refuse(format!("can't find pane: {}", t.as_deref().unwrap_or("")));
        match req {
            Request::Version => Action::Answer(VERSION_LINE.into()),
            Request::Split(s) => {
                if 1 + self.mates.len() >= MAX_PANES {
                    return Action::Refuse(format!("a workspace holds up to {MAX_PANES} panes"));
                }
                if s.target.is_some() && self.find(s.target.as_deref(), caller).is_none() {
                    return gone(&s.target);
                }
                let command = (!s.command.is_empty()).then(|| s.command.join(" "));
                let print = s.print.then(|| s.format.clone().unwrap_or_else(|| "#{session_name}:#{window_index}.#{pane_index}".into()));
                Action::Open { placement: self.place(), command, cwd: s.cwd.clone().or_else(|| self.cwd.clone()), print }
            }
            Request::SendKeys { target, literal, keys } => match self.find(target.as_deref(), caller) {
                None => gone(target),
                Some(m) => Action::Type { handle: m.handle.clone(), keys: typed(keys, *literal) },
            },
            Request::Display { target, format } => match self.find(target.as_deref(), caller) {
                None => gone(target),
                Some(m) => Action::Answer(expand(format, &self.vars(m))),
            },
            Request::ListPanes { format } => {
                let f = format.as_deref().unwrap_or("#{pane_index}: #{pane_id}");
                Action::Answer(self.members().map(|m| expand(f, &self.vars(m))).collect::<Vec<_>>().join("\n"))
            }
            Request::Kill { target } => match self.find(target.as_deref(), caller) {
                None => gone(target),
                Some(m) if *m == self.leader => Action::Refuse("the leader's pane is closed only from the window".into()),
                Some(m) => Action::Close(vec![m.handle.clone()]),
            },
            Request::Respawn { target } => match self.find(target.as_deref(), caller) {
                Some(m) if *m == self.leader => Action::Refuse("a teammate cannot respawn the leader pane".into()),
                _ => Action::Refuse("respawn-pane is not answered".into()),
            },
            Request::Other(name) => Action::Refuse(format!("{name} is not answered")),
        }
    }
}

/// send-keys: `-l` types every word as it is; otherwise `Enter`, `C-m` and `KPEnter` press Enter,
/// `Space` types a space and every other word is typed as text.
fn typed(keys: &[String], literal: bool) -> Vec<Key> {
    let mut out: Vec<Key> = vec![];
    for k in keys {
        let key = match k.as_str() {
            "Enter" | "C-m" | "KPEnter" if !literal => Key::Enter,
            "Space" if !literal => Key::Text(" ".into()),
            s => Key::Text(s.into()),
        };
        match (out.last_mut(), key) {
            (Some(Key::Text(prev)), Key::Text(t)) => prev.push_str(&t),
            (_, k) => out.push(k),
        }
    }
    out
}

/// What a terminal's exit means for the teams.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ended {
    /// The leader exited: close every one of these teammate panes; the team is gone.
    Leader(Vec<String>),
    /// A teammate exited: it leaves its leader's team; the other panes stay.
    Mate { leader: String },
    /// Not part of any team.
    Unknown,
}

/// Every live team, by leader handle.
#[derive(Debug, Default)]
pub struct Teams {
    teams: BTreeMap<String, Team>,
}

impl Teams {
    /// The leader's team, made on its first teammate request.
    pub fn lead(&mut self, leader: &str, cwd: Option<String>) -> &mut Team {
        self.teams.entry(leader.to_string()).or_insert_with(|| Team::new(leader, cwd))
    }

    /// The team a terminal belongs to, as leader or teammate.
    pub fn team_of(&self, handle: &str) -> Option<&Team> {
        self.teams.values().find(|t| t.leader.handle == handle || t.mates.iter().any(|m| m.handle == handle))
    }

    /// ORCH-042: when the leader's terminal exits, the whole team is cleared.
    pub fn ended(&mut self, handle: &str) -> Ended {
        if let Some(t) = self.teams.remove(handle) {
            return Ended::Leader(t.mates.into_iter().map(|m| m.handle).collect());
        }
        for t in self.teams.values_mut() {
            if let Some(i) = t.mates.iter().position(|m| m.handle == handle) {
                t.mates.remove(i);
                return Ended::Mate { leader: t.leader.handle.clone() };
            }
        }
        Ended::Unknown
    }
}

/// Split-pane or in-process: teammates get panes only when a usable absolute path to Claude is
/// known; otherwise they run in-process inside the leader (ORCH-042).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Panes,
    InProcess,
}

pub fn mode(claude: Option<&Path>) -> Mode {
    match claude {
        Some(p) if p.is_absolute() && p.is_file() => Mode::Panes,
        _ => Mode::InProcess,
    }
}

/// The saved Agent Teams mode preference (T-191-b's key and values, shared with the picker).
pub const TEAMS_MODE_KEY: &str = "agentTeamsMode";

/// The mode a launch's teammates get from the saved preference: none when it is off (or unknown),
/// panes only for "native" on a host that supports them with a usable Claude path, otherwise
/// in-process (Windows and WSL always run them in-process, as the picker already says).
pub fn saved_mode(settings: &Value, windows_or_wsl: bool, claude: Option<&Path>) -> Option<Mode> {
    match settings.get(TEAMS_MODE_KEY).and_then(Value::as_str) {
        Some("native") if !windows_or_wsl => Some(mode(claude)),
        Some("native") | Some("in-process") => Some(Mode::InProcess),
        _ => None,
    }
}

/// The pane open as the window already takes it from `terminal split` (CLI-026 shape).
pub fn split_event(p: &Placement, command: Option<&str>, ask: &str) -> Value {
    json!({ "kind": "terminal-split", "handle": p.from, "dir": p.dir.word(), "command": command, "ask": ask })
}

/// The pane close as the window already takes it from `terminal close`.
pub fn close_event(handles: &[String]) -> Value {
    json!({ "kind": "terminal-close", "handles": handles })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    fn team(mates: usize) -> Team {
        let mut t = Team::new("t1", Some("C:/w".into()));
        for i in 0..mates {
            t.joined(&format!("m{}", i + 1));
        }
        t
    }

    #[test]
    fn orch042_a_split_request_reads_side_size_target_print_and_command() {
        let r = parse(&argv(&["split-window", "-h", "-l", "70%", "-t", "%0", "-P", "-F", "#{pane_id}", "-c", "C:/w", "-e", "A=1", "claude", "--x"])).unwrap();
        assert_eq!(
            r,
            Request::Split(Split {
                target: Some("%0".into()),
                side_by_side: true,
                size: Some(Size::Percent(70)),
                cwd: Some("C:/w".into()),
                env: vec![("A".into(), "1".into())],
                print: true,
                format: Some("#{pane_id}".into()),
                command: argv(&["claude", "--x"]),
            })
        );
    }

    #[test]
    fn orch042_bundled_flags_attached_values_aliases_and_the_default_vertical_split() {
        let Request::Split(s) = parse(&argv(&["splitw", "-dPl30", "-t%1", "--", "-not-a-flag"])).unwrap() else { panic!() };
        assert!(!s.side_by_side, "tmux splits one above the other unless -h");
        assert_eq!(s.size, Some(Size::Cells(30)));
        assert_eq!(s.target.as_deref(), Some("%1"));
        assert!(s.print);
        assert_eq!(s.command, argv(&["-not-a-flag"]), "after -- every word is the command");
    }

    #[test]
    fn orch042_version_checks_and_tmux_own_leading_options() {
        assert_eq!(parse(&argv(&["-V"])).unwrap(), Request::Version);
        assert_eq!(parse(&argv(&["-L", "kolux", "-V"])).unwrap(), Request::Version);
        assert_eq!(parse(&argv(&["-L", "k", "-2u", "kill-pane", "-t", "%2"])).unwrap(), Request::Kill { target: Some("%2".into()) });
    }

    #[test]
    fn orch042_send_keys_display_list_and_unanswered_commands() {
        assert_eq!(
            parse(&argv(&["send-keys", "-t", "%1", "cd C:/w", "Enter"])).unwrap(),
            Request::SendKeys { target: Some("%1".into()), literal: false, keys: argv(&["cd C:/w", "Enter"]) }
        );
        assert_eq!(parse(&argv(&["display", "-p", "-t", "%1", "#{pane_id}"])).unwrap(), Request::Display { target: Some("%1".into()), format: "#{pane_id}".into() });
        assert_eq!(parse(&argv(&["lsp", "-F", "#D"])).unwrap(), Request::ListPanes { format: Some("#D".into()) });
        assert_eq!(parse(&argv(&["new-session", "-d"])).unwrap(), Request::Other("new-session".into()));
        assert_eq!(parse(&argv(&["display-message", "hi"])).unwrap(), Request::Other("display-message without -p".into()));
    }

    #[test]
    fn orch042_bad_requests_are_errors_not_guesses() {
        assert!(parse(&[]).is_err(), "no command");
        assert!(parse(&argv(&["split-window", "-q"])).unwrap_err().contains("unknown flag -q"));
        assert!(parse(&argv(&["split-window", "-t"])).unwrap_err().contains("-t needs a value"));
        assert!(parse(&argv(&["split-window", "-l", "101%"])).is_err(), "over 100 percent");
        assert!(parse(&argv(&["split-window", "-l", "0"])).is_err(), "zero cells");
        assert!(parse(&argv(&["split-window", "-l", "half"])).is_err());
    }

    #[test]
    fn orch042_three_teammates_make_one_column_right_of_the_leader() {
        let mut t = team(0);
        let mut seen = vec![];
        for h in ["m1", "m2", "m3"] {
            let p = t.place();
            seen.push((p.from.clone(), p.dir));
            t.joined(h);
        }
        assert_eq!(seen, vec![("t1".into(), Dir::Right), ("m1".into(), Dir::Down), ("m2".into(), Dir::Down)]);
        assert_eq!(t.mates.iter().map(|m| m.pane.as_str()).collect::<Vec<_>>(), ["%1", "%2", "%3"]);
    }

    #[test]
    fn orch042_a_split_opens_at_the_placement_whatever_side_tmux_asked_for() {
        let t = team(1);
        let r = parse(&argv(&["split-window", "-h", "-P", "-t", "%0", "claude", "--resume"])).unwrap();
        let Action::Open { placement, command, cwd, print } = t.decide(Some("%0"), &r) else { panic!() };
        assert_eq!(placement, Placement { from: "m1".into(), dir: Dir::Down }, "the column beside the leader, not a second column");
        assert_eq!(command.as_deref(), Some("claude --resume"));
        assert_eq!(cwd.as_deref(), Some("C:/w"), "the team's folder when -c is not given");
        assert_eq!(print.as_deref(), Some("#{session_name}:#{window_index}.#{pane_index}"));
    }

    #[test]
    fn orch042_the_twelfth_pane_is_the_last_one() {
        let req = Request::Split(Split::default());
        assert!(matches!(team(MAX_PANES - 2).decide(None, &req), Action::Open { .. }), "11 panes: one more fits");
        assert_eq!(team(MAX_PANES - 1).decide(None, &req), Action::Refuse(format!("a workspace holds up to {MAX_PANES} panes")));
        assert_eq!(team(1).decide(None, &Request::Split(Split { target: Some("%9".into()), ..Split::default() })), Action::Refuse("can't find pane: %9".into()));
    }

    #[test]
    fn orch042_a_teammate_cannot_respawn_or_kill_the_leader_but_a_teammate_pane_closes() {
        let t = team(2);
        assert_eq!(t.decide(Some("%1"), &Request::Respawn { target: Some("%0".into()) }), Action::Refuse("a teammate cannot respawn the leader pane".into()));
        assert_eq!(t.decide(Some("%1"), &Request::Kill { target: Some("t1".into()) }), Action::Refuse("the leader's pane is closed only from the window".into()));
        assert_eq!(t.decide(Some("%0"), &Request::Kill { target: Some("%2".into()) }), Action::Close(vec!["m2".into()]));
        assert_eq!(t.decide(Some("%2"), &Request::Kill { target: None }), Action::Close(vec!["m2".into()]), "no target: the caller's own pane");
    }

    #[test]
    fn orch042_keys_go_to_the_named_pane_with_enter_pressed_apart() {
        let t = team(1);
        let r = parse(&argv(&["send-keys", "-t", "%1", "cd", "Space", "C:/w", "C-m", "claude", "Enter"])).unwrap();
        assert_eq!(
            t.decide(None, &r),
            Action::Type { handle: "m1".into(), keys: vec![Key::Text("cd C:/w".into()), Key::Enter, Key::Text("claude".into()), Key::Enter] }
        );
        let lit = parse(&argv(&["send-keys", "-l", "-t", "%1", "Enter"])).unwrap();
        assert_eq!(t.decide(None, &lit), Action::Type { handle: "m1".into(), keys: vec![Key::Text("Enter".into())] }, "-l types the word");
        assert_eq!(t.decide(None, &Request::SendKeys { target: Some("%7".into()), literal: false, keys: vec![] }), Action::Refuse("can't find pane: %7".into()));
    }

    #[test]
    fn orch042_format_queries_leave_unknown_fields_empty() {
        let t = team(1);
        let d = parse(&argv(&["display-message", "-p", "-t", "%1", "#{pane_id}|#{pane_index}|#{nope}|#S|##|#{pane_current_path}"])).unwrap();
        assert_eq!(t.decide(None, &d), Action::Answer("%1|1||kolux|#|C:/w".into()));
        assert_eq!(t.decide(None, &Request::ListPanes { format: Some("#D".into()) }), Action::Answer("%0\n%1".into()));
        assert_eq!(t.decide(None, &Request::Version), Action::Answer(VERSION_LINE.into()));
        assert_eq!(expand("a#{unclosed", &BTreeMap::new()), "a", "an unclosed field reads to the end and is empty");
        assert_eq!(expand("50#", &BTreeMap::new()), "50#");
    }

    #[test]
    fn orch042_the_leader_exiting_clears_the_whole_team() {
        let mut all = Teams::default();
        for h in ["m1", "m2", "m3"] {
            all.lead("t1", None).joined(h);
        }
        all.lead("t9", None).joined("x1");
        assert_eq!(all.team_of("m2").map(|t| t.leader.handle.as_str()), Some("t1"));
        assert_eq!(all.ended("t1"), Ended::Leader(vec!["m1".into(), "m2".into(), "m3".into()]));
        assert!(all.team_of("m1").is_none() && all.team_of("t1").is_none(), "the team is gone");
        assert!(all.team_of("x1").is_some(), "another leader's team stays");
        assert_eq!(all.ended("nobody"), Ended::Unknown);
    }

    #[test]
    fn orch042_a_teammate_exiting_leaves_and_the_next_one_takes_its_place_in_the_column() {
        let mut all = Teams::default();
        all.lead("t1", None).joined("m1");
        all.lead("t1", None).joined("m2");
        assert_eq!(all.ended("m2"), Ended::Mate { leader: "t1".into() });
        assert_eq!(all.lead("t1", None).place(), Placement { from: "m1".into(), dir: Dir::Down });
        assert_eq!(all.ended("m1"), Ended::Mate { leader: "t1".into() });
        assert_eq!(all.lead("t1", None).place(), Placement { from: "t1".into(), dir: Dir::Right }, "an empty column starts beside the leader again");
        assert_eq!(all.lead("t1", None).joined("m3").pane, "%3", "pane ids are never reused");
    }

    #[test]
    fn orch042_no_usable_absolute_claude_path_means_in_process() {
        assert_eq!(mode(None), Mode::InProcess);
        assert_eq!(mode(Some(Path::new("claude"))), Mode::InProcess, "a bare name is not an absolute path");
        let missing = std::env::temp_dir().join("orch042-no-such-claude.exe");
        assert_eq!(mode(Some(&missing)), Mode::InProcess);
        let here = std::env::current_exe().unwrap();
        assert_eq!(mode(Some(&here)), Mode::Panes);
        assert_eq!(mode(here.parent()), Mode::InProcess, "a folder is not a program");
    }

    #[test]
    fn orch042_the_saved_teams_mode_decides_panes_only_for_native_off_windows() {
        let here = std::env::current_exe().unwrap();
        let s = |v: Value| json!({ TEAMS_MODE_KEY: v });
        assert_eq!(saved_mode(&s(json!("native")), false, Some(&here)), Some(Mode::Panes));
        assert_eq!(saved_mode(&s(json!("native")), true, Some(&here)), Some(Mode::InProcess), "Windows and WSL stay in-process");
        assert_eq!(saved_mode(&s(json!("native")), false, None), Some(Mode::InProcess), "no Claude path: in-process");
        assert_eq!(saved_mode(&s(json!("in-process")), false, Some(&here)), Some(Mode::InProcess));
        assert_eq!(saved_mode(&s(json!("off")), false, Some(&here)), None);
        assert_eq!(saved_mode(&s(json!(3)), false, Some(&here)), None, "unknown is off, as the picker reads it");
        assert_eq!(saved_mode(&json!({}), false, Some(&here)), None);
    }

    #[test]
    fn orch042_pane_open_and_close_use_the_window_events_terminal_split_and_close_send() {
        let p = Placement { from: "t1".into(), dir: Dir::Right };
        assert_eq!(split_event(&p, Some("claude"), "ask-1"), json!({ "kind": "terminal-split", "handle": "t1", "dir": "right", "command": "claude", "ask": "ask-1" }));
        assert_eq!(split_event(&Placement { from: "m1".into(), dir: Dir::Down }, None, "a")["dir"], "down");
        assert_eq!(close_event(&["m1".into(), "m2".into()]), json!({ "kind": "terminal-close", "handles": ["m1", "m2"] }));
    }
}
