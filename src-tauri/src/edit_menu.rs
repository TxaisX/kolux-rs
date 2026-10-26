// APP-014: spelling suggestions for the app's own right-click menu in text fields.
// WebView2 raises ContextMenuRequested with its default items; the ones named "spellCheck" are the
// suggestions. In an editable spot we take them, hide the engine's own menu and hand the words to the
// page, which draws the menu in the app's style. Other platforms have no such hook, so the page
// gets no suggestions there and draws the edit actions only.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

pub const SUGGESTIONS_EVENT: &str = "edit-menu-suggestions";
const MAX_SUGGESTIONS: usize = 5;

/// True once the engine hook is in place; the page leaves the engine's menu alone only then.
static HOOKED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Suggestions {
    pub words: Vec<String>,
}

/// The suggestion words among the engine's default items, as (unlocalised name, label) pairs.
pub fn suggestion_words(items: &[(String, String)]) -> Vec<String> {
    items
        .iter()
        .filter(|(name, _)| name == "spellCheck")
        // The label carries an ampersand where a keyboard accelerator goes; "&&" is a literal one.
        .map(|(_, label)| label.replace("&&", "\u{0}").replace('&', "").replace('\u{0}', "&"))
        .filter(|w| !w.trim().is_empty())
        .take(MAX_SUGGESTIONS)
        .collect()
}

/// Whether the page should hold back its own preventDefault so the engine raises its event.
#[tauri::command]
pub fn edit_menu_suggestions_available() -> bool {
    HOOKED.load(Ordering::Relaxed)
}

#[cfg(windows)]
pub fn install(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(w) = app.get_webview_window("main") else { return };
    let app = app.clone();
    let _ = w.with_webview(move |pw| imp::hook(&pw.controller(), app));
}

#[cfg(not(windows))]
pub fn install(_app: &tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use super::{suggestion_words, Suggestions, HOOKED, SUGGESTIONS_EVENT};
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::ContextMenuRequestedEventHandler;
    use windows::core::{Interface, BOOL, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;

    /// SAFETY: `get` must be a WebView2 getter that writes a CoTaskMem string (or nothing).
    unsafe fn take(get: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
        let mut p = PWSTR::null();
        if get(&mut p).is_err() || p.is_null() {
            return String::new();
        }
        // SAFETY: the engine wrote a valid, nul-terminated CoTaskMem string; it is freed once.
        let s = unsafe { p.to_string() }.unwrap_or_default();
        unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
        s
    }

    pub fn hook(controller: &ICoreWebView2Controller, app: tauri::AppHandle) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        // The event needs the engine's 11th interface; an older runtime has none, so the page keeps its own menu.
        let Ok(core) = core.cast::<ICoreWebView2_11>() else { return };
        let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: plain reads from the event's objects, which live for the call.
            unsafe {
                let mut editable = BOOL(0);
                args.ContextMenuTarget()?.IsEditable(&mut editable)?;
                if !editable.as_bool() {
                    return Ok(());
                }
                let items = args.MenuItems()?;
                let mut count = 0u32;
                items.Count(&mut count)?;
                let mut named = Vec::new();
                for i in 0..count {
                    let item = items.GetValueAtIndex(i)?;
                    named.push((take(|p| item.Name(p)), take(|p| item.Label(p))));
                }
                args.SetHandled(true)?;
                let _ = app.emit(SUGGESTIONS_EVENT, Suggestions { words: suggestion_words(&named) });
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the engine keeps the handler; the token is written once.
        if unsafe { core.add_ContextMenuRequested(&handler, &mut token) }.is_ok() {
            HOOKED.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(name: &str, label: &str) -> (String, String) {
        (name.into(), label.into())
    }

    #[test]
    fn only_spell_check_items_become_suggestions_in_order() {
        let items = vec![item("cut", "Cu&t"), item("spellCheck", "hello"), item("spellCheck", "hallo"), item("paste", "&Paste"), item("spellCheck", "hell")];
        assert_eq!(suggestion_words(&items), vec!["hello", "hallo", "hell"]);
    }

    #[test]
    fn accelerator_ampersands_go_but_a_literal_one_stays() {
        assert_eq!(suggestion_words(&[item("spellCheck", "&and"), item("spellCheck", "R&&D")]), vec!["and", "R&D"]);
    }

    #[test]
    fn at_most_five_and_no_blank_ones() {
        let mut items: Vec<_> = (0..8).map(|i| item("spellCheck", &format!("w{i}"))).collect();
        items.insert(0, item("spellCheck", "  "));
        assert_eq!(suggestion_words(&items).len(), 5);
        assert!(suggestion_words(&[item("copy", "Copy")]).is_empty());
    }
}
