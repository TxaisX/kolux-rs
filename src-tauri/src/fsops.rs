// The explorer's file operations (EDIT-034, part 1): create, rename, delete to the system trash and
// bring back from it, and copy a path to the clipboard. The explorer keeps the undo history; each undo or redo is one of these calls.
// Copy, move and drop-in are T-094-b2.
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
                    Ok(m) if m.is_dir() => fs::remove_dir_all(path),
                    Ok(_) => fs::remove_file(path),
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

#[tauri::command]
pub fn fs_create(dir: String, name: String, folder: bool) -> Result<String, String> {
    create(Path::new(&dir), &name, folder).map(|p| shown(&p))
}

#[tauri::command]
pub fn fs_rename(path: String, name: String) -> Result<String, String> {
    rename(Path::new(&path), &name).map(|p| shown(&p))
}

#[tauri::command]
pub async fn fs_trash(paths: Vec<String>) -> Vec<Gone> {
    tauri::async_runtime::spawn_blocking(move || trash_each(&paths)).await.unwrap_or_default()
}

#[tauri::command]
pub async fn fs_restore(paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || restore(&paths)).await.map_err(|e| e.to_string())?
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
    fn wsl_shares_are_known() {
        assert!(is_wsl(Path::new(r"\\wsl$\Ubuntu\home\a")));
        assert!(is_wsl(Path::new(r"\\wsl.localhost\Ubuntu\x")));
        assert!(!is_wsl(Path::new(r"C:\wsl$\x")));
    }
}
