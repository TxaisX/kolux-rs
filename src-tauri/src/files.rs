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
// T-442-c: async, because fence.allow can ask git for every project's worktrees (a path outside
// the project roots, such as a Kolux worktree, on a cold 3 s cache) and that must never hold up typing.
#[tauri::command(async)]
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

/// Saves run one at a time (T-442-c): the disk-hash check and the write happen under one lock,
/// so two saves that now run on worker threads can never both pass the check and land out of
/// order; the later one is refused as changed on disk instead.
// ponytail: one lock for every path; saves are milliseconds, a per-path map if that ever shows.
static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// T-073 (EDIT-003): answers with the stamp of the file it just wrote, taken under the same lock,
/// so the editor remembers its own save and the disk-change check never takes it for an agent's.
#[tauri::command(async)]
pub fn file_write(path: String, text: String, loaded_hash: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<Option<Stamp>, WriteError> {
    let path = fence.allow(&path, &store, &git, true)?;
    let _one = WRITES.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    write_checked(&path, &text, loaded_hash.as_deref())?;
    Ok(stamp_of(&path))
}

/// T-073 (EDIT-003): what a cheap disk-change check compares: the modified time in milliseconds
/// and the size in bytes. It is advisory only (the banner); a same-size rewrite inside one check
/// or a tool that puts the old modified time back slips past it, and the save's hash check
/// (`write_checked`) is the guard that still refuses then.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Stamp {
    pub mtime: u64,
    pub size: u64,
}

/// The stamp of a file, or None when it is gone or cannot be looked at.
pub fn stamp_of(path: &Path) -> Option<Stamp> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    Some(Stamp { mtime, size: meta.len() })
}

