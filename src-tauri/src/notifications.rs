//! SET-034: the Notifications page's test button and its link to the system's own notification
//! settings. The page chooses the sound: a tone Kolux plays itself (the toast is then silent so only
//! one sound plays), the system's default sound, or silence when the volume is 0.

use serde_json::{json, Value};

/// `reg query` output for PushNotifications\ToastEnabled: Windows' "Get notifications from apps"
/// switch. Only an explicit 0 counts as off; a missing value means the switch was never touched.
pub fn toasts_off(reg_output: &str) -> bool {
    reg_output.lines().any(|l| l.contains("ToastEnabled") && l.split_whitespace().last() == Some("0x0"))
}

/// Has the user switched app notifications off for the whole system?
fn blocked() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications", "/v", "ToastEnabled"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output();
        out.map(|o| toasts_off(&String::from_utf8_lossy(&o.stdout))).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Shows the sample notification. `sound` false makes the toast silent (Kolux's own tone plays, or
/// the volume is 0); true lets the system's default sound play with it.
#[tauri::command]
pub fn notification_test(app: tauri::AppHandle, sound: bool) -> Result<Value, String> {
    use tauri_plugin_notification::NotificationExt;
    if blocked() {
        return Ok(json!({ "shown": false, "blocked": true }));
    }
    let mut n = app.notification().builder().title("Kolux").body("This is how a notification from Kolux looks and sounds.");
    if sound {
        n = n.sound("Default");
    }
    n.show().map_err(|e| e.to_string())?;
    Ok(json!({ "shown": true, "blocked": false }))
}

/// Opens the system's notification settings (a fixed address, never one from the page).
#[tauri::command]
pub fn open_notification_settings() -> Result<(), String> {
    #[cfg(windows)]
    let run = std::process::Command::new("explorer.exe").arg("ms-settings:notifications").spawn();
    #[cfg(target_os = "macos")]
    let run = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.notifications").spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let run: std::io::Result<std::process::Child> = Err(std::io::Error::other("this system's notification settings cannot be opened from Kolux"));
    run.map(|_| ()).map_err(|e| e.to_string())
}

/// VIEW-111: the store key that says the first-run welcome notification has been answered.
pub const WELCOME_KEY: &str = "notifications.welcomeAnswered";
/// How long the system may take to show the welcome before it counts as unanswered.
const WELCOME_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

/// VIEW-111: what the first start does about notification permission.
#[derive(Debug, PartialEq)]
pub enum Welcome {
    /// Not a Mac: nothing is shown and nothing is probed.
    Unsupported,
    /// A Mac that has never answered: show the one welcome notification.
    Ask,
    /// Answered on an earlier start: never asked again.
    Answered,
}

pub fn welcome_step(macos: bool, saved: Option<&str>) -> Welcome {
    if !macos {
        Welcome::Unsupported
    } else if saved.is_some() {
        Welcome::Answered
    } else {
        Welcome::Ask
    }
}

/// VIEW-111: called once at start. On a Mac that has not answered, shows one welcome notification;
/// the system asks for permission when it first shows one. The answer is recorded only when the
/// system shows it in time, so a start where it does not may ask again later.
pub fn first_run_welcome(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(store) = app.try_state::<std::sync::Mutex<crate::state::Store>>() else { return };
    let saved = store.lock().ok().and_then(|s| s.get(WELCOME_KEY).ok().flatten());
    if welcome_step(cfg!(target_os = "macos"), saved.as_deref()) != Welcome::Ask {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        use tauri_plugin_notification::NotificationExt;
        let (tx, rx) = std::sync::mpsc::channel();
        let shower = app.clone();
        std::thread::spawn(move || {
            let shown = shower.notification().builder().title("Kolux").body("Kolux will tell you here when an agent needs you or finishes.").show().is_ok();
            let _ = tx.send(shown);
        });
        if rx.recv_timeout(WELCOME_WAIT) == Ok(true) {
            if let Some(store) = app.try_state::<std::sync::Mutex<crate::state::Store>>() {
                if let Ok(s) = store.lock() {
                    let _ = s.set(WELCOME_KEY, "1");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::toasts_off;

    #[test]
    fn view111_only_a_mac_that_never_answered_is_asked_once() {
        use super::{welcome_step, Welcome};
        assert_eq!(welcome_step(true, None), Welcome::Ask);
        assert_eq!(welcome_step(true, Some("1")), Welcome::Answered);
        assert_eq!(welcome_step(false, None), Welcome::Unsupported);
        assert_eq!(welcome_step(false, Some("1")), Welcome::Unsupported);
    }

    #[test]
    fn only_an_explicit_zero_turns_app_notifications_off() {
        let off = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\r\n    ToastEnabled    REG_DWORD    0x0\r\n";
        assert!(toasts_off(off));
        assert!(!toasts_off(&off.replace("0x0", "0x1")));
        assert!(!toasts_off("ERROR: The system was unable to find the specified registry key or value."));
    }
}
