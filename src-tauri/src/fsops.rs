// The explorer's file operations (EDIT-034, part 1): create, rename, delete to the system trash and
// bring back from it, and copy a path to the clipboard. The explorer keeps the undo history; each undo or redo is one of these calls.
// Part 2: copy (also used for files dropped in from the desktop) and move (drag in the tree).
// EDIT-045: every command fences its paths first (`links::fence`): the entry acted on must sit
// inside a project, and a folder written into must really be inside one.
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Renames run one at a time, so two racing for the same name cannot both pass the "is it free" check.
static RENAMES: Mutex<()> = Mutex::new(());

fn one_name(name: &str) -> Result<&str, String> {
    let mut parts = Path::new(name).components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(_)), None) if !name.trim().is_empty() && !name.contains(['/', '\\']) => Ok(name),
        _ => Err(format!("\"{name}\" is not a file name")),
    }
}

fn shown(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Makes an empty file or folder; never replaces anything already there.
pub fn create(dir: &Path, name: &str, folder: bool) -> Result<PathBuf, String> {
    let path = dir.join(one_name(name)?);
    let made = if folder { fs::create_dir(&path) } else { fs::OpenOptions::new().write(true).create_new(true).open(&path).map(drop) };
    made.map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("{name} already exists here"),
        _ => format!("could not create {name}: {e}"),
    })?;
    Ok(path)
}

/// Whether the folder holds an entry spelled exactly `name`. A file system that ignores case or
/// Unicode normalisation reports a differently spelled name as existing; this tells the two apart.
fn spelled(dir: &Path, name: &str) -> bool {
    fs::read_dir(dir).map(|it| it.filter_map(Result::ok).any(|e| e.file_name() == name)).unwrap_or(true)
}

/// Gives `from` a new name in the same folder. A symlink is renamed itself, never its target. A new
/// spelling of the same name (letter case, Unicode normalisation) is allowed; another entry's name is not.
pub fn rename(from: &Path, name: &str) -> Result<PathBuf, String> {
    let name = one_name(name)?;
    let dir = from.parent().ok_or_else(|| format!("{} has no folder", from.display()))?;
    let to = dir.join(name);
    let _turn = RENAMES.lock().unwrap_or_else(|e| e.into_inner());
    fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    if to.as_os_str() == from.as_os_str() {
        return Ok(to);
    }
    if fs::symlink_metadata(&to).is_ok() && spelled(dir, name) {
        return Err(format!("{name} already exists here"));
    }
    fs::rename(from, &to).map_err(|e| format!("could not rename {}: {e}", from.display()))?;
    Ok(to)
}

/// A WSL share has no trash, so a delete there is for good.
pub fn is_wsl(p: &Path) -> bool {
    let s = shown(p).replace('/', "\\").to_lowercase();
    s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\") || s.starts_with("\\\\?\\unc\\wsl$\\") || s.starts_with("\\\\?\\unc\\wsl.localhost\\")
}

#[derive(serde::Serialize, Debug)]
pub struct Gone {
    pub path: String,
    /// Deleted for good (a WSL share); there is nothing to undo.
    pub permanent: bool,
    pub error: Option<String>,
}

/// Deletes each path on its own, so one failure leaves the rest going.
pub fn trash_each(paths: &[String]) -> Vec<Gone> {
    paths
        .iter()
        .map(|p| {
            let path = Path::new(p);
            let permanent = is_wsl(path);
            let done = if permanent {
                match fs::symlink_metadata(path) {
                    Ok(m) => remove_retrying(path, m.is_dir()),
                    Err(e) => Err(e),
                }
                .map_err(|e| e.to_string())
            } else {
                trash::delete(path).map_err(|e| e.to_string())
            };
            Gone { path: p.clone(), permanent, error: done.err().map(|e| format!("{p}: {e}")) }
        })
        .collect()
}

/// EDIT-044: on Windows a removal that fails for a passing reason (the file locked for a moment:
/// sharing or lock violation, access denied) is tried a few more times before it counts as failed.
pub fn remove_retrying(path: &Path, dir: bool) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        let r = if dir { fs::remove_dir_all(path) } else { fs::remove_file(path) };
        match r {
            Err(e) if cfg!(windows) && tries < 5 && e.raw_os_error().is_some_and(|c| [5, 32, 33].contains(&c)) => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
            r => return r,
        }
    }
}

