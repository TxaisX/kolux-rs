// Searching file contents across a worktree (EDIT-037). ripgrep answers; without it, git's own
// grep stands in where the folder is a repository. By default the search is plain text, ignores
// case, covers hidden files and skips the git folder; match case, whole word and regular
// expression are options. Include and exclude take comma-separated patterns, a bare pattern
// matching at any depth and a backslash before a comma making it literal. Results are capped,
// long lines are trimmed around the hit, a slow search is stopped, an overly long query is
// refused, and a search that fails says why instead of finding nothing.
use std::io::{BufRead, BufReader, Read};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_QUERY: usize = 1000;
const MAX_HITS: usize = 2000;
const TIMEOUT: Duration = Duration::from_secs(15);
/// Characters of a long line kept on each side of the hit.
const SIDE: usize = 80;
/// FIX-3 (council P5): characters of the hit itself sent to the window; a longer one (a regex
/// spanning a minified line) is cut here and ends with an ellipsis, while `len` keeps its real length.
const TEXT_MAX: usize = 200;
/// FIX-3 (council P5): ripgrep skips files bigger than this (a dump or a bundle, not source).
const MAX_FILESIZE: &str = "10M";
/// How often a running search looks whether a newer one for the same folder has replaced it.
const POLL: Duration = Duration::from_millis(50);
/// The error a replaced search ends with; the window has already moved on and drops it.
pub const SUPERSEDED: &str = "A newer search of this folder replaced this one.";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    query: String,
    #[serde(default)]
    match_case: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    regex: bool,
    #[serde(default)]
    include: String,
    #[serde(default)]
    exclude: String,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Hit {
    /// 1-based line.
    line: u64,
    /// Where the hit starts in the line, in UTF-16 units (what the editor counts).
    col: usize,
    before: String,
    text: String,
    after: String,
    /// The hit's full length in UTF-16 units; `text` may be cut to TEXT_MAX characters.
    len: usize,
}

#[derive(serde::Serialize)]
pub struct FileHits {
    /// Relative to the worktree, with forward slashes.
    path: String,
    hits: Vec<Hit>,
}

#[derive(serde::Serialize)]
pub struct Found {
    files: Vec<FileHits>,
    total: usize,
    capped: bool,
    source: &'static str,
}

/// Comma-separated patterns; `\,` is a comma inside a pattern. Blanks are dropped.
pub fn split_patterns(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&',') => {
                cur.push(',');
                chars.next();
            }
            ',' => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
}

/// A line cut to the hit at bytes `start..end`, with up to SIDE characters either side. The work
/// is bounded by SIDE, not by the line: a minified one-line file is never counted end to end per hit.
pub fn trim_around(line: &str, start: usize, end: usize) -> (String, String, String) {
    let start = floor(line, start.min(line.len()));
    let end = floor(line, end.clamp(start, line.len()));
    let before = &line[..start];
    let after = &line[end..];
    let cut_before: String = match before.char_indices().rev().nth(SIDE - 1) {
        Some((i, _)) if i > 0 => format!("…{}", &before[i..]),
        _ => before.to_string(),
    };
    let cut_after: String = match after.char_indices().nth(SIDE) {
        Some((i, _)) => format!("{}…", &after[..i]),
        None => after.to_string(),
    };
    let mid = &line[start..end];
    let text = match mid.char_indices().nth(TEXT_MAX) {
        Some((i, _)) => format!("{}…", &mid[..i]),
        None => mid.to_string(),
    };
    (cut_before.trim_start().to_string(), text, cut_after)
}

