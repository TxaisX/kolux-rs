//! SAFE-021 / SAFE-022: paths the interface hands to the system. A path on another machine is
//! refused as text, before any filesystem call, so Windows never offers the user's credentials to
//! that host; a file link aimed at a program, script, installer or shortcut is revealed in its
//! folder instead of run. `refuse_host` guards every command that takes a path from the
//! interface; `open_path` is the one door for handing a file to the system.
//!
//! ponytail: there are no terminal or note links yet; when they land they call `open_path` and
//! need nothing of their own. On Linux a reveal opens the folder without selecting the file; the
//! FileManager1 D-Bus call would select it.

use std::path::Path;
use std::sync::Mutex;

/// File types that run when opened: programs, scripts, installers, shortcuts, macro documents and
/// the odd Office and web-query types that start a program. Lowercase, without the dot.
const PROGRAMS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "btm", "nt", "ps1", "psm1", "psd1", "ps1xml", "psc1", "pssc", "cdxml",
    "ps2", "ps2xml", "msh", "msh1", "msh2", "mshxml", "msh1xml", "msh2xml", "vbs", "vbe", "vb", "js", "jse", "wsf",
    "wsh", "wsc", "ws", "sct", "hta", "msi", "msp", "mst", "msix", "msixbundle", "appx", "appxbundle", "appinstaller",
    "application", "manifest", "xbap", "gadget", "cpl", "msc", "inf", "reg", "lnk", "url", "scf", "website",
    "library-ms", "search-ms", "searchconnector-ms", "settingcontent-ms", "theme", "themepack", "diagcab", "diagcfg",
    "diagpkg", "chm", "hlp", "jar", "jnlp", "py", "pyw", "pyc", "pyz", "pyzw", "rb", "pl", "pm", "php", "phar", "sh",
    "bash", "zsh", "ksh", "csh", "fish", "command", "tool", "app", "pkg", "mpkg", "dmg", "action", "workflow", "scpt",
    "scptd", "applescript", "terminal", "webloc", "desktop", "run", "bin", "elf", "appimage", "deb", "rpm", "snap",
    "flatpak", "flatpakref", "apk", "ipa", "ocx", "dll", "sys", "drv", "vxd", "grp", "ins", "isp", "its", "mad",
    "maf", "mag", "mam", "maq", "mar", "mas", "mat", "mau", "mav", "maw", "mcf", "mda", "mdb", "mde", "mdt", "mdw",
    "mdz", "ade", "adp", "accdb", "accde", "accdr", "accdt", "docm", "dotm", "xlsm", "xltm", "xlam", "xla", "xll",
    "pptm", "potm", "ppam", "ppsm", "sldm", "one", "onepkg", "onetoc2", "iqy", "oqy", "rqy", "dqy", "slk", "sylk",
    "crt", "cer", "der", "p7b", "p7c", "pfx", "p12", "xnk", "shb", "shs", "prf", "prg", "pcd", "vsmacros", "vsw",
];

/// Every registered root a share path may live under: the projects and the workspaces folder.
pub fn roots(store: &Mutex<crate::state::Store>) -> Vec<String> {
    let s = store.lock().unwrap_or_else(|e| e.into_inner());
    let mut v: Vec<String> = crate::projects::load_projects(&s).into_iter().map(|p| p.path).collect();
    v.push(crate::projects::workspaces_dir(&s).to_string_lossy().into_owned());
    v
}

/// Err when `path` points at another machine (SAFE-021); judged as text only.
pub fn refuse_host(path: &str, roots: &[String]) -> Result<(), String> {
    if host_path(path, roots) {
        Err(format!("{path} is on another computer; Kolux never opens or checks paths on other machines"))
    } else {
        Ok(())
    }
}

/// A share written with two leading slashes or backslashes, a file URL naming a host, the
/// long-path or device form of one (`\\?\UNC\`, `\\.\pipe\`), or any such path that climbs with
/// `..`. WSL roots and long-path local drives are local; a share under a registered root is allowed.
pub fn host_path(text: &str, roots: &[String]) -> bool {
    let low = text.trim().to_ascii_lowercase();
    let path = match low.strip_prefix("file:") {
        None => low,
        Some(rest) => match rest.strip_prefix("//") {
            None => decode(rest),
            Some(rest) => {
                let (host, tail) = rest.split_once('/').unwrap_or((rest, ""));
                match host {
                    "" | "localhost" => decode(&format!("/{tail}")),
                    "wsl$" | "wsl.localhost" => return false,
                    _ => return true,
                }
            }
        },
    };
    let s = windows_form(&path);
    if !s.starts_with("\\\\") {
        return false;
    }
    if s.split('\\').any(|seg| seg == "..") {
        return true;
    }
    let s = short_unc(s);
    if s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\") {
        return false;
    }
    if let Some(rest) = s.strip_prefix("\\\\?\\").or_else(|| s.strip_prefix("\\\\.\\")) {
        // the long-path and device namespaces: a drive is local; pipes and the rest are not ours
        return !(rest.len() >= 2 && rest.as_bytes()[0].is_ascii_alphabetic() && rest.as_bytes()[1] == b':');
    }
    !roots.iter().any(|r| {
        let k = short_unc(crate::projects::name_key(r));
        k.starts_with("\\\\") && (s == k || s.strip_prefix(&k).is_some_and(|t| t.starts_with('\\')))
    })
}