/// Whether a trash entry is the one deleted from `want`. Windows lists an entry by its shown name,
/// which leaves out the extension when Explorer hides extensions; the entry's own file keeps it.
#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
fn was_at(item: &trash::TrashItem, want: &Path) -> bool {
    let same = |a: &std::ffi::OsStr, b: &std::ffi::OsStr| a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase();
    let (Some(parent), Some(name)) = (want.parent(), want.file_name()) else { return false };
    same(item.original_parent.as_os_str(), parent.as_os_str())
        && (item.name == name || (Some(item.name.as_os_str()) == want.file_stem() && Path::new(&item.id).extension() == want.extension()))
}

/// Brings paths back from the trash, the latest deletion of each.
#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
pub fn restore(paths: &[String]) -> Result<(), String> {
    let mut items = trash::os_limited::list().map_err(|e| e.to_string())?;
    items.sort_by_key(|i| std::cmp::Reverse(i.time_deleted));
    let mut pick = Vec::new();
    for p in paths {
        let want = Path::new(p);
        let i = items.iter().position(|i| was_at(i, want)).ok_or_else(|| format!("{p} is not in the trash"))?;
        let mut item = items.remove(i);
        item.name = want.file_name().unwrap_or_default().to_owned(); // put back under its full name
        pick.push(item);
    }
    trash::os_limited::restore_all(pick).map_err(|e| match e {
        trash::Error::RestoreCollision { path, .. } => format!("{} exists again, so it was not put back", path.display()),
        e => e.to_string(),
    })
}

#[cfg(target_os = "macos")]
pub fn restore(_paths: &[String]) -> Result<(), String> {
    Err("putting files back from the trash needs the Finder on macOS".into()) // ponytail: no restore API in the trash crate on macOS
}

type Store<'a> = tauri::State<'a, Mutex<crate::state::Store>>;
type Grants<'a> = tauri::State<'a, crate::links::Grants>;
type Fence = (Vec<String>, std::collections::HashSet<String>);
/// ACCT-055's fence (fence.rs): the user's projects and their worktrees.
type Guard<'a> = tauri::State<'a, crate::fence::Fence>;
type GitState<'a> = tauri::State<'a, crate::git::Git>;

fn fence_of(store: &Store<'_>, grants: &Grants<'_>) -> Fence {
    (crate::links::roots(store), grants.snapshot())
}

fn fenced(f: &Fence, path: &str, follow: bool) -> Result<PathBuf, String> {
    crate::links::fence(path, &f.0, &f.1, follow)
}

// ACCT-055: each command below works only on paths inside the user's projects and worktrees
// (fence.rs) and, on top of that, never out through a link (EDIT-045's `links::fence`); a copy
// may also take files the user just dropped in from outside.
#[tauri::command]
pub fn fs_create(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, dir: String, name: String, folder: bool) -> Result<String, String> {
    guard.allow(&dir, &store, &git, false)?;
    create(&fenced(&fence_of(&store, &grants), &dir, true)?, &name, folder).map(|p| shown(&p))
}

#[tauri::command]
pub fn fs_rename(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, path: String, name: String) -> Result<String, String> {
    guard.allow(&path, &store, &git, false)?;
    rename(&fenced(&fence_of(&store, &grants), &path, false)?, &name).map(|p| shown(&p))
}

