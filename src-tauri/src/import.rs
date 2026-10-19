//! What an older profile brings into this one.
//!
//! APP-004 (T-213): on the first launch the profile folder of the former product name (Nightshift),
//! found beside this profile in the system's application-data folder in any letter case, is copied
//! into this profile once. A file this profile already has is never overwritten, a file another
//! program holds locked (or that cannot be read) is skipped and the rest carries on, links are not
//! followed, and settings saved under the former product's names take the current names, with a
//! value already saved under the current name winning. Development, test and lane profiles never
//! get it (`hooks::agent_hooks::fenced`). Repeating it changes nothing: the copy only fills gaps, the
//! rename only touches former-name keys, and the profile records that it ran.
//!
//! HID-036 (T-331): settings retired before this rebuild are dropped quietly from an older profile,
//! with no message and no failed load, and never come back: `without_retired` is the filter the
//! settings load and save apply (coordinator hunk in state.rs, T-331 commit body), and the
//! carry-over applies it to what it brings in. A retired setting is recognised by its exact old
//! spelling only, so a key a newer build writes is never dropped.
// ponytail: T-213 is PARKED and must not be wired (council review i18n-f914eb3, B1): copying the former
// app's whole data folder breaks the no-importer default (COMPAT 5.3, OD-05). Nothing calls
// `first_launch` or `carry_over` outside the tests; it waits on Txais's yes, and if he says yes it is
// rebuilt as an allow-list importer (see the T-213 line in PLAN.md).
#![cfg_attr(not(test), allow(dead_code))]

use crate::state::Store;
use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The former product name, as its profile folder and its settings carried it.
pub const FORMER_NAME: &str = "nightshift";
/// Set in the profile's store once the former-name carry-over has run (or found nothing to carry).
const KEY_CARRIED: &str = "former_name_carried";

/// What one carry-over did.
#[derive(Debug, Default, PartialEq)]
pub struct Carried {
    /// Files copied in.
    pub copied: usize,
    /// Files left alone because this profile already had them.
    pub kept: usize,
    /// Files and folders that could not be read or copied (locked by another program, say), or links.
    pub skipped: Vec<PathBuf>,
    /// Settings renamed from the former product's names.
    pub renamed: usize,
}

/// The former product's profile folder in `app_data` (the folder that holds this profile), matched
/// in any letter case; never a file and never a link.
pub fn former_profile(app_data: &Path) -> Option<PathBuf> {
    fs::read_dir(app_data).ok()?.flatten().find_map(|e| {
        let named = e.file_name().to_str().is_some_and(|n| n.eq_ignore_ascii_case(FORMER_NAME));
        (named && e.file_type().is_ok_and(|t| t.is_dir())).then(|| e.path())
    })
}

/// Copies into `to` every file under `from` that `to` does not have yet, folders included.
pub fn copy_missing(from: &Path, to: &Path, out: &mut Carried) {
    let Ok(entries) = fs::read_dir(from) else {
        out.skipped.push(from.to_path_buf());
        return;
    };
    for e in entries {
        let Ok(e) = e else { continue };
        let (src, dst) = (e.path(), to.join(e.file_name()));
        match e.file_type() {
            Ok(t) if t.is_symlink() => out.skipped.push(src),
            Ok(t) if t.is_dir() => {
                // symlink_metadata, never is_dir(): a link or junction on this side is not followed and nothing is written through it.
                let real_dir = dst.symlink_metadata().is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink());
                if real_dir || (dst.symlink_metadata().is_err() && fs::create_dir(&dst).is_ok()) {
                    copy_missing(&src, &dst, out);
                } else {
                    out.skipped.push(src);
                }
            }
            Ok(_) if dst.symlink_metadata().is_ok() => out.kept += 1,
            Ok(_) => match copy_new(&src, &dst) {
                Ok(()) => out.copied += 1,
                Err(_) => out.skipped.push(src),
            },
            Err(_) => out.skipped.push(src),
        }
    }
}