fn floor(s: &str, mut i: usize) -> usize {
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn hit(line_no: u64, line: &str, start: usize, end: usize) -> Hit {
    let line = line.trim_end_matches(['\n', '\r']);
    let col = line[..floor(line, start.min(line.len()))].encode_utf16().count();
    hit_at(line_no, line, start, end, col)
}

fn hit_at(line_no: u64, line: &str, start: usize, end: usize, col: usize) -> Hit {
    let s = floor(line, start.min(line.len()));
    let len = line[s..floor(line, end.clamp(s, line.len()))].encode_utf16().count();
    let (before, text, after) = trim_around(line, start, end);
    Hit { line: line_no, col, before, text, after, len }
}

fn rel(p: &str) -> String {
    let p = p.replace('\\', "/");
    p.strip_prefix("./").unwrap_or(&p).to_string()
}

/// One ripgrep `--json` line turned into at most `limit` hits (none for the other message kinds).
/// FIX-2 (council P1): the cap applies before any hit is built, and the column is one forward scan
/// over the line (submatches come in order), so a line with tens of thousands of matches costs one
/// pass, not one pass per match. (ripgrep's --max-columns does not apply to its JSON output.)
pub fn parse_rg(line: &str, limit: usize) -> Option<(String, Vec<Hit>)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v["type"] != "match" {
        return None;
    }
    let d = &v["data"];
    let path = rel(d["path"]["text"].as_str()?);
    let text = d["lines"]["text"].as_str()?;
    let no = d["line_number"].as_u64()?;
    let text = text.trim_end_matches(['\n', '\r']);
    let (mut at, mut col) = (0usize, 0usize);
    let mut hits = Vec::new();
    for m in d["submatches"].as_array()?.iter().take(limit) {
        let (Some(s), Some(e)) = (m["start"].as_u64(), m["end"].as_u64()) else { continue };
        let s = floor(text, (s as usize).min(text.len()));
        if s < at {
            continue;
        }
        col += text[at..s].encode_utf16().count();
        at = s;
        hits.push(hit_at(no, text, s, e as usize, col));
    }
    Some((path, hits))
}

/// One `git grep -z -n --column` line: path, line, 1-based byte column, text. git gives only where
/// the first hit starts, so a plain-text hit is as long as the query.
// ponytail: a regex hit in git's fallback is marked from its start with no length; ripgrep gives real spans.
pub fn parse_git(line: &str, fixed_len: Option<usize>) -> Option<(String, Vec<Hit>)> {
    let mut parts = line.splitn(4, '\0');
    let path = rel(parts.next()?);
    let no: u64 = parts.next()?.parse().ok()?;
    let col: usize = parts.next()?.parse().ok()?;
    let text = parts.next()?;
    let start = col.saturating_sub(1);
    Some((path, vec![hit(no, text, start, start + fixed_len.unwrap_or(0))]))
}

fn rg_command(root: &Path, a: &Ask) -> Command {
    let mut cmd = Command::new("rg");
    cmd.args(["--json", "--hidden", "--no-config", "--no-messages", "--max-filesize", MAX_FILESIZE, "-g", "!.git/"]);
    cmd.arg(if a.match_case { "-s" } else { "-i" });
    if a.whole_word {
        cmd.arg("-w");
    }
    if !a.regex {
        cmd.arg("-F");
    }
    for p in split_patterns(&a.include) {
        cmd.args(["-g", &p]);
    }
    for p in split_patterns(&a.exclude) {
        cmd.args(["-g", &format!("!{p}")]);
    }
    cmd.args(["-e", &a.query, "--", "."]).current_dir(root);
    cmd
}

fn git_command(root: &Path, a: &Ask) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.quotepath=off", "grep", "-z", "-n", "--column", "-I", "--no-color", "--untracked"]);
    if !a.match_case {
        cmd.arg("-i");
    }
    if a.whole_word {
        cmd.arg("-w");
    }
    cmd.arg(if a.regex { "-E" } else { "-F" });
    cmd.args(["-e", &a.query, "--"]);
    let inc = split_patterns(&a.include);
    if inc.is_empty() {
        cmd.arg(".");
    }
    for p in inc {
        cmd.arg(format!(":(glob)**/{p}"));
    }
    for p in split_patterns(&a.exclude) {
        cmd.arg(format!(":(glob,exclude)**/{p}"));
    }
    cmd.current_dir(root);
    cmd
}

/// Runs a search command, collecting hits until the cap or the time limit.
/// FIX-3 (council P4): the search running for each folder. A new search of the same folder raises
/// the old one's flag, and the old one kills its ripgrep or git child at once instead of reading on
/// to the cap or the time limit while the user types.
/// FIX-4 (council d2 AFTER 1): each search takes a generation number when its command is called,
/// before the fence step, which can take a while and lets calls reach their folder out of order.
/// A folder remembers the generation of the search that holds it; a search with a lower number than
/// the holder's stops at once instead of stopping the newer one.
static GEN: AtomicU64 = AtomicU64::new(0);

pub fn next_gen() -> u64 {
    GEN.fetch_add(1, Ordering::SeqCst) + 1
}

type Held = (u64, Arc<AtomicBool>);
static RUNNING: Mutex<Option<HashMap<PathBuf, Held>>> = Mutex::new(None);