#[tauri::command]
pub async fn fs_trash(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, paths: Vec<String>) -> Result<Vec<Gone>, String> {
    let f = fence_of(&store, &grants);
    let refused = paths.iter().map(|p| guard.allow(p, &store, &git, false).err()).collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .zip(refused)
            .map(|(p, refused)| match refused.map_or_else(|| fenced(&f, &p, false), Err) {
                Ok(_) => trash_each(std::slice::from_ref(&p)).remove(0),
                Err(e) => Gone { path: p, permanent: false, error: Some(e) },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_restore(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, paths: Vec<String>) -> Result<(), String> {
    guard.allow_all(&paths, &store, &git)?;
    let f = fence_of(&store, &grants);
    for p in &paths {
        fenced(&f, p, false)?;
    }
    tauri::async_runtime::spawn_blocking(move || restore(&paths)).await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, Debug, Default)]
pub struct Placed {
    pub from: String,
    /// Where it landed; None when it failed.
    pub to: Option<String>,
    pub error: Option<String>,
}

/// "a.txt", then "a copy.txt", "a copy 2.txt" and on; a folder or a dot file keeps its whole name.
fn nth_name(name: &str, n: usize) -> String {
    if n == 0 {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    };
    if n == 1 { format!("{stem} copy{ext}") } else { format!("{stem} copy {n}{ext}") }
}

fn is_link(md: &fs::Metadata) -> bool {
    md.file_type().is_symlink() // on Windows a junction counts too
}

/// Copies a folder's contents into an empty `to`, skipping links inside it; returns how many it skipped.
fn fill(from: &Path, to: &Path) -> std::io::Result<usize> {
    let mut skipped = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let md = fs::symlink_metadata(entry.path())?;
        let dest = to.join(entry.file_name());
        if is_link(&md) {
            skipped += 1;
        } else if md.is_dir() {
            fs::create_dir(&dest)?;
            skipped += fill(&entry.path(), &dest)?;
        } else {
            let mut src = fs::File::open(entry.path())?;
            let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&dest)?;
            std::io::copy(&mut src, &mut out)?;
        }
    }
    Ok(skipped)
}

/// Copies a file or a whole folder into `dir`. It never overwrites: a taken name gets " copy",
/// " copy 2" and so on. A link is refused, and links inside a folder are left out.
pub fn copy_into(from: &Path, dir: &Path) -> Result<(PathBuf, usize), String> {
    let md = fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or_else(|| format!("{} has no name", from.display()))?;
    if is_link(&md) {
        return Err(format!("{name} is a link; links are not copied"));
    }
    if md.is_dir() && dir.starts_with(from) {
        return Err(format!("{name} cannot be copied into itself"));
    }
    for n in 0..1000 {
        let to = dir.join(nth_name(&name, n));
        let made = if md.is_dir() { fs::create_dir(&to) } else { fs::OpenOptions::new().write(true).create_new(true).open(&to).map(drop) };
        match made {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("could not copy {name}: {e}")),
            Ok(()) => {}
        }
        let filled = if md.is_dir() { fill(from, &to) } else { fs::File::open(from).and_then(|mut src| std::io::copy(&mut src, &mut fs::OpenOptions::new().write(true).truncate(true).open(&to)?)).map(|_| 0) };
        return filled.map(|skipped| (to.clone(), skipped)).map_err(|e| {
            let _ = if md.is_dir() { fs::remove_dir_all(&to) } else { fs::remove_file(&to) }; // only the half-made copy
            format!("could not copy {name}: {e}")
        });
    }
    Err(format!("could not find a free name for {name}"))
}

/// Moves an entry into another folder; refused when that folder already holds the name, or when a
/// folder would go inside itself.
pub fn move_into(from: &Path, dir: &Path) -> Result<PathBuf, String> {
    let name = from.file_name().ok_or_else(|| format!("{} has no name", from.display()))?;
    let to = dir.join(name);
    let _turn = RENAMES.lock().unwrap_or_else(|e| e.into_inner());
    fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
    if from.parent() == Some(dir) {
        return Ok(to);
    }
    if dir.starts_with(from) {
        return Err(format!("{} cannot go inside itself", name.to_string_lossy()));
    }
    if fs::symlink_metadata(&to).is_ok() {
        return Err(format!("{} already exists in {}", name.to_string_lossy(), dir.display()));
    }
    // ponytail: a move to another drive fails here; copy then delete when the tree spans drives
    fs::rename(from, &to).map_err(|e| format!("could not move {}: {e}", name.to_string_lossy()))?;
    Ok(to)
}

