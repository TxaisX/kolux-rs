//! TERM-099 / TERM-100 (T-307): finds the Ghostty configuration and theme files and the Warp theme files
//! on this machine and hands their text to the settings page, which maps them (src/settings/
//! importSchemes.ts). Nothing here writes anything. Files are read with a size cap, and a file that
//! cannot be used comes back with a plain reason that never carries a folder path.
//!
//! What is contained (FIX-3b): a Ghostty include, a Ghostty theme and a Warp theme file are each read
//! only through their real path (links and junctions resolved), and only when that path is inside the
//! real place of the folder they were found in. When either real place cannot be found, the file is
//! not read. What is not contained: the first Ghostty config file is read as named, because a dotfiles
//! setup may link it from elsewhere; a hard link inside a folder is read like any file in it, because
//! it has no other path; and a setup that links every file separately (GNU stow, home-manager) loses
//! the linked includes and themes, which are listed as outside the folder.
//!
//! Folder names, checked 2026-10-19 against the vendors' public pages (URLs and exact folders in
//! evidence/look-FIX-3b.txt). Warp: ~/.warp/themes (macOS), ${XDG_DATA_HOME:-~/.local/share}/warp-terminal/
//! themes (Linux), %APPDATA%\warp\Warp\data\themes (Windows). Ghostty: $XDG_CONFIG_HOME/ghostty (default
//! ~/.config/ghostty) holding config or config.ghostty and a themes folder, plus ~/Library/Application
//! Support/com.mitchellh.ghostty on macOS for the config files. Not in those pages, kept as extra places
//! to look and not checked: Ghostty's themes folder under the macOS Application Support folder, and
//! Ghostty's folder under %APPDATA% on Windows (Ghostty's page names no Windows folder).

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

/// A config or theme file bigger than this is not read (the settings page also caps the text it maps).
const MAX_BYTES: u64 = 262_144;
/// Config files followed through `config-file = ...` lines, the first one included.
const MAX_CONFIG_FILES: usize = 8;
/// Warp theme files listed in one scan, and how long the scan may take.
const MAX_WARP_FILES: usize = 400;
const WARP_SCAN_BUDGET: Duration = Duration::from_secs(3);