/// Backslashes throughout, and the `/c:/x` a file URL yields turned into `c:\x`.
fn windows_form(path: &str) -> String {
    let mut s = path.replace('/', "\\");
    let b = s.as_bytes();
    if b.len() >= 3 && b[0] == b'\\' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        s.remove(0);
    }
    s
}

/// `\\?\UNC\host\x` and `\\.\UNC\host\x` as `\\host\x`.
fn short_unc(s: String) -> String {
    match s.strip_prefix("\\\\?\\unc\\").or_else(|| s.strip_prefix("\\\\.\\unc\\")) {
        Some(rest) => format!("\\\\{rest}"),
        None => s,
    }
}

/// Percent escapes turned back into bytes; anything else is left as it is.
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = (b[i] == b'%' && i + 2 < b.len())
            .then(|| std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()))
            .flatten();
        match hex {
            Some(v) => {
                out.push(v);
                i += 3;
            }
            None => {
                out.push(b[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// SAFE-022: a file name of a type that runs when opened. On Windows an alternate-data-stream
/// suffix, trailing dots or spaces and an 8.3 short name cannot hide the type (a short name's
/// three-letter extension may be a cut-down program type, so the shape alone counts); on POSIX
/// colons and tildes are ordinary characters.
pub fn program_like(path: &str, windows: bool) -> bool {
    let seps: &[char] = if windows { &['\\', '/'] } else { &['/'] };
    let mut name = path.rsplit(seps).next().unwrap_or(path).to_ascii_lowercase();
    if windows {
        if let Some(i) = name.find(':') {
            name.truncate(i);
        }
        name = name.trim_end_matches(['.', ' ']).to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i + 1..]),
        _ => (name.as_str(), ""),
    };
    PROGRAMS.contains(&ext)
        || (windows && stem.len() <= 8 && ext.len() <= 3 && stem.as_bytes().windows(2).any(|w| w[0] == b'~' && w[1].is_ascii_digit()))
}

/// `program_like` for this platform, plus the execute bit on POSIX.
pub fn launchable(path: &Path) -> bool {
    if program_like(&path.to_string_lossy(), cfg!(windows)) {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    false
}

/// The file manager's own "show this file" call.
fn reveal_command(path: &Path) -> std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer.exe");
        c.raw_arg(format!("/select,\"{}\"", path.display()));
        c
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(path);
        c
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(path.parent().unwrap_or(path));
        c
    }
}

/// Opens the file manager with `path` selected.
pub fn reveal(path: &Path) -> Result<(), String> {
    reveal_command(path).spawn().map(|_| ()).map_err(|e| format!("could not reveal {}: {e}", path.display()))
}

/// SAFE-022: hands a file to the system. A program-like file is revealed in its folder, anything
/// else is opened in its own app; a path on another machine or a relative one is refused.
/// Answers "revealed" or "opened".
#[tauri::command]
pub fn open_path(store: tauri::State<'_, Mutex<crate::state::Store>>, path: String) -> Result<&'static str, String> {
    refuse_host(&path, &roots(&store))?;
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err(format!("{path} is not a full path"));
    }
    if launchable(p) {
        reveal(p).map(|_| "revealed")
    } else {
        crate::artifacts::system_open(&path).map(|_| "opened")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(s: &str) -> bool {
        host_path(s, &[])
    }

    #[test]
    fn safe021_paths_on_other_machines_are_refused_as_text_and_local_wsl_and_registered_shares_pass() {
        for p in [
            r"\\server\share\a.txt",
            "//server/share/a.txt",
            "file://server/share/a.txt",
            "FILE://nas/x",
            "file:////server/share",
            "file:///%5C%5Cserver%5Cshare%5Ca.txt",
            r"\\?\UNC\server\share\a",
            r"\\.\UNC\server\share\a",
            r"\\.\pipe\kolux",
            r"\\?\Volume{1234}\a",
            r"\\?\C:\..\..\UNC\server\share",
            r"\\?\C:\a\..\b",
            r"\\wsl$\Ubuntu\..\..\server\share",
            r"  \\server\share  ",
        ] {
            assert!(host(p), "{p}");
        }
        for p in [
            r"C:\Users\me\a.txt",
            "/home/me/a.txt",
            "relative/a.txt",
            r"\\wsl$\Ubuntu\home\me",
            r"\\wsl.localhost\Ubuntu\home",
            r"\\?\UNC\wsl$\Ubuntu\home",
            r"\\?\C:\very\long\path",
            r"\\?\c:",
            "file:///C:/Users/me/a.txt",
            "file://localhost/C:/a.txt",
            "file://wsl$/Ubuntu/home",
            "file://wsl.localhost/Ubuntu/home",
            "file:/C:/x",
            "file:///home/me/a",
            "",
        ] {
            assert!(!host(p), "{p}");
        }
        let roots = [r"\\nas\Projects\repo".to_string(), r"C:\code".to_string()];
        assert!(!host_path(r"\\NAS\projects\repo\src\a.rs", &roots));
        assert!(!host_path(r"\\nas\projects\repo", &roots));
        assert!(!host_path(r"\\?\UNC\nas\projects\repo\a", &roots));
        assert!(!host_path("//nas/projects/repo/a", &roots));
        assert!(host_path(r"\\nas\projects\repo2\a", &roots));
        assert!(host_path(r"\\nas\projects\other", &roots));
        assert!(host_path(r"\\nas\projects\repo\..\other", &roots));
        assert!(host_path(r"\\code\x", &roots));
        let long = [r"\\?\UNC\nas\projects\repo".to_string()];
        assert!(!host_path(r"\\nas\projects\repo\a", &long));
        // the refusal is text only: a host that cannot exist answers at once
        let t = std::time::Instant::now();
        let err = refuse_host(r"\\no-such-host-kolux-rs.invalid\share\a.txt", &[]).unwrap_err();
        assert!(t.elapsed() < std::time::Duration::from_millis(500));
        assert!(err.contains("another computer"), "{err}");
        assert_eq!(refuse_host(r"C:\a.txt", &[]), Ok(()));
    }

    #[test]
    fn safe022_programs_scripts_installers_and_shortcuts_are_told_from_documents_under_any_disguise() {
        for p in [
            "setup.bat",
            r"C:\x\run.CMD",
            "/home/me/a.js",
            "tool.exe",
            "link.lnk",
            "install.msi",
            "site.url",
            "notes.one",
            "query.iqy",
            "data.slk",
            "x.ps1",
            "a.sh",
            "a.py",
            "a.jar",
            "a.hta",
            "a.scr",
            "app.AppImage",
            "a.desktop",
            "x.docm",
            "a.cpl",
            "a.msix",
            "a.pkg",
            "a.dll",
        ] {
            assert!(program_like(p, true), "{p}");
            assert!(program_like(p, false), "{p}");
        }
        for p in [r"C:\x\tool.exe:Zone.Identifier", r"C:\x\tool.exe:stream:$DATA", "tool.exe.", "tool.exe ", "tool.exe. . ", "PROGRA~1.EXE", "NOTES~1.TXT", "notes~1.txt", "backup~1.txt"] {
            assert!(program_like(p, true), "{p}");
        }
        for p in ["readme.txt", "notes.md", "photo.png", "a.json", "report.docx", "Makefile", "a.exe.txt", ".bashrc", "my-long-report~1.txt", "notes~1.markdown"] {
            assert!(!program_like(p, true), "{p}");
            assert!(!program_like(p, false), "{p}");
        }
        // POSIX: colons and tildes are ordinary characters, and a backslash is part of the name
        assert!(!program_like("/home/me/a:b.txt", false));
        assert!(!program_like("/home/me/notes~1.txt", false));
        assert!(!program_like("/home/me/report.txt:exe", false));
        assert!(program_like("/home/me/a.txt:x.exe", false));
        assert!(program_like(r"/home/me/weird\name.sh", false));
        assert!(launchable(Path::new("C:/x/run.bat")));
        assert!(!launchable(Path::new("C:/x/readme.txt")));
    }

    #[cfg(unix)]
    #[test]
    fn safe022_the_execute_bit_counts_on_posix() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("krs-links-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("tool");
        std::fs::write(&f, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!launchable(&f));
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(launchable(&f));
        let _ = std::fs::remove_dir_all(&d);
    }
}
