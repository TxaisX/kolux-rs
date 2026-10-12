// SKILL-005: the starter kits' sample data. The files are built into the app (so an installed copy
// has them with no resource lookup), copied once into one folder per kit inside a single samples
// folder in the user's home, and that folder is opened as a project. The kit catalogue itself
// (roles, inputs, prompts) lives in the frontend, src/kits/catalog.ts.
use crate::git::Git;
use crate::projects::{add_project, start_git, Project};
use crate::state::Store;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Every sample file: kit id, file name, contents. A test checks this matches `src-tauri/kits`.
pub const SAMPLES: &[(&str, &str, &str)] = &[
    ("spreadsheet", "sales.csv", include_str!("../kits/spreadsheet/sales.csv")),
    ("tidy-merge", "customers-a.csv", include_str!("../kits/tidy-merge/customers-a.csv")),
    ("tidy-merge", "customers-b.csv", include_str!("../kits/tidy-merge/customers-b.csv")),
    ("marketing", "campaign.csv", include_str!("../kits/marketing/campaign.csv")),
    ("research", "notes.md", include_str!("../kits/research/notes.md")),
    ("sales", "crm-export.csv", include_str!("../kits/sales/crm-export.csv")),
    ("weekly", "kpis.csv", include_str!("../kits/weekly/kpis.csv")),
];

pub const SAMPLES_DIR_ENV: &str = "KOLUX_SAMPLES_DIR";

/// `kolux-rs\samples` in the user's home, beside the default workspaces folder, unless
/// KOLUX_SAMPLES_DIR names another place.
pub fn samples_root() -> PathBuf {
    match std::env::var(SAMPLES_DIR_ENV).ok().filter(|v| !v.trim().is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => crate::projects::default_workspaces_dir().with_file_name("samples"),
    }
}

/// The sample repository's own identity, so its first commit works even before the user has set
/// a Git name; it is passed on that one command only.
const SAMPLE_IDENT: &[&str] = &["-c", "user.name=Kolux RS samples", "-c", "user.email=samples@kolux-rs.invalid"];

/// Copies one kit's samples into `root\<kit>` and makes that folder a Git repository with them as
/// its first commit. A file already there is never overwritten and a folder already in Git is
/// left as it is, so a second call changes nothing.
pub fn copy_samples(root: &Path, kit: &str) -> Result<PathBuf, String> {
    let files: Vec<_> = SAMPLES.iter().filter(|(k, _, _)| *k == kit).collect();
    if files.is_empty() {
        return Err(format!("The {kit} kit has no sample data."));
    }
    let dir = root.join(kit);
    fs::create_dir_all(&dir).map_err(|e| format!("Kolux could not make the samples folder {}: {e}", dir.display()))?;
    for (_, name, text) in &files {
        let path = dir.join(name);
        if !path.exists() {
            fs::write(&path, text).map_err(|e| format!("Kolux could not copy the sample {name}: {e}"))?;
        }
    }
    if !dir.join(".git").exists() {
        let names: Vec<String> = files.iter().map(|(_, n, _)| n.to_string()).collect();
        start_git(&dir, &names, SAMPLE_IDENT)?;
    }
    Ok(dir)
}

/// SKILL-005: Try with sample data. Returns the samples project, added like any repository.
#[tauri::command]
pub fn kit_samples(git: State<'_, Git>, store: State<'_, Mutex<Store>>, kit: String) -> Result<Project, String> {
    let dir = copy_samples(&samples_root(), &kit)?;
    let store = store.lock().map_err(|e| e.to_string())?;
    add_project(&git, &store, &dir)
}

/// The samples folder for a kit, so the setup dialog can tell a sample workspace from a real one.
#[tauri::command]
pub fn kit_samples_dir(kit: String) -> String {
    samples_root().join(kit).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_sample_file_on_disk_is_built_in_and_the_other_way_round() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("kits");
        let mut on_disk = Vec::new();
        for kit in fs::read_dir(&base).unwrap() {
            let kit = kit.unwrap();
            for f in fs::read_dir(kit.path()).unwrap() {
                on_disk.push(format!("{}/{}", kit.file_name().to_string_lossy(), f.unwrap().file_name().to_string_lossy()));
            }
        }
        on_disk.sort();
        let mut built: Vec<String> = SAMPLES.iter().map(|(k, n, t)| {
            assert!(!t.trim().is_empty(), "{k}/{n} is empty");
            format!("{k}/{n}")
        }).collect();
        built.sort();
        assert_eq!(on_disk, built);
    }

    #[test]
    fn samples_are_copied_once_into_a_git_folder_and_never_overwritten() {
        let root = std::env::temp_dir().join(format!("kolux-rs-kit-samples-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dir = copy_samples(&root, "tidy-merge").unwrap();
        assert_eq!(dir, root.join("tidy-merge"));
        assert!(dir.join("customers-a.csv").is_file() && dir.join("customers-b.csv").is_file());
        assert_eq!(crate::git::run(&["rev-list", "--count", "HEAD"], Some(&dir)).unwrap(), "1");
        // A user's edit survives a second Try with sample data, and nothing else changes.
        fs::write(dir.join("customers-a.csv"), "edited").unwrap();
        let head = crate::git::run(&["rev-parse", "HEAD"], Some(&dir)).unwrap();
        copy_samples(&root, "tidy-merge").unwrap();
        assert_eq!(fs::read_to_string(dir.join("customers-a.csv")).unwrap(), "edited");
        assert_eq!(crate::git::run(&["rev-parse", "HEAD"], Some(&dir)).unwrap(), head);
        assert!(copy_samples(&root, "no-such-kit").unwrap_err().contains("no sample data"));
        fs::remove_dir_all(&root).unwrap();
    }
}