/// One file copied to a path that must not exist yet; a copy that fails part way is removed again.
fn copy_new(src: &Path, dst: &Path) -> io::Result<()> {
    let mut r = fs::File::open(src)?;
    let mut w = fs::OpenOptions::new().write(true).create_new(true).open(dst)?;
    let done = io::copy(&mut r, &mut w).and_then(|_| w.sync_all());
    if done.is_err() {
        drop(w);
        let _ = fs::remove_file(dst);
    }
    done
}

/// `key` with each former product name in it replaced by the current one in the same letter case
/// style (nightshift, Nightshift, NIGHTSHIFT); `None` when it holds no former name.
pub fn current_name(key: &str) -> Option<String> {
    let lower = key.to_ascii_lowercase();
    if !lower.contains(FORMER_NAME) {
        return None;
    }
    let (mut out, mut at) = (String::with_capacity(key.len()), 0);
    while let Some(i) = lower[at..].find(FORMER_NAME).map(|i| i + at) {
        out.push_str(&key[at..i]);
        let found = &key[i..i + FORMER_NAME.len()];
        out.push_str(if found.bytes().all(|b| b.is_ascii_uppercase()) {
            "KOLUX"
        } else if found.starts_with(|c: char| c.is_ascii_uppercase()) {
            "Kolux"
        } else {
            "kolux"
        });
        at = i + FORMER_NAME.len();
    }
    out.push_str(&key[at..]);
    Some(out)
}

/// Settings saved under the former product's names (`nightshiftTheme`) and interface preferences
/// under its prefix (`nightshift.sidebarWidth`) take the current names; a value already saved under
/// the current name wins and the former one is dropped. Only top-level keys: values, and the keys
/// inside them (a project named after a folder, say), are left as they are. Returns how many moved.
pub fn rename_former(settings: &mut Map<String, Value>) -> usize {
    let former: Vec<(String, String)> = settings.keys().filter_map(|k| current_name(k).map(|n| (k.clone(), n))).collect();
    for (old, new) in &former {
        if let Some(v) = settings.remove(old) {
            settings.entry(new.clone()).or_insert(v);
        }
    }
    former.len()
}

/// APP-004 at start: the carry-over, for the installed app's own profile only.
pub fn first_launch(store: &Store, profile: &Path) -> Option<Carried> {
    if crate::hooks::agent_hooks::fenced(profile) {
        return None;
    }
    carry_over(store, profile)
}

/// The carry-over into `profile` (whose store is `store`) from the former-name folder beside it,
/// once per profile. `None` when it ran before, when there is nothing to carry, or when the store
/// cannot say whether it ran.
pub fn carry_over(store: &Store, profile: &Path) -> Option<Carried> {
    if store.get(KEY_CARRIED).ok()?.is_some() {
        return None;
    }
    let from = profile.parent().and_then(former_profile).filter(|f| !same_folder(f, profile));
    let mut out = Carried::default();
    if let Some(from) = &from {
        copy_missing(from, profile, &mut out);
        // A settings file that cannot be read is never saved over (T-441); it keeps the former names.
        if let Ok(mut settings) = store.try_settings() {
            if let Some(map) = settings.as_object_mut() {
                out.renamed = rename_former(map);
            }
            let dropped = drop_retired(&mut settings);
            if out.renamed + dropped > 0 && store.save_settings(&settings).is_err() {
                out.renamed = 0;
            }
        }
    }
    let record = format!("{} copied, {} kept, {} skipped, {} renamed", out.copied, out.kept, out.skipped.len(), out.renamed);
    store.set(KEY_CARRIED, &record).ok()?;
    from.map(|_| out)
}

fn same_folder(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a.as_os_str().eq_ignore_ascii_case(b.as_os_str()),
    }
}


