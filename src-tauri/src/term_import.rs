//! TERM-099 / TERM-100 (T-307): finds the Ghostty configuration and theme files and the Warp theme files
//! on this machine and hands their text to the settings page, which maps them (src/settings/
//! importSchemes.ts). Nothing here writes anything. Files are read with a size cap, only inside the
//! folders named below, and a file that cannot be used comes back with a plain reason that never
//! carries a folder path. The folder names are from the public Ghostty configuration reference and
//! Warp's custom-themes page.

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

/// The first config file that exists in `candidates`, then the files it includes (relative paths inside
/// its own folder, at most `MAX_CONFIG_FILES` in all, each once).
pub(crate) fn ghostty_config(candidates: &[PathBuf]) -> Vec<GhosttyFile> {
    let Some(first) = candidates.iter().find(|p| p.is_file()) else {
        return Vec::new();
    };
    let dir = first.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut out = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut queue = vec![first.clone()];
    while let Some(path) = queue.pop() {
        if out.len() >= MAX_CONFIG_FILES {
            break;
        }
        let key = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.insert(key) {
            continue;
        }
        let label = file_name(&path);
        match read_capped(&path) {
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
    folders.iter().map(|d| d.join(name)).filter(|p| p.is_file()).find_map(|p| read_capped(&p).ok())
}

/// The `.yaml` / `.yml` files in the Warp theme folders, by name, each with its text or why it was
/// skipped. Past `MAX_WARP_FILES` or the scan's time budget the rest are left out and one entry says so.
pub(crate) fn warp_themes(folders: &[PathBuf], budget: Duration) -> Vec<WarpFile> {
    let began = Instant::now();
    let mut names: Vec<PathBuf> = folders
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flat_map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("yaml") || x.eq_ignore_ascii_case("yml")))
        .collect();
    names.sort_by_key(|p| file_name(p).to_lowercase());
    let mut out = Vec::new();
    for (i, p) in names.iter().enumerate() {
        if i >= MAX_WARP_FILES || began.elapsed() > budget {
            out.push(WarpFile { name: "more theme files".into(), text: None, skipped: Some(format!("{} more were not read: the scan stopped early", names.len() - i)) });
            break;
        }
        let name = file_name(p);
        match read_capped(p) {
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
    let mut v = Vec::new();
    if let Some(h) = home() {
        v.push(h.join(".warp").join("themes"));
        v.push(h.join(".local").join("share").join("warp-terminal").join("themes"));
    }
    if let Some(l) = env_dir("LOCALAPPDATA") {
        v.push(l.join("warp").join("Warp").join("data").join("themes"));
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
