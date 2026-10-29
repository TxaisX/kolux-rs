//! T-580: a fenced run (`agents::run_fenced`) leaves the user's own Path as it found it, and npm's engine refusal
//! reads as one plain sentence.
//!
//! An official install script may add its folder to `HKCU\Environment` "Path". In a scratch run that folder is a
//! scratch one, and it leaked into the real Path (2026-10-28, OpenClaw). So a fenced batch keeps the value as
//! stored before it starts and writes it back afterwards when it changed. A release run is not fenced: there an
//! installer adding itself to Path is wanted.

/// `HKCU\Environment` "Path" exactly as stored: its registry type and its bytes, not expanded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct StoredValue {
    pub kind: u32,
    pub data: Vec<u8>,
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The stored value; `Ok(None)` when there is no user Path.
#[cfg(windows)]
pub(super) fn read_user_path() -> Result<Option<StoredValue>, String> {
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA};
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};
    let (key, name) = (wide("Environment"), wide("Path"));
    let mut kind: u32 = 0;
    let mut bytes: u32 = 0;
    // SAFETY: the strings are NUL-terminated and outlive the calls; the first call only asks the size, the
    // second fills a buffer of that many bytes (retried once with the size named if the value grew meanwhile).
    unsafe {
        let ask = |buf: *mut u8, kind: &mut u32, bytes: &mut u32| {
            RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND, kind, buf.cast(), bytes)
        };
        match ask(std::ptr::null_mut(), &mut kind, &mut bytes) {
            0 => {}
            ERROR_FILE_NOT_FOUND => return Ok(None),
            e => return Err(format!("Kolux could not read the user Path (error {e}).")),
        }
        let mut buf = vec![0u8; bytes as usize];
        let mut got = bytes;
        let mut status = ask(buf.as_mut_ptr(), &mut kind, &mut got);
        if status == ERROR_MORE_DATA {
            buf = vec![0u8; got as usize];
            status = ask(buf.as_mut_ptr(), &mut kind, &mut got);
        }
        if status != 0 {
            return Err(format!("Kolux could not read the user Path (error {status})."));
        }
        buf.truncate(got as usize);
        Ok(Some(StoredValue { kind, data: buf }))
    }
}

/// Writes `value` back as stored (or removes the value when there was none), then tells open programs the
/// environment changed, the way Windows' own settings page does.
#[cfg(windows)]
pub(super) fn write_user_path(value: Option<&StoredValue>) -> Result<(), String> {
    use windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
    let (key, name) = (wide("Environment"), wide("Path"));
    // SAFETY: the strings are NUL-terminated and outlive the calls; `data` is `data.len()` bytes long.
    let status = unsafe {
        match value {
            Some(v) => RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), v.kind, v.data.as_ptr().cast(), v.data.len() as u32),
            None => match RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) {
                ERROR_FILE_NOT_FOUND => 0,
                s => s,
            },
        }
    };
    if status != 0 {
        return Err(format!("Kolux could not put the user Path back (error {status})."));
    }
    let area = wide("Environment");
    let mut out: usize = 0;
    // SAFETY: `area` is NUL-terminated and outlives the call; a hung window is skipped after a second.
    unsafe {
        SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, area.as_ptr() as isize, SMTO_ABORTIFHUNG, 1000, &mut out);
    }
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn read_user_path() -> Result<Option<StoredValue>, String> {
    Ok(None)
}

#[cfg(not(windows))]
pub(super) fn write_user_path(_value: Option<&StoredValue>) -> Result<(), String> {
    Ok(())
}

/// The Node.js range npm's engine refusal names in `tail` (`Required: {"node":">=24"}`, `required: { node: '>=24' }`
/// or the older `wanted: {"node":">=18"}`): `Some(None)` when it is an engine refusal without a readable range,
/// `None` when `tail` holds no engine refusal at all.
pub(super) fn engine_refusal(tail: &str) -> Option<Option<String>> {
    let low = tail.to_ascii_lowercase();
    let range = low.lines().zip(tail.lines()).find_map(|(l, line)| {
        let at = l.find("required").or_else(|| l.find("wanted"))?;
        let node = at + l[at..].find("node")? + "node".len();
        let rest = line[node..].trim_start_matches(['"', '\'', ':', ' ']);
        let end = rest.find(['"', '\'', '}', ',']).unwrap_or(rest.len());
        Some(rest[..end].trim().to_string()).filter(|r| !r.is_empty())
    });
    let refusal = low.contains("ebadengine") || low.contains("unsupported engine") || (low.contains("engine") && range.is_some());
    refusal.then_some(range)
}

/// The sentence pair for an agent npm refused to install on this Node.js, when `tail` shows that refusal.
pub(super) fn needs_newer_node(name: &str, tail: &str) -> Option<String> {
    let range = engine_refusal(tail)?;
    let needs = match range {
        Some(r) => format!("{name} needs a newer Node.js ({r})."),
        None => format!("{name} needs a newer Node.js."),
    };
    Some(format!("{needs} Update Node.js (winget upgrade OpenJS.NodeJS.LTS), then install again."))
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPENCLAW: &str = ">=24.22.1 <25 || >=26.12.1";

    #[test]
    fn npm_error_form_names_the_required_range() {
        let tail = "npm error code EBADENGINE\nnpm error engine Unsupported engine\nnpm error engine Not compatible with your version of node/npm: openclaw@2026.10.1\nnpm error notsup Required: {\"node\":\">=24.22.1 <25 || >=26.12.1\"}\nnpm error notsup Actual:   {\"npm\":\"11.6.2\",\"node\":\"v24.19.0\"}\nnpm error A complete log of this run can be found in: C:\\x.log";
        assert_eq!(engine_refusal(tail), Some(Some(OPENCLAW.to_string())));
        assert_eq!(
            needs_newer_node("OpenClaw", tail).as_deref(),
            Some("OpenClaw needs a newer Node.js (>=24.22.1 <25 || >=26.12.1). Update Node.js (winget upgrade OpenJS.NodeJS.LTS), then install again.")
        );
    }

    #[test]
    fn npm_warn_form_and_the_older_wanted_form_name_the_range_too() {
        let warn = "npm warn EBADENGINE Unsupported engine {\nnpm warn EBADENGINE   package: 'openclaw@2026.10.1',\nnpm warn EBADENGINE   required: { node: '>=24.22.1 <25 || >=26.12.1' },\nnpm warn EBADENGINE   current: { node: 'v24.19.0', npm: '11.6.2' }\nnpm warn EBADENGINE }";
        assert_eq!(engine_refusal(warn), Some(Some(OPENCLAW.to_string())));
        let old = "npm WARN engine x@1.0.0: wanted: {\"node\":\">=18\"} (current: {\"node\":\"16.0.0\",\"npm\":\"8.0.0\"})";
        assert_eq!(engine_refusal(old), Some(Some(">=18".to_string())));
    }

    #[test]
    fn an_engine_refusal_without_a_range_still_reads_plainly_and_other_failures_are_left_alone() {
        assert_eq!(
            needs_newer_node("OpenClaw", "npm error code EBADENGINE").as_deref(),
            Some("OpenClaw needs a newer Node.js. Update Node.js (winget upgrade OpenJS.NodeJS.LTS), then install again.")
        );
        assert_eq!(needs_newer_node("OpenClaw", "npm error code E404\nnpm error 404 Not Found"), None);
        assert_eq!(needs_newer_node("Aider", "Python 3.12 is required"), None);
        assert_eq!(needs_newer_node("X", ""), None);
    }
}
