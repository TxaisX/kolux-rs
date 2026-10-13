//! APP-021: broken folder permissions on Windows. At startup a quick check confirms the user can
//! write to the install folder and the profile folder and read the install folder's files. What
//! fails is reset to the permissions it inherits (icacls /reset), but only in the user's own
//! install: a machine-wide one (Program Files, Windows) is never touched. What is still broken
//! comes back as a problem for the window to name, so a launch never fails over it.

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// What was repaired, for the log.
    pub repaired: Vec<String>,
    /// What is still broken, in words the user can act on.
    pub problems: Vec<String>,
}

/// Creates and removes a probe file.
pub fn writable(dir: &Path) -> std::io::Result<()> {
    let probe = dir.join(format!(".kolux-write-check-{}", std::process::id()));
    fs::OpenOptions::new().write(true).create_new(true).open(&probe)?;
    fs::remove_file(probe)
}

/// The files directly in `dir` that the user is refused when reading them.
pub fn unreadable(dir: &Path) -> Vec<PathBuf> {
    let Ok(list) = fs::read_dir(dir) else { return vec![] };
    list.flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && matches!(fs::File::open(p), Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied))
        .collect()
}

/// A machine-wide install is the administrator's to repair; anything else is the user's own.
pub fn own_install(dir: &Path, machine: &[PathBuf]) -> bool {
    let d = dir.to_string_lossy().to_lowercase();
    !machine.iter().any(|m| {
        let m = m.to_string_lossy().to_lowercase();
        !m.is_empty() && d.starts_with(m.trim_end_matches('\\'))
    })
}

fn machine_folders() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "SystemRoot"].iter().filter_map(std::env::var_os).map(PathBuf::from).collect()
}

fn fix_command(path: &Path) -> String {
    format!("icacls \"{}\" /reset", path.display())
}

/// Resets one file or folder (not what is inside it) to its inherited permissions.
fn reset(path: &Path) -> bool {
    let mut cmd = std::process::Command::new("icacls");
    cmd.arg(path).args(["/reset", "/C", "/Q"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

/// Checks a folder the app must write to and, when it may, repairs it.
fn folder(out: &mut Outcome, dir: &Path, name: &str, may_repair: bool) {
    if fs::create_dir_all(dir).is_ok() && writable(dir).is_ok() {
        return;
    }
    if may_repair && reset(dir) && writable(dir).is_ok() {
        out.repaired.push(format!("the {name} {} could not be written to; its permissions were reset", dir.display()));
        return;
    }
    let how = if may_repair { format!("To fix it, run {} in a terminal.", fix_command(dir)) } else { "It is a machine-wide install, so an administrator has to repair it or reinstall Kolux RS.".into() };
    out.problems.push(format!("Kolux RS cannot write to its {name} {}: a permissions problem it could not repair. {how}", dir.display()));
}

/// The startup check (see the module comment).
pub fn check(install: &Path, profile: &Path) -> Outcome {
    let mut out = Outcome::default();
    let own = own_install(install, &machine_folders());
    folder(&mut out, install, "install folder", own);
    folder(&mut out, profile, "profile folder", true);
    for file in unreadable(install) {
        if own && reset(&file) && fs::File::open(&file).is_ok() {
            out.repaired.push(format!("{} could not be read; its permissions were reset", file.display()));
            continue;
        }
        let how = if own { format!("To fix it, run {} in a terminal.", fix_command(&file)) } else { "It is a machine-wide install, so an administrator has to repair it or reinstall Kolux RS.".into() };
        out.problems.push(format!("Kolux RS cannot read {} in its install folder: a permissions problem it could not repair. {how}", file.display()));
    }
    out
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn icacls(path: &Path, args: &[&str]) {
        let ok = std::process::Command::new("icacls").arg(path).args(args).output().unwrap().status.success();
        assert!(ok, "icacls {} {args:?}", path.display());
    }

    fn me() -> String {
        std::env::var("USERNAME").unwrap()
    }

    #[test]
    fn app021_an_unreadable_install_file_is_repaired() {
        let install = temp("app021-install");
        let profile = install.join("profile");
        let file = install.join("resource.dat");
        fs::write(&file, "x").unwrap();
        icacls(&file, &["/deny", &format!("{}:(R)", me())]);
        assert_eq!(unreadable(&install), vec![file.clone()]);
        let out = check(&install, &profile);
        assert!(out.problems.is_empty(), "{out:?}");
        assert_eq!(out.repaired.len(), 1, "{out:?}");
        assert_eq!(fs::read_to_string(&file).unwrap(), "x", "access is restored");
        fs::remove_dir_all(&install).unwrap();
    }

    #[test]
    fn app021_a_folder_that_refuses_writes_is_repaired() {
        let install = temp("app021-write");
        let profile = install.join("profile");
        fs::create_dir_all(&profile).unwrap();
        icacls(&profile, &["/deny", &format!("{}:(W)", me())]);
        assert!(writable(&profile).is_err());
        let out = check(&install, &profile);
        assert!(out.problems.is_empty(), "{out:?}");
        assert!(out.repaired[0].contains("profile folder"), "{out:?}");
        assert!(writable(&profile).is_ok());
        fs::remove_dir_all(&install).unwrap();
    }

    #[test]
    fn app021_a_repair_that_cannot_happen_is_named_as_a_permissions_problem() {
        let install = temp("app021-stuck");
        let file = install.join("resource.dat");
        fs::write(&file, "x").unwrap();
        // OWNER RIGHTS (S-1-3-4) refused the right to change permissions: even the owner cannot reset it.
        icacls(&file, &["/deny", &format!("{}:(R)", me()), "/deny", "*S-1-3-4:(WDAC)"]);
        let out = check(&install, &install.join("profile"));
        assert_eq!(out.problems.len(), 1, "{out:?}");
        assert!(out.problems[0].contains("permissions problem") && out.problems[0].contains("/reset"), "{out:?}");
        fs::remove_file(&file).unwrap(); // the folder still lets its owner delete what is in it
        fs::remove_dir_all(&install).unwrap();
    }

    #[test]
    fn app021_a_machine_wide_install_is_never_repaired() {
        let machine = vec![PathBuf::from(r"C:\Program Files")];
        assert!(!own_install(Path::new(r"C:\Program Files\Kolux RS"), &machine));
        assert!(own_install(Path::new(r"C:\Users\ann\AppData\Local\Programs\Kolux RS"), &machine));
    }
}
