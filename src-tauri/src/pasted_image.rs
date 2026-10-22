//! TERM-070: a screenshot pasted into a terminal is saved as a file so its path can be pasted for
//! the agent to read. The window hands over the image bytes it read from the clipboard event (as
//! the raw request body, not a JSON array) with the file kind in a header; this saves them under
//! the profile's `pasted-images` folder and answers the absolute path.
//!
//! Only png, jpeg, gif, webp and bmp are kept, and an image over `LIMIT` is refused with a
//! message; nothing is swallowed. Old pastes (older than `KEEP_DAYS`) are removed on each save so
//! the folder does not grow forever. Nothing here makes a network request.
use std::path::{Path, PathBuf};

pub const FOLDER: &str = "pasted-images";
pub const LIMIT: usize = 32 * 1024 * 1024;
const KEEP_DAYS: u64 = 14;

/// The file ending for an image kind the clipboard can hold; None for anything else.
pub fn ext_for(kind: &str) -> Option<&'static str> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "image/png" | "png" => Some("png"),
        "image/jpeg" | "image/jpg" | "jpeg" | "jpg" => Some("jpg"),
        "image/gif" | "gif" => Some("gif"),
        "image/webp" | "webp" => Some("webp"),
        "image/bmp" | "bmp" => Some("bmp"),
        _ => None,
    }
}

/// Writes `bytes` into `dir` as `paste-<ms>-<n>.<ext>` and answers the path. Refuses an empty
/// image, an unknown kind and one over the size limit, each with a sentence that says what happened.
pub fn save_into(dir: &Path, kind: &str, bytes: &[u8], now_ms: u128) -> Result<PathBuf, String> {
    let Some(ext) = ext_for(kind) else {
        return Err(format!("The clipboard image is a kind Kolux does not save ({kind}); nothing was pasted."));
    };
    if bytes.is_empty() {
        return Err("The clipboard image was empty; nothing was pasted.".into());
    }
    if bytes.len() > LIMIT {
        return Err(format!("The clipboard image is over {} MB; nothing was pasted.", LIMIT / 1024 / 1024));
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Kolux could not make the folder for pasted images ({e}); nothing was pasted."))?;
    // Two pastes in the same millisecond must not share a name: the first free counter wins.
    for n in 0..1000u32 {
        let path = dir.join(format!("paste-{now_ms}-{n}.{ext}"));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(bytes).map_err(|e| format!("Kolux could not save the image ({e}); nothing was pasted."))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Kolux could not save the image ({e}); nothing was pasted.")),
        }
    }
    Err("Kolux could not find a free name for the image; nothing was pasted.".into())
}

/// Removes pasted images older than the keep time; a file that cannot be removed is left.
pub fn sweep(dir: &Path, now_ms: u128) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let cutoff = now_ms.saturating_sub(KEEP_DAYS as u128 * 86_400_000);
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let stamp = name.strip_prefix("paste-").and_then(|r| r.split('-').next()).and_then(|s| s.parse::<u128>().ok());
        if matches!(stamp, Some(t) if t < cutoff) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// The sweep of a profile's pasted images; it runs at every paste and once at start-up (row 144),
/// so old pastes go even when nothing is pasted again.
pub fn sweep_profile(profile: &Path) {
    sweep(&profile.join(FOLDER), now_ms());
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis())
}

/// The window sends the image bytes as the request body and the kind in the `x-image-kind` header.
#[tauri::command(async)]
pub fn paste_image_save(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    use tauri::Manager;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The clipboard image did not arrive; nothing was pasted.".into());
    };
    let kind = request.headers().get("x-image-kind").and_then(|v| v.to_str().ok()).unwrap_or("");
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    sweep_profile(&profile);
    save_into(&profile.join(FOLDER), kind, bytes, now_ms()).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> crate::test_dir::TempDir {
        let p = std::env::temp_dir().join(format!("kolux-pasted-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        crate::test_dir::TempDir(p)
    }

    #[test]
    fn term070_a_png_is_saved_and_its_path_comes_back() {
        let dir = temp("png");
        let path = save_into(&dir.join(FOLDER), "image/png", &[137, 80, 78, 71], 1_000).unwrap();
        assert!(path.starts_with(dir.join(FOLDER)));
        assert_eq!(path.extension().unwrap(), "png");
        assert_eq!(std::fs::read(&path).unwrap(), vec![137, 80, 78, 71]);
    }

    #[test]
    fn term070_two_pastes_in_one_millisecond_get_two_files() {
        let dir = temp("same");
        let a = save_into(&dir, "image/png", &[1], 5).unwrap();
        let b = save_into(&dir, "image/png", &[2], 5).unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read(&b).unwrap(), vec![2]);
    }

    #[test]
    fn term070_failures_say_so_and_write_nothing() {
        let dir = temp("bad");
        assert!(save_into(&dir, "text/html", &[1], 1).unwrap_err().contains("does not save"));
        assert!(save_into(&dir, "image/png", &[], 1).unwrap_err().contains("empty"));
        assert!(save_into(&dir, "image/png", &vec![0; LIMIT + 1], 1).unwrap_err().contains("over"));
        assert!(!dir.exists() || std::fs::read_dir(&*dir).unwrap().count() == 0);
    }

    #[test]
    fn term070_kinds_map_to_endings() {
        assert_eq!(ext_for("IMAGE/JPEG"), Some("jpg"));
        assert_eq!(ext_for("image/webp"), Some("webp"));
        assert_eq!(ext_for("application/pdf"), None);
    }

    #[test]
    fn term070_old_pastes_are_swept_and_other_files_stay() {
        let dir = temp("sweep");
        let now = 100 * 86_400_000u128;
        let old = save_into(&dir, "png", &[1], 1_000).unwrap();
        let fresh = save_into(&dir, "png", &[1], now - 1_000).unwrap();
        let other = dir.join("notes.txt");
        std::fs::write(&other, "x").unwrap();
        sweep(&dir, now);
        assert!(!old.exists() && fresh.exists() && other.exists());
    }

    #[test]
    fn row144_the_start_up_sweep_clears_old_pastes_with_no_new_paste() {
        // Row 144: old pastes go at start-up too, not only when the next paste happens.
        let profile = temp("startup");
        let old = save_into(&profile.join(FOLDER), "png", &[1], 1_000).unwrap();
        let fresh = save_into(&profile.join(FOLDER), "png", &[1], now_ms() - 1_000).unwrap();
        sweep_profile(&profile);
        assert!(!old.exists() && fresh.exists());
        // A profile that never pasted anything is fine.
        sweep_profile(&temp("never"));
    }
}