/// HID-036 (T-331): settings retired before this rebuild, each by the exact camelCase names an older
/// profile may have saved it under (letter case and separators matter, so a newer key that only
/// looks like one is kept). They are dropped quietly whenever settings are read or saved, so they
/// never fail a load and never come back with a later change.
pub const RETIRED: &[(&str, &[&str])] = &[
    ("scrollback size in bytes", &["scrollbackBytes", "terminalScrollbackBytes", "scrollbackSizeBytes", "scrollbackBufferSize"]),
    ("GitHub attribution", &["githubAttribution", "gitAttribution", "commitAttribution", "addGithubAttribution"]),
    ("agents sidebar", &["agentsSidebar", "agentSidebar", "showAgentsSidebar", "agentsSidebarOpen"]),
    ("OpenCode sign-in cookie", &["opencodeCookie", "opencodeSigninCookie", "opencodeSessionCookie", "opencodeAuthCookie"]),
    ("OpenCode workspace id", &["opencodeWorkspaceId", "opencodeWorkspace"]),
    ("dashboard open mode", &["dashboardOpenMode", "dashboardMode", "dashboardWindowMode"]),
    ("artifact sharing", &["artifactSharing", "artifactsSharing", "shareArtifacts"]),
    ("artifacts on or off", &["artifactsEnabled", "enableArtifacts", "artifactsOn"]),
    ("artifacts button", &["artifactsButton", "artifactButton", "showArtifactsButton"]),
    ("skip the artifact delete confirmation", &["skipArtifactDeleteConfirm", "skipArtifactDeleteConfirmation", "artifactDeleteConfirmSkip", "confirmArtifactDelete"]),
    ("skill sharing", &["skillSharing", "skillsSharing", "shareSkills"]),
    ("phone-pairing connection mode", &["pairingConnectionMode", "phonePairingMode", "mobilePairingMode"]),
];

/// A saved setting's name as the retired list spells it: a name a profile saved under the old
/// product's or the current product's camelCase prefix (`nightshiftSkillSharing`, `koluxSkillSharing`)
/// reads as the bare name (`skillSharing`). Nothing else is normalised: not letter case, not dots,
/// dashes or underscores.
fn bare(key: &str) -> String {
    for p in ["kolux", FORMER_NAME] {
        if let Some(rest) = key.strip_prefix(p) {
            let mut c = rest.chars();
            if let Some(first) = c.next().filter(|c| c.is_ascii_uppercase()) {
                return format!("{}{}", first.to_ascii_lowercase(), c.as_str());
            }
        }
    }
    key.to_owned()
}

/// Whether `key` names a retired setting.
pub fn is_retired(key: &str) -> bool {
    let b = bare(key);
    RETIRED.iter().any(|(_, names)| names.contains(&b.as_str()))
}

/// `settings` with every retired setting dropped (a value that is not an object is left alone).
pub fn without_retired(mut settings: Value) -> Value {
    drop_retired(&mut settings);
    settings
}

