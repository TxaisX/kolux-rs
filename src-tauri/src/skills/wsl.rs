//! SKILL-021: skills inside a WSL distribution. The distribution is the one the open project lives
//! in. Kolux asks it for the skill folders through a small shell script (one `wsl.exe` call per
//! folder, run through the `Runner` below so tests use a fake) and reads the answer strictly: an
//! answer that is cut off, has no end line or has a broken line is an error, never an empty list.
//! Plugins inside WSL and the distribution's own plugin caches are not read (kolux-rs-after.md).

use base64::Engine;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
/// The first line of every answer.
const HEADER: &str = "KOLUX-WSL-SKILLS 1";
/// An answer is read up to this many bytes; more is an error, not a shorter list.
const ANSWER_LIMIT: usize = 8 * 1024 * 1024;

/// Runs the folder script in a distribution. `dir` is a folder in it; `~/` stands for its home.
pub trait Runner: Send + Sync {
    fn run(&self, distro: &str, dir: &str, cancel: &AtomicBool) -> Result<Vec<u8>, String>;
}

/// No WSL at hand: every call fails with a plain reason (tests that do not care about WSL).
#[cfg(test)]
pub struct Unavailable;

#[cfg(test)]
impl Runner for Unavailable {
    fn run(&self, _distro: &str, _dir: &str, _cancel: &AtomicBool) -> Result<Vec<u8>, String> {
        Err("WSL is not available on this computer".into())
    }
}

/// One shell line, run as `sh -c <SCRIPT> kolux <dir>`. It prints the header, `NOTFOUND` when the
/// folder is missing, one `SKILL` line per skill file and `END <count>` last.
pub const SCRIPT: &str = r#"set -f; D="$1"; case "$D" in "~/"*) D="$HOME/${D#??}";; esac; echo "KOLUX-WSL-SKILLS 1"; if [ ! -d "$D" ]; then echo NOTFOUND; echo "END 0"; exit 0; fi; find -L "$D" -maxdepth 5 -name SKILL.md -type f 2>/dev/null | sort | { n=0; while IFS= read -r f; do d=$(dirname "$f"); r=$(readlink -f "$d" 2>/dev/null || echo "$d"); m=$(stat -c %Y "$f" 2>/dev/null || echo 0); p=$(printf %s "$d" | base64 | tr -d '\n'); q=$(printf %s "$r" | base64 | tr -d '\n'); t=$(head -c 8192 "$f" 2>/dev/null | base64 | tr -d '\n'); printf 'SKILL\t%s\t%s\t%s\t%s\n' "$p" "$q" "$m" "$t"; n=$((n+1)); done; echo "END $n"; }"#;

/// `wsl.exe -d <distro> --exec sh -c <SCRIPT> kolux <dir>`, hidden, killed when `cancel` is set.
pub struct Real;

impl Runner for Real {
    fn run(&self, distro: &str, dir: &str, cancel: &AtomicBool) -> Result<Vec<u8>, String> {
        use std::io::Read;
        use std::process::{Command, Stdio};
        if !safe_name(distro) {
            return Err(format!("{distro:?} is not a distribution name Kolux will pass to WSL"));
        }
        let mut cmd = Command::new("wsl.exe");
        cmd.args(["-d", distro, "--exec", "sh", "-c", SCRIPT, "kolux", dir]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("Could not start wsl.exe: {e}"))?;
        let out = child.stdout.take().ok_or("Could not read from wsl.exe")?;
        let reader = std::thread::spawn(move || {
            let mut buf = vec![];
            let _ = out.take(ANSWER_LIMIT as u64 + 1).read_to_end(&mut buf);
            buf
        });
        let status = loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The WSL scan was stopped".into());
            }
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(e) => return Err(format!("wsl.exe: {e}")),
            }
        };
        let buf = reader.join().map_err(|_| "The WSL answer could not be read".to_string())?;
        if !status.success() {
            return Err(format!("wsl.exe ended with {}", status.code().map_or("no exit code".into(), |c| format!("exit code {c}"))));
        }
        Ok(buf)
    }
}