#[tauri::command]
pub async fn fs_copy(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, paths: Vec<String>, dir: String) -> Result<Vec<Placed>, String> {
    guard.allow(&dir, &store, &git, false)?;
    let f = fence_of(&store, &grants);
    // Ok(true): a file the user just dropped in from outside, copied as it is.
    let sources = paths.iter().map(|p| guard.allow_source(p, &store, &git).map(|_| guard.was_dropped(Path::new(p)))).collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .zip(sources)
            .map(|(p, source)| match source.and_then(|dropped| if dropped { Ok(PathBuf::from(&p)) } else { fenced(&f, &p, false) }).and_then(|from| fenced(&f, &dir, true).and_then(|d| copy_into(&from, &d))) {
                Ok((to, 0)) => Placed { from: p, to: Some(shown(&to)), error: None },
                Ok((to, n)) => Placed { from: p, error: Some(format!("{}: {n} link(s) inside were left out", shown(&to))), to: Some(shown(&to)) },
                Err(e) => Placed { from: p, to: None, error: Some(e) },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Each move is (entry, folder to move it into).
#[tauri::command]
pub async fn fs_move(store: Store<'_>, grants: Grants<'_>, guard: Guard<'_>, git: GitState<'_>, moves: Vec<(String, String)>) -> Result<Vec<Placed>, String> {
    guard.allow_all(moves.iter().flat_map(|(p, d)| [p, d]), &store, &git)?;
    let f = fence_of(&store, &grants);
    tauri::async_runtime::spawn_blocking(move || {
        moves
            .into_iter()
            .map(|(p, dir)| match fenced(&f, &p, false).and_then(|from| fenced(&f, &dir, true).and_then(|d| move_into(&from, &d))) {
                Ok(to) => Placed { from: p, to: Some(shown(&to)), error: None },
                Err(e) => Placed { from: p, to: None, error: Some(e) },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Puts text on the system clipboard from the app side, so a copy works whether or not the web view
/// holds focus or a user gesture (the web Clipboard API needs both). The explorer falls back to the
/// web Clipboard API where this is not built.
#[cfg(windows)]
#[tauri::command]
pub fn clip_write(window: tauri::WebviewWindow, text: String) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
    let owner = window.hwnd().map(|h| h.0).unwrap_or(std::ptr::null_mut());
    let wide: Vec<u16> = text.encode_utf16().chain([0]).collect();
    // SAFETY: the usual clipboard hand-off. The block is ours until SetClipboardData takes it, after
    // which Windows owns it; on every failure before that it is freed here.
    unsafe {
        let mem = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
        if mem.is_null() {
            return Err("not enough memory to copy".into());
        }
        let dst = GlobalLock(mem) as *mut u16;
        if dst.is_null() {
            GlobalFree(mem);
            return Err("not enough memory to copy".into());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
        GlobalUnlock(mem);
        // Another app may hold the clipboard for a moment.
        let open = (0..10).any(|_| OpenClipboard(owner) != 0 || { std::thread::sleep(std::time::Duration::from_millis(20)); false });
        if !open {
            GlobalFree(mem);
            return Err("the clipboard is busy in another app; try again".into());
        }
        EmptyClipboard();
        let taken = !SetClipboardData(CF_UNICODETEXT as u32, mem).is_null();
        CloseClipboard();
        if !taken {
            GlobalFree(mem);
            return Err("could not put the text on the clipboard".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn clip_write(_text: String) -> Result<(), String> {
    Err("no app-side clipboard here".into()) // ponytail: web Clipboard API fallback in the explorer; add a native path per OS if it falls short
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("krs-fsops-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[cfg(windows)]
    #[test]
    fn edit044_a_removal_blocked_for_a_moment_is_retried() {
        use std::os::windows::fs::OpenOptionsExt;
        let d = temp_dir("retry");
        let file = d.join("busy.txt");
        fs::write(&file, "x").unwrap();
        // Held open with no sharing for 150 ms: the first removals fail with a sharing violation.
        let held = fs::OpenOptions::new().read(true).share_mode(0).open(&file).unwrap();
        let t = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            drop(held);
        });
        let started = std::time::Instant::now();
        remove_retrying(&file, false).unwrap();
        assert!(started.elapsed() >= std::time::Duration::from_millis(100), "it had to wait for the lock");
        assert!(!file.exists());
        t.join().unwrap();
        // A real failure still comes back once the retries are spent.
        assert!(remove_retrying(&d.join("absent.txt"), false).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn creating_never_replaces_and_names_must_be_one_part() {
        let d = temp_dir("create");
        fs::write(d.join("a.txt"), "keep").unwrap();
        assert!(create(&d, "a.txt", false).unwrap_err().contains("already exists"));
        assert!(create(&d, "a.txt", true).is_err());
        assert_eq!(fs::read_to_string(d.join("a.txt")).unwrap(), "keep");
        for bad in ["", "..", "x/y", "x\\y", " "] {
            assert!(create(&d, bad, false).is_err(), "{bad:?}");
        }
        assert!(create(&d, "sub", true).unwrap().is_dir());
        assert!(create(&d, "b.txt", false).unwrap().is_file());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn renaming_refuses_another_entry_but_allows_a_new_case() {
        let d = temp_dir("rename");
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::write(d.join("b.txt"), "b").unwrap();
        assert!(rename(&d.join("a.txt"), "b.txt").unwrap_err().contains("already exists"));
        assert_eq!(fs::read_to_string(d.join("b.txt")).unwrap(), "b");
        let to = rename(&d.join("a.txt"), "A.txt").unwrap();
        assert!(fs::read_dir(&d).unwrap().any(|e| e.unwrap().file_name() == "A.txt"));
        assert_eq!(rename(&to, "c.txt").unwrap(), d.join("c.txt"));
        assert!(!d.join("A.txt").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn two_renames_to_one_name_leave_one_winner() {
        let d = temp_dir("race");
        fs::write(d.join("x"), "x").unwrap();
        fs::write(d.join("y"), "y").unwrap();
        let (dx, dy) = (d.join("x"), d.join("y"));
        let a = std::thread::spawn(move || rename(&dx, "z").is_ok());
        let b = std::thread::spawn(move || rename(&dy, "z").is_ok());
        assert_eq!([a.join().unwrap(), b.join().unwrap()].iter().filter(|w| **w).count(), 1);
        assert_eq!(fs::read_dir(&d).unwrap().count(), 2);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn copies_never_overwrite_and_take_a_new_name() {
        let d = temp_dir("copy");
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::create_dir_all(d.join("f").join("deep")).unwrap();
        fs::write(d.join("f").join("deep").join("x"), "x").unwrap();
        fs::create_dir(d.join("in")).unwrap();
        fs::write(d.join("in").join("a.txt"), "keep").unwrap();
        assert_eq!(copy_into(&d.join("a.txt"), &d.join("in")).unwrap().0, d.join("in").join("a copy.txt"));
        assert_eq!(copy_into(&d.join("a.txt"), &d.join("in")).unwrap().0, d.join("in").join("a copy 2.txt"));
        assert_eq!(fs::read_to_string(d.join("in").join("a.txt")).unwrap(), "keep");
        assert_eq!(fs::read_to_string(d.join("in").join("a copy.txt")).unwrap(), "a");
        let (to, skipped) = copy_into(&d.join("f"), &d.join("in")).unwrap();
        assert_eq!((to.clone(), skipped), (d.join("in").join("f"), 0));
        assert_eq!(fs::read_to_string(to.join("deep").join("x")).unwrap(), "x");
        assert_eq!(copy_into(&d.join("f"), &d.join("in")).unwrap().0, d.join("in").join("f copy"));
        assert!(copy_into(&d.join("f"), &d.join("f").join("deep")).unwrap_err().contains("into itself"));
        assert_eq!(nth_name(".env", 1), ".env copy");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn moves_refuse_a_taken_name_and_a_folder_into_itself() {
        let d = temp_dir("move");
        fs::create_dir_all(d.join("f").join("sub")).unwrap();
        fs::create_dir(d.join("g")).unwrap();
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::write(d.join("g").join("a.txt"), "keep").unwrap();
        assert!(move_into(&d.join("a.txt"), &d.join("g")).unwrap_err().contains("already exists"));
        assert_eq!(fs::read_to_string(d.join("g").join("a.txt")).unwrap(), "keep");
        assert!(move_into(&d.join("f"), &d.join("f").join("sub")).unwrap_err().contains("inside itself"));
        assert_eq!(move_into(&d.join("f"), &d.join("g")).unwrap(), d.join("g").join("f"));
        assert!(d.join("g").join("f").join("sub").is_dir() && !d.join("f").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn links_are_not_copied() {
        let d = temp_dir("links");
        fs::write(d.join("t"), "t").unwrap();
        std::os::unix::fs::symlink(d.join("t"), d.join("l")).unwrap();
        fs::create_dir(d.join("in")).unwrap();
        assert!(copy_into(&d.join("l"), &d.join("in")).unwrap_err().contains("link"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn wsl_shares_are_known() {
        assert!(is_wsl(Path::new(r"\\wsl$\Ubuntu\home\a")));
        assert!(is_wsl(Path::new(r"\\wsl.localhost\Ubuntu\x")));
        assert!(!is_wsl(Path::new(r"C:\wsl$\x")));
    }
}
