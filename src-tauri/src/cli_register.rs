//! CLI-008: make the `kolux` command (`kolux-dev` in a development build) available in terminals
//! outside Kolux, or take it away again. Windows adds the CLI folder to the user's PATH in the
//! registry; Linux (and macOS, until its system-wide link lands) writes a launcher script in the
//! per-user programs folder. Nothing that is not Kolux's own is ever overwritten or deleted.
//! The state is read again after a change, and a change that did not take never shows success.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// What Settings shows: whether the command is registered, where, and why when it is not.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    /// `registered`, `not-registered`, `unknown` (PATH unreadable: no change is offered) or `conflict`.
    pub state: &'static str,
    pub command: String,
    /// The folder on PATH, or the launcher file.
    pub place: String,
    pub note: Option<String>,
    /// Whether register / remove should be offered.
    pub can_change: bool,
}

fn view(state: &'static str, place: &str, note: Option<String>) -> Registration {
    Registration { state, command: crate::orchestration::CLI.to_string(), place: place.to_string(), note, can_change: state != "unknown" }
}

// ------------------------------------------------------------------------ Windows: user PATH

/// A folder as PATH compares it: `%VAR%` expanded, slashes alike, no trailing slash, any case.
pub fn same_entry(entry: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> bool {
    let norm = |s: &str| expand(s.trim().trim_matches('"'), env).replace('/', "\\").trim_end_matches('\\').to_lowercase();
    !entry.trim().is_empty() && norm(entry) == norm(dir)
}

fn expand(s: &str, env: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find('%') {
        out.push_str(&rest[..a]);
        match rest[a + 1..].find('%') {
            Some(b) => match env(&rest[a + 1..a + 1 + b]) {
                Some(v) => {
                    out.push_str(&v);
                    rest = &rest[a + b + 2..];
                }
                None => {
                    out.push('%');
                    rest = &rest[a + 1..];
                }
            },
            None => {
                out.push_str(&rest[a..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn path_has(path: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> bool {
    path.split(';').any(|e| same_entry(e, dir, env))
}

/// PATH with `dir` added at the end; unchanged when it is already there.
pub fn path_with(path: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> String {
    if path_has(path, dir, env) {
        return path.to_string();
    }
    let kept = path.trim_end_matches(';');
    if kept.trim().is_empty() {
        dir.to_string()
    } else {
        format!("{kept};{dir}")
    }
}

/// PATH without any entry that is `dir`; None when it holds none (so nothing is written).
pub fn path_without(path: &str, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if !path_has(path, dir, env) {
        return None;
    }
    Some(path.split(';').filter(|e| !same_entry(e, dir, env)).collect::<Vec<_>>().join(";"))
}

/// The user's PATH variable as a registry (or a test) holds it.
pub trait UserPath {
    /// None when the user has no PATH variable at all; Err when it cannot be read.
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
}

fn real_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub fn windows_state(store: &dyn UserPath, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Registration {
    match store.read() {
        Err(why) => view("unknown", dir, Some(format!("Kolux cannot read your PATH ({why}), so it offers no change"))),
        Ok(p) if path_has(p.as_deref().unwrap_or_default(), dir, env) => view("registered", dir, None),
        Ok(_) => view("not-registered", dir, None),
    }
}

/// Adds `dir` to the user's PATH and reads it back; success is shown only when it is there.
pub fn windows_register(store: &dyn UserPath, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Result<Registration, String> {
    let now = store.read().map_err(|e| format!("Kolux cannot read your PATH ({e}); nothing was changed"))?.unwrap_or_default();
    if !path_has(&now, dir, env) {
        store.write(&path_with(&now, dir, env)).map_err(|e| format!("Windows refused the change to your PATH: {e}"))?;
    }
    let again = store.read().map_err(|e| format!("the change could not be checked afterwards: {e}"))?.unwrap_or_default();
    if !path_has(&again, dir, env) {
        return Err(format!("{dir} is still not on your PATH after the change; something else holds that setting"));
    }
    Ok(view("registered", dir, None))
}

/// Takes `dir` off the user's PATH; an entry that is not there changes nothing.
pub fn windows_remove(store: &dyn UserPath, dir: &str, env: &dyn Fn(&str) -> Option<String>) -> Result<Registration, String> {
    let now = store.read().map_err(|e| format!("Kolux cannot read your PATH ({e}); nothing was changed"))?.unwrap_or_default();
    if let Some(next) = path_without(&now, dir, env) {
        store.write(&next).map_err(|e| format!("Windows refused the change to your PATH: {e}"))?;
        let again = store.read().map_err(|e| format!("the change could not be checked afterwards: {e}"))?.unwrap_or_default();
        if path_has(&again, dir, env) {
            return Err(format!("{dir} is still on your PATH after the change"));
        }
    }
    Ok(view("not-registered", dir, None))
}

#[cfg(windows)]
pub struct Registry;

#[cfg(windows)]
impl Registry {
    /// The name the value goes by in HKCU\Environment, whatever its letter case (Path, PATH, path).
    fn name() -> Result<Option<(Vec<u16>, u32)>, String> {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ};
        let key: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut h: HKEY = std::ptr::null_mut();
        // SAFETY: valid null-terminated key name and out pointer.
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_READ, &mut h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let mut found = None;
        let mut i = 0u32;
        loop {
            let mut name = vec![0u16; 16384];
            let mut len = name.len() as u32;
            let mut kind = 0u32;
            // SAFETY: `name` holds `len` UTF-16 units.
            let rc = unsafe { RegEnumValueW(h, i, name.as_mut_ptr(), &mut len, std::ptr::null_mut(), &mut kind, std::ptr::null_mut(), std::ptr::null_mut()) };
            if rc != 0 {
                break;
            }
            name.truncate(len as usize);
            if String::from_utf16_lossy(&name).eq_ignore_ascii_case("path") {
                name.push(0);
                found = Some((name, kind));
                break;
            }
            i += 1;
        }
        // SAFETY: `h` was opened above.
        unsafe { RegCloseKey(h) };
        Ok(found)
    }
}

#[cfg(windows)]
impl UserPath for Registry {
    fn read(&self) -> Result<Option<String>, String> {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ};
        let Some((name, _)) = Registry::name()? else { return Ok(None) };
        let key: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut h: HKEY = std::ptr::null_mut();
        // SAFETY: valid null-terminated key name and out pointer.
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_READ, &mut h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let mut bytes = 0u32;
        // SAFETY: a null buffer asks only for the size.
        let mut rc = unsafe { RegQueryValueExW(h, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), &mut bytes) };
        let mut buf = vec![0u16; bytes as usize / 2 + 2];
        if rc == 0 {
            let mut len = (buf.len() * 2) as u32;
            // SAFETY: `buf` holds `len` bytes.
            rc = unsafe { RegQueryValueExW(h, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        }
        // SAFETY: `h` was opened above.
        unsafe { RegCloseKey(h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Ok(Some(String::from_utf16_lossy(&buf[..end])))
    }

    fn write(&self, value: &str) -> Result<(), String> {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_EXPAND_SZ};
        use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
        // The existing name keeps its spelling; a missing PATH is made as `Path`. A PATH that holds %VARS% stays expandable.
        let name = match Registry::name()? {
            Some((n, _)) => n,
            None => "Path\0".encode_utf16().collect(),
        };
        let key: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut h: HKEY = std::ptr::null_mut();
        // SAFETY: valid null-terminated key name and out pointer.
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_SET_VALUE, &mut h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        let data: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        // SAFETY: `data` is a null-terminated UTF-16 string of `data.len() * 2` bytes.
        let rc = unsafe { RegSetValueExW(h, name.as_ptr(), 0, REG_EXPAND_SZ, data.as_ptr().cast(), (data.len() * 2) as u32) };
        // SAFETY: `h` was opened above.
        unsafe { RegCloseKey(h) };
        if rc != 0 {
            return Err(format!("registry error {rc}"));
        }
        // Tell running programs (Explorer, new terminals) the environment changed.
        let env: Vec<u16> = "Environment\0".encode_utf16().collect();
        let mut out = 0usize;
        // SAFETY: the broadcast carries a null-terminated string that outlives the call.
        unsafe { SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, env.as_ptr() as isize, SMTO_ABORTIFHUNG, 2000, &mut out) };
        Ok(())
    }
}

// ------------------------------------------------------------------------ Linux / macOS: launcher

const MARK: &str = "# written by Kolux: kolux command launcher";

/// The launcher script: it runs the installed program with the arguments it was given.
pub fn launcher_script(exe: &Path) -> String {
    format!("#!/bin/sh\n{MARK}\nexec \"{}\" \"$@\"\n", exe.display().to_string().replace('"', "\\\""))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Target {
    Missing,
    /// A launcher Kolux wrote; `current` says whether it points at this build.
    Ours { current: bool },
    /// Something else is there: a file or link of unknown origin.
    Foreign,
}

pub fn inspect(target: &Path, wanted: &str) -> Target {
    let Ok(meta) = std::fs::symlink_metadata(target) else { return Target::Missing };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Target::Foreign;
    }
    match std::fs::read_to_string(target) {
        Ok(text) if text.contains(MARK) => Target::Ours { current: text == wanted },
        _ => Target::Foreign,
    }
}

fn conflict(target: &Path) -> String {
    format!("{} already exists and was not written by Kolux; it was left as it is. Move or delete it, then register again", target.display())
}

pub fn launcher_state(target: &Path, exe: &Path, on_path: bool) -> Registration {
    let place = target.display().to_string();
    match inspect(target, &launcher_script(exe)) {
        Target::Foreign => view("conflict", &place, Some(conflict(target))),
        Target::Ours { current: true } => view("registered", &place, (!on_path).then(|| format!("{} is not on your PATH yet; add it to your shell profile", target.parent().map(|p| p.display().to_string()).unwrap_or_default()))),
        Target::Ours { current: false } | Target::Missing => view("not-registered", &place, None),
    }
}

pub fn launcher_register(target: &Path, exe: &Path, on_path: bool) -> Result<Registration, String> {
    let want = launcher_script(exe);
    if inspect(target, &want) == Target::Foreign {
        return Err(conflict(target));
    }
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    std::fs::write(target, &want).map_err(|e| format!("cannot write {}: {e}", target.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755)).map_err(|e| format!("cannot make {} runnable: {e}", target.display()))?;
    }
    // Look at the target again: it must be our launcher now, or the registration did not work.
    match inspect(target, &want) {
        Target::Ours { current: true } => Ok(launcher_state(target, exe, on_path)),
        _ => Err(format!("{} does not hold the launcher after writing it", target.display())),
    }
}

pub fn launcher_remove(target: &Path, exe: &Path, on_path: bool) -> Result<Registration, String> {
    match inspect(target, &launcher_script(exe)) {
        Target::Foreign => Err(conflict(target)),
        Target::Missing => Ok(launcher_state(target, exe, on_path)),
        Target::Ours { .. } => {
            std::fs::remove_file(target).map_err(|e| format!("cannot remove {}: {e}", target.display()))?;
            if target.exists() {
                return Err(format!("{} is still there after removing it", target.display()));
            }
            Ok(launcher_state(target, exe, on_path))
        }
    }
}

// ------------------------------------------------------------------------ the app's three commands

fn folder_and_exe() -> Result<(PathBuf, PathBuf), String> {
    let exe = std::env::current_exe().map_err(|e| format!("Kolux cannot find its own program: {e}"))?;
    let dir = exe.parent().map(Path::to_path_buf).ok_or("Kolux cannot find its own folder")?;
    Ok((dir, exe))
}

/// The command's own file in the CLI folder; naming it when it is missing says what is in the way.
fn command_file(dir: &Path) -> Result<(), String> {
    let name = crate::orchestration::CLI;
    if ["exe", "cmd"].iter().any(|e| dir.join(format!("{name}.{e}")).is_file()) || cfg!(not(windows)) {
        Ok(())
    } else {
        Err(format!("{} holds no {name}.exe or {name}.cmd, so there is nothing to register", dir.display()))
    }
}

#[cfg(not(windows))]
fn launcher_target() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("HOME is not set")?;
    Ok(home.join(".local").join("bin").join(crate::orchestration::CLI))
}

#[cfg(not(windows))]
fn target_on_path(target: &Path) -> bool {
    let dir = target.parent().map(|d| d.to_path_buf());
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| Some(d) == dir))
}

pub fn state_now() -> Result<Registration, String> {
    let (dir, exe) = folder_and_exe()?;
    #[cfg(windows)]
    {
        let _ = exe;
        Ok(windows_state(&Registry, &dir.display().to_string(), &real_env))
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        let t = launcher_target()?;
        Ok(launcher_state(&t, &exe, target_on_path(&t)))
    }
}

/// Settings > CLI: where the command is, and whether it is registered right now.
#[tauri::command]
pub fn cli_register_state() -> Result<Registration, String> {
    state_now()
}

/// Settings > CLI: register the command for the whole system.
#[tauri::command]
pub fn cli_register() -> Result<Registration, String> {
    let (dir, exe) = folder_and_exe()?;
    command_file(&dir)?;
    #[cfg(windows)]
    {
        let _ = exe;
        windows_register(&Registry, &dir.display().to_string(), &real_env)
    }
    #[cfg(not(windows))]
    {
        let t = launcher_target()?;
        launcher_register(&t, &exe, target_on_path(&t))
    }
}

/// Settings > CLI: take the command away again.
#[tauri::command]
pub fn cli_unregister() -> Result<Registration, String> {
    let (dir, exe) = folder_and_exe()?;
    #[cfg(windows)]
    {
        let _ = exe;
        windows_remove(&Registry, &dir.display().to_string(), &real_env)
    }
    #[cfg(not(windows))]
    {
        let t = launcher_target()?;
        launcher_remove(&t, &exe, target_on_path(&t))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake {
        value: RefCell<Option<String>>,
        unreadable: bool,
        refuses: bool,
        writes: RefCell<u32>,
    }
    impl Fake {
        fn new(v: Option<&str>) -> Fake {
            Fake { value: RefCell::new(v.map(String::from)), unreadable: false, refuses: false, writes: RefCell::new(0) }
        }
    }
    impl UserPath for Fake {
        fn read(&self) -> Result<Option<String>, String> {
            if self.unreadable {
                return Err("access denied".into());
            }
            Ok(self.value.borrow().clone())
        }
        fn write(&self, v: &str) -> Result<(), String> {
            *self.writes.borrow_mut() += 1;
            if !self.refuses {
                *self.value.borrow_mut() = Some(v.to_string());
            }
            Ok(())
        }
    }
    fn env(n: &str) -> Option<String> {
        (n.eq_ignore_ascii_case("localappdata")).then(|| r"C:\Users\me\AppData\Local".to_string())
    }
    const DIR: &str = r"C:\Users\me\AppData\Local\Programs\Kolux";

    #[test]
    fn cli008_a_folder_matches_whatever_its_case_slashes_trailing_slash_or_variables() {
        assert!(path_has(r"C:\a;c:/users/me/appdata/local/programs/kolux/;C:\b", DIR, &env));
        assert!(path_has(r"%LOCALAPPDATA%\Programs\Kolux", DIR, &env));
        assert!(!path_has(r"C:\a;C:\Users\me\AppData\Local\Programs\Kolux2", DIR, &env));
        assert!(!path_has("", DIR, &env));
        assert_eq!(path_with(r"C:\a;", DIR, &env), format!(r"C:\a;{DIR}"));
        assert_eq!(path_with("", DIR, &env), DIR);
        assert_eq!(path_with(&format!(r"C:\a;{DIR}"), DIR, &env), format!(r"C:\a;{DIR}"));
    }

    #[test]
    fn cli008_removing_an_entry_the_path_does_not_hold_changes_nothing() {
        assert_eq!(path_without(r"C:\a;C:\b", DIR, &env), None);
        assert_eq!(path_without(&format!(r"C:\a;{DIR};C:\b"), DIR, &env).unwrap(), r"C:\a;C:\b");
        let f = Fake::new(Some(r"C:\a"));
        let r = windows_remove(&f, DIR, &env).unwrap();
        assert_eq!((r.state, *f.writes.borrow()), ("not-registered", 0));
    }

    #[test]
    fn cli008_register_adds_the_folder_reads_it_back_and_remove_takes_it_away() {
        let f = Fake::new(Some(r"C:\a"));
        assert_eq!(windows_state(&f, DIR, &env).state, "not-registered");
        let r = windows_register(&f, DIR, &env).unwrap();
        assert_eq!(r.state, "registered");
        assert_eq!(f.value.borrow().clone().unwrap(), format!(r"C:\a;{DIR}"));
        assert_eq!(windows_state(&f, DIR, &env).state, "registered");
        // Registering twice writes nothing the second time.
        let before = *f.writes.borrow();
        windows_register(&f, DIR, &env).unwrap();
        assert_eq!(*f.writes.borrow(), before);
        assert_eq!(windows_remove(&f, DIR, &env).unwrap().state, "not-registered");
        assert_eq!(f.value.borrow().clone().unwrap(), r"C:\a");
    }

    #[test]
    fn cli008_an_unreadable_path_shows_unknown_and_offers_no_change_and_a_change_that_did_not_take_is_an_error() {
        let mut f = Fake::new(Some(r"C:\a"));
        f.unreadable = true;
        let s = windows_state(&f, DIR, &env);
        assert_eq!((s.state, s.can_change), ("unknown", false));
        assert!(windows_register(&f, DIR, &env).unwrap_err().contains("nothing was changed"));
        assert_eq!(*f.writes.borrow(), 0);
        let mut g = Fake::new(Some(r"C:\a"));
        g.refuses = true;
        let e = windows_register(&g, DIR, &env).unwrap_err();
        assert!(e.contains("still not on your PATH"), "{e}");
    }

    fn scratch(tag: &str) -> crate::test_dir::TempDir {
        crate::test_dir::temp(&format!("cli008-{tag}"))
    }

    #[test]
    fn cli008_a_launcher_of_unknown_origin_is_a_conflict_left_where_it_is_and_our_old_one_is_replaced() {
        let d = scratch("launcher");
        let exe = d.join("app").join("kolux-rs");
        let target = d.join("bin").join("kolux");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        // Something else is at the target: reported with its path, untouched.
        std::fs::write(&target, "#!/bin/sh\necho mine\n").unwrap();
        let e = launcher_register(&target, &exe, true).unwrap_err();
        assert!(e.contains(&target.display().to_string()) && e.contains("not written by Kolux"), "{e}");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "#!/bin/sh\necho mine\n");
        assert_eq!(launcher_state(&target, &exe, true).state, "conflict");
        assert!(launcher_remove(&target, &exe, true).is_err());
        assert!(target.exists());
        // Free again: register writes ours; an outdated one of ours is replaced; remove deletes ours only.
        std::fs::remove_file(&target).unwrap();
        assert_eq!(launcher_register(&target, &exe, true).unwrap().state, "registered");
        let old = d.join("old").join("kolux-rs");
        std::fs::write(&target, launcher_script(&old)).unwrap();
        assert_eq!(launcher_state(&target, &exe, true).state, "not-registered");
        assert_eq!(launcher_register(&target, &exe, true).unwrap().state, "registered");
        assert!(std::fs::read_to_string(&target).unwrap().contains(&exe.display().to_string()));
        assert_eq!(launcher_remove(&target, &exe, true).unwrap().state, "not-registered");
        assert!(!target.exists());
        // Removing what is not there changes nothing.
        assert_eq!(launcher_remove(&target, &exe, true).unwrap().state, "not-registered");
        // A folder that is not on PATH is a warning on a registered launcher, not a failure.
        let r = launcher_register(&target, &exe, false).unwrap();
        assert!(r.note.unwrap().contains("not on your PATH"));
    }

    #[cfg(windows)]
    #[test]
    fn cli008_the_real_user_environment_key_can_be_read_without_changing_it() {
        // Read-only: this never writes the registry.
        assert!(Registry.read().is_ok());
    }
}
