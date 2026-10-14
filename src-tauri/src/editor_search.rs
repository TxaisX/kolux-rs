// Searching file contents across a worktree (EDIT-037). ripgrep answers; without it, git's own
// grep stands in where the folder is a repository. By default the search is plain text, ignores
// case, covers hidden files and skips the git folder; match case, whole word and regular
// expression are options. Include and exclude take comma-separated patterns, a bare pattern
// matching at any depth and a backslash before a comma making it literal. Results are capped,
// long lines are trimmed around the hit, a slow search is stopped, an overly long query is
// refused, and a search that fails says why instead of finding nothing.
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const MAX_QUERY: usize = 1000;
const MAX_HITS: usize = 2000;
const TIMEOUT: Duration = Duration::from_secs(15);
/// Characters of a long line kept on each side of the hit.
const SIDE: usize = 80;

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
    (cut_before.trim_start().to_string(), line[start..end].to_string(), cut_after)
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
    let (before, text, after) = trim_around(line, start, end);
    Hit { line: line_no, col, before, text, after }
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
    cmd.args(["--json", "--hidden", "--no-config", "--no-messages", "-g", "!.git/"]);
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
fn run(mut cmd: Command, parse: impl Fn(&str, usize) -> Option<(String, Vec<Hit>)>, source: &'static str) -> Result<Found, std::io::Error> {
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
    let (mut total, mut capped, mut late) = (0, false, false);
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
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
            Err(mpsc::RecvTimeoutError::Timeout) => {
                late = true;
                break;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if capped || late {
        let _ = child.kill();
    }
    let status = child.wait()?;
    let stderr = errs.join().unwrap_or_default();
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

pub fn search(root: &Path, a: &Ask) -> Result<Found, String> {
    if a.query.is_empty() {
        return Ok(Found { files: vec![], total: 0, capped: false, source: "none" });
    }
    if a.query.chars().count() > MAX_QUERY {
        return Err(format!("The search text is longer than {MAX_QUERY} characters."));
    }
    match run(rg_command(root, a), parse_rg, "rg") {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if !root.join(".git").exists() {
                return Err("ripgrep is not installed and this folder is not a git repository, so there is nothing to search with.".into());
            }
            let len = (!a.regex).then_some(a.query.len());
            run(git_command(root, a), |l, _| parse_git(l, len), "git").map_err(|e| e.to_string())
        }
        other => other.map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn editor_search(root: String, ask: Ask, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Found, String> {
    let root = fence.allow(&root, &store, &git, false)?;
    tauri::async_runtime::spawn_blocking(move || search(&root, &ask)).await.map_err(|e| e.to_string())?
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
        assert_eq!(hits[0], Hit { line: 7, col: 2, before: "é ".into(), text: "Todo".into(), after: " todo".into() });
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
                    run(git_command(&d, a), |l, _| parse_git(l, len), "git")
                } else {
                    run(rg_command(&d, a), parse_rg, "rg")
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
