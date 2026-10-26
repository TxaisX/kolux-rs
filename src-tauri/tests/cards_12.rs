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

// ---- batch 2: EDIT-034 explorer file operations (scratch root edit12b) ----

use kolux_rs_lib::fsops::{copy_into, create, restore, trash_each};

fn scratch_b(tag: &str) -> PathBuf {
    for var in ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "USERPROFILE", "HOME"] {
        let v = std::env::var(var).unwrap_or_default();
        assert!(norm(Path::new(&v)).starts_with(&norm(Path::new(ROOT))), "{var} must point under {ROOT}, not {v}");
    }
    let d = Path::new(ROOT).join("edit12b").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

#[test]
fn edit034_box1_create_on_a_taken_name_is_refused_and_the_original_is_untouched() {
    let d = scratch_b("e34b1");
    std::fs::write(d.join("notes.txt"), "original text").unwrap();
    let err = create(&d, "notes.txt", false).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    let err = create(&d, "notes.txt", true).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(std::fs::read_to_string(d.join("notes.txt")).unwrap(), "original text");
    assert!(d.join("notes.txt").is_file());
    // a free name is created empty
    let made = create(&d, "fresh.txt", false).unwrap();
    assert_eq!(std::fs::read_to_string(made).unwrap(), "");
}

#[test]
fn edit034_box2_two_files_go_to_the_trash_in_one_call_and_undo_brings_both_back() {
    let d = scratch_b("e34b2");
    let tag = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let a = d.join(format!("cards-del-a-{tag}.txt"));
    let b = d.join(format!("cards-del-b-{tag}.txt"));
    std::fs::write(&a, "alpha body").unwrap();
    std::fs::write(&b, "beta body").unwrap();
    let paths = vec![a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned()];
    // one fs_trash call carries both selected paths
    let gone = trash_each(&paths);
    assert_eq!(gone.len(), 2);
    for g in &gone {
        assert!(g.error.is_none(), "{:?}", g.error);
        assert!(!g.permanent, "scratch is not a WSL share, so this goes to the trash");
    }
    assert!(!a.exists() && !b.exists(), "both left the folder");
    // the undo call (fs_restore with the same paths)
    restore(&paths).unwrap();
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "alpha body");
    assert_eq!(std::fs::read_to_string(&b).unwrap(), "beta body");
}

#[test]
fn edit034_box3_a_dropped_folder_onto_one_that_holds_the_same_name_arrives_under_a_new_name() {
    let d = scratch_b("e34b3");
    let desk = d.join("desktop").join("proj");
    std::fs::create_dir_all(desk.join("sub")).unwrap();
    std::fs::write(desk.join("a.txt"), "from the desktop").unwrap();
    std::fs::write(desk.join("sub").join("b.txt"), "nested").unwrap();
    let target = d.join("tree").join("folder");
    std::fs::create_dir_all(target.join("proj")).unwrap();
    std::fs::write(target.join("proj").join("mine.txt"), "already here").unwrap();

    let (to, skipped) = copy_into(&desk, &target).unwrap();
    assert_eq!(skipped, 0);
    assert_eq!(to.file_name().unwrap().to_string_lossy(), "proj copy");
    assert_eq!(std::fs::read_to_string(to.join("a.txt")).unwrap(), "from the desktop");
    assert_eq!(std::fs::read_to_string(to.join("sub").join("b.txt")).unwrap(), "nested");
    // the folder that was already there is untouched, and the source is still whole
    assert_eq!(std::fs::read_to_string(target.join("proj").join("mine.txt")).unwrap(), "already here");
    assert!(!target.join("proj").join("a.txt").exists());
    assert_eq!(std::fs::read_to_string(desk.join("a.txt")).unwrap(), "from the desktop");
    // a second drop does not overwrite the first copy either
    let (again, _) = copy_into(&desk, &target).unwrap();
    assert_eq!(again.file_name().unwrap().to_string_lossy(), "proj copy 2");
}