/// T-073 (EDIT-003): the stamps of the files open in editor tabs, in the order asked, None for a
/// file that is gone, unreadable or outside the projects. The editor asks every two seconds for
/// the tabs in front and when the window gets focus.
/// ponytail: polling; a file watcher (the one the git-status lane adds) is the upgrade path, so the
/// two never both add a dependency.
#[tauri::command(async)]
pub fn file_stamps(paths: Vec<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Vec<Option<Stamp>> {
    paths.iter().map(|p| fence.allow(p, &store, &git, true).ok().and_then(|p| stamp_of(&p))).collect()
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

#[tauri::command(async)]
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
    fn t073_the_stamp_follows_a_rewrite_and_is_none_for_a_missing_file() {
        let dir = temp_dir("stamp");
        let f = dir.join("a.txt");
        fs::write(&f, "one
").unwrap();
        let first = stamp_of(&f).unwrap();
        assert_eq!(first.size, 4);
        fs::write(&f, "one two
").unwrap();
        let second = stamp_of(&f).unwrap();
        assert_ne!(first, second, "a rewrite to another size changes the stamp");
        assert_eq!(stamp_of(&dir.join("gone.txt")), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t073_council_the_hash_check_refuses_even_when_the_stamp_says_unchanged() {
        // The banner's stamp is advisory: a same-size rewrite that puts the old modified time
        // back looks unchanged to it, and the save must still be refused by the hash check.
        let dir = temp_dir("stamp-equal");
        let f = dir.join("a.txt");
        fs::write(&f, "aaaa
").unwrap();
        let loaded = text_hash(b"aaaa
");
        let before = stamp_of(&f).unwrap();
        let mtime = fs::metadata(&f).unwrap().modified().unwrap();
        fs::write(&f, "bbbb
").unwrap();
        fs::OpenOptions::new().write(true).open(&f).unwrap().set_modified(mtime).unwrap();
        assert_eq!(stamp_of(&f).unwrap(), before, "same size and the old modified time: the stamp cannot tell");
        let refused = write_checked(&f, "mine
", Some(&loaded));
        assert_eq!(refused, Err(WriteError::ChangedOnDisk { path: f.display().to_string(), disk_hash: Some(text_hash(b"bbbb
")) }));
        assert_eq!(fs::read_to_string(&f).unwrap(), "bbbb
", "the agent's text stays on disk");
        let _ = fs::remove_dir_all(&dir);
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

// ---- EDIT-043 (T-237-a): Open in another app ----
use std::path::PathBuf;
/// EDIT-043 (T-237-a): opens a project folder in another app or the system file manager. `command`
/// is the app's launch command (the user's own, from General settings; the window falls back to
/// VS Code's when a row has none); none at all opens the file manager. A relative path, a path the
/// fence refuses, or anything that is not a folder is refused (in that order, so a share is never
/// touched and a program is never run), and a launch that fails comes back as an error.
#[allow(dead_code)] // live once lib.rs registers files::open_in (coordinator hunk); drop this line then
#[tauri::command(async)]
pub fn open_in(path: String, command: Option<String>, fence: tauri::State<'_, crate::fence::Fence>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, git: tauri::State<'_, crate::git::Git>) -> Result<(), String> {
    let command = command.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
    if let Some(c) = &command {
        let settings = store.lock().map_err(|e| e.to_string())?.settings();
        if !saved_command(&settings, c) {
            return Err(format!("{c} is not one of the apps under General settings, so it was not run"));
        }
    }
    let dir = open_target(&path, |p| fence.allow(p, &store, &git, false))?;
    match command.as_deref() {
        None => crate::artifacts::system_open(&dir.to_string_lossy()),
        Some(c) => launch_in(&dir, c, std::env::var_os("PATH")),
    }
}

/// EDIT-043: the folder open_in opens. The path must be full before anything else; then the
/// fence decides (it refuses shares from the spelling alone, before any file system access); only
/// then is the disk asked, and only a folder passes, so a file such as setup.bat is never run.
/// FIX-2 (council FS-2): what comes back is the folder's canonical path (links and `..` resolved,
/// the `\\?\` prefix of a disk path dropped), never the caller's spelling: Windows collapses `..`
/// before the disk sees a path, so `C:\proj\a"&x|y\..\sub` is a real folder, and its quote and
/// shell characters must not reach the app's launcher.
pub fn open_target(path: &str, allow: impl FnOnce(&str) -> Result<PathBuf, String>) -> Result<PathBuf, String> {
    if !Path::new(path).is_absolute() {
        return Err(format!("{path} is not a full path, so it was not opened"));
    }
    let dir = allow(path)?;
    if !dir.exists() {
        return Err(format!("{path} does not exist"));
    }
    if !dir.is_dir() {
        return Err(format!("{path} is not a folder, so it was not opened"));
    }
    let real = dir.canonicalize().map_err(|e| format!("{path}: {e}"))?;
    Ok(plain_disk_path(real))
}

/// `\\?\C:\x` as `C:\x`; any other path as it is (the fence refuses shares and namespace paths).
fn plain_disk_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match (s.strip_prefix(r"\\?\"), p.components().next()) {
        (Some(rest), Some(std::path::Component::Prefix(x))) if matches!(x.kind(), std::path::Prefix::VerbatimDisk(..)) => PathBuf::from(rest),
        _ => p,
    }
}

/// A launch command split into the program and its arguments; double quotes group words.
pub fn split_command(cmd: &str) -> Vec<String> {
    let (mut out, mut word, mut quoted, mut any) = (Vec::new(), String::new(), false, false);
    for ch in cmd.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    out.push(std::mem::take(&mut word));
                    any = false;
                }
            }
            c => {
                word.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(word);
    }
    out
}

/// The program a launch command names: a full path as it is, else the first match on `path_var`
/// of the absolute folders on `path_var`. On Windows a name without one of the launchable
/// extensions is tried only with .com, .exe, .bat and .cmd, in that order (the default PATHEXT),
/// never bare: VS Code's bin folder holds an extensionless `code` shell script next to code.cmd.
pub fn find_program(program: &str, path_var: Option<std::ffi::OsString>) -> Option<PathBuf> {
    const LAUNCHABLE: [&str; 4] = [".com", ".exe", ".bat", ".cmd"];
    let given = Path::new(program);
    let has_ext = given.extension().and_then(|e| e.to_str()).is_some_and(|e| LAUNCHABLE.iter().any(|l| l[1..].eq_ignore_ascii_case(e)));
    let exts: &[&str] = if cfg!(windows) && !has_ext { &LAUNCHABLE } else { &[""] };
    if given.components().count() > 1 || given.is_absolute() {
        return exts.iter().map(|e| PathBuf::from(format!("{program}{e}"))).find(|p| p.is_file());
    }
    let dirs = path_var.map(|v| std::env::split_paths(&v).filter(|d| d.is_absolute()).collect::<Vec<_>>()).unwrap_or_default();
    dirs.iter().flat_map(|d| exts.iter().map(move |e| d.join(format!("{program}{e}")))).find(|p| p.is_file())
}

/// Starts `command` with `dir` as its last argument, without a console window. Batch launchers
/// (VS Code's `code` is one) get the standard library's batch-argument escaping, which refuses an
/// argument it cannot pass safely instead of handing it to the shell.
pub fn launch_in(dir: &Path, command: &str, path_var: Option<std::ffi::OsString>) -> Result<(), String> {
    let parts = split_command(command);
    let Some(name) = parts.first() else { return Err("the launch command is empty".into()) };
    let program = find_program(name, path_var).ok_or_else(|| format!("{name} was not found; check the app's launch command in General settings"))?;
    let mut cmd = std::process::Command::new(program);
    cmd.args(&parts[1..]).arg(dir).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("{name} did not start: {e}"))
}

/// EDIT-043: the window may only run VS Code's command or one saved under General settings
/// (openInApps). This keeps a stray or mistyped command out; it is not a wall against the window
/// itself, which can also write openInApps through the settings patch (the window is trusted code).
pub fn saved_command(settings: &serde_json::Value, cmd: &str) -> bool {
    cmd == "code" || settings["openInApps"].as_array().is_some_and(|a| a.iter().any(|r| r["command"].as_str().map(str::trim) == Some(cmd)))
}

#[cfg(test)]
mod open_in_tests {
    use super::*;

    #[test]
    fn edit043_relative_or_missing_paths_are_refused() {
        let pass = |p: &str| Ok(PathBuf::from(p));
        assert!(open_target("relative\\folder", pass).unwrap_err().contains("not a full path"));
        let gone = std::env::temp_dir().join("kolux-edit043-not-there-7f3a");
        assert!(open_target(&gone.to_string_lossy(), pass).unwrap_err().contains("does not exist"));
        assert!(open_target(&std::env::temp_dir().to_string_lossy(), pass).is_ok());
    }

    #[test]
    fn edit043_the_fence_decides_before_the_disk_and_only_a_folder_opens() {
        // the fence runs first: its refusal comes back even for a path that does not exist, so a
        // share is refused from its spelling and never reached
        let share = r"\\host\share\proj";
        let mut asked = None;
        let err = open_target(share, |p| {
            asked = Some(p.to_string());
            Err(format!("Kolux does not open files from other computers' shares: {p}"))
        })
        .unwrap_err();
        assert_eq!(asked.as_deref(), Some(share));
        assert!(err.contains("shares"), "{err}");
        let relative = open_target("proj", |_| panic!("the fence is not asked about a relative path"));
        assert!(relative.unwrap_err().contains("not a full path"));
        // a file inside the project (setup.bat) is refused, never handed to the system to run
        let base = std::env::temp_dir().join(format!("kolux-edit043-file-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let bat = base.join("setup.bat");
        std::fs::write(&bat, "@echo off\r\n").unwrap();
        let err = open_target(&bat.to_string_lossy(), |p| Ok(PathBuf::from(p))).unwrap_err();
        assert!(err.contains("is not a folder"), "{err}");
        assert_eq!(open_target(&base.to_string_lossy(), |p| Ok(PathBuf::from(p))).unwrap(), plain_disk_path(base.canonicalize().unwrap()));
        let _ = std::fs::remove_dir_all(&base);
    }

    // FIX-2 (council FS-2): the launcher gets the canonical folder, never the caller's spelling.
    // Windows collapses `..` before the disk sees the path, so a spelling with a quote and shell
    // characters in a component that `..` cancels is a real folder; none of it may come back.
    #[cfg(windows)]
    #[test]
    fn edit043_the_folder_opened_is_the_canonical_one_not_the_callers_spelling() {
        let base = std::env::temp_dir().join(format!("kolux-edit043-canon-{}", std::process::id()));
        std::fs::create_dir_all(base.join("sub")).unwrap();
        let canonical = base.join("sub").canonicalize().unwrap();
        let spelled = format!(r#"{}\a"&x|y<z>\..\sub"#, base.display());
        assert!(Path::new(&spelled).is_dir(), "Windows resolves the dot-dot first: {spelled}");
        let got = open_target(&spelled, |p| Ok(PathBuf::from(p))).unwrap();
        let s = got.to_string_lossy().to_string();
        assert!(!s.contains(['"', '&', '|', '<', '>']) && !s.contains(".."), "{s}");
        assert!(!s.starts_with(r"\\?\"), "a plain disk path for the launcher: {s}");
        assert_eq!(got, plain_disk_path(canonical));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn edit043_an_extensionless_script_next_to_the_cmd_is_never_picked() {
        // VS Code's bin folder: an extensionless `code` shell script beside code.cmd
        let bin = std::env::temp_dir().join(format!("kolux-edit043-pathext-{}", std::process::id()));
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("fakeed"), "#!/usr/bin/env sh\n").unwrap();
        std::fs::write(bin.join("fakeed.cmd"), "@echo off\r\n").unwrap();
        let path = Some(std::env::join_paths([PathBuf::from("relative-bin"), bin.clone()]).unwrap());
        assert_eq!(find_program("fakeed", path.clone()), Some(bin.join("fakeed.cmd")));
        assert_eq!(find_program("fakeed.cmd", path.clone()), Some(bin.join("fakeed.cmd")));
        std::fs::write(bin.join("fakeed.exe"), "").unwrap();
        assert_eq!(find_program("fakeed", path.clone()), Some(bin.join("fakeed.exe")), ".exe comes before .cmd, as in PATHEXT");
        std::fs::remove_file(bin.join("fakeed.cmd")).unwrap();
        std::fs::remove_file(bin.join("fakeed.exe")).unwrap();
        assert_eq!(find_program("fakeed", path), None, "the bare script alone is not launchable");
        let _ = std::fs::remove_dir_all(&bin);
    }

    #[test]
    fn edit043_launch_commands_split_on_spaces_with_quotes_grouping() {
        assert_eq!(split_command("code"), vec!["code"]);
        assert_eq!(split_command("  code   -n "), vec!["code", "-n"]);
        assert_eq!(split_command(r#""C:\Program Files\Zed\zed.exe" --new"#), vec![r"C:\Program Files\Zed\zed.exe", "--new"]);
        assert_eq!(split_command(r#"app """#), vec!["app", ""]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn edit043_a_launcher_runs_with_the_folder_and_a_missing_one_is_reported() {
        let base = std::env::temp_dir().join(format!("kolux-edit043-{}", std::process::id()));
        let bin = base.join("bin");
        let work = base.join("my work");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        let out = base.join("got.txt");
        #[cfg(windows)]
        std::fs::write(bin.join("fakeed.cmd"), format!("@echo %~1> \"{}\"\r\n", out.display())).unwrap();
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let f = bin.join("fakeed");
            std::fs::write(&f, format!("#!/bin/sh\necho \"$1\" > \"{}\"\n", out.display())).unwrap();
            std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = Some(bin.clone().into_os_string());
        assert!(find_program("fakeed", path.clone()).is_some());
        launch_in(&work, "fakeed", path.clone()).unwrap();
        let mut got = String::new();
        for _ in 0..100 {
            if let Ok(s) = std::fs::read_to_string(&out) {
                if !s.trim().is_empty() {
                    got = s;
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(got.trim(), work.to_string_lossy());
        let err = launch_in(&work, "no-such-editor-edit043", path).unwrap_err();
        assert!(err.contains("no-such-editor-edit043 was not found"), "{err}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn edit043_only_vs_code_or_a_saved_app_command_is_run() {
        let none = serde_json::json!({});
        assert!(saved_command(&none, "code"));
        assert!(!saved_command(&none, "cmd /c calc"));
        let saved = serde_json::json!({ "openInApps": [{ "label": "Zed", "command": " zed " }] });
        assert!(saved_command(&saved, "zed"));
        assert!(!saved_command(&saved, "zed --evil"));
    }
}