/// This search's flag for `root`. It takes the folder from a lower generation and raises that one's
/// flag; when the folder is held by a higher generation (a newer search, or a cancel), the flag comes
/// back already raised and the folder is left alone.
fn claim(root: &Path, gen: u64) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut m) = RUNNING.lock() {
        let map = m.get_or_insert_with(HashMap::new);
        match map.get(root) {
            Some((held, _)) if *held > gen => flag.store(true, Ordering::SeqCst),
            _ => {
                if let Some((_, old)) = map.insert(root.to_path_buf(), (gen, flag.clone())) {
                    old.store(true, Ordering::SeqCst);
                }
            }
        }
    }
    flag
}

/// FIX-4 (council d2 AFTER 7): no view wants `root`'s search any more (its explorer was closed or
/// moved to another folder). The running search stops, and one still on its way through the fence
/// (a lower generation) stops when it arrives.
pub fn cancel(root: &Path) {
    if let Ok(mut m) = RUNNING.lock() {
        let held = (next_gen(), Arc::new(AtomicBool::new(true)));
        if let Some((_, old)) = m.get_or_insert_with(HashMap::new).insert(root.to_path_buf(), held) {
            old.store(true, Ordering::SeqCst);
        }
    }
}

/// The search behind `flag` is over: forget it unless a newer one already took its place.
fn release(root: &Path, flag: &Arc<AtomicBool>) {
    if let Ok(mut m) = RUNNING.lock() {
        if let Some(map) = m.as_mut() {
            if map.get(root).is_some_and(|(_, f)| Arc::ptr_eq(f, flag)) {
                map.remove(root);
            }
        }
    }
}