/// A distribution name made only of letters, digits, dot, dash and underscore.
pub fn safe_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// `\\wsl$\Ubuntu\home\me\repo` (or `\\wsl.localhost\...`, or the long `\\?\UNC\wsl...` form) ->
/// (`Ubuntu`, `/home/me/repo`). None for any other path, a name WSL would not take or a `..`.
pub fn split(p: &Path) -> Option<(String, String)> {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = match s.get(..8).filter(|h| h.eq_ignore_ascii_case("\\\\?\\UNC\\")) {
        Some(_) => format!("\\\\{}", &s[8..]),
        None => s,
    };
    let rest = s.strip_prefix("\\\\")?;
    let mut parts = rest.split('\\');
    let host = parts.next()?.to_ascii_lowercase();
    if host != "wsl$" && host != "wsl.localhost" {
        return None;
    }
    let distro = parts.next().filter(|d| safe_name(d))?.to_string();
    let mut linux = String::new();
    for seg in parts.filter(|s| !s.is_empty()) {
        if seg == ".." || seg == "." || seg.contains('\0') {
            return None;
        }
        linux.push('/');
        linux.push_str(seg);
    }
    if linux.is_empty() {
        linux.push('/');
    }
    Some((distro, linux))
}

/// The Windows path of a place inside a distribution.
pub fn unc(distro: &str, linux: &str) -> PathBuf {
    let mut s = format!("\\\\wsl.localhost\\{distro}");
    for seg in linux.split('/').filter(|s| !s.is_empty()) {
        s.push('\\');
        s.push_str(seg);
    }
    PathBuf::from(s)
}

/// One skill the distribution reported.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    /// The skill folder as listed (absolute, Linux form).
    pub dir: String,
    /// The same folder with links resolved, to list a skill reached twice once.
    pub real: String,
    /// Last change of the skill file in milliseconds since 1970 (None when the distribution gave 0).
    pub updated: Option<u64>,
    pub text: String,
}

#[derive(Debug, PartialEq)]
pub enum Answer {
    NotFound,
    Skills(Vec<Found>),
}

fn bad(why: &str) -> String {
    format!("WSL gave an answer Kolux could not read ({why})")
}

fn decode(field: &str) -> Result<Vec<u8>, String> {
    B64.decode(field.as_bytes()).map_err(|_| bad("a field is not valid"))
}

/// Read one answer strictly: header, then either `NOTFOUND` and `END 0`, or `SKILL` lines and an
/// `END` line whose count matches. Lines before the header (a message of WSL's own) are skipped;
/// anything else out of shape makes the whole answer an error.
pub fn parse(bytes: &[u8]) -> Result<Answer, String> {
    if bytes.len() > ANSWER_LIMIT {
        return Err(bad("it is longer than Kolux reads"));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| bad("it is not text"))?;
    let mut lines = text.lines().map(|l| l.trim_end_matches('\r'));
    if !lines.any(|l| l == HEADER) {
        return Err(bad("it does not start with the expected line"));
    }
    let mut skills = vec![];
    let mut missing = false;
    let mut ended = None;
    for line in lines {
        if ended.is_some() {
            if line.is_empty() {
                continue;
            }
            return Err(bad("there is more after the last line"));
        }
        if line == "NOTFOUND" {
            if missing || !skills.is_empty() {
                return Err(bad("the folder is both missing and listed"));
            }
            missing = true;
        } else if let Some(n) = line.strip_prefix("END ") {
            ended = Some(n.parse::<usize>().map_err(|_| bad("the count is not a number"))?);
        } else if let Some(rest) = line.strip_prefix("SKILL\t") {
            if missing {
                return Err(bad("the folder is both missing and listed"));
            }
            let f: Vec<&str> = rest.split('\t').collect();
            if f.len() != 4 {
                return Err(bad("a skill line is cut short"));
            }
            let dir = String::from_utf8(decode(f[0])?).map_err(|_| bad("a folder name is not text"))?;
            let real = String::from_utf8(decode(f[1])?).map_err(|_| bad("a folder name is not text"))?;
            if !dir.starts_with('/') || !real.starts_with('/') || dir.split('/').any(|s| s == "..") {
                return Err(bad("a folder is not an absolute path"));
            }
            let secs: u64 = f[2].parse().map_err(|_| bad("a time is not a number"))?;
            let text = String::from_utf8_lossy(&decode(f[3])?).into_owned();
            skills.push(Found { dir, real, updated: (secs > 0).then(|| secs.saturating_mul(1000)), text });
        } else {
            return Err(bad("a line has an unexpected shape"));
        }
    }
    match ended {
        None => Err(bad("it ends before the last line")),
        Some(n) if n != skills.len() => Err(bad("the count does not match the lines")),
        Some(_) if missing => Ok(Answer::NotFound),
        Some(_) => Ok(Answer::Skills(skills)),
    }
}

