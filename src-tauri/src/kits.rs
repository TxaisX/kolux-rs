// SKILL-005: the starter kits' sample data. The files are built into the app (so an installed copy
// has them with no resource lookup), copied once into one folder per kit inside a single samples
// folder in the user's home, and that folder is opened as a project. The kit catalogue itself
// (roles, inputs, prompts) lives in the frontend, src/kits/catalog.ts.
use crate::git::Git;
use crate::projects::{locate_repo, register_project, start_git, Project};
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
/// Off the window thread, and Git runs before the state store is locked (T-442-c).
#[tauri::command(async)]
pub fn kit_samples(git: State<'_, Git>, store: State<'_, Mutex<Store>>, kit: String) -> Result<Project, String> {
    let dir = copy_samples(&samples_root(), &kit)?;
    let found = locate_repo(&git, &dir)?;
    register_project(&*store.lock().map_err(|e| e.to_string())?, found)
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
    read_file(dir).map(|f| f.run)
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
    let old = read_file(dir);
    match gather_earlier(&results, old.as_ref().map(|f| &f.run), earlier_name) {
        Ok(name) => out.earlier = name,
        Err(e) => out.earlier_error = Some(e),
    }
    // SKILL-014: the folder's own history rides in the same record file.
    let run = Past { dir: dir.to_string_lossy().into_owned(), kit: record.kit.clone(), title: record.title.clone(), started: record.started, collected: None };
    let history = remember_run(old.map(|f| f.history).unwrap_or_default(), run);
    if let Err(e) = write_file(dir, &RecordFile { run: record, history }) {
        out.record_error = Some(e.to_string());
    }
    out
}

#[tauri::command]
/// ACCT-055: only a project or the samples folder, like the other kit commands.
pub fn kit_check(store: State<'_, Mutex<Store>>, dir: String) -> Option<RunCheck> {
    guard(&store, &dir).ok().and_then(|d| check(&d))
}

/// SKILL-015: refused for an unknown kit or a folder that is not a project or under samples.
#[tauri::command]
pub fn kit_prepare(store: State<'_, Mutex<Store>>, dir: String, kit: String, title: String, roles: Vec<RunRole>, earlier_name: String) -> Result<Prepared, String> {
    known_kit(&kit)?;
    let path = guard(&store, &dir)?;
    let started = now_ms();
    let out = prepare(&path, RunRecord { kit: kit.clone(), title: title.clone(), started, roles }, &earlier_name);
    if let Ok(s) = store.lock() {
        let list = remember_run(load_history(&s), Past { dir, kit, title, started, collected: None });
        let _ = save_history(&s, &list);
    }
    Ok(out)
}

/// SKILL-009 / SKILL-014 Open results: the results folder in the system file manager, or the
/// collected folder inside it when one is named and still there.
#[tauri::command]
pub fn kit_open_results(store: State<'_, Mutex<Store>>, dir: String, folder: Option<String>) -> Result<(), String> {
    let path = guard(&store, &dir)?.join(RESULTS);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let one = folder.filter(|f| Path::new(f).components().count() == 1 && matches!(Path::new(f).components().next(), Some(std::path::Component::Normal(_))));
    match one.map(|f| path.join(f)).filter(|p| p.is_dir()) {
        Some(sub) => reveal(&sub),
        None => reveal(&path),
    }
}

// ---- SKILL-013 collect, SKILL-014 run history, SKILL-015 where kits may run ----

/// SKILL-014: a run record over this size, or one that cannot be parsed, is ignored.
const RECORD_LIMIT: u64 = 256 * 1024;
/// SKILL-014: each history list keeps the newest this many runs.
pub const HISTORY_MAX: usize = 50;
/// SKILL-014 COMPAT: the history across projects lives in the app's own data folder.
const HISTORY_KEY: &str = "kit_history";

/// One run in a history list.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Past {
    pub dir: String,
    pub kit: String,
    pub title: String,
    pub started: u64,
    /// The dated folder inside the results folder this run was collected into.
    #[serde(default)]
    pub collected: Option<String>,
}

/// The hidden record file: the current run and this folder's own history.
#[derive(Debug, Serialize, Deserialize)]
struct RecordFile {
    #[serde(flatten)]
    run: RunRecord,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    history: Vec<Past>,
}

