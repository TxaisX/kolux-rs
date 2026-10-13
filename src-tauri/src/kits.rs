// SKILL-005: the starter kits' sample data. The files are built into the app (so an installed copy
// has them with no resource lookup), copied once into one folder per kit inside a single samples
// folder in the user's home, and that folder is opened as a project. The kit catalogue itself
// (roles, inputs, prompts) lives in the frontend, src/kits/catalog.ts.
use crate::git::Git;
use crate::projects::{add_project, start_git, Project};
use crate::state::Store;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
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
#[tauri::command(async)]
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

/// COMPAT: the results folder at the project root, one subfolder per role id.
pub const RESULTS: &str = "kit-results";
/// SKILL-006: the run record, hidden inside the results folder (its history is SKILL-014).
const RECORD: &str = ".kit-run.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RunRole {
    pub id: String,
    pub ai: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RunRecord {
    pub kit: String,
    pub title: String,
    /// Milliseconds since 1970; a marker or result older than this is from an earlier run.
    pub started: u64,
    pub roles: Vec<RunRole>,
}

/// What the strip needs: the run, and every file in each role's folder with its change time.
#[derive(Debug, Serialize)]
pub struct RunCheck {
    pub record: RunRecord,
    pub files: BTreeMap<String, BTreeMap<String, u64>>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub started: u64,
    /// The dated folder an earlier run's results were copied into.
    pub earlier: Option<String>,
    pub earlier_error: Option<String>,
    pub record_error: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn changed_ms(path: &Path) -> Option<u64> {
    let t = fs::metadata(path).ok()?.modified().ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

pub fn read_record(dir: &Path) -> Option<RunRecord> {
    serde_json::from_str(&fs::read_to_string(dir.join(RESULTS).join(RECORD)).ok()?).ok()
}

/// SKILL-009 / SKILL-010: the run in this folder, or None when it never ran a kit.
pub fn check(dir: &Path) -> Option<RunCheck> {
    let record = read_record(dir)?;
    let mut files = BTreeMap::new();
    for r in &record.roles {
        let mut mine = BTreeMap::new();
        for e in fs::read_dir(dir.join(RESULTS).join(&r.id)).into_iter().flatten().flatten() {
            if e.path().is_file() {
                if let Some(t) = changed_ms(&e.path()) {
                    mine.insert(e.file_name().to_string_lossy().into_owned(), t);
                }
            }
        }
        files.insert(r.id.clone(), mine);
    }
    Some(RunCheck { record, files })
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<usize> {
    let mut n = 0;
    for e in fs::read_dir(from)?.flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if src.is_dir() {
            n += copy_tree(&src, &dst)?;
        } else {
            fs::create_dir_all(to)?;
            fs::copy(&src, &dst)?;
            n += 1;
        }
    }
    Ok(n)
}

/// SKILL-006: copies what an earlier run left into `results/<name>` (a fresh name, " (2)" and on
/// when taken). The role folders are the earlier record's roles, or with no record every folder
/// that is not itself a dated one (their names hold an en dash). Nothing is moved or deleted.
pub fn gather_earlier(results: &Path, earlier: Option<&RunRecord>, name: &str) -> Result<Option<String>, String> {
    let roles: Vec<String> = match earlier {
        Some(r) => r.roles.iter().map(|r| r.id.clone()).collect(),
        None => fs::read_dir(results)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.contains('\u{2013}'))
            .collect(),
    };
    let full: Vec<String> = roles.into_iter().filter(|r| fs::read_dir(results.join(r)).map(|mut d| d.next().is_some()).unwrap_or(false)).collect();
    if full.is_empty() {
        return Ok(None);
    }
    let mut pick = name.to_string();
    let mut n = 2;
    while results.join(&pick).exists() {
        pick = format!("{name} ({n})");
        n += 1;
    }
    for r in &full {
        copy_tree(&results.join(r), &results.join(&pick).join(r)).map_err(|e| format!("Kolux could not copy the earlier results of {r}: {e}"))?;
    }
    Ok(Some(pick))
}

/// SKILL-006: before a kit's seats open, keep the earlier run's results and write the new record.
/// Either step may fail without stopping the launch; the caller tells the user.
pub fn prepare(dir: &Path, record: RunRecord, earlier_name: &str) -> Prepared {
    let results = dir.join(RESULTS);
    let mut out = Prepared { started: record.started, ..Default::default() };
    match gather_earlier(&results, read_record(dir).as_ref(), earlier_name) {
        Ok(name) => out.earlier = name,
        Err(e) => out.earlier_error = Some(e),
    }
    let text = serde_json::to_string_pretty(&record).unwrap_or_default();
    if let Err(e) = fs::create_dir_all(&results).and_then(|_| fs::write(results.join(RECORD), text)) {
        out.record_error = Some(e.to_string());
    }
    out
}

#[tauri::command]
pub fn kit_check(dir: String) -> Option<RunCheck> {
    check(Path::new(&dir))
}

#[tauri::command]
pub fn kit_prepare(dir: String, kit: String, title: String, roles: Vec<RunRole>, earlier_name: String) -> Prepared {
    prepare(Path::new(&dir), RunRecord { kit, title, started: now_ms(), roles }, &earlier_name)
}

/// SKILL-009 Open results: the results folder in the system file manager.
#[tauri::command]
pub fn kit_open_results(dir: String) -> Result<(), String> {
    let path = Path::new(&dir).join(RESULTS);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let opener = "explorer.exe";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
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

    fn record(kit: &str, started: u64) -> RunRecord {
        RunRecord { kit: kit.into(), title: "Fake kit".into(), started, roles: vec![RunRole { id: "a".into(), ai: "claude".into() }, RunRole { id: "b".into(), ai: "codex".into() }] }
    }

    #[test]
    fn a_new_run_keeps_the_earlier_results_in_a_dated_copy_and_records_itself() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-kit-run-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let name = "Fake kit \u{2013} Oct 12 2026, 1.08 AM";
        // No earlier run: nothing to gather, the record is written, and check sees no files yet.
        let p = prepare(&dir, record("one", 1000), name);
        assert_eq!((p.earlier.as_deref(), p.earlier_error.as_deref(), p.record_error.as_deref()), (None, None, None));
        let c = check(&dir).unwrap();
        assert_eq!(c.record, record("one", 1000));
        assert!(c.files["a"].is_empty() && c.files["b"].is_empty());
        // The earlier run left files: a second run copies them and leaves the originals.
        fs::create_dir_all(dir.join(RESULTS).join("a")).unwrap();
        fs::write(dir.join(RESULTS).join("a").join("findings.md"), "old").unwrap();
        fs::write(dir.join(RESULTS).join("a").join("DONE"), "done").unwrap();
        let c = check(&dir).unwrap();
        assert_eq!(c.files["a"].keys().collect::<Vec<_>>(), ["DONE", "findings.md"]);
        let p = prepare(&dir, record("one", 2000), name);
        assert_eq!(p.earlier.as_deref(), Some(name));
        assert_eq!(fs::read_to_string(dir.join(RESULTS).join(name).join("a").join("findings.md")).unwrap(), "old");
        assert_eq!(fs::read_to_string(dir.join(RESULTS).join("a").join("findings.md")).unwrap(), "old");
        assert_eq!(read_record(&dir).unwrap().started, 2000);
        // The same minute again takes a fresh name; a dated folder is never gathered itself.
        let p = prepare(&dir, record("one", 3000), name);
        assert_eq!(p.earlier, Some(format!("{name} (2)")));
        fs::remove_file(dir.join(RESULTS).join(RECORD)).unwrap();
        let p = prepare(&dir, record("one", 4000), "Earlier run – Oct 12 2026, 1.09 AM");
        assert_eq!(p.earlier.as_deref(), Some("Earlier run – Oct 12 2026, 1.09 AM"));
        let kept: Vec<_> = fs::read_dir(dir.join(RESULTS).join("Earlier run – Oct 12 2026, 1.09 AM")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(kept, ["a"]);
        assert!(check(&std::env::temp_dir().join("kolux-rs-no-such-kit-folder")).is_none());
        fs::remove_dir_all(&dir).unwrap();
    }
}