#[derive(Serialize, Debug, PartialEq)]
pub struct GhosttyFile {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct WarpFile {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

/// The text of a file, or why it was not read. The reason never names a folder.
fn read_capped(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|_| "could not be read".to_string())?;
    if !meta.is_file() {
        return Err("is not a file".into());
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("is too large to read (over {} KB)", MAX_BYTES / 1024));
    }
    let bytes = std::fs::read(path).map_err(|_| "could not be read".to_string())?;
    String::from_utf8(bytes).map_err(|_| "is not text".to_string())
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// The path an include line names, when it is a plain relative path that stays inside the config folder.
fn include_target(dir: &Path, value: &str) -> Option<PathBuf> {
    let v = value.trim().trim_start_matches('?').trim().trim_matches('"');
    if v.is_empty() {
        return None;
    }
    let rel = Path::new(v);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(dir.join(rel))
}

/// The real path a file may be read through: it must be inside `root` (the folder's real place) once links
/// are resolved. Fails closed: when either real place is unknown the file is not read (FIX-3b).
fn inside(real: Option<&Path>, root: Option<&Path>, outside: &'static str) -> Result<PathBuf, &'static str> {
    match (real, root) {
        (Some(r), Some(root)) if r.starts_with(root) => Ok(r.to_path_buf()),
        (Some(_), Some(_)) => Err(outside),
        _ => Err("could not be read"),
    }
}

/// The text of `file` read through its real path, only when that is inside `folder`'s real place.
fn read_inside(file: &Path, folder: &Path, outside: &'static str) -> Result<String, String> {
    let real = std::fs::canonicalize(file).ok();
    let root = std::fs::canonicalize(folder).ok();
    read_capped(&inside(real.as_deref(), root.as_deref(), outside)?).map_err(|e| e.to_string())
}

/// The first config file that exists in `candidates`, then the files it includes (relative paths inside
/// its own folder, also after symlinks and junctions are resolved; at most `MAX_CONFIG_FILES` in all, each once).
pub(crate) fn ghostty_config(candidates: &[PathBuf]) -> Vec<GhosttyFile> {
    ghostty_config_with(candidates, &|p| std::fs::canonicalize(p).ok())
}

/// `ghostty_config` with the way a path's real place is found passed in, so a test can make that step fail.
fn ghostty_config_with(candidates: &[PathBuf], canon: &dyn Fn(&Path) -> Option<PathBuf>) -> Vec<GhosttyFile> {
    let Some(first) = candidates.iter().find(|p| p.is_file()) else {
        return Vec::new();
    };
    let dir = first.parent().map(Path::to_path_buf).unwrap_or_default();
    // The folder's real place, links resolved: an include must still be inside it after its own links are
    // resolved (FIX-2, 2026-10-19). The first config file may itself be a link, as in a dotfiles setup.
    // When the folder's real place cannot be found, no include is read (FIX-3b).
    let real_dir = canon(&dir);
    let mut out = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut queue = vec![first.clone()];
    let mut is_first = true;
    while let Some(path) = queue.pop() {
        if out.len() >= MAX_CONFIG_FILES {
            break;
        }
        let real = canon(&path);
        if !seen.insert(real.clone().unwrap_or_else(|| path.clone())) {
            continue;
        }
        let label = file_name(&path);
        let first_file = std::mem::replace(&mut is_first, false);
        // The first file is the user's own entry point and is read as named. An include is read only through
        // the real path that passed the check, so a link swapped in after the check is not followed.
        let read_from = if first_file {
            path.clone()
        } else {
            match inside(real.as_deref(), real_dir.as_deref(), "is outside the configuration folder") {
                Ok(p) => p,
                Err(why) => {
                    out.push(GhosttyFile { label, text: None, skipped: Some(why.into()) });
                    continue;
                }
            }
        };
        match read_capped(&read_from) {
            Ok(text) => {
                let mut includes: Vec<PathBuf> = text
                    .lines()
                    .filter_map(|l| l.trim().strip_prefix("config-file"))
                    .filter_map(|rest| rest.trim_start().strip_prefix('='))
                    .filter_map(|v| include_target(&dir, v))
                    .collect();
                includes.reverse(); // popped from the end, so they are read in file order
                queue.extend(includes);
                out.push(GhosttyFile { label, text: Some(text), skipped: None });
            }
            Err(why) => out.push(GhosttyFile { label, text: None, skipped: Some(why) }),
        }
    }
    out
}

/// The text of the named Ghostty theme from the first folder that has it. A name that could leave the
/// theme folder (a separator, `..`) finds nothing.
pub(crate) fn ghostty_theme(name: &str, folders: &[PathBuf]) -> Option<String> {
    let clean = !name.is_empty() && name != "." && !name.contains("..") && !name.contains(['/', '\\', ':', '\0']);
    if !clean {
        return None;
    }
    folders.iter().find_map(|d| {
        let p = d.join(name);
        if p.is_file() { read_inside(&p, d, "is outside the theme folder").ok() } else { None }
    })
}

/// The `.yaml` / `.yml` files in the Warp theme folders, by name, each with its text or why it was
/// skipped. Past `MAX_WARP_FILES` or the scan's time budget the rest are left out and one entry says so.
pub(crate) fn warp_themes(folders: &[PathBuf], budget: Duration) -> Vec<WarpFile> {
    let began = Instant::now();
    let mut names: Vec<(&PathBuf, PathBuf)> = folders
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok().map(|rd| (d, rd)))
        .flat_map(|(d, rd)| rd.filter_map(|e| e.ok()).map(move |e| (d, e.path())))
        .filter(|(_, p)| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("yaml") || x.eq_ignore_ascii_case("yml")))
        .collect();
    names.sort_by_key(|(_, p)| file_name(p).to_lowercase());
    let mut out = Vec::new();
    for (i, (folder, p)) in names.iter().enumerate() {
        if i >= MAX_WARP_FILES || began.elapsed() > budget {
            out.push(WarpFile { name: "more theme files".into(), text: None, skipped: Some(format!("{} more were not read: the scan stopped early", names.len() - i)) });
            break;
        }
        let name = file_name(p);
        match read_inside(p, folder, "is outside the theme folder") {
            Ok(text) => out.push(WarpFile { name, text: Some(text), skipped: None }),
            Err(why) => out.push(WarpFile { name, text: None, skipped: Some(why) }),
        }
    }
    out
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}
fn home() -> Option<PathBuf> {
    env_dir(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
}

/// Where Ghostty keeps its configuration folder: XDG first, then the per-system places.
fn ghostty_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(x) = env_dir("XDG_CONFIG_HOME") {
        v.push(x.join("ghostty"));
    }
    if let Some(h) = home() {
        v.push(h.join(".config").join("ghostty"));
        v.push(h.join("Library").join("Application Support").join("com.mitchellh.ghostty"));
    }
    if let Some(a) = env_dir("APPDATA") {
        v.push(a.join("ghostty"));
    }
    v
}