fn read_file(dir: &Path) -> Option<RecordFile> {
    let path = dir.join(RESULTS).join(RECORD);
    if fs::metadata(&path).ok()?.len() > RECORD_LIMIT {
        return None;
    }
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn write_file(dir: &Path, file: &RecordFile) -> std::io::Result<()> {
    let results = dir.join(RESULTS);
    fs::create_dir_all(&results)?;
    fs::write(results.join(RECORD), serde_json::to_string_pretty(file).unwrap_or_default())
}

fn same_run(a: &Past, b: &Past) -> bool {
    crate::projects::name_key(&a.dir) == crate::projects::name_key(&b.dir) && a.kit == b.kit && a.started == b.started
}

/// SKILL-014: adds a run, the same folder, kit and start time stored only once, newest first,
/// the newest 50 kept.
pub fn remember_run(mut list: Vec<Past>, run: Past) -> Vec<Past> {
    list.retain(|x| !same_run(x, &run));
    list.push(run);
    list.sort_by_key(|p| std::cmp::Reverse(p.started));
    list.truncate(HISTORY_MAX);
    list
}

fn mark_collected(list: &mut [Past], run: &Past, folder: &str) {
    for x in list.iter_mut().filter(|x| same_run(x, run)) {
        x.collected = Some(folder.to_string());
    }
}

pub fn load_history(store: &Store) -> Vec<Past> {
    store.get(HISTORY_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_history(store: &Store, list: &[Past]) -> Result<(), String> {
    store.set(HISTORY_KEY, &serde_json::to_string(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// SKILL-015: kit actions take only an absolute path to an existing folder that is a project
/// added to Kolux or sits inside the samples folder.
pub fn kit_folder(dir: &str, projects: &[Project], samples: &Path) -> Result<PathBuf, String> {
    let p = Path::new(dir);
    if !p.is_absolute() {
        return Err(format!("Kits need a full folder path, and {dir} is not one."));
    }
    if !p.is_dir() {
        return Err(format!("{dir} is not a folder on this PC."));
    }
    let inside = match (p.canonicalize(), samples.canonicalize()) {
        (Ok(a), Ok(b)) => a.starts_with(b),
        _ => false,
    };
    if inside || projects.iter().any(|x| crate::projects::same_folder(p, Path::new(&x.path))) {
        Ok(p.to_path_buf())
    } else {
        Err(format!("Kits run only in a project added to Kolux or in the samples folder, and {dir} is neither."))
    }
}

/// SKILL-015: the kit ids Kolux knows (every kit has sample data).
pub fn known_kit(kit: &str) -> Result<(), String> {
    if SAMPLES.iter().any(|(k, _, _)| *k == kit) {
        Ok(())
    } else {
        Err(format!("Kolux has no kit called {kit}."))
    }
}

fn guard(store: &State<'_, Mutex<Store>>, dir: &str) -> Result<PathBuf, String> {
    let lock = store.lock().map_err(|e| e.to_string())?;
    let projects = crate::projects::load_projects(&lock);
    drop(lock);
    kit_folder(dir, &projects, &samples_root())
}

/// A free name inside `results`: `name`, else `name (2)` and on.
fn fresh_name(results: &Path, name: &str) -> String {
    let mut pick = name.to_string();
    let mut n = 2;
    while results.join(&pick).exists() {
        pick = format!("{name} ({n})");
        n += 1;
    }
    pick
}

/// SKILL-013: a declared result inside the results folder, or None when it is missing or refused:
/// a step that is not a plain name (parent steps, absolute or drive paths), a link anywhere along
/// the way, or a real path outside the results folder (a look-alike sibling included).
fn declared(results: &Path, root: &Path, role: &str, file: &str) -> Option<PathBuf> {
    let rel = Path::new(role).join(file);
    if role.is_empty() || file.is_empty() || rel.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return None;
    }
    let mut at = results.to_path_buf();
    for c in rel.components() {
        at.push(c);
        if fs::symlink_metadata(&at).ok()?.file_type().is_symlink() {
            return None;
        }
    }
    let real = at.canonicalize().ok()?;
    (real.starts_with(root) && fs::symlink_metadata(&at).ok()?.is_file()).then_some(at)
}

fn results_root(dir: &Path) -> Result<(PathBuf, PathBuf), String> {
    let results = dir.join(RESULTS);
    match fs::symlink_metadata(&results) {
        Ok(m) if m.file_type().is_symlink() => Err("The results folder is a link to somewhere else, so Kolux leaves it alone.".into()),
        Ok(_) => Ok((results.clone(), results.canonicalize().map_err(|e| e.to_string())?)),
        Err(_) => Err("This folder has no kit results yet.".into()),
    }
}

/// What the strip sends for each role: its id, its title and the files it was meant to produce.
#[derive(Clone, Debug, Deserialize)]
pub struct CollectRole {
    pub id: String,
    pub title: String,
    pub files: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Collected {
    /// The dated folder's name inside the results folder.
    pub folder: String,
    pub copied: Vec<String>,
    pub missing: Vec<String>,
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn ai_name(ai: &str) -> &str {
    match ai {
        "claude" => "Claude",
        "codex" => "Codex",
        "grok" => "Grok",
        "" => "no AI",
        other => other,
    }
}

/// SKILL-013: Markdown for the Results page. Raw HTML is shown as text, and links or images that
/// would run script (javascript:, vbscript:, data:) are taken out, their words kept.
pub fn safe_markdown(md: &str) -> String {
    use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag, TagEnd};
    let bad = |u: &str| {
        let l: String = u.trim().chars().filter(|c| !c.is_whitespace() && !c.is_control()).collect::<String>().to_ascii_lowercase();
        l.starts_with("javascript:") || l.starts_with("vbscript:") || l.starts_with("data:")
    };
    let mut links: Vec<bool> = Vec::new();
    let mut images: Vec<bool> = Vec::new();
    let events = Parser::new_ext(md, Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS).filter_map(|e| match e {
        Event::Html(t) | Event::InlineHtml(t) => Some(Event::Text(t)),
        Event::Start(Tag::HtmlBlock) => Some(Event::Html(CowStr::Borrowed("<pre class=\"raw\">"))),
        Event::End(TagEnd::HtmlBlock) => Some(Event::Html(CowStr::Borrowed("</pre>\n"))),
        Event::Start(Tag::Link { ref dest_url, .. }) => {
            let drop = bad(dest_url);
            links.push(drop);
            (!drop).then_some(e)
        }
        Event::End(TagEnd::Link) => (!links.pop().unwrap_or(false)).then_some(e),
        Event::Start(Tag::Image { ref dest_url, .. }) => {
            let drop = bad(dest_url) || images.iter().any(|d| *d);
            images.push(drop);
            (!drop).then_some(e)
        }
        Event::End(TagEnd::Image) => (!images.pop().unwrap_or(false)).then_some(e),
        _ if images.iter().any(|d| *d) => None,
        e => Some(e),
    });
    let mut out = String::new();
    html::push_html(&mut out, events);
    out
}

struct Item {
    role: String,
    ai: String,
    rel: String,
    hash: String,
    md: Option<String>,
}

fn readme(title: &str, folder: &str, items: &[Item], missing: &[String]) -> String {
    let mut s = format!("# {title}\n\nThe results of the kit, collected into {folder}. The original files were not touched.\n\n## Files\n\n");
    for i in items {
        s += &format!("- {} — made by the {} role on {}\n", i.rel, i.role, i.ai);
    }
    if items.is_empty() {
        s += "No result files were there to collect.\n";
    }
    if !missing.is_empty() {
        s += "\n## Missing\n\nThese files were meant to be made but were not there, or were links Kolux will not follow:\n\n";
        for m in missing {
            s += &format!("- {m}\n");
        }
    }
    s += "\n## Audit\n\nEach copied file's SHA-256 hash, so a change can be spotted later.\n\n| File | SHA-256 |\n| --- | --- |\n";
    for i in items {
        s += &format!("| {} | {} |\n", i.rel, i.hash);
    }
    s
}

const PAGE_STYLE: &str = "body{margin:0;font:15px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d1d1f;background:#f6f6f4}main{max-width:820px;margin:0 auto;padding:32px 20px 64px}h1{font-size:26px;margin:0 0 4px}.sub{color:#6b6b6b;margin:0 0 28px}section{background:#fff;border:1px solid #e3e3df;border-radius:10px;padding:18px 22px;margin:0 0 18px}h2{font-size:17px;margin:0 0 2px}.file{color:#6b6b6b;font-size:13px;margin:0 0 12px}pre{white-space:pre-wrap;background:#f1f1ee;padding:10px;border-radius:6px;overflow-x:auto}table{border-collapse:collapse}td,th{border:1px solid #e3e3df;padding:4px 8px}img{max-width:100%}@media (prefers-color-scheme:dark){body{background:#1b1b1d;color:#e8e8e6}section{background:#242427;border-color:#36363a}.sub,.file{color:#a0a0a0}pre{background:#2c2c30}td,th{border-color:#36363a}a{color:#8ab4ff}}";

fn results_page(title: &str, folder: &str, items: &[Item], missing: &[String]) -> String {
    let mut body = String::new();
    for i in items {
        let file = i.rel.rsplit('/').next().unwrap_or(&i.rel);
        let inner = match &i.md {
            Some(md) => format!("<div class=\"md\">{}</div>", safe_markdown(md)),
            None => format!("<p><a href=\"{}\">Open {}</a></p>", esc(&i.rel), esc(file)),
        };
        body += &format!("<section><h2>{} · {}</h2><p class=\"file\">{}</p>{inner}</section>\n", esc(&i.role), esc(&i.ai), esc(&i.rel));
    }
    if !missing.is_empty() {
        body += "<section><h2>Missing</h2><ul>";
        for m in missing {
            body += &format!("<li>{}</li>", esc(m));
        }
        body += "</ul></section>\n";
    }
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:\"><title>{t}</title><style>{PAGE_STYLE}</style></head>\n<body><main><h1>{t}</h1><p class=\"sub\">Collected into {f}</p>\n{body}</main></body></html>\n",
        t = esc(title),
        f = esc(folder)
    )
}

/// SKILL-013: copies every declared result of this folder's run into a fresh dated folder inside
/// the results folder, with a README (who made what, then each file's SHA-256) and one Results
/// page. Originals are never touched; missing or refused files are listed.
pub fn collect(dir: &Path, roles: &[CollectRole], name: &str) -> Result<(Collected, Past), String> {
    use sha2::{Digest, Sha256};
    let mut file = read_file(dir).ok_or("This folder has no kit run to collect.")?;
    let (results, root) = results_root(dir)?;
    let folder = fresh_name(&results, name);
    let out = results.join(&folder);
    fs::create_dir_all(&out).map_err(|e| format!("Kolux could not make the folder {folder}: {e}"))?;
    let (mut items, mut missing) = (Vec::new(), Vec::new());
    for r in roles {
        let ai = file.run.roles.iter().find(|x| x.id == r.id).map(|x| ai_name(&x.ai).to_string()).unwrap_or_else(|| ai_name("").into());
        for f in &r.files {
            let rel = format!("{}/{}", r.id, f);
            let Some(src) = declared(&results, &root, &r.id, f) else {
                missing.push(rel);
                continue;
            };
            let bytes = fs::read(&src).map_err(|e| format!("Kolux could not read {rel}: {e}"))?;
            let to = out.join(&r.id).join(f);
            fs::create_dir_all(out.join(&r.id)).and_then(|_| fs::write(&to, &bytes)).map_err(|e| format!("Kolux could not copy {rel}: {e}"))?;
            let hash = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
            let md = (f.to_ascii_lowercase().ends_with(".md") || f.to_ascii_lowercase().ends_with(".markdown")).then(|| String::from_utf8_lossy(&bytes).into_owned());
            items.push(Item { role: r.title.clone(), ai: ai.clone(), rel, hash, md });
        }
    }
    let title = file.run.title.clone();
    fs::write(out.join("README.md"), readme(&title, &folder, &items, &missing)).map_err(|e| format!("Kolux could not write the README: {e}"))?;
    fs::write(out.join("Results.html"), results_page(&title, &folder, &items, &missing)).map_err(|e| format!("Kolux could not write the Results page: {e}"))?;
    let run = Past { dir: dir.to_string_lossy().into_owned(), kit: file.run.kit.clone(), title, started: file.run.started, collected: Some(folder.clone()) };
    if !file.history.iter().any(|x| same_run(x, &run)) {
        file.history = remember_run(std::mem::take(&mut file.history), run.clone());
    }
    mark_collected(&mut file.history, &run, &folder);
    write_file(dir, &file).map_err(|e| format!("The results were collected, but the run record could not be updated: {e}"))?;
    Ok((Collected { folder, copied: items.into_iter().map(|i| i.rel).collect(), missing }, run))
}

#[tauri::command]
pub fn kit_collect(store: State<'_, Mutex<Store>>, dir: String, roles: Vec<CollectRole>, name: String) -> Result<Collected, String> {
    let dir = guard(&store, &dir)?;
    let (done, run) = collect(&dir, &roles, &name)?;
    let store = store.lock().map_err(|e| e.to_string())?;
    let mut list = remember_run(load_history(&store), run.clone());
    mark_collected(&mut list, &run, &done.folder);
    save_history(&store, &list)?;
    Ok(done)
}

/// SKILL-014: recent kit runs across every project, newest first.
#[tauri::command]
pub fn kit_history(store: State<'_, Mutex<Store>>) -> Vec<Past> {
    store.lock().map(|s| load_history(&s)).unwrap_or_default()
}

fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let opener = "explorer.exe";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// SKILL-012 Open: a role's result file in the system's default app.
#[tauri::command]
pub fn kit_open_file(store: State<'_, Mutex<Store>>, dir: String, role: String, file: String) -> Result<(), String> {
    let dir = guard(&store, &dir)?;
    let (results, root) = results_root(&dir)?;
    let path = declared(&results, &root, &role, &file).ok_or_else(|| format!("{role}/{file} is not there, or is a link Kolux will not follow."))?;
    reveal(&path)
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
    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-kit-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(RESULTS).join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn collect_copies_declared_files_into_a_dated_folder_with_hashes_and_a_safe_page() {
        let dir = temp("collect");
        prepare(&dir, record("one", 1000), "unused");
        put(&dir, "a/findings.md", "# Findings\n\n<script>alert(1)</script>\n\n[click](javascript:alert(2)) and ![x](javascript:alert(3))\n");
        put(&dir, "b/table.csv", "abc");
        // A look-alike sibling of the results folder holds a file a path could try to reach.
        fs::create_dir_all(dir.join("kit-results2")).unwrap();
        fs::write(dir.join("kit-results2").join("secret.md"), "secret").unwrap();
        let roles = vec![
            CollectRole { id: "a".into(), title: "Analyst".into(), files: vec!["findings.md".into(), "gone.md".into(), "../../kit-results2/secret.md".into()] },
            CollectRole { id: "b".into(), title: "Builder".into(), files: vec!["table.csv".into(), "C:/Windows/win.ini".into(), "/etc/passwd".into()] },
        ];
        let name = "Fake kit \u{2013} Oct 12 2026, 12.05 PM";
        let (got, run) = collect(&dir, &roles, name).unwrap();
        assert_eq!(got.folder, name);
        assert_eq!(got.copied, ["a/findings.md", "b/table.csv"]);
        assert_eq!(got.missing, ["a/gone.md", "a/../../kit-results2/secret.md", "b/C:/Windows/win.ini", "b//etc/passwd"]);
        let out = dir.join(RESULTS).join(name);
        assert_eq!(fs::read_to_string(out.join("b").join("table.csv")).unwrap(), "abc");
        assert!(!out.join("secret.md").exists() && !out.join("a").join("secret.md").exists());
        // Originals stay where they were.
        assert_eq!(fs::read_to_string(dir.join(RESULTS).join("b").join("table.csv")).unwrap(), "abc");
        let readme = fs::read_to_string(out.join("README.md")).unwrap();
        assert!(readme.contains("b/table.csv — made by the Builder role on Codex"), "{readme}");
        assert!(readme.contains("## Audit") && readme.contains("| b/table.csv | ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad |"), "{readme}");
        assert!(readme.contains("- a/gone.md"));
        let page = fs::read_to_string(out.join("Results.html")).unwrap();
        assert!(page.contains("&lt;script&gt;alert(1)&lt;/script&gt;") && !page.contains("<script"), "{page}");
        assert!(!page.to_ascii_lowercase().contains("javascript:") && page.contains("click"), "{page}");
        assert!(page.contains("<a href=\"b/table.csv\">Open table.csv</a>") && page.contains("<h1>Fake kit</h1>"));
        // The run's history entry says it was collected; a second collect takes a fresh name.
        assert_eq!(run.collected.as_deref(), Some(name));
        let file = read_file(&dir).unwrap();
        assert_eq!(file.history.len(), 1);
        assert_eq!(file.history[0].collected.as_deref(), Some(name));
        assert_eq!(collect(&dir, &roles, name).unwrap().0.folder, format!("{name} (2)"));
        assert!(collect(&temp("collect-none"), &roles, name).unwrap_err().contains("no kit run"));
        fs::remove_dir_all(&dir).unwrap();
        fs::remove_dir_all(temp("collect-none")).unwrap();
    }

    #[test]
    fn a_declared_file_that_is_a_link_counts_as_missing() {
        let dir = temp("link");
        prepare(&dir, record("one", 1000), "unused");
        put(&dir, "a/real.md", "real");
        let outside = dir.join("outside.md");
        fs::write(&outside, "outside").unwrap();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(&outside, dir.join(RESULTS).join("a").join("report.md"));
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, dir.join(RESULTS).join("a").join("report.md"));
        if let Err(e) = made {
            // Windows without Developer Mode refuses to make links; the path checks above still run.
            eprintln!("skipping the link case: {e}");
            fs::remove_dir_all(&dir).unwrap();
            return;
        }
        let roles = vec![CollectRole { id: "a".into(), title: "A".into(), files: vec!["real.md".into(), "report.md".into()] }];
        let (got, _) = collect(&dir, &roles, "Kit \u{2013} Oct 1 2026, 9.00 AM").unwrap();
        assert_eq!((got.copied, got.missing), (vec!["a/real.md".to_string()], vec!["a/report.md".to_string()]));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn history_keeps_one_entry_per_run_and_the_newest_fifty() {
        let past = |dir: &str, started: u64| Past { dir: dir.into(), kit: "sales".into(), title: "Sales".into(), started, collected: None };
        let mut list = Vec::new();
        for n in 1..=51 {
            list = remember_run(list, past("C:\\work\\shop", n));
        }
        assert_eq!(list.len(), 50);
        assert_eq!((list[0].started, list[49].started), (51, 2));
        // The same folder (written another way), kit and start time is stored once.
        let again = remember_run(list.clone(), past("c:/work/shop/", 51));
        assert_eq!(again.len(), 50);
        assert_eq!(again.iter().filter(|p| p.started == 51).count(), 1);
    }

    #[test]
    fn a_run_record_over_256_kb_or_unparsable_is_ignored() {
        let dir = temp("big");
        prepare(&dir, record("one", 1000), "unused");
        assert!(read_record(&dir).is_some());
        let path = dir.join(RESULTS).join(RECORD);
        let text = fs::read_to_string(&path).unwrap();
        fs::write(&path, format!("{}{}", text.trim_end(), " ".repeat(256 * 1024))).unwrap();
        assert!(read_record(&dir).is_none() && check(&dir).is_none());
        fs::write(&path, "{ not json").unwrap();
        assert!(read_record(&dir).is_none());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn kit_actions_take_only_projects_or_the_samples_folder() {
        let base = temp("guard");
        let (project, other, samples, look) = (base.join("shop"), base.join("other"), base.join("samples"), base.join("samples2"));
        for d in [&project, &other, &samples.join("sales"), &look] {
            fs::create_dir_all(d).unwrap();
        }
        fs::write(base.join("file.txt"), "x").unwrap();
        let projects = vec![Project { id: "1".into(), name: "shop".into(), path: project.to_string_lossy().to_uppercase(), workspaces_dir: None, base: None }];
        let ok = |p: &Path| kit_folder(&p.to_string_lossy(), &projects, &samples);
        assert!(ok(&project).is_ok());
        assert!(ok(&samples.join("sales")).is_ok());
        assert!(ok(&other).unwrap_err().contains("neither"));
        assert!(ok(&look).unwrap_err().contains("neither"));
        assert!(ok(&base.join("missing")).unwrap_err().contains("not a folder"));
        assert!(ok(&base.join("file.txt")).unwrap_err().contains("not a folder"));
        assert!(kit_folder("shop", &projects, &samples).unwrap_err().contains("full folder path"));
        assert!(known_kit("sales").is_ok() && known_kit("nope").unwrap_err().contains("no kit called nope"));
        fs::remove_dir_all(&base).unwrap();
    }
}
