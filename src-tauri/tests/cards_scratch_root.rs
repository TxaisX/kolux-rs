//! The scratch-root rule itself: found from the home's ancestors, any root accepted, the real home refused.

mod scratch_root;

use scratch_root::{real_home_conflict, resolve_from, root, MARKER};
use std::path::Path;

/// A scratch-made stand-in for another root, e.g. cards-v3-alt, with its own marker and a home below it.
fn fake_root(tag: &str) -> std::path::PathBuf {
    let d = root().join("rootcheck").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("home").join("AppData").join("Roaming")).unwrap();
    std::fs::write(d.join(MARKER), "").unwrap();
    std::fs::write(d.join("home").join(MARKER), "").unwrap();
    d
}

#[test]
fn a_marker_in_another_root_makes_that_root_the_scratch_root() {
    let alt = fake_root("alt");
    assert_eq!(resolve_from(&alt.join("home")).unwrap(), alt);
    assert_eq!(resolve_from(&alt.join("home").join("AppData").join("Roaming")).unwrap(), alt.join("home"));
}

#[test]
fn the_search_never_creates_the_marker_it_looks_for() {
    let d = root().join("rootcheck").join(format!("bare-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("home")).unwrap();
    // The enclosing root holds the real marker, so this resolves to it; nothing is written below.
    assert_eq!(resolve_from(&d.join("home")).unwrap(), root());
    assert!(!d.join(MARKER).exists() && !d.join("home").join(MARKER).exists());
}

#[test]
fn no_marker_before_the_drive_root_is_an_error() {
    let err = resolve_from(Path::new(r"Z:\no-such-scratch\home")).unwrap_err();
    assert!(err.contains(MARKER), "{err}");
}

#[test]
fn the_real_home_is_refused_as_or_inside_the_root() {
    let real = Path::new(r"C:\Users\someone");
    assert!(real_home_conflict(Path::new(r"C:\Users\someone"), Some(real)).is_some());
    assert!(real_home_conflict(Path::new(r"C:\Users"), Some(real)).is_some());
    assert!(real_home_conflict(Path::new(r"C:\Users\someone-scratch"), Some(real)).is_none());
    assert!(real_home_conflict(Path::new(r"G:\Temp\cards-v3-alt"), Some(real)).is_none());
    assert!(real_home_conflict(Path::new(r"C:\Users"), None).is_none());
}

#[test]
fn the_derived_root_holds_all_four_homes() {
    let r = root();
    for var in ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "USERPROFILE", "HOME"] {
        let v = std::env::var(var).unwrap();
        assert!(scratch_root::within(Path::new(&v), r), "{var}={v}");
    }
}