fn run(mut cmd: Command, parse: impl Fn(&str, usize) -> Option<(String, Vec<Hit>)>, source: &'static str, stop: &AtomicBool) -> Result<Found, std::io::Error> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let out = child.stdout.take().expect("piped");
    let mut err = child.stderr.take().expect("piped");
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let errs = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let deadline = Instant::now() + TIMEOUT;
    let mut files: Vec<FileHits> = Vec::new();
    let (mut total, mut capped, mut late, mut replaced) = (0, false, false, false);
    loop {
        if stop.load(Ordering::SeqCst) {
            replaced = true;
            break;
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            late = true;
            break;
        }
        match rx.recv_timeout(left.min(POLL)) {
            Ok(line) => {
                let Some((path, hits)) = parse(&line, MAX_HITS - total + 1) else { continue };
                for h in hits {
                    if total == MAX_HITS {
                        capped = true;
                        break;
                    }
                    total += 1;
                    match files.last_mut() {
                        Some(f) if f.path == path => f.hits.push(h),
                        _ => files.push(FileHits { path: path.clone(), hits: vec![h] }),
                    }
                }
                if capped {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if capped || late || replaced {
        let _ = child.kill();
    }
    let status = child.wait()?;
    let stderr = errs.join().unwrap_or_default();
    if replaced {
        return Err(std::io::Error::other(SUPERSEDED));
    }
    if late {
        return Err(std::io::Error::other(format!("The search took longer than {} seconds and was stopped; narrow it with an include pattern.", TIMEOUT.as_secs())));
    }
    // ripgrep and git grep both end with 1 when nothing matched; more is a real failure.
    if !capped && status.code().is_some_and(|c| c > 1) && total == 0 {
        let why = stderr.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("the search command failed").to_string();
        return Err(std::io::Error::other(why));
    }
    Ok(Found { files, total, capped, source })
}

#[cfg(test)]
pub fn search(root: &Path, a: &Ask) -> Result<Found, String> {
    search_gen(root, a, next_gen())
}

/// `search` for a call that took its generation number earlier (at command entry).
pub fn search_gen(root: &Path, a: &Ask, gen: u64) -> Result<Found, String> {
    if a.query.is_empty() {
        return Ok(Found { files: vec![], total: 0, capped: false, source: "none" });
    }
    if a.query.chars().count() > MAX_QUERY {
        return Err(format!("The search text is longer than {MAX_QUERY} characters."));
    }
    let stop = claim(root, gen);
    if stop.load(Ordering::SeqCst) {
        // a newer search (or a cancel) already holds this folder: nothing to start
        return Err(SUPERSEDED.into());
    }
    let found = match run(rg_command(root, a), parse_rg, "rg", &stop) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if !root.join(".git").exists() {
                Err("ripgrep is not installed and this folder is not a git repository, so there is nothing to search with.".into())
            } else {
                let len = (!a.regex).then_some(a.query.len());
                run(git_command(root, a), |l, _| parse_git(l, len), "git", &stop).map_err(|e| e.to_string())
            }
        }
        other => other.map_err(|e| e.to_string()),
    };
    release(root, &stop);
    found
}

#[tauri::command]
pub async fn editor_search(root: String, ask: Ask, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Found, String> {
    let gen = next_gen();
    let root = fence.allow(&root, &store, &git, false)?;
    tauri::async_runtime::spawn_blocking(move || search_gen(&root, &ask, gen)).await.map_err(|e| e.to_string())?
}

/// FIX-4: the explorer that asked for searches of `root` is gone; stop its search. Needs a line in
/// lib.rs's handler list (evidence/look-FIX-4-lib.patch).
#[allow(dead_code)] // until that line is in
#[tauri::command]
pub async fn editor_search_cancel(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let root = fence.allow(&root, &store, &git, false)?;
    cancel(&root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(q: &str) -> Ask {
        Ask { query: q.into(), match_case: false, whole_word: false, regex: false, include: String::new(), exclude: String::new() }
    }

    #[test]
    fn patterns_split_on_commas_and_a_backslash_keeps_one() {
        assert_eq!(split_patterns("*.ts, src/**  ,,"), vec!["*.ts", "src/**"]);
        assert_eq!(split_patterns(r"a\,b.txt,c"), vec!["a,b.txt", "c"]);
        assert!(split_patterns("  ").is_empty());
    }

    #[test]
    fn long_lines_are_trimmed_around_the_hit() {
        let line = format!("{}TODO{}", "a".repeat(200), "b".repeat(200));
        let (b, t, a) = trim_around(&line, 200, 204);
        assert_eq!(t, "TODO");
        assert_eq!(b.chars().count(), SIDE + 1); // the ellipsis plus SIDE characters
        assert!(b.starts_with('…') && a.ends_with('…'));
        let (b, _, a) = trim_around("  short TODO line", 8, 12);
        assert_eq!((b.as_str(), a.as_str()), ("short ", " line"));
    }

    #[test]
    fn reads_ripgrep_and_git_lines() {
        let rg = r#"{"type":"match","data":{"path":{"text":".\\sub\\b.ts"},"lines":{"text":"é Todo todo\r\n"},"line_number":7,"submatches":[{"match":{"text":"Todo"},"start":3,"end":7},{"match":{"text":"todo"},"start":8,"end":12}]}}"#;
        let (path, hits) = parse_rg(rg, MAX_HITS).unwrap();
        assert_eq!(path, "sub/b.ts");
        assert_eq!(hits.len(), 2);
        // "é " is two UTF-16 units before the hit, though three bytes.
        assert_eq!(hits[0], Hit { line: 7, col: 2, before: "é ".into(), text: "Todo".into(), after: " todo".into(), len: 4 });
        assert!(parse_rg(r#"{"type":"begin","data":{}}"#, MAX_HITS).is_none());
        let (path, hits) = parse_git("a dir/x.txt\u{0}12\u{0}5\u{0}one todo here", Some(4)).unwrap();
        assert_eq!((path.as_str(), hits[0].line, hits[0].text.as_str(), hits[0].col), ("a dir/x.txt", 12, "todo", 4));
    }

    // FIX-2 (council P1): a minified one-line file with a match per character: the cap holds
    // before any hit is built, the columns still count UTF-16 units, and the sides stay SIDE long.
    #[test]
    fn a_line_with_thousands_of_matches_builds_only_the_hits_asked_for() {
        let line = format!("é{}", "e".repeat(60_000));
        let subs: Vec<String> = (0..60_000).map(|i| format!(r#"{{"match":{{"text":"e"}},"start":{},"end":{}}}"#, i + 2, i + 3)).collect();
        let json = format!(r#"{{"type":"match","data":{{"path":{{"text":"min.js"}},"lines":{{"text":{}}},"line_number":1,"submatches":[{}]}}}}"#, serde_json::to_string(&line).unwrap(), subs.join(","));
        let (_, hits) = parse_rg(&json, 3).unwrap();
        assert_eq!(hits.len(), 3);
        assert_eq!(hits.iter().map(|h| h.col).collect::<Vec<_>>(), vec![1, 2, 3]);
        let (_, hits) = parse_rg(&json, MAX_HITS).unwrap();
        assert_eq!(hits.len(), MAX_HITS);
        let last = hits.last().unwrap();
        assert_eq!(last.col, MAX_HITS);
        assert_eq!(last.before.chars().count(), SIDE + 1);
        assert_eq!(last.after.chars().count(), SIDE + 1);
    }

    // FIX-3 (council P5): a hit longer than TEXT_MAX characters (a regex across a minified line) is
    // cut to TEXT_MAX plus an ellipsis for the list, but keeps its real UTF-16 length for the editor.
    #[test]
    fn a_long_hit_is_cut_for_the_list_but_keeps_its_length() {
        let line = format!("ab{}cd", "é".repeat(5000));
        let h = hit(3, &line, 2, 2 + 2 * 5000);
        assert_eq!(h.text.chars().count(), TEXT_MAX + 1);
        assert!(h.text.ends_with('…') && h.text.starts_with('é'));
        assert_eq!((h.col, h.len), (2, 5000));
        assert_eq!(h.after, "cd");
        let short = hit(1, "one todo", 4, 8);
        assert_eq!((short.text.as_str(), short.len), ("todo", 4));
    }

    // FIX-3 (council P5): ripgrep is told to skip files over 10 MB; a real 11 MB file with a match is
    // not searched while a small one next to it is.
    #[test]
    fn ripgrep_skips_files_over_ten_megabytes() {
        let args: Vec<String> = rg_command(Path::new("."), &ask("x")).get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|w| w[0] == "--max-filesize" && w[1] == "10M"), "{args:?}");
        if Command::new("rg").arg("--version").output().is_err() {
            eprintln!("ripgrep not installed; the size rule was checked on the arguments only");
            return;
        }
        let d = std::env::temp_dir().join(format!("krs-search-big-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let mut big = "needle\n".to_string();
        big.push_str(&"x".repeat(11 * 1024 * 1024));
        std::fs::write(d.join("big.txt"), big).unwrap();
        std::fs::write(d.join("small.txt"), "needle\n").unwrap();
        let f = run(rg_command(&d, &ask("needle")), parse_rg, "rg", &AtomicBool::new(false)).unwrap();
        assert_eq!(f.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["small.txt"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    // FIX-3 (council P4): a new search of the same folder raises the running one's flag (another
    // folder's search is left alone), and a raised flag kills the child at once: a command that would
    // run for about 20 seconds ends within a few, with the superseded error the window drops.
    #[test]
    fn a_newer_search_of_the_same_folder_stops_the_older_one() {
        let (a, b) = (Path::new("C:/krs-claim-a"), Path::new("C:/krs-claim-b"));
        let first = claim(a, next_gen());
        let other = claim(b, next_gen());
        assert!(!first.load(Ordering::SeqCst));
        let second = claim(a, next_gen());
        assert!(first.load(Ordering::SeqCst), "the older search of the folder is told to stop");
        assert!(!second.load(Ordering::SeqCst) && !other.load(Ordering::SeqCst));
        release(a, &first);
        assert!(RUNNING.lock().unwrap().as_ref().unwrap().get(a).is_some_and(|(_, f)| Arc::ptr_eq(f, &second)), "a finished older search does not drop the newer one's entry");
        release(a, &second);
        release(b, &other);
        assert!(RUNNING.lock().unwrap().as_ref().unwrap().get(a).is_none());

        let stop = Arc::new(AtomicBool::new(false));
        let raise = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            raise.store(true, Ordering::SeqCst);
        });
        let mut slow = if cfg!(windows) { Command::new("ping") } else { Command::new("sleep") };
        if cfg!(windows) {
            slow.args(["-n", "20", "127.0.0.1"]);
        } else {
            slow.arg("20");
        }
        let t0 = Instant::now();
        let err = run(slow, |_, _| None, "rg", &stop).err().unwrap();
        assert_eq!(err.to_string(), SUPERSEDED);
        assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
    }

    // FIX-4 (council d2 AFTER 1): the fence step can let an older search reach its folder after a
    // newer one. The older one stops at once and the newer one keeps running.
    #[test]
    fn fix4_a_search_reaching_its_folder_after_a_newer_one_stops_and_the_newer_runs_on() {
        let a = Path::new("C:/krs-gen-a");
        let (g_old, g_new) = (next_gen(), next_gen());
        let newer = claim(a, g_new);
        let older = claim(a, g_old);
        assert!(!newer.load(Ordering::SeqCst), "the newer search is not stopped by the late older one");
        assert!(older.load(Ordering::SeqCst), "the late older search stops at once");
        release(a, &older);
        assert!(RUNNING.lock().unwrap().as_ref().unwrap().get(a).is_some_and(|(_, f)| Arc::ptr_eq(f, &newer)), "the late one never takes the newer one's entry");
        release(a, &newer);
    }

    // FIX-4: a late older search starts no ripgrep at all, and says the superseded error.
    #[test]
    fn fix4_a_late_older_search_starts_nothing_and_says_superseded() {
        let a = Path::new("C:/krs-gen-late");
        let (g_old, g_new) = (next_gen(), next_gen());
        let newer = claim(a, g_new);
        let err = search_gen(a, &ask("needle"), g_old).err().unwrap();
        assert_eq!(err, SUPERSEDED);
        assert!(!newer.load(Ordering::SeqCst));
        release(a, &newer);
    }

    // FIX-4 (council d2 AFTER 7): a cancel stops the folder's running search, and one still on its
    // way through the fence (lower generation) stops on arrival; a search asked afterwards runs.
    #[test]
    fn fix4_cancel_stops_the_running_search_and_one_still_in_the_fence_but_not_a_later_one() {
        let a = Path::new("C:/krs-gen-cancel");
        let running = claim(a, next_gen());
        let in_the_fence = next_gen();
        cancel(a);
        assert!(running.load(Ordering::SeqCst), "the running search is stopped");
        assert!(claim(a, in_the_fence).load(Ordering::SeqCst), "a search that was asked before the cancel stops on arrival");
        let later = claim(a, next_gen());
        assert!(!later.load(Ordering::SeqCst), "a search asked after the cancel runs");
        release(a, &later);
        cancel(Path::new("C:/krs-gen-never-searched")); // nothing running: no harm
    }

    #[test]
    fn refuses_an_overly_long_query() {
        let err = search(Path::new("."), &ask(&"x".repeat(MAX_QUERY + 1))).err().unwrap();
        assert!(err.contains("longer than"));
    }

    // A real search over a throwaway folder: case, whole word, exclude, regex errors, the cap.
    #[test]
    fn searches_a_folder() {
        let d = std::env::temp_dir().join(format!("krs-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("sub")).unwrap();
        std::fs::create_dir_all(d.join(".hidden")).unwrap();
        std::fs::write(d.join("a.txt"), "one todo here\nTODO two\ntodos\n").unwrap();
        std::fs::write(d.join("sub").join("b.test.ts"), "x Todo\n").unwrap();
        std::fs::write(d.join(".hidden").join("c.txt"), "todo hidden\n").unwrap();
        // The fallback needs a repository; ripgrep is checked too wherever it is installed.
        let git_init = Command::new("git").args(["init", "-q"]).current_dir(&d).status().unwrap();
        assert!(git_init.success());
        let has_rg = Command::new("rg").arg("--version").output().is_ok();
        for use_git in [true, false] {
            if !use_git && !has_rg {
                continue;
            }
            let go = |a: &Ask| -> Result<Found, std::io::Error> {
                if use_git {
                    let len = (!a.regex).then_some(a.query.len());
                    run(git_command(&d, a), |l, _| parse_git(l, len), "git", &AtomicBool::new(false))
                } else {
                    run(rg_command(&d, a), parse_rg, "rg", &AtomicBool::new(false))
                }
            };
            let count = |a: &Ask| go(a).unwrap().total;
            assert_eq!(count(&ask("todo")), 5, "git={use_git}");
            assert_eq!(count(&Ask { match_case: true, ..ask("todo") }), 3);
            assert_eq!(count(&Ask { whole_word: true, ..ask("todo") }), 4);
            let no_tests = go(&Ask { exclude: "*.test.ts".into(), ..ask("todo") }).unwrap();
            assert!(no_tests.files.iter().all(|f| !f.path.ends_with(".test.ts")));
            assert_eq!(no_tests.total, 4);
            let only = go(&Ask { include: "*.ts".into(), ..ask("todo") }).unwrap();
            assert_eq!(only.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["sub/b.test.ts"]);
            assert!(go(&Ask { regex: true, ..ask("(unclosed") }).is_err());
            assert_eq!(count(&Ask { regex: true, ..ask("t.d.") }), 5);
            let hit = &go(&ask("here")).unwrap().files[0];
            assert_eq!((hit.path.as_str(), hit.hits[0].line, hit.hits[0].col, hit.hits[0].text.as_str()), ("a.txt", 1, 9, "here"));
            std::fs::write(d.join("many.txt"), "z
".repeat(MAX_HITS + 50)).unwrap();
            let many = go(&ask("z")).unwrap();
            assert!(many.capped && many.total == MAX_HITS);
            std::fs::remove_file(d.join("many.txt")).unwrap();
        }
        let _ = std::fs::remove_dir_all(&d);
    }
}
