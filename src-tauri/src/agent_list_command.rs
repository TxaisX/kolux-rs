//! The window's `agent_list` command. A sync command runs on the UI thread, so the catalogue's disk and PATH probing
//! (about 0.5 s, asked three times at start) held every other call, the pane's event listeners included.
use crate::agents::{catalogue, AgentInfo};

#[tauri::command]
pub async fn agent_list() -> Vec<AgentInfo> {
    tauri::async_runtime::spawn_blocking(catalogue).await.unwrap_or_default()
}
