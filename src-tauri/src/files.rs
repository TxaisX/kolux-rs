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

/// The two texts of a diff tab (EDIT-027); see Git::diff_sides.
#[derive(serde::Serialize)]
pub struct Sides {
    original: String,
    modified: String,
}

#[tauri::command]
pub fn diff_sides(path: String, staged: bool, git: tauri::State<'_, crate::git::Git>) -> Result<Sides, String> {
    let (original, modified) = git.diff_sides(Path::new(&path), staged)?;
    Ok(Sides { original, modified })
}

/// The changed files the diff picker lists (EDIT-027).
#[tauri::command]
pub fn git_changes(root: String, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<crate::git::Change>, String> {
    git.changes(Path::new(&root))
}

/// Every change of the worktree for All Changes (EDIT-029); see Git::change_entries.
#[tauri::command]
pub fn change_entries(root: String, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<crate::git::Entry>, String> {
    git.change_entries(Path::new(&root))
}

/// One side of a changed image, as bytes (EDIT-029: images load on their own); empty when the
/// file is not on that side.
#[tauri::command]
pub fn diff_image(path: String, staged: bool, new: bool, git: tauri::State<'_, crate::git::Git>) -> Result<tauri::ipc::Response, String> {
    let (old, now) = git.diff_bytes(Path::new(&path), staged)?;
    Ok(tauri::ipc::Response::new(if new { now } else { old }))
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

/// One row of the explorer (EDIT-033). A symlink (or junction) is `link` until it is opened, so it
/// expands only once `path_kind` has confirmed it points at a folder.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
}

/// A folder's entries for the explorer: folders first, then by name ignoring case; `.git` is left out.
pub fn list_dir(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let mut out: Vec<DirEntry> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .filter(|e| e.file_name() != ".git")
        .map(|e| {
            let kind = match e.file_type() {
                Ok(t) if t.is_symlink() => "link",
                Ok(t) if t.is_dir() => "dir",
                _ => "file",
            };
            DirEntry { name: e.file_name().to_string_lossy().into_owned(), path: e.path().to_string_lossy().into_owned(), kind }
        })
        .collect();
    out.sort_by(|a, b| (a.kind != "dir").cmp(&(b.kind != "dir")).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
pub fn dir_list(path: String) -> Result<Vec<DirEntry>, String> {
    list_dir(Path::new(&path))
}

/// What a path really is, following links: "dir", "file" or "missing".
#[tauri::command]
pub fn path_kind(path: String) -> &'static str {
    match fs::metadata(&path) {
        Ok(m) if m.is_dir() => "dir",
        Ok(_) => "file",
        Err(_) => "missing",
    }
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
    fn the_explorer_lists_folders_first_by_name_and_leaves_out_git() {
        let d = temp_dir("list");
        for f in ["b.txt", "A.txt"] {
            fs::write(d.join(f), "x").unwrap();
        }
        for f in ["zeta", "Alpha", ".git"] {
            fs::create_dir(d.join(f)).unwrap();
        }
        let got: Vec<_> = list_dir(&d).unwrap().into_iter().map(|e| (e.name, e.kind)).collect();
        assert_eq!(got, [("Alpha".to_string(), "dir"), ("zeta".to_string(), "dir"), ("A.txt".to_string(), "file"), ("b.txt".to_string(), "file")]);
        assert_eq!(path_kind(d.join("zeta").to_string_lossy().into()), "dir");
        assert_eq!(path_kind(d.join("nope").to_string_lossy().into()), "missing");
        let _ = fs::remove_dir_all(&d);
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