/// Build an answer the way the script prints it (tests only).
#[cfg(test)]
pub fn answer_for(skills: &[(&str, &str, &str)]) -> String {
    let mut out = format!("{HEADER}\n");
    for (dir, real, text) in skills {
        out.push_str(&format!("SKILL\t{}\t{}\t1700000000\t{}\n", B64.encode(dir), B64.encode(real), B64.encode(text)));
    }
    out.push_str(&format!("END {}\n", skills.len()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_reads_every_wsl_path_form() {
        assert_eq!(split(Path::new("\\\\wsl$\\Ubuntu\\home\\me\\repo")), Some(("Ubuntu".into(), "/home/me/repo".into())));
        assert_eq!(split(Path::new("\\\\wsl.localhost\\Debian-12\\")), Some(("Debian-12".into(), "/".into())));
        assert_eq!(split(Path::new("\\\\?\\UNC\\wsl.localhost\\Ubuntu\\srv\\x")), Some(("Ubuntu".into(), "/srv/x".into())));
        assert_eq!(split(Path::new("//WSL$/Ubuntu/a")), Some(("Ubuntu".into(), "/a".into())));
    }

    #[test]
    fn split_refuses_other_hosts_odd_names_and_dotdot() {
        assert_eq!(split(Path::new("\\\\server\\share\\x")), None);
        assert_eq!(split(Path::new("C:\\Users\\me")), None);
        assert_eq!(split(Path::new("\\\\wsl$\\")), None);
        assert_eq!(split(Path::new("\\\\wsl$\\Ubu ntu\\a")), None);
        assert_eq!(split(Path::new("\\\\wsl$\\Ubuntu\\a\\..\\b")), None);
    }

    #[test]
    fn unc_goes_back_to_a_windows_path() {
        assert_eq!(unc("Ubuntu", "/home/me/.claude/skills/x"), PathBuf::from("\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\skills\\x"));
    }

    #[test]
    fn a_good_answer_lists_its_skills() {
        let a = answer_for(&[("/home/me/.claude/skills/pdf", "/home/me/.claude/skills/pdf", "# pdf\n"), ("/h/b", "/h/b", "")]);
        let Answer::Skills(s) = parse(a.as_bytes()).unwrap() else { panic!("not skills") };
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].dir, "/home/me/.claude/skills/pdf");
        assert_eq!(s[0].text, "# pdf\n");
        assert_eq!(s[0].updated, Some(1_700_000_000_000));
    }

    #[test]
    fn a_missing_folder_is_not_found_and_an_empty_one_is_an_empty_list() {
        assert_eq!(parse(b"KOLUX-WSL-SKILLS 1\nNOTFOUND\nEND 0\n").unwrap(), Answer::NotFound);
        assert_eq!(parse(b"KOLUX-WSL-SKILLS 1\r\nEND 0\r\n").unwrap(), Answer::Skills(vec![]));
    }

    #[test]
    fn garbled_answers_are_errors_never_an_empty_list() {
        let good = answer_for(&[("/a/b", "/a/b", "# b\n")]);
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty", vec![]),
            ("no header", b"hello\nEND 0\n".to_vec()),
            ("cut before END", good.replace("END 1\n", "").into_bytes()),
            ("count mismatch", good.replace("END 1", "END 2").into_bytes()),
            ("count not a number", good.replace("END 1", "END x").into_bytes()),
            ("skill cut short", "KOLUX-WSL-SKILLS 1\nSKILL\tYQ==\nEND 1\n".as_bytes().to_vec()),
            ("bad base64", "KOLUX-WSL-SKILLS 1\nSKILL\t!!\t!!\t5\t\nEND 1\n".as_bytes().to_vec()),
            ("relative folder", format!("KOLUX-WSL-SKILLS 1\nSKILL\t{}\t{}\t5\t\nEND 1\n", B64.encode("a/b"), B64.encode("a/b")).into_bytes()),
            ("not text", vec![0xff, 0xfe, 0x00, 0x01]),
            ("stray line", "KOLUX-WSL-SKILLS 1\nwhat\nEND 0\n".as_bytes().to_vec()),
            ("junk after END", format!("{good}more\n").into_bytes()),
            ("missing and listed", "KOLUX-WSL-SKILLS 1\nNOTFOUND\nSKILL\tYQ==\nEND 1\n".as_bytes().to_vec()),
        ];
        for (why, bytes) in cases {
            assert!(parse(&bytes).is_err(), "{why} must be an error");
        }
    }

    #[test]
    fn a_message_of_wsls_own_before_the_header_is_skipped() {
        let a = format!("wsl: some notice\n{}", answer_for(&[]));
        assert_eq!(parse(a.as_bytes()).unwrap(), Answer::Skills(vec![]));
    }

    #[test]
    fn the_script_shape_is_one_line_with_the_header_and_end() {
        assert!(!SCRIPT.contains('\n'));
        assert!(SCRIPT.contains(HEADER) && SCRIPT.contains("END $n") && SCRIPT.contains("head -c 8192"));
    }
}
