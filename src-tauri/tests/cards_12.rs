//! spec/12 P0 boxes (batch 1): EDIT-001 and EDIT-003 file back end, on real files under the scratch
//! root G:\Temp\cards-v3\edit12\.

use kolux_rs_lib::files::{read_text, stamp_of, text_hash, write_checked};
use std::path::{Path, PathBuf};

const ROOT: &str = r"G:\Temp\cards-v3";

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there.
fn scratch(tag: &str) -> PathBuf {
    for var in ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "USERPROFILE", "HOME"] {
        let v = std::env::var(var).unwrap_or_default();
        assert!(norm(Path::new(&v)).starts_with(&norm(Path::new(ROOT))), "{var} must point under {ROOT}, not {v}");
    }
    let base = Path::new(ROOT).join("edit12");
    let d = base.join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

#[test]
fn edit001_box1_save_puts_the_typed_character_on_disk() {
    let d = scratch("e1b1");
    let f = d.join("main.rs");
    std::fs::write(&f, "fn main() {}\n").unwrap();
    let loaded = read_text(&f).unwrap();
    let hash = text_hash(loaded.as_bytes());
    let typed = format!("x{loaded}");
    write_checked(&f, &typed, Some(&hash)).unwrap();
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "xfn main() {}\n");
    assert_eq!(read_text(&f).unwrap(), typed);
}

#[cfg(windows)]
#[test]
fn edit001_box4_an_unreadable_file_fails_then_loads_after_access_returns() {
    use std::os::windows::fs::OpenOptionsExt;
    let d = scratch("e1b4");
    let f = d.join("secret.txt");
    std::fs::write(&f, "hello there\n").unwrap();
    // An exclusive handle (share mode 0) stands in for removed read permission: opening for read is refused.
    let lock = std::fs::OpenOptions::new().read(true).share_mode(0).open(&f).unwrap();
    let first = read_text(&f);
    assert!(first.is_err(), "reading a refused file must fail, got {first:?}");
    let second = read_text(&f);
    assert!(second.is_err(), "a second try (Retry) still fails while access is withheld");
    drop(lock);
    assert_eq!(read_text(&f).unwrap(), "hello there\n");
}

#[test]
fn edit003_box4_kolux_save_leaves_a_stable_stamp_that_an_outside_rewrite_changes() {
    let d = scratch("e3b4");
    let f = d.join("note.md");
    std::fs::write(&f, "one\n").unwrap();
    let hash = text_hash(b"one\n");
    write_checked(&f, "one\ntwo\n", Some(&hash)).unwrap();
    let after_save = stamp_of(&f).unwrap();
    assert_eq!(after_save.size, 8);
    assert_eq!(stamp_of(&f), Some(after_save), "nothing moved since Kolux's own save, so the check sees no change");
    std::fs::write(&f, "one\ntwo\nthree\n").unwrap(); // an agent's rewrite
    assert_ne!(stamp_of(&f), Some(after_save));
}
