//! T-025-e / STAT-008: the user's own Codex hooks and their approvals, copied into a Kolux-managed
//! Codex home and refreshed whenever the originals change. Kolux's status hook runs first in the
//! copy; each approval is re-keyed to its hook's place in the copy, so an approval the user
//! withdrew disappears from it, and trust for one entry never counts for another. The user's own
//! files are only ever read.

use super::super::{install_codex_hooks, is_mine, snake};
use serde_json::{Map, Value};
use std::path::Path;

/// The user's hooks file, read: none when absent, an error when it cannot be parsed (the copy then
/// stays as it was, and Kolux's private home carries on with its own entry).
pub fn read_hooks(user: &Path) -> Result<Option<Value>, String> {
    let file = user.join("hooks.json");
    match std::fs::read_to_string(&file) {
        Ok(t) => serde_json::from_str(&t).map(Some).map_err(|e| format!("{} is not JSON ({e}); not copied", file.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}; not copied", file.display())),
    }
}

/// The user's config file as a document; an unreadable one holds no approvals.
pub fn read_config(user: &Path) -> toml_edit::DocumentMut {
    std::fs::read_to_string(user.join("config.toml")).ok().and_then(|t| t.parse().ok()).unwrap_or_default()
}

/// Where each of the user's own groups ended up in the copy: (snake-cased event, old index, new index).
type Moves = Vec<(String, usize, usize)>;

/// Rewrites `managed` to Kolux's own groups first, then the user's groups (theirs, not Kolux's),
/// and returns where each user group went. `command` is Kolux's hook command.
pub fn copy_groups(user: &Value, managed: &mut Value, command: &str) -> Moves {
    // Strip everything but Kolux's own groups, then let the ordinary install place Kolux's entry.
    if let Some(events) = managed.get_mut("hooks").and_then(Value::as_object_mut) {
        for groups in events.values_mut().filter_map(Value::as_array_mut) {
            groups.retain(is_mine);
        }
        events.retain(|_, g| g.as_array().is_none_or(|a| !a.is_empty()));
    }
    install_codex_hooks(managed, command);
    let mut moves = Moves::new();
    let Some(theirs) = user.get("hooks").and_then(Value::as_object) else { return moves };
    let Some(events) = managed.get_mut("hooks").and_then(Value::as_object_mut) else { return moves };
    for (event, groups) in theirs {
        let Some(groups) = groups.as_array() else { continue };
        let ours = events.entry(event.clone()).or_insert_with(|| Value::Array(Vec::new()));
        let Some(ours) = ours.as_array_mut() else { continue };
        for (old, group) in groups.iter().enumerate().filter(|(_, g)| !is_mine(g)) {
            moves.push((snake(event), old, ours.len()));
            ours.push(group.clone());
        }
        if ours.is_empty() {
            events.remove(event);
        }
    }
    moves
}

/// The key Codex files an approval under: the hooks file's real path, the event, the group and the hook.
fn key_of(path: &str, event: &str, group: usize, hook: usize) -> String {
    format!("{path}:{event}:{group}:{hook}")
}

/// Splits `<path>:<event>:<group>:<hook>` for a known path.
fn split_key<'a>(key: &'a str, path: &str) -> Option<(&'a str, usize, usize)> {
    let rest = key.strip_prefix(path)?.strip_prefix(':')?;
    let mut parts = rest.rsplitn(3, ':');
    let hook = parts.next()?.parse().ok()?;
    let group = parts.next()?.parse().ok()?;
    Some((parts.next()?, group, hook))
}

fn state_of(doc: &mut toml_edit::DocumentMut) -> Option<&mut toml_edit::Table> {
    doc.get_mut("hooks")?.as_table_mut()?.get_mut("state")?.as_table_mut()
}

/// Brings `managed`'s approvals in line with the user's: every approval already there for a hook
/// that is not Kolux's goes, and the user's current approvals come in under their new keys.
/// Kolux's own entries (its groups in `groups`) are left as they are. `user_path` and `managed_path`
/// are the two hooks files' real paths.
pub fn copy_approvals(user: &toml_edit::DocumentMut, user_path: &str, managed: &mut toml_edit::DocumentMut, managed_path: &str, groups: &Value, moves: &Moves) {
    let mine = |event: &str, group: usize| -> bool {
        groups.get("hooks").and_then(Value::as_object).is_some_and(|e| e.iter().any(|(name, g)| snake(name) == event && g.get(group).is_some_and(is_mine)))
    };
    if let Some(state) = state_of(managed) {
        let stale: Vec<String> = state.iter().map(|(k, _)| k.to_owned()).filter(|k| split_key(k, managed_path).is_some_and(|(event, group, _)| !mine(event, group))).collect();
        for key in stale {
            state.remove(&key);
        }
    }
    let theirs: Vec<(String, toml_edit::Item)> = user.get("hooks").and_then(|h| h.get("state")).and_then(toml_edit::Item::as_table).map(|t| t.iter().map(|(k, v)| (k.to_owned(), v.clone())).collect()).unwrap_or_default();
    for (key, entry) in theirs {
        let Some((event, group, hook)) = split_key(&key, user_path) else { continue };
        let Some((_, _, new)) = moves.iter().find(|(e, old, _)| e == event && *old == group) else { continue };
        if entry.get("trusted_hash").is_none() {
            continue;
        }
        let hooks = managed.as_table_mut().entry("hooks").or_insert(toml_edit::table());
        let Some(hooks) = hooks.as_table_mut() else { continue };
        hooks.set_implicit(true);
        let Some(state) = hooks.entry("state").or_insert(toml_edit::table()).as_table_mut() else { continue };
        state.set_implicit(true);
        state.insert(&key_of(managed_path, event, *new, hook), entry);
    }
}

/// Copies the user's hooks and approvals into one managed home's parsed files. True when either changed.
pub fn mirror(user: &Path, hooks: &mut Value, doc: &mut toml_edit::DocumentMut, managed_path: &str, command: &str) -> Result<bool, String> {
    let theirs = read_hooks(user)?.unwrap_or_else(|| serde_json::json!({}));
    let (before_hooks, before_doc) = (hooks.clone(), doc.to_string());
    if !hooks.is_object() {
        *hooks = Value::Object(Map::new());
    }
    let moves = copy_groups(&theirs, hooks, command);
    let user_path = crate::trust::real_path(&user.join("hooks.json")).unwrap_or_default();
    copy_approvals(&read_config(user), &user_path, doc, managed_path, hooks, &moves);
    Ok(*hooks != before_hooks || doc.to_string() != before_doc)
}
