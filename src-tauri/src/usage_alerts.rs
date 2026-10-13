// USAGE-009: the usage alerts the window decides on go out as system notifications. The record of
// which threshold already fired, tied to each window's reset time, lives in state.db so a restart
// does not repeat an alert.
use crate::state::Store;
use std::sync::Mutex;
use tauri_plugin_notification::NotificationExt;

const KEY: &str = "usage_alerts_fired";

#[derive(serde::Deserialize)]
pub struct Alert {
    title: String,
    body: String,
}

#[tauri::command(async)]
pub fn usage_alerts_fired(store: tauri::State<'_, Mutex<Store>>) -> Result<serde_json::Value, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let saved = store.get(KEY).map_err(|e| e.to_string())?;
    Ok(saved.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_else(|| serde_json::json!({})))
}

/// Saves the record first, so an alert that fails to show is still not repeated after a restart.
#[tauri::command(async)]
pub fn usage_alert_send(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, fired: serde_json::Value, alerts: Vec<Alert>) -> Result<(), String> {
    store.lock().map_err(|e| e.to_string())?.set(KEY, &fired.to_string()).map_err(|e| e.to_string())?;
    for a in alerts {
        app.notification().builder().title(a.title).body(a.body).show().map_err(|e| e.to_string())?;
    }
    Ok(())
}
