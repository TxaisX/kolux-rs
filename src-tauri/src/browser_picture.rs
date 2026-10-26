//! T-241 (BROW-038) and T-240 (BROW-035): a picture of the page as it shows now, for the drawing
//! canvas and for the grabbed element's picture. The engine takes it (Page.captureScreenshot);
//! the front end draws on it or crops it, and a finished drawing is saved here as a PNG so an
//! agent can open it by path.

use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// The largest picture saved, in decoded bytes (a 4K screen's PNG is far below this).
pub const SAVE_MAX: usize = 32 * 1024 * 1024;

/// The visible page: the engine's base64 PNG, and the size in CSS pixels it shows (the picture's
/// own pixel size is its PNG header's; the ratio is the display scale).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picture {
    pub data: String,
    pub css_width: f64,
    pub css_height: f64,
}

/// The visible page's size in CSS pixels from the engine's layout metrics.
pub fn viewport_of(metrics: &Value) -> Option<(f64, f64)> {
    let v = ["cssVisualViewport", "visualViewport"].iter().map(|k| &metrics[*k]).find(|v| v.is_object())?;
    let side = |k: &str| v[k].as_f64().filter(|n| n.is_finite() && *n >= 1.0);
    Some((side("clientWidth")?, side("clientHeight")?))
}

/// The picture the front end gets, from the engine's two answers.
pub fn picture_of(shot: &Value, metrics: &Value) -> Result<Picture, String> {
    let data = shot["data"].as_str().filter(|d| !d.is_empty()).ok_or("the page's engine sent no picture")?;
    let (css_width, css_height) = viewport_of(metrics).ok_or("the page's engine did not say how big the page is")?;
    Ok(Picture { data: data.to_string(), css_width, css_height })
}

/// A file stem of lower-case letters, digits and dashes; anything else folds to one dash.
pub fn clean_stem(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_end_matches('-').chars().take(40).collect();
    if out.is_empty() { "picture".into() } else { out }
}

/// `<stem>-<stamp>.png` in `dir`, or the first of `-2`, `-3` ... that is not taken: a picture is
/// never overwritten.
pub fn free_path(dir: &Path, stem: &str, stamp: u64) -> PathBuf {
    let first = dir.join(format!("{stem}-{stamp}.png"));
    if !first.exists() {
        return first;
    }
    (2u32..).map(|n| dir.join(format!("{stem}-{stamp}-{n}.png"))).find(|p| !p.exists()).unwrap_or(first)
}

/// Decodes a PNG (a bare base64 string or a `data:image/png;base64,` URL); anything else is refused.
pub fn decode_png(data: &str) -> Result<Vec<u8>, String> {
    let b64 = data.strip_prefix("data:image/png;base64,").unwrap_or(data);
    if b64.len() / 4 * 3 > SAVE_MAX + 3 {
        return Err("the picture is too large to save".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|_| "the picture is not base64".to_string())?;
    if bytes.len() > SAVE_MAX {
        return Err("the picture is too large to save".into());
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("the picture is not a PNG".into());
    }
    Ok(bytes)
}

/// Writes the picture below `dir` (made when missing) and answers its path.
pub fn save_png(dir: &Path, name: &str, stamp: u64, data: &str) -> Result<PathBuf, String> {
    let bytes = decode_png(data)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = free_path(dir, &clean_stem(name), stamp);
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

/// Takes the picture of the tab's visible page (blocking).
fn take(id: u32) -> Result<Picture, String> {
    let shot = super::devtools(id, "Page.captureScreenshot", json!({ "format": "png", "fromSurface": true }).to_string())?;
    let metrics = super::devtools(id, "Page.getLayoutMetrics", "{}".into())?;
    picture_of(&shot, &metrics)
}

/// The tab's visible page as a picture, for drawing on it or cropping an element from it.
#[tauri::command]
pub async fn browser_capture(app: AppHandle, id: u32) -> Result<Picture, String> {
    let _ = super::APP.set(app);
    tauri::async_runtime::spawn_blocking(move || take(id)).await.map_err(|e| e.to_string())?
}

/// Saves a finished drawing (a PNG as base64 or a data URL) in the captures folder; answers the path.
#[tauri::command]
pub async fn browser_save_picture(app: AppHandle, data: String, name: String) -> Result<String, String> {
    let _ = super::APP.set(app);
    let dir = super::captures_dir()?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || save_png(&dir, &name, stamp, &data).map(|p| p.display().to_string())).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

    #[test]
    fn brow038_the_page_size_comes_from_the_css_viewport_and_a_missing_one_is_refused() {
        let m = json!({ "cssVisualViewport": { "clientWidth": 1280.5, "clientHeight": 720.0 }, "visualViewport": { "clientWidth": 1.0, "clientHeight": 1.0 } });
        assert_eq!(viewport_of(&m), Some((1280.5, 720.0)));
        assert_eq!(viewport_of(&json!({ "visualViewport": { "clientWidth": 800, "clientHeight": 600 } })), Some((800.0, 600.0)));
        assert_eq!(viewport_of(&json!({ "cssVisualViewport": { "clientWidth": 0, "clientHeight": 600 } })), None);
        assert_eq!(viewport_of(&json!({})), None);
        let shot = json!({ "data": PNG });
        assert_eq!(picture_of(&shot, &m).unwrap(), Picture { data: PNG.into(), css_width: 1280.5, css_height: 720.0 });
        assert!(picture_of(&json!({ "data": "" }), &m).is_err());
        assert!(picture_of(&shot, &json!({})).is_err());
    }

    #[test]
    fn brow038_the_picture_goes_to_the_front_end_in_camel_case() {
        let v = serde_json::to_value(Picture { data: "x".into(), css_width: 2.0, css_height: 3.0 }).unwrap();
        assert_eq!(v, json!({ "data": "x", "cssWidth": 2.0, "cssHeight": 3.0 }));
    }

    #[test]
    fn brow038_a_saved_name_is_letters_digits_and_dashes_only() {
        assert_eq!(clean_stem("Shop — Checkout page!"), "shop-checkout-page");
        assert_eq!(clean_stem("..\\..\\evil/name"), "evil-name");
        assert_eq!(clean_stem("  "), "picture");
        assert_eq!(clean_stem(&"a".repeat(80)).len(), 40);
    }

    #[test]
    fn brow038_a_png_is_decoded_checked_and_saved_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("kolux-picture-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let first = save_png(&dir, "My Page", 7, &format!("data:image/png;base64,{PNG}")).unwrap();
        assert_eq!(first, dir.join("my-page-7.png"));
        let second = save_png(&dir, "My Page", 7, PNG).unwrap();
        assert_eq!(second, dir.join("my-page-7-2.png"), "a taken name is never overwritten");
        assert!(std::fs::read(&first).unwrap().starts_with(b"\x89PNG"));
        assert!(save_png(&dir, "x", 1, "AAAA").unwrap_err().contains("not a PNG"));
        assert!(save_png(&dir, "x", 1, "%%%").unwrap_err().contains("not base64"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn brow038_a_picture_past_the_size_cap_is_refused_before_it_is_decoded() {
        let big = "A".repeat((SAVE_MAX / 3 + 8) * 4);
        assert!(decode_png(&big).unwrap_err().contains("too large"));
    }
}
