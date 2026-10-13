// Reading and saving the text of a file shown in an editor tab (EDIT-001). A save goes to a
// temporary file beside the target and is then moved over it, so a failed write never leaves a
// half-written file behind. Every command here takes only paths inside the user's projects and
// worktrees (ACCT-055, fence.rs); EDIT-045's `links::fence` guards the file operations and
// `path_kind` (inside a project or granted exactly, never out through a link); the WSL and share
// parts of EDIT-045 are T-062; large and binary files are EDIT-046 (T-178).
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

type Store<'a> = tauri::State<'a, std::sync::Mutex<crate::state::Store>>;
type Grants<'a> = tauri::State<'a, crate::links::Grants>;

/// SAFE-021 / EDIT-045: a path on another machine, outside the projects, or leading out through a
/// link is refused before the file is touched.
#[tauri::command]
pub fn file_read(path: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<String, String> {
    read_text(&fence.allow(&path, &store, &git, true)?)
}

/// T-073-a (EDIT-003): the SHA-256 of a file's bytes as lowercase hex. The editor hashes the UTF-8
/// bytes of the text it loaded the same way (file_read hands the bytes back unchanged).
pub fn text_hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Why file_write did not save. `Failed` goes to the window as the plain message it always was;
/// `ChangedOnDisk` goes as `{ kind: "stale", message, path, diskHash }` (diskHash null
/// when the file is gone), so the editor can offer to reload or overwrite.
#[derive(Debug, PartialEq)]
pub enum WriteError {
    ChangedOnDisk { path: String, disk_hash: Option<String> },
    Failed(String),
}

impl From<String> for WriteError {
    fn from(message: String) -> Self {
        WriteError::Failed(message)
    }
}

impl serde::Serialize for WriteError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            WriteError::Failed(message) => s.serialize_str(message),
            WriteError::ChangedOnDisk { path, disk_hash } => serde_json::json!({
                "kind": "stale", // the kind the editor's isStale (src/editor/buffers.ts) looks for
                "message": format!("{path} changed on disk since it was opened, so it was not saved"),
                "path": path,
                "diskHash": disk_hash,
            })
            .serialize(s),
        }
    }
}

