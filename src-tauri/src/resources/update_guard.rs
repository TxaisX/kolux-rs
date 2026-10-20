//! T-293 (APP-030): an update whose Windows signature does not match is stopped, with no bypass.
//!
//! The minisign check in `update.rs` proves a download came from Kolux RS's release job. This adds
//! the Windows publisher check on top: before a downloaded installer is kept as "ready", its
//! Authenticode signature is read with Windows' own `Get-AuthenticodeSignature` (Windows
//! PowerShell from the system folder, never one found on PATH) and compared with the running
//! program's own signature, or with the publisher pinned into the build (`KOLUX_RS_PUBLISHER` at
//! build time). The rules, in `decide`:
//!
//! - A damaged, untrusted or unreadable installer signature is always refused.
//! - A signed copy (or a build with a pinned publisher) takes only an installer validly signed by
//!   that same publisher. An unsigned installer, another publisher, or a signature that could not
//!   be checked is refused. Publishers are compared by certificate subject, so a renewed
//!   certificate of the same publisher still updates.
//! - An unsigned copy (today's releases and development copies) takes an unsigned installer or a
//!   validly signed one: the minisign key has already vouched for it. A copy whose own signature is
//!   damaged, or whose own signature could not be read, refuses every installer.
//!
//! There is no setting, variable or argument that skips this. A refused version is written to the
//! store and never offered again (`update_check` filters it).

use std::path::Path;

/// The store key holding refused versions, newest last.
pub const KEY_REFUSED: &str = "update.refusedVersions";
/// The refused list keeps this many versions.
const REFUSED_KEEP: usize = 20;
/// The publisher pinned into a signed release build, if the release job set it.
pub const PINNED_PUBLISHER: Option<&str> = option_env!("KOLUX_RS_PUBLISHER");
/// The marker the page reads to show the security stop card (no install button).
pub const REFUSED_MARK: &str = "update:refused|";