fn warp_dirs() -> Vec<PathBuf> {
    warp_dirs_from(&env_dir)
}

/// Warp's theme folders, with the environment passed in. ponytail: every system's place is tried on every system.
fn warp_dirs_from(env: &dyn Fn(&str) -> Option<PathBuf>) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = env(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        v.push(h.join(".warp").join("themes"));
    }
    // Linux: ${XDG_DATA_HOME:-$HOME/.local/share}/warp-terminal/themes
    if let Some(x) = env("XDG_DATA_HOME") {
        v.push(x.join("warp-terminal").join("themes"));
    }
    if let Some(h) = env(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        v.push(h.join(".local").join("share").join("warp-terminal").join("themes"));
    }
    // Windows: %APPDATA%\warp\Warp\data\themes (Warp's page names APPDATA, not LOCALAPPDATA)
    if let Some(a) = env("APPDATA") {
        v.push(a.join("warp").join("Warp").join("data").join("themes"));
    }
    v
}

#[tauri::command]
pub async fn term_import_ghostty() -> Result<Vec<GhosttyFile>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let candidates: Vec<PathBuf> = ghostty_dirs().into_iter().flat_map(|d| [d.join("config"), d.join("config.ghostty")]).collect();
        ghostty_config(&candidates)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_import_ghostty_theme(name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folders: Vec<PathBuf> = ghostty_dirs().into_iter().map(|d| d.join("themes")).collect();
        ghostty_theme(&name, &folders)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_import_warp() -> Result<Vec<WarpFile>, String> {
    tauri::async_runtime::spawn_blocking(|| warp_themes(&warp_dirs(), WARP_SCAN_BUDGET)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder under the system temp dir (the scratch TEMP in tests), removed on drop.
    struct Dir(PathBuf);
    impl Dir {
        fn new(tag: &str) -> Dir {
            static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let p = std::env::temp_dir().join(format!("kolux-term-import-{}-{tag}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Dir(p)
        }
        fn put(&self, rel: &str, text: &str) -> PathBuf {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, text).unwrap();
            p
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn term_099_config_is_found_with_its_relative_includes_once_each_and_never_outside_its_folder() {
        let d = Dir::new("cfg");
        let cfg = d.put("ghostty/config", "font-size = 13\nconfig-file = extra\nconfig-file = ?missing\nconfig-file = ../escape\nconfig-file = extra\n");
        d.put("ghostty/extra", "config-file = config\ncursor-style = bar\n");
        d.put("escape", "font-size = 99\n");
        let files = ghostty_config(&[d.0.join("nope"), cfg]);
        let labels: Vec<_> = files.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, ["config", "extra", "missing"]);
        assert!(files[1].text.as_deref().unwrap().contains("cursor-style = bar"));
        assert_eq!(files[2].skipped.as_deref(), Some("could not be read"));
        assert!(!files.iter().any(|f| f.text.as_deref().is_some_and(|t| t.contains("99"))));
        assert!(ghostty_config(&[d.0.join("none")]).is_empty());
    }

    #[test]
    fn term_099_an_oversized_config_is_skipped_by_name_and_include_chains_stop_at_the_limit() {
        let d = Dir::new("big");
        let cfg = d.put("config", &format!("config-file = huge\n{}", "config-file = a\n"));
        d.put("huge", &"x".repeat(MAX_BYTES as usize + 1));
        let files = ghostty_config(&[cfg]);
        let huge = files.iter().find(|f| f.label == "huge").unwrap();
        assert!(huge.text.is_none() && huge.skipped.as_deref().unwrap().contains("too large"));
        for i in 0..20 {
            d.put(&format!("c{i}"), &format!("config-file = c{}\n", i + 1));
        }
        let chain = d.put("start", "config-file = c0\n");
        assert_eq!(ghostty_config(&[chain]).len(), MAX_CONFIG_FILES);
    }

    /// Makes `link` a file symlink to `target`; false (so the test prints SKIPPED) when this account may not.
    fn file_link(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(target, link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(target, link);
        made.is_ok()
    }

    /// Makes `link` a folder link to `target` (a junction on Windows, which needs no privilege).
    fn dir_link(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        {
            std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().is_ok_and(|o| o.status.success())
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
    }

    #[test]
    fn term_099_fix2_an_include_that_is_a_symlink_to_a_file_outside_the_config_folder_is_not_read() {
        let d = Dir::new("lnk");
        let cfg = d.put("ghostty/config", "font-size = 13\nconfig-file = linked\nconfig-file = inner/ok\n");
        let outside = d.put("elsewhere/secret", "SECRET-OUTSIDE\n");
        d.put("ghostty/inner/ok", "cursor-style = bar\n");
        if !file_link(&d.0.join("ghostty/linked"), &outside) {
            println!("SKIPPED: this account cannot create a file symlink, so the file-symlink containment check did not run");
            return;
        }
        let files = ghostty_config(&[cfg]);
        let labels: Vec<_> = files.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, ["config", "linked", "ok"]);
        let linked = &files[1];
        assert!(linked.text.is_none(), "the symlink target must not be read: {linked:?}");
        assert_eq!(linked.skipped.as_deref(), Some("is outside the configuration folder"));
        assert!(files[2].text.as_deref().unwrap().contains("cursor-style = bar"), "a plain sub-folder include still reads");
        assert!(!format!("{files:?}").contains("SECRET-OUTSIDE"));
    }

    #[test]
    fn term_099_fix2_an_include_through_a_folder_link_that_leaves_the_config_folder_is_not_read() {
        let d = Dir::new("junc");
        let cfg = d.put("ghostty/config", "config-file = away/secret\nconfig-file = real/ok\n");
        d.put("elsewhere/secret", "SECRET-OUTSIDE\n");
        d.put("ghostty/real/ok", "font-size = 12\n");
        if !dir_link(&d.0.join("ghostty").join("away"), &d.0.join("elsewhere")) {
            println!("SKIPPED: this account cannot create a folder link, so the folder-link containment check did not run");
            return;
        }
        let files = ghostty_config(&[cfg]);
        let secret = files.iter().find(|f| f.label == "secret").expect("the include is listed by name");
        assert!(secret.text.is_none(), "a file reached through a folder link outside must not be read: {secret:?}");
        assert_eq!(secret.skipped.as_deref(), Some("is outside the configuration folder"));
        assert!(files.iter().any(|f| f.label == "ok" && f.text.is_some()));
        assert!(!format!("{files:?}").contains("SECRET-OUTSIDE"));
    }

    #[test]
    fn term_099_fix2_the_config_file_itself_may_be_a_symlink_as_in_a_dotfiles_setup() {
        let d = Dir::new("dot");
        let real = d.put("dotfiles/ghostty-config", "font-size = 15\nconfig-file = extra\n");
        d.put("ghostty/extra", "cursor-style = block\n");
        let link = d.0.join("ghostty/config");
        if !file_link(&link, &real) {
            println!("SKIPPED: this account cannot create a file symlink, so the dotfiles-config check did not run");
            return;
        }
        let files = ghostty_config(&[link]);
        assert_eq!(files.len(), 2, "{files:?}");
        assert!(files[0].text.as_deref().unwrap().contains("font-size = 15"));
        assert!(files[1].text.as_deref().unwrap().contains("cursor-style = block"));
    }

    /// A way to find a real place that fails for the one named file, as on a drive where it errs.
    fn canon_failing_on(name: &'static str) -> impl Fn(&Path) -> Option<PathBuf> {
        move |p| if p.file_name().is_some_and(|n| n == name) { None } else { std::fs::canonicalize(p).ok() }
    }

    #[test]
    fn term_099_fix3_an_include_whose_real_place_cannot_be_found_is_refused_not_read() {
        let d = Dir::new("nocanon");
        let cfg = d.put("ghostty/config", "config-file = flaky\nconfig-file = ok\n");
        d.put("ghostty/flaky", "SECRET-FLAKY\n");
        d.put("ghostty/ok", "cursor-style = bar\n");
        let files = ghostty_config_with(&[cfg], &canon_failing_on("flaky"));
        let labels: Vec<_> = files.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, ["config", "flaky", "ok"]);
        assert!(files[1].text.is_none(), "an include that cannot be resolved must not be read: {:?}", files[1]);
        assert_eq!(files[1].skipped.as_deref(), Some("could not be read"));
        assert!(files[2].text.as_deref().unwrap().contains("cursor-style = bar"), "the other include still reads");
        assert!(!format!("{files:?}").contains("SECRET-FLAKY"));
    }

    #[test]
    fn term_099_fix3_an_include_is_read_through_its_real_path_not_the_path_it_was_named_by() {
        let d = Dir::new("viareal");
        let cfg = d.put("ghostty/config", "config-file = named\n");
        d.put("ghostty/named", "FROM-NAMED\n");
        let swapped = d.put("ghostty/swapped", "FROM-SWAPPED\n");
        let swapped = std::fs::canonicalize(swapped).unwrap();
        // The named path now resolves to another file inside the folder, as if it were swapped after the check.
        let canon = move |p: &Path| if p.file_name().is_some_and(|n| n == "named") { Some(swapped.clone()) } else { std::fs::canonicalize(p).ok() };
        let files = ghostty_config_with(&[cfg], &canon);
        assert_eq!(files.len(), 2, "{files:?}");
        assert_eq!(files[1].text.as_deref(), Some("FROM-SWAPPED\n"), "the text must come from the checked real path");
    }

    #[test]
    fn term_099_fix3_when_the_config_folder_itself_cannot_be_resolved_includes_say_so_not_outside() {
        let d = Dir::new("nodir");
        let cfg = d.put("ghostty/config", "config-file = ok\n");
        d.put("ghostty/ok", "cursor-style = bar\n");
        let dir = d.0.join("ghostty");
        let canon = move |p: &Path| if p == dir { None } else { std::fs::canonicalize(p).ok() };
        let files = ghostty_config_with(&[cfg], &canon);
        assert_eq!(files.len(), 2, "{files:?}");
        assert!(files[1].text.is_none(), "{:?}", files[1]);
        assert_eq!(files[1].skipped.as_deref(), Some("could not be read"));
    }

    #[test]
    fn term_099_fix3_a_hard_link_inside_the_folder_is_read_because_containment_goes_by_path() {
        // Characterization, not a wish: a hard link has no "real place" other than its own path, so a hard
        // link inside the folder to a file elsewhere on the same volume is read like any inside file.
        let d = Dir::new("hard");
        let cfg = d.put("ghostty/config", "config-file = hard\n");
        let outside = d.put("elsewhere/notes", "VIA-HARD-LINK\n");
        if std::fs::hard_link(&outside, d.0.join("ghostty/hard")).is_err() {
            println!("SKIPPED: this account cannot create a hard link, so the hard-link characterization did not run");
            return;
        }
        let files = ghostty_config(&[cfg]);
        assert_eq!(files[1].text.as_deref(), Some("VIA-HARD-LINK\n"), "{files:?}");
    }

    #[test]
    fn term_099_fix3_a_theme_that_is_a_symlink_to_a_file_outside_its_folder_is_not_read_but_a_linked_folder_is() {
        let d = Dir::new("thlnk");
        d.put("themes/Plain", "background = 000000\n");
        let outside = d.put("elsewhere/secret", "SECRET-OUTSIDE\n");
        if !file_link(&d.0.join("themes/Sneaky"), &outside) {
            println!("SKIPPED: this account cannot create a file symlink, so the theme symlink check did not run");
            return;
        }
        let themes = [d.0.join("themes")];
        assert_eq!(ghostty_theme("Plain", &themes).as_deref(), Some("background = 000000\n"));
        assert_eq!(ghostty_theme("Sneaky", &themes), None, "a theme linked to a file outside its folder must not be read");
        // The whole theme folder may be a link (a dotfiles setup): its files are inside its real place.
        d.put("real-themes/Night", "background = 111111\n");
        if dir_link(&d.0.join("linked-themes"), &d.0.join("real-themes")) {
            assert_eq!(ghostty_theme("Night", &[d.0.join("linked-themes")]).as_deref(), Some("background = 111111\n"));
        } else {
            println!("SKIPPED: this account cannot create a folder link, so the linked theme folder check did not run");
        }
    }

    #[test]
    fn term_100_fix3_a_warp_theme_that_is_a_symlink_to_a_file_outside_its_folder_is_skipped_by_name() {
        let d = Dir::new("wlnk");
        d.put("themes/night.yaml", "background: '#000000'\n");
        let outside = d.put("elsewhere/secret.yaml", "SECRET-OUTSIDE\n");
        if !file_link(&d.0.join("themes/sneaky.yaml"), &outside) {
            println!("SKIPPED: this account cannot create a file symlink, so the Warp symlink check did not run");
            return;
        }
        let got = warp_themes(&[d.0.join("themes")], Duration::from_secs(5));
        let names: Vec<_> = got.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(names, ["night.yaml", "sneaky.yaml"]);
        assert!(got[0].text.is_some());
        assert!(got[1].text.is_none(), "{:?}", got[1]);
        assert_eq!(got[1].skipped.as_deref(), Some("is outside the theme folder"));
        assert!(!format!("{got:?}").contains("SECRET-OUTSIDE"));
    }

    #[test]
    fn term_100_fix3_warp_theme_folders_match_warps_public_page_on_each_system() {
        // https://docs.warp.dev/terminal/appearance/custom-themes (read 2026-10-19):
        //   macOS ~/.warp/themes/ · Windows %APPDATA%, then warp, Warp, data, themes · Linux ${XDG_DATA_HOME:-$HOME/.local/share}/warp-terminal/themes/
        let home = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let env = |k: &str| match k {
            k if k == home => Some(PathBuf::from("H")),
            "APPDATA" => Some(PathBuf::from("A")),
            "LOCALAPPDATA" => Some(PathBuf::from("L")),
            "XDG_DATA_HOME" => Some(PathBuf::from("X")),
            _ => None,
        };
        let got = warp_dirs_from(&env);
        let has = |p: PathBuf| assert!(got.contains(&p), "missing {p:?} in {got:?}");
        has(PathBuf::from("H").join(".warp").join("themes"));
        has(PathBuf::from("A").join("warp").join("Warp").join("data").join("themes"));
        has(PathBuf::from("X").join("warp-terminal").join("themes"));
        has(PathBuf::from("H").join(".local").join("share").join("warp-terminal").join("themes"));
        assert!(!got.iter().any(|p| p.starts_with("L")), "LOCALAPPDATA is not a place Warp documents: {got:?}");
    }

    #[test]
    fn term_099_a_theme_is_found_by_name_in_the_first_folder_that_has_it_and_a_path_is_refused() {
        let a = Dir::new("ta");
        let b = Dir::new("tb");
        b.put("Midnight", "background = 000000\n");
        a.put("Midnight", "background = 111111\n");
        a.put("secret.txt", "private\n");
        let folders = [b.0.clone(), a.0.clone()];
        assert_eq!(ghostty_theme("Midnight", &folders).as_deref(), Some("background = 000000\n"));
        assert_eq!(ghostty_theme("Nowhere", &folders), None);
        for bad in ["", ".", "..", "../secret.txt", "sub/Midnight", "sub\\Midnight", "C:Midnight"] {
            assert_eq!(ghostty_theme(bad, &folders), None, "{bad:?}");
        }
    }

    #[test]
    fn term_100_warp_themes_come_back_by_file_name_with_unreadable_ones_marked_and_no_folder_path() {
        let a = Dir::new("wa");
        a.put("themes/night.yaml", "background: '#000000'\n");
        a.put("themes/Day.yml", "background: '#ffffff'\n");
        a.put("themes/notes.txt", "ignored\n");
        a.put("themes/huge.yaml", &"x".repeat(MAX_BYTES as usize + 1));
        std::fs::write(a.0.join("themes/binary.yaml"), [0xffu8, 0xfe, 0x00]).unwrap();
        let got = warp_themes(&[a.0.join("themes"), a.0.join("missing")], Duration::from_secs(5));
        let names: Vec<_> = got.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(names, ["binary.yaml", "Day.yml", "huge.yaml", "night.yaml"]);
        assert_eq!(got[0].skipped.as_deref(), Some("is not text"));
        assert!(got[2].skipped.as_deref().unwrap().contains("too large"));
        assert!(got[3].text.as_deref().unwrap().contains("#000000"));
        let shown = format!("{got:?}");
        assert!(!shown.contains("kolux-term-import"), "no folder path in the result: {shown}");
    }

    #[test]
    fn term_100_a_scan_past_its_time_budget_stops_and_says_so() {
        let a = Dir::new("wb");
        a.put("one.yaml", "a: 1\n");
        a.put("two.yaml", "a: 2\n");
        std::thread::sleep(Duration::from_millis(5));
        let got = warp_themes(std::slice::from_ref(&a.0), Duration::ZERO);
        assert_eq!(got.len(), 1);
        assert!(got[0].skipped.as_deref().unwrap().contains("scan stopped early"));
    }
}