/// Saves `text` over `path`. With `loaded_hash` (the `text_hash` of the text the editor loaded)
/// the save is refused when the file on disk no longer has that hash, so an agent's edit is never
/// overwritten unseen. Without it the save goes ahead as before.
/// ponytail: the check and the rename are not one atomic step; a write landing in between is lost.
pub fn write_checked(path: &Path, text: &str, loaded_hash: Option<&str>) -> Result<(), WriteError> {
    if let Some(want) = loaded_hash {
        let disk_hash = match fs::read(path) {
            Ok(bytes) => Some(text_hash(&bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(WriteError::Failed(format!("could not check {} before saving: {e}", path.display()))),
        };
        if disk_hash.as_deref() != Some(want.trim()) {
            return Err(WriteError::ChangedOnDisk { path: path.display().to_string(), disk_hash });
        }
    }
    Ok(write_text(path, text)?)
}

#[tauri::command]
pub fn file_write(path: String, text: String, loaded_hash: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), WriteError> {
    write_checked(&fence.allow(&path, &store, &git, true)?, &text, loaded_hash.as_deref())
}

/// ACCT-055: Open a file shows the system picker here, so only the file the user chose is
/// granted (never its folder); none when the picker was cancelled.
#[tauri::command]
pub async fn file_pick(app: tauri::AppHandle, default_path: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut pick = app.dialog().file().set_title("Open a file");
    if let Some(dir) = default_path {
        pick = pick.set_directory(dir);
    }
    let Some(chosen) = pick.blocking_pick_file() else { return Ok(None) };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    fence.grant(&path, &*store.lock().map_err(|e| e.to_string())?)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// The worktree's markdown files for the Mod+Shift+O picker (EDIT-012), at most 2000 of them.
#[derive(serde::Serialize)]
pub struct Notes {
    files: Vec<String>,
    capped: bool,
}

// TERM-115: async, so listing a big worktree through git never holds typing in another pane.
#[tauri::command(async)]
pub fn md_list(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Notes, String> {
    let (files, capped) = git.markdown_files(&fence.allow(&root, &store, &git, false)?, 2000)?;
    Ok(Notes { files, capped })
}

/// Quick Open's list of the worktree's files (EDIT-036), as paths relative to the worktree with
/// forward slashes, in natural order. ripgrep lists them: it honours .gitignore and stays quick on
/// trees of 100,000 files. When it is not installed, git's own list stands in where the folder is
/// a repository (`source` says which one answered, "none" when neither could).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    files: Vec<String>,
    capped: bool,
    source: &'static str,
    rg_missing: bool,
}

const LIST_CAP: usize = 200_000;
/// Build caches and editor settings (the Next framework's, VS Code's and JetBrains IDEs'), plus git's own folder.
const LEFT_OUT: [&str; 4] = [".git", ".next", ".vscode", ".idea"];

fn rg(root: &Path) -> std::io::Result<std::process::Output> {
    let mut cmd = std::process::Command::new("rg");
    cmd.args(["--files", "--hidden", "--no-messages", "--no-config"]);
    for dir in LEFT_OUT {
        cmd.args(["-g", &format!("!{dir}/")]);
    }
    cmd.current_dir(root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.output()
}

/// Splits a name into runs of digits and runs of anything else.
fn runs(s: &str) -> Vec<&str> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    for i in 1..b.len() {
        if b[i].is_ascii_digit() != b[i - 1].is_ascii_digit() {
            out.push(&s[start..i]);
            start = i;
        }
    }
    if !s.is_empty() {
        out.push(&s[start..]);
    }
    out
}

/// A sort key for natural order: "file2" before "file10", letters compared without case. Each run
/// of digits is padded to 20 places, so plain string order on the keys counts the numbers.
pub fn natural_key(s: &str) -> String {
    runs(s)
        .into_iter()
        .map(|r| if r.as_bytes()[0].is_ascii_digit() { format!("{:0>20}", r.trim_start_matches('0')) } else { r.to_lowercase() })
        .collect()
}

/// Normalises a raw listing: forward slashes, nothing inside a nested worktree (a folder holding a
/// `.git` file or folder of its own) or a left-out folder, natural order, at most `cap` names.
pub fn shape(raw: &str, cap: usize) -> (Vec<String>, bool) {
    let names: Vec<String> = raw.split(['\n', '\0']).map(|n| n.trim_end_matches('\r').replace('\\', "/")).filter(|n| !n.is_empty()).collect();
    // git lists a nested repository as "dir/"; ripgrep lists a nested worktree's ".git" file.
    let nested: Vec<String> = names.iter().filter_map(|n| n.strip_suffix("/.git").map(|d| format!("{d}/")).or_else(|| n.ends_with('/').then(|| n.clone()))).collect();
    let mut files: Vec<String> = names
        .into_iter()
        .filter(|n| !n.ends_with('/') && n != ".git" && !n.split('/').any(|s| LEFT_OUT.contains(&s)) && !nested.iter().any(|d| n.starts_with(d.as_str())))
        .collect();
    files.sort_by_cached_key(|n| (natural_key(n), n.clone()));
    let capped = files.len() > cap;
    files.truncate(cap);
    (files, capped)
}

#[tauri::command]
pub async fn file_list(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<FileList, String> {
    let root = fence.allow(&root, &store, &git, false)?;
    let git = git.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = root.as_path();
        // A one-off failure to start ripgrep is tried once more; only "not found" means it is missing.
        let out = rg(root).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Err(e) } else { rg(root) });
        match out {
            Ok(o) => {
                let (files, capped) = shape(&String::from_utf8_lossy(&o.stdout), LIST_CAP);
                Ok(FileList { files, capped, source: "rg", rg_missing: false })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(match git.listed_files(root) {
                Ok(raw) => {
                    let (files, capped) = shape(&raw, LIST_CAP);
                    FileList { files, capped, source: "git", rg_missing: true }
                }
                Err(_) => FileList { files: Vec::new(), capped: false, source: "none", rg_missing: true },
            }),
            Err(e) => Err(format!("could not start ripgrep: {e}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod list_tests {
    use super::*;

    #[test]
    fn natural_order_counts_numbers() {
        let mut v = vec!["mod10.ts", "Mod2.ts", "mod1.ts", "a/b.ts", "mod02.ts"];
        v.sort_by_cached_key(|n| (natural_key(n), n.to_string()));
        assert_eq!(v, ["a/b.ts", "mod1.ts", "Mod2.ts", "mod02.ts", "mod10.ts"]);
    }

    #[test]
    fn leaves_out_nested_worktrees_and_tool_folders() {
        let raw = "src\\main.rs\r\nwt\\.git\nwt\\sub\\w.txt\n.next\\x.js\napp\\.idea\\w.xml\n.git\nsub/\nsub/x.txt\nfile10\nfile2\n";
        assert_eq!(shape(raw, 10), (vec!["file2".to_string(), "file10".into(), "src/main.rs".into()], false));
        assert!(shape(raw, 2).1);
    }
}

/// The two texts of a diff tab (EDIT-027); see Git::diff_sides.
#[derive(serde::Serialize)]
pub struct Sides {
    original: String,
    modified: String,
}

#[tauri::command]
pub async fn diff_sides(path: String, staged: bool, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Sides, String> {
    let (original, modified) = git.diff_sides(&fence.allow(&path, &store, &git, false)?, staged)?;
    Ok(Sides { original, modified })
}

/// The changed files the diff picker lists (EDIT-027).
#[tauri::command(async)]
pub fn git_changes(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<crate::git::Change>, String> {
    git.changes(&fence.allow(&root, &store, &git, false)?)
}

/// Every change of the worktree for All Changes (EDIT-029); see Git::change_entries.
#[tauri::command]
pub async fn change_entries(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<crate::git::Entry>, String> {
    git.change_entries(&fence.allow(&root, &store, &git, false)?)
}

/// One side of a changed image, as bytes (EDIT-029: images load on their own); empty when the
/// file is not on that side.
#[tauri::command(async)]
pub fn diff_image(path: String, staged: bool, new: bool, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<tauri::ipc::Response, String> {
    let (old, now) = git.diff_bytes(&fence.allow(&path, &store, &git, false)?, staged)?;
    Ok(tauri::ipc::Response::new(if new { now } else { old }))
}

/// Mod+Shift+M: an empty note at the worktree root named untitled.md, then untitled-2.md and
/// onwards. It never overwrites a file and gives up after 100 taken names. Naming it on the
/// first save is EDIT-054 (T-237).
#[tauri::command(async)]
pub fn md_new(root: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<String, String> {
    new_note(&fence.allow(&root, &store, &git, false)?)
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
pub fn dir_list(path: String, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Vec<DirEntry>, String> {
    list_dir(&fence.allow(&path, &store, &git, false)?)
}

/// What a path really is: "remote" (another machine, never looked up; SAFE-021), "outside" (not
/// in a project, or out through a link; EDIT-045), else following links "dir", "file" or "missing".
#[tauri::command]
pub fn path_kind(store: Store<'_>, grants: Grants<'_>, path: String) -> &'static str {
    let roots = crate::links::roots(&store);
    match crate::links::fence(&path, &roots, &grants.snapshot(), true) {
        Ok(p) => kind_of(&p),
        Err(_) if crate::links::host_path(&path, &roots) => "remote",
        Err(_) => "outside",
    }
}

pub fn kind_of(path: &Path) -> &'static str {
    match fs::metadata(path) {
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
        assert_eq!(kind_of(&d.join("zeta")), "dir");
        assert_eq!(kind_of(&d.join("nope")), "missing");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn t073a_a_save_with_the_loaded_hash_is_refused_once_the_file_changed_on_disk() {
        let d = temp_dir("t073a");
        let f = d.join("notes.md");
        fs::write(&f, "first\n").unwrap();
        let loaded = text_hash(read_text(&f).unwrap().as_bytes());
        // SHA-256, lowercase hex: the standard test vector, so the editor's crypto.subtle digest matches.
        assert_eq!(text_hash(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

        // Unchanged on disk: the save goes through, and the new text's hash is the next one to send.
        write_checked(&f, "second\n", Some(&loaded)).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "second\n");
        let loaded = text_hash(b"second\n");

        // An agent edits the file: the save with the old hash is refused and the agent's text stays.
        fs::write(&f, "agent\n").unwrap();
        let err = write_checked(&f, "mine\n", Some(&loaded)).unwrap_err();
        assert_eq!(err, WriteError::ChangedOnDisk { path: f.display().to_string(), disk_hash: Some(text_hash(b"agent\n")) });
        assert_eq!(fs::read_to_string(&f).unwrap(), "agent\n");
        let sent = serde_json::to_value(&err).unwrap();
        assert_eq!((sent["kind"].as_str(), sent["diskHash"].as_str()), (Some("stale"), Some(text_hash(b"agent\n").as_str())));

        // Deleted on disk: refused with no disk hash. No hash given: saves as before.
        fs::remove_file(&f).unwrap();
        let gone = serde_json::to_value(write_checked(&f, "mine\n", Some(&loaded)).unwrap_err()).unwrap();
        assert!(gone["diskHash"].is_null() && !f.exists());
        write_checked(&f, "mine\n", None).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "mine\n");

        // Any other failure reaches the window as the plain message it always was.
        assert_eq!(serde_json::to_value(WriteError::Failed("could not save x".into())).unwrap(), serde_json::json!("could not save x"));
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