/// Drops the retired settings in place; returns how many went.
pub fn drop_retired(settings: &mut Value) -> usize {
    let Some(map) = settings.as_object_mut() else { return 0 };
    let before = map.len();
    map.retain(|k, _| !is_retired(k));
    before - map.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// An application-data folder holding an empty profile and its open store.
    fn profile(tag: &str) -> (crate::test_dir::TempDir, PathBuf) {
        let root = crate::test_dir::temp(tag);
        let profile = root.join("com.txaisxiong.kolux-rs");
        fs::create_dir_all(&profile).unwrap();
        (root, profile)
    }

    fn seed_former(root: &Path, name: &str) -> PathBuf {
        let old = root.join(name);
        fs::create_dir_all(old.join("projects")).unwrap();
        fs::write(old.join("settings.json"), serde_json::to_vec(&json!({"nightshiftTheme": "dark", "language": "fr", "nightshift.sidebarWidth": 240})).unwrap()).unwrap();
        fs::write(old.join("projects").join("site.json"), br#"{"name":"site","path":"G:/work/site"}"#).unwrap();
        old
    }

    #[test]
    fn t213_app004_the_former_folder_is_found_in_any_letter_case_and_only_as_a_folder() {
        let (root, _) = profile("imp-case");
        assert_eq!(former_profile(&root), None);
        fs::write(root.join("nightshift"), b"a file, not a profile").unwrap();
        assert_eq!(former_profile(&root), None);
        fs::remove_file(root.join("nightshift")).unwrap();
        let old = seed_former(&root, "NightShift");
        assert_eq!(former_profile(&root).map(|p| p.file_name().unwrap().to_owned()), old.file_name().map(|n| n.to_owned()));
    }

    #[test]
    fn t213_app004_a_seeded_profile_carries_its_project_and_setting_and_a_second_launch_changes_nothing() {
        let (root, profile) = profile("imp-seed");
        seed_former(&root, "NIGHTSHIFT");
        let store = Store::open(&profile).unwrap();
        let c = carry_over(&store, &profile).expect("carried");
        assert_eq!((c.copied, c.kept, c.skipped.len(), c.renamed), (2, 0, 0, 2));
        let s = store.settings();
        assert_eq!(s, json!({"koluxTheme": "dark", "language": "fr", "kolux.sidebarWidth": 240}));
        assert!(profile.join("projects").join("site.json").is_file());
        let before = fs::read(profile.join("settings.json")).unwrap();
        // Second launch: it ran already, so nothing is copied or renamed again.
        assert_eq!(carry_over(&store, &profile), None);
        assert_eq!(fs::read(profile.join("settings.json")).unwrap(), before);
        assert_eq!(fs::read_dir(profile.join("projects")).unwrap().count(), 1, "no duplicate project");
        // Even a repeated copy only fills gaps.
        let mut again = Carried::default();
        copy_missing(&root.join("NIGHTSHIFT"), &profile, &mut again);
        assert_eq!((again.copied, again.kept), (0, 2));
        assert_eq!(store.get(KEY_CARRIED).unwrap().as_deref(), Some("2 copied, 0 kept, 0 skipped, 2 renamed"));
        drop(store);
    }

    #[test]
    fn t213_app004_a_file_already_in_the_new_profile_is_never_overwritten() {
        let (root, profile) = profile("imp-keep");
        seed_former(&root, "nightshift");
        fs::create_dir_all(profile.join("projects")).unwrap();
        fs::write(profile.join("projects").join("site.json"), b"mine").unwrap();
        fs::write(profile.join("settings.json"), br#"{"koluxTheme":"light","nightshiftTheme":"dark"}"#).unwrap();
        let store = Store::open(&profile).unwrap();
        let c = carry_over(&store, &profile).expect("carried");
        assert_eq!((c.copied, c.kept), (0, 2));
        assert_eq!(fs::read(profile.join("projects").join("site.json")).unwrap(), b"mine");
        // The current name's value wins over the former one, which is dropped.
        assert_eq!(store.settings(), json!({"koluxTheme": "light"}));
        drop(store);
    }

    #[cfg(windows)]
    #[test]
    fn t213_app004_a_file_locked_by_another_program_is_skipped_and_the_rest_carries_on() {
        use std::os::windows::fs::OpenOptionsExt;
        let (root, profile) = profile("imp-lock");
        let old = seed_former(&root, "nightshift");
        fs::write(old.join("history.log"), b"held").unwrap();
        let held = fs::OpenOptions::new().read(true).write(true).share_mode(0).open(old.join("history.log")).unwrap();
        let store = Store::open(&profile).unwrap();
        let c = carry_over(&store, &profile).expect("carried");
        assert_eq!(c.skipped, vec![old.join("history.log")]);
        assert_eq!(c.copied, 2);
        assert!(!profile.join("history.log").exists(), "no half copy left behind");
        drop(held);
        drop(store);
    }

    #[test]
    fn t213_app004_former_names_take_the_current_name_in_the_same_letter_case() {
        assert_eq!(current_name("nightshiftTheme").as_deref(), Some("koluxTheme"));
        assert_eq!(current_name("NightshiftAccent").as_deref(), Some("KoluxAccent"));
        assert_eq!(current_name("NIGHTSHIFT_TOKEN_NAME").as_deref(), Some("KOLUX_TOKEN_NAME"));
        assert_eq!(current_name("nightshift:nightShift.x").as_deref(), Some("kolux:kolux.x"));
        assert_eq!(current_name("theme"), None);
        let mut m = json!({"nightshiftA": 1, "koluxA": 2, "nightshiftB": {"nightshiftInner": 3}, "projects": {"nightshift-app": 4}}).as_object().unwrap().clone();
        assert_eq!(rename_former(&mut m), 2);
        assert_eq!(Value::Object(m.clone()), json!({"koluxA": 2, "koluxB": {"nightshiftInner": 3}, "projects": {"nightshift-app": 4}}));
        assert_eq!(rename_former(&mut m), 0, "a second rename changes nothing");
    }

    #[test]
    fn t213_app004_development_and_test_profiles_never_get_it() {
        let (root, profile) = profile("imp-fence");
        seed_former(&root, "nightshift");
        let store = Store::open(&profile).unwrap();
        assert_eq!(first_launch(&store, &profile), None);
        assert!(!profile.join("projects").exists());
        assert_eq!(store.get(KEY_CARRIED).unwrap(), None, "a later real launch is not marked done");
        drop(store);
    }

    #[test]
    fn t213_app004_no_former_folder_marks_it_done_and_copies_nothing() {
        let (_root, profile) = profile("imp-none");
        let store = Store::open(&profile).unwrap();
        assert_eq!(carry_over(&store, &profile), None);
        assert!(store.get(KEY_CARRIED).unwrap().is_some());
        drop(store);
    }


    /// A profile's settings carrying every retired setting, in the spellings an older profile may use.
    fn every_retired() -> Value {
        let mut m = Map::new();
        for (i, (_, names)) in RETIRED.iter().enumerate() {
            m.insert(names[0].to_owned(), json!(i));
        }
        m.insert("terminalScrollbackBytes".into(), json!(1_000_000));
        m.insert("koluxAgentsSidebar".into(), json!(true));
        m.insert("nightshiftGithubAttribution".into(), json!(false));
        m.insert("theme".into(), json!("dark"));
        m.insert("language".into(), json!("ja"));
        m.insert("artifacts".into(), json!({"kept": "the library is a live feature"}));
        m.insert("rightSidebarOpen".into(), json!(true));
        Value::Object(m)
    }

    #[test]
    fn t331_hid036_every_retired_setting_is_named_and_none_collides_with_a_live_one() {
        assert_eq!(RETIRED.len(), 12, "the full list in the card's Compat line");
        for live in ["theme", "language", "artifacts", "skills", "rightSidebarOpen", "leftSidebarWidth", "sidebar", "scrollback", "agentStatusHooks", "confirmWorkspaceDelete"] {
            assert!(!is_retired(live), "{live} is a live setting");
        }
        assert!(is_retired("scrollbackBytes") && is_retired("terminalScrollbackBytes"));
        assert!(is_retired("koluxOpencodeWorkspaceId") && is_retired("nightshiftSkillSharing"));
    }

    #[test]
    fn fix1_after1_only_the_exact_old_spellings_are_dropped_and_a_newer_key_is_kept() {
        // Newer keys that merely look like a retired one (other letter case, other separators, a
        // shorter name) belong to a newer build and must survive a load and a save.
        for newer in ["pairingmode", "pairingMode", "pairing-mode", "pairing.mode", "scrollbackbytes", "scrollback_bytes", "SCROLLBACK_BYTES", "terminal.scrollback-bytes", "agents-sidebar", "Agents_Sidebar", "artifactsEnabledV2", "skillSharingMode"] {
            assert!(!is_retired(newer), "{newer} is not an old spelling");
        }
        let mut s = json!({"pairingmode": "relay", "scrollbackbytes": 5, "phonePairingMode": "old", "scrollbackBytes": 1, "theme": "dark"});
        assert_eq!(drop_retired(&mut s), 2);
        assert_eq!(s, json!({"pairingmode": "relay", "scrollbackbytes": 5, "theme": "dark"}));
        // every listed name is written in the camelCase an older profile used, so each matches itself exactly
        for (_, names) in RETIRED {
            for n in *names {
                assert!(is_retired(n), "{n}");
                assert!(n.chars().all(|c| c.is_ascii_alphanumeric()) && n.starts_with(|c: char| c.is_ascii_lowercase()), "{n} must be a camelCase key");
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn fix1_soon1_a_destination_link_is_never_written_through() {
        let (root, profile) = profile("imp-dstlink");
        let old = seed_former(&root, "nightshift");
        let outside = root.join("outside-the-profile");
        fs::create_dir_all(&outside).unwrap();
        let link = profile.join("projects");
        let made = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(&link).arg(&outside).output();
        if !made.as_ref().is_ok_and(|o| o.status.success()) {
            eprintln!("NOTE fix1_soon1: the junction could not be made here ({made:?}); the destination-link check did NOT run");
            return;
        }
        // The link must really be there before the skip means anything.
        let meta = link.symlink_metadata().expect("the junction exists");
        assert!(meta.file_type().is_symlink(), "a junction reads as a link: {:?}", meta.file_type());
        assert!(outside.read_dir().unwrap().next().is_none());
        let mut out = Carried::default();
        copy_missing(&old, &profile, &mut out);
        assert!(outside.read_dir().unwrap().next().is_none(), "nothing was written through the link");
        assert!(!outside.join("site.json").exists());
        assert!(out.skipped.contains(&old.join("projects")), "the folder behind the link is reported as skipped: {:?}", out.skipped);
        assert_eq!(out.copied, 1, "the rest (settings.json) still carries on");
        assert!(profile.join("settings.json").is_file());
        fs::remove_dir(&link).unwrap(); // removes the junction itself, never its target
        assert!(outside.is_dir());
    }

    #[test]
    fn t331_hid036_a_profile_with_every_retired_setting_loads_without_them_and_they_never_come_back() {
        let (_root, profile) = profile("imp-retired");
        fs::write(profile.join("settings.json"), serde_json::to_vec(&every_retired()).unwrap()).unwrap();
        let store = Store::open(&profile).unwrap();
        // Load: the read succeeds (no message, no refusal) and the retired ones are gone.
        let loaded = without_retired(store.try_settings().expect("loads"));
        assert_eq!(loaded, json!({"theme": "dark", "language": "ja", "artifacts": {"kept": "the library is a live feature"}, "rightSidebarOpen": true}));
        // The next save writes them out of the file.
        store.save_settings(&loaded).unwrap();
        let on_disk: Value = serde_json::from_slice(&fs::read(profile.join("settings.json")).unwrap()).unwrap();
        assert_eq!(on_disk, loaded);
        // A later change made from an old copy that still had them does not bring them back.
        let mut stale = every_retired();
        stale["theme"] = json!("light");
        store.save_settings(&without_retired(stale)).unwrap();
        let after: Value = serde_json::from_slice(&fs::read(profile.join("settings.json")).unwrap()).unwrap();
        assert_eq!(after["theme"], json!("light"));
        assert!(after.as_object().unwrap().keys().all(|k| !is_retired(k)), "{after}");
        drop(store);
    }

    #[test]
    fn t331_hid036_the_former_name_carry_over_drops_them_too_and_a_non_object_is_left_alone() {
        let (root, profile) = profile("imp-retired-carry");
        let old = root.join("nightshift");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("settings.json"), br#"{"nightshiftTheme":"dark","agentsSidebar":true,"opencodeCookie":"x"}"#).unwrap();
        let store = Store::open(&profile).unwrap();
        carry_over(&store, &profile).expect("carried");
        assert_eq!(store.settings(), json!({"koluxTheme": "dark"}));
        drop(store);
        assert_eq!(drop_retired(&mut json!([1, 2])), 0);
        assert_eq!(without_retired(json!("text")), json!("text"));
    }
}
