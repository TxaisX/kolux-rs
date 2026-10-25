//! After-list 21 (BROW-008): whether the system has a program for a link's scheme, so the load
//! overlay offers Open Externally only when something outside Kolux would take the link. Windows
//! asks the shell's association store (AssocQueryString for the URL scheme); elsewhere the answer
//! is "unknown", which keeps the button as before. The command is `browser_external_handler`.

// Until evidence/browser-fix-21-lib.rs.patch registers the command in lib.rs nothing calls it; that
// patch also deletes this line.
#![allow(dead_code)]

/// The scheme of an address `open_external` would let through (web and mail links), lower case.
pub fn scheme_of(url: &str) -> Option<&'static str> {
    let low = url.trim_start().to_ascii_lowercase();
    ["https", "http", "mailto"].into_iter().find(|s| low.strip_prefix(s).is_some_and(|r| r.starts_with(':')))
}

/// What the shell's answer means. `hr` and `needed` are AssocQueryString's result and the
/// characters it says the handler's name needs. `Some(false)` only for the shell's own "nothing is
/// associated" answers; any other failure is unknown (`None`), never a reason to hide the button.
pub fn has_handler(hr: i32, needed: u32) -> Option<bool> {
    const NO_ASSOCIATION: i32 = 0x8007_0483_u32 as i32; // ERROR_NO_ASSOCIATION
    const NOT_FOUND: i32 = 0x8007_0490_u32 as i32; // E_ELEMENTNOTFOUND
    match hr {
        0 | 1 if needed > 1 => Some(true),
        0 | 1 => Some(false),
        NO_ASSOCIATION | NOT_FOUND => Some(false),
        _ => None,
    }
}

#[cfg(windows)]
fn ask_shell(scheme: &str) -> Option<bool> {
    use windows_sys::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_IS_PROTOCOL, ASSOCSTR_COMMAND};
    let name: Vec<u16> = scheme.encode_utf16().chain([0]).collect();
    let mut needed = 0u32;
    // SAFETY: `name` is NUL-terminated and outlives the call; a null output buffer only asks for
    // the length the handler's command needs, which is written to `needed`.
    let hr = unsafe { AssocQueryStringW(ASSOCF_IS_PROTOCOL, ASSOCSTR_COMMAND, name.as_ptr(), std::ptr::null(), std::ptr::null_mut(), &mut needed) };
    has_handler(hr, needed)
}

#[cfg(not(windows))]
fn ask_shell(_scheme: &str) -> Option<bool> {
    None
}

/// Whether the system has a program for this address's scheme: `Some(false)` hides Open
/// Externally; `None` (unknown: a scheme `open_external` refuses, another platform, an odd shell
/// answer) leaves the button as it was.
#[tauri::command]
pub async fn browser_external_handler(url: String) -> Option<bool> {
    let scheme = scheme_of(&url)?;
    tauri::async_runtime::spawn_blocking(move || ask_shell(scheme)).await.ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn after21_only_web_and_mail_schemes_are_asked_about() {
        assert_eq!(scheme_of("https://example.com/"), Some("https"));
        assert_eq!(scheme_of("HTTP://example.com/"), Some("http"));
        assert_eq!(scheme_of("  mailto:a@b.test"), Some("mailto"));
        for no in ["file:///C:/x", "javascript:alert(1)", "httpx://a", "http", "https//a", "ftp://a", ""] {
            assert_eq!(scheme_of(no), None, "{no}");
        }
    }

    #[test]
    fn after21_a_handler_is_known_only_from_the_shell_s_own_answers() {
        assert_eq!(has_handler(1, 40), Some(true), "S_FALSE with a length: the size query found one");
        assert_eq!(has_handler(0, 12), Some(true));
        assert_eq!(has_handler(1, 0), Some(false));
        assert_eq!(has_handler(0, 1), Some(false), "an empty name is no handler");
        assert_eq!(has_handler(0x8007_0483_u32 as i32, 0), Some(false), "no association");
        assert_eq!(has_handler(0x8007_0490_u32 as i32, 0), Some(false), "element not found");
        assert_eq!(has_handler(0x8000_4005_u32 as i32, 0), None, "E_FAIL is unknown, not a refusal");
        assert_eq!(has_handler(0x8007_0005_u32 as i32, 0), None, "access denied is unknown");
    }
}