/// One file's Authenticode signature as Windows reports it.
#[derive(Debug, Clone, PartialEq)]
pub enum SignState {
    /// A valid signature that chains to a trusted root.
    Signed { subject: String, thumbprint: String },
    /// No signature at all.
    Unsigned,
    /// A signature is there but is not valid (hash mismatch, untrusted, unknown error...).
    Broken(String),
    /// The signature could not be read (the system tool failed or was missing).
    Unknown(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Install,
    Stop(String),
}

/// Reads `Get-AuthenticodeSignature`'s answer, printed as `{"status":..,"subject":..,"thumbprint":..}`.
pub fn parse_report(json: &str) -> SignState {
    #[derive(serde::Deserialize)]
    struct Report {
        status: Option<String>,
        subject: Option<String>,
        thumbprint: Option<String>,
    }
    let Ok(r) = serde_json::from_str::<Report>(json.trim()) else {
        return SignState::Unknown("the signature check gave no readable answer".into());
    };
    let status = r.status.unwrap_or_default();
    match status.as_str() {
        "Valid" => {
            let subject = r.subject.unwrap_or_default();
            if subject.trim().is_empty() {
                SignState::Broken("a valid signature without a publisher".into())
            } else {
                SignState::Signed { subject, thumbprint: r.thumbprint.unwrap_or_default() }
            }
        }
        "NotSigned" => SignState::Unsigned,
        "" => SignState::Unknown("the signature check gave no status".into()),
        other => SignState::Broken(other.to_string()),
    }
}

/// A certificate subject in one comparable form: parts trimmed, case folded.
pub fn same_publisher(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.split(',').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect::<Vec<_>>();
    let (x, y) = (norm(a), norm(b));
    !x.is_empty() && x == y
}

/// The common name of a subject, for messages (`CN=Example Ltd, O=...` -> `Example Ltd`).
pub fn publisher_name(subject: &str) -> String {
    subject
        .split(',')
        .map(str::trim)
        .find_map(|p| p.strip_prefix("CN=").or_else(|| p.strip_prefix("cn=")))
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_else(|| subject.trim().to_string())
}

fn stop(why: String) -> Verdict {
    Verdict::Stop(format!("Kolux RS refused this update: {why} It will not be offered again. Your current version keeps working."))
}

/// The decision: may this installer replace the running copy?
pub fn decide(running: &SignState, installer: &SignState, pinned: Option<&str>) -> Verdict {
    if let SignState::Broken(s) = installer {
        return stop(format!("the installer's Windows signature is not valid ({s})."));
    }
    let expected: Option<String> = match (pinned.map(str::trim).filter(|p| !p.is_empty()), running) {
        (Some(p), _) => Some(p.to_string()),
        (None, SignState::Signed { subject, .. }) => Some(subject.clone()),
        (None, SignState::Unsigned) => None,
        (None, SignState::Broken(s)) => {
            return stop(format!("this copy's own Windows signature is damaged ({s}), so no publisher can be trusted. Reinstall Kolux RS from its releases page."));
        }
        (None, SignState::Unknown(why)) => {
            return stop(format!("this copy's own Windows signature could not be checked ({why})."));
        }
    };
    match (expected, installer) {
        (Some(want), SignState::Signed { subject, .. }) if same_publisher(&want, subject) => Verdict::Install,
        (Some(want), SignState::Signed { subject, .. }) => stop(format!(
            "the installer is signed by {} but Kolux RS is published by {}.",
            publisher_name(subject),
            publisher_name(&want)
        )),
        (Some(want), SignState::Unsigned) => stop(format!("the installer is not signed, but Kolux RS is signed by {}.", publisher_name(&want))),
        (Some(_), SignState::Unknown(why)) => stop(format!("the installer's Windows signature could not be checked ({why}).")),
        (None, SignState::Signed { .. }) | (None, SignState::Unsigned) => Verdict::Install,
        (None, SignState::Unknown(why)) => stop(format!("the installer's Windows signature could not be checked ({why}).")),
        (_, SignState::Broken(_)) => unreachable!("handled above"),
    }
}

/// Writes the downloaded installer to `dir`, checks it with `check` against the running copy's
/// signature, and removes the file again. The installer itself is never started here.
pub fn vet(bytes: &[u8], dir: &Path, version: &str, running: &SignState, pinned: Option<&str>, check: impl Fn(&Path) -> SignState) -> Verdict {
    let safe: String = version.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    let file = dir.join(format!("kolux-rs-update-{safe}-{}.exe", std::process::id()));
    let installer = match std::fs::create_dir_all(dir).and_then(|()| std::fs::write(&file, bytes)) {
        Ok(()) => check(&file),
        Err(e) => SignState::Unknown(format!("the download could not be written for the check: {}", e.kind())),
    };
    let _ = std::fs::remove_file(&file);
    decide(running, &installer, pinned)
}

/// Adds a refused version to the stored list (no repeats, newest kept).
pub fn refused_add(list: Option<&str>, version: &str) -> String {
    let mut v: Vec<&str> = list.unwrap_or("").split('\n').map(str::trim).filter(|s| !s.is_empty() && *s != version).collect();
    v.push(version);
    let start = v.len().saturating_sub(REFUSED_KEEP);
    v[start..].join("\n")
}

pub fn refused_has(list: Option<&str>, version: &str) -> bool {
    list.unwrap_or("").split('\n').any(|s| s.trim() == version)
}

/// Reads one file's signature with Windows' own tool. The path travels in an environment
/// variable, never inside the script text.
#[cfg(windows)]
pub fn check_file(path: &Path) -> SignState {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let ps = Path::new(&root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    let script = "$ErrorActionPreference='Stop'; $s = Get-AuthenticodeSignature -LiteralPath $env:KOLUX_RS_SIG_FILE; \
        $c = $s.SignerCertificate; \
        [pscustomobject]@{ status = [string]$s.Status; subject = $(if ($c) { $c.Subject } else { '' }); thumbprint = $(if ($c) { $c.Thumbprint } else { '' }) } | ConvertTo-Json -Compress";
    match std::process::Command::new(ps)
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env("KOLUX_RS_SIG_FILE", path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(o) if o.status.success() => parse_report(&String::from_utf8_lossy(&o.stdout)),
        Ok(_) => SignState::Unknown("the Windows signature check failed".into()),
        Err(e) => SignState::Unknown(format!("the Windows signature check could not start: {}", e.kind())),
    }
}

/// Authenticode is a Windows matter; other systems have no publisher signature to compare.
#[cfg(not(windows))]
pub fn check_file(_path: &Path) -> SignState {
    SignState::Unsigned
}

/// The running program's own signature.
pub fn running_state() -> SignState {
    match std::env::current_exe() {
        Ok(p) => check_file(&p),
        Err(e) => SignState::Unknown(format!("this copy's own program could not be found: {}", e.kind())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACME: &str = "CN=Acme Tools Ltd, O=Acme Tools Ltd, L=Leeds, C=GB";
    fn signed(subject: &str, thumb: &str) -> SignState {
        SignState::Signed { subject: subject.into(), thumbprint: thumb.into() }
    }
    fn stopped(v: Verdict) -> String {
        match v {
            Verdict::Stop(why) => why,
            Verdict::Install => panic!("expected a stop"),
        }
    }

    #[test]
    fn reports_from_the_windows_tool_are_read() {
        assert_eq!(parse_report(r#"{"status":"Valid","subject":"CN=Acme Tools Ltd","thumbprint":"AB12"}"#), signed("CN=Acme Tools Ltd", "AB12"));
        assert_eq!(parse_report(r#"{"status":"NotSigned","subject":"","thumbprint":""}"#), SignState::Unsigned);
        assert_eq!(parse_report(r#"{"status":"HashMismatch","subject":"CN=Acme Tools Ltd","thumbprint":"AB12"}"#), SignState::Broken("HashMismatch".into()));
        assert_eq!(parse_report(r#"{"status":"NotTrusted","subject":"CN=Self","thumbprint":"CD"}"#), SignState::Broken("NotTrusted".into()));
        assert!(matches!(parse_report(r#"{"status":"Valid","subject":" ","thumbprint":"AB"}"#), SignState::Broken(_)));
        assert!(matches!(parse_report("garbage"), SignState::Unknown(_)));
        assert!(matches!(parse_report("{}"), SignState::Unknown(_)));
    }

    #[test]
    fn a_signed_copy_takes_only_its_own_publisher() {
        let running = signed(ACME, "OLD1");
        // A renewed certificate (new thumbprint, same subject, other spacing and case) still updates.
        assert_eq!(decide(&running, &signed("cn=Acme Tools Ltd,O=Acme Tools Ltd, L=Leeds,  C=GB", "NEW2"), None), Verdict::Install);
        let why = stopped(decide(&running, &signed("CN=Mallory Software, O=Mallory", "EV1"), None));
        assert!(why.contains("Mallory Software") && why.contains("Acme Tools Ltd"), "{why}");
        assert!(why.contains("not be offered again"), "{why}");
        let why = stopped(decide(&running, &SignState::Unsigned, None));
        assert!(why.contains("not signed"), "{why}");
        assert!(stopped(decide(&running, &SignState::Unknown("tool failed".into()), None)).contains("could not be checked"));
        assert!(stopped(decide(&running, &SignState::Broken("HashMismatch".into()), None)).contains("HashMismatch"));
    }

    #[test]
    fn a_pinned_publisher_wins_over_the_running_signature() {
        // Pinned build: the installer must carry the pinned publisher, whatever the copy reports.
        assert_eq!(decide(&SignState::Unsigned, &signed(ACME, "X"), Some(ACME)), Verdict::Install);
        assert!(matches!(decide(&SignState::Unsigned, &SignState::Unsigned, Some(ACME)), Verdict::Stop(_)));
        assert!(matches!(decide(&signed("CN=Other", "Y"), &signed("CN=Other", "Y"), Some(ACME)), Verdict::Stop(_)));
        assert_eq!(decide(&SignState::Unknown("x".into()), &signed(ACME, "X"), Some(ACME)), Verdict::Install);
        // An empty pin counts as no pin.
        assert_eq!(decide(&SignState::Unsigned, &SignState::Unsigned, Some("  ")), Verdict::Install);
    }

    #[test]
    fn an_unsigned_copy_never_takes_a_broken_signature() {
        assert_eq!(decide(&SignState::Unsigned, &SignState::Unsigned, None), Verdict::Install);
        assert_eq!(decide(&SignState::Unsigned, &signed(ACME, "X"), None), Verdict::Install);
        assert!(matches!(decide(&SignState::Unsigned, &SignState::Broken("NotTrusted".into()), None), Verdict::Stop(_)));
        assert!(matches!(decide(&SignState::Unsigned, &SignState::Unknown("x".into()), None), Verdict::Stop(_)));
    }

    #[test]
    fn a_copy_that_cannot_vouch_for_itself_refuses_everything() {
        for installer in [signed(ACME, "X"), SignState::Unsigned] {
            assert!(stopped(decide(&SignState::Broken("HashMismatch".into()), &installer, None)).contains("Reinstall"));
            assert!(matches!(decide(&SignState::Unknown("x".into()), &installer, None), Verdict::Stop(_)));
        }
    }

    #[test]
    fn vet_checks_a_temporary_copy_and_removes_it() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t293-{}-{}", std::process::id(), line!()));
        let seen = std::cell::RefCell::new(None);
        let v = vet(b"MZ fake installer", &dir, "1.2.3", &signed(ACME, "A"), None, |p| {
            *seen.borrow_mut() = Some((p.to_path_buf(), std::fs::read(p).unwrap()));
            signed("CN=Mallory", "B")
        });
        assert!(matches!(v, Verdict::Stop(_)));
        let (path, bytes) = seen.into_inner().unwrap();
        assert_eq!(bytes, b"MZ fake installer");
        assert!(path.file_name().unwrap().to_string_lossy().starts_with("kolux-rs-update-1.2.3-"));
        assert!(!path.exists(), "the checked copy is removed");
        // An odd version string never escapes the folder.
        let v = vet(b"x", &dir, "../../evil", &SignState::Unsigned, None, |p| {
            assert_eq!(p.parent().unwrap(), dir.as_path());
            SignState::Unsigned
        });
        assert_eq!(v, Verdict::Install);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refused_versions_are_remembered_once_and_capped() {
        let l = refused_add(None, "1.0.0");
        let l = refused_add(Some(&l), "1.1.0");
        let l = refused_add(Some(&l), "1.0.0");
        assert_eq!(l, "1.1.0\n1.0.0");
        assert!(refused_has(Some(&l), "1.0.0") && refused_has(Some(&l), "1.1.0"));
        assert!(!refused_has(Some(&l), "1.2.0") && !refused_has(None, "1.0.0"));
        let mut l = String::new();
        for i in 0..30 {
            l = refused_add(Some(&l), &format!("0.{i}.0"));
        }
        assert_eq!(l.lines().count(), REFUSED_KEEP);
        assert!(refused_has(Some(&l), "0.29.0") && !refused_has(Some(&l), "0.0.0"));
    }

    #[test]
    fn publisher_names_read_well() {
        assert_eq!(publisher_name(ACME), "Acme Tools Ltd");
        assert_eq!(publisher_name("O=No Common Name"), "O=No Common Name");
        assert!(!same_publisher("", ""));
    }

    // The real Windows tool on a file that is certainly unsigned (a fresh text file). This reads a
    // local file only; nothing is downloaded or run.
    #[cfg(windows)]
    #[test]
    fn the_windows_tool_reports_an_unsigned_file() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t293-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("plain.txt");
        std::fs::write(&f, "not signed").unwrap();
        let s = check_file(&f);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(matches!(s, SignState::Unsigned | SignState::Broken(_)), "{s:?}");
    }
}
