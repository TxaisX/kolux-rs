// Reading and saving the text of a file shown in an editor tab (EDIT-001). A save goes to a
// temporary file beside the target and is then moved over it, so a failed write never leaves a
// half-written file behind. Fencing file access to the user's projects is EDIT-045 (T-062);
// large and binary files are EDIT-046 (T-178).
use std::fs;
use std::io::Write;
use std::path::Path;

pub fn read_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text", path.display()))
}

pub fn write_text(path: &Path, text: &str) -> Result<(), String> {
    let name = path.file_name().ok_or_else(|| format!("{} is not a file path", path.display()))?;
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let temp = dir.join(format!(".{}.kolux-save-{}", name.to_string_lossy(), std::process::id()));
    let fail = |e: std::io::Error| {
        let _ = fs::remove_file(&temp);
        format!("could not save {}: {e}", path.display())
    };
    let mut f = fs::File::create(&temp).map_err(fail)?;
    f.write_all(text.as_bytes()).and_then(|_| f.sync_all()).map_err(fail)?;
    drop(f);
    fs::rename(&temp, path).map_err(fail)
}

#[tauri::command]
pub fn file_read(path: String) -> Result<String, String> {
    read_text(Path::new(&path))
}

#[tauri::command]
pub fn file_write(path: String, text: String) -> Result<(), String> {
    write_text(Path::new(&path), &text)
}

/// The worktree's markdown files for the Mod+Shift+O picker (EDIT-012), at most 2000 of them.
#[derive(serde::Serialize)]
pub struct Notes {
    files: Vec<String>,
    capped: bool,
}

#[tauri::command]
pub fn md_list(root: String, git: tauri::State<'_, crate::git::Git>) -> Result<Notes, String> {
    let (files, capped) = git.markdown_files(Path::new(&root), 2000)?;
    Ok(Notes { files, capped })
}

/// Mod+Shift+M: an empty note at the worktree root named untitled.md, then untitled-2.md and
/// onwards. It never overwrites a file and gives up after 100 taken names. Naming it on the
/// first save is EDIT-054 (T-237).
#[tauri::command]
pub fn md_new(root: String) -> Result<String, String> {
    new_note(Path::new(&root))
}

pub fn new_note(root: &Path) -> Result<String, String> {
    for n in 1..=100 {
        let name = if n == 1 { "untitled.md".to_string() } else { format!("untitled-{n}.md") };
        let path = root.join(name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path.to_string_lossy().into_owned()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("could not create a note in {}: {e}", root.display())),
        }
    }
    Err(format!("{} already has 100 untitled notes; rename or delete some first", root.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("krs-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_save_replaces_the_file_and_leaves_no_temporary_behind() {
        let d = temp_dir("save");
        let f = d.join("main.rs");
        fs::write(&f, "fn main() {}\n").unwrap();
        write_text(&f, "fn main() { x }\n").unwrap();
        assert_eq!(read_text(&f).unwrap(), "fn main() { x }\n");
        assert_eq!(fs::read_dir(&d).unwrap().count(), 1);
    }

    #[test]
    fn new_notes_count_up_and_never_overwrite() {
        let d = temp_dir("notes");
        fs::write(d.join("untitled-2.md"), "keep").unwrap();
        let a = new_note(&d).unwrap();
        let b = new_note(&d).unwrap();
        assert!(a.ends_with("untitled.md") && b.ends_with("untitled-3.md"), "{a} {b}");
        assert_eq!(read_text(&d.join("untitled-2.md")).unwrap(), "keep");
        for n in 4..=100 {
            fs::write(d.join(format!("untitled-{n}.md")), "").unwrap();
        }
        assert!(new_note(&d).unwrap_err().contains("100 untitled notes"));
    }

    #[test]
    fn failures_name_the_file() {
        let d = temp_dir("fail");
        let missing = d.join("nope").join("a.txt");
        assert!(read_text(&missing).unwrap_err().contains("a.txt"));
        assert!(write_text(&missing, "x").unwrap_err().starts_with("could not save"));
        fs::write(d.join("bin"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_text(&d.join("bin")).unwrap_err().contains("not UTF-8"));
    }
}
