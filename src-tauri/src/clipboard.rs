//! APP-016 (the Windows parts) and the facts APP-037's feedback box adds.
//!
//! Files go on the clipboard as a real file list (CF_HDROP, with the copy-not-move hint) so the
//! file manager pastes real files, but only absolute paths inside the permitted roots (fence.rs)
//! and only when every path passes, so one refusal puts nothing on the clipboard. Text is written,
//! then read back, and the copy is reported as failed unless what comes back is the same bytes,
//! line endings included. Nothing here makes a network request.
//!
//! ponytail: image paste into a terminal needs src/terminal/TerminalPane.tsx (T-249-b); macOS and
//! Linux file lists are not built here (the reply says unsupported).
#![cfg_attr(not(windows), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The size of the DROPFILES header: the offset of the first name, the drop point, two flags.
const HEADER: u32 = 20;
#[cfg(not(windows))]
const UNSUPPORTED: &str = "Copying to the clipboard from the app is only built for Windows here.";

/// The path as the shell wants it in a file list: no `\\?\` prefix on a drive path, backslashes.
fn shown(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => s,
    }
}

/// The bytes of a CF_HDROP block: the DROPFILES header (wide names), each name ending in a zero,
/// and one more zero at the end.
pub fn drop_list(paths: &[PathBuf]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER as usize + paths.len() * 64);
    out.extend(HEADER.to_le_bytes());
    out.extend([0u8; 12]); // drop point (two longs) and the non-client flag
    out.extend(1i32.to_le_bytes()); // names are wide
    for p in paths {
        out.extend(shown(p).encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()));
    }
    out.extend([0, 0]);
    out
}

/// Every one of `paths` as an absolute, existing path that `allow` accepts, or the first refusal;
/// nothing is placed unless the whole list passes.
pub fn permit(paths: &[String], allow: impl Fn(&str) -> Result<PathBuf, String>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() {
        return Err("There is nothing to copy.".into());
    }
    paths
        .iter()
        .map(|p| {
            if !Path::new(p).is_absolute() {
                return Err(format!("{p}: only a full path (like C:\\folder\\file.txt) can be copied"));
            }
            let ok = allow(p)?;
            if ok.exists() {
                Ok(ok)
            } else {
                Err(format!("{p} is not there any more"))
            }
        })
        .collect()
}

/// Writes `text` with `put`, reads it back with `get`, and reports the copy as failed unless the
/// same bytes come back.
pub fn verified_copy(text: &str, put: impl FnOnce(&str) -> Result<(), String>, get: impl FnOnce() -> Option<String>) -> Result<(), String> {
    put(text)?;
    match get() {
        Some(back) if back.as_bytes() == text.as_bytes() => Ok(()),
        Some(_) => Err("The copy failed: what the clipboard holds is not what was copied (line breaks or characters changed).".into()),
        None => Err("The copy failed: nothing could be read back from the clipboard.".into()),
    }
}

/// "Windows build 26200 (24H2)" from the registry's build and display version.
pub fn release_text(build: Option<&str>, display: Option<&str>) -> String {
    let clean = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    match (clean(build), clean(display)) {
        (Some(b), Some(d)) => format!("Windows build {b} ({d})"),
        (Some(b), None) => format!("Windows build {b}"),
        _ => "Windows".into(),
    }
}

#[cfg(windows)]
pub mod os {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::System::Ole::{CF_HDROP, CF_UNICODETEXT};
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    /// The window that owns what is placed (null: none, fine for tests and reads).
    pub type Owner = *mut c_void;
    const MEMORY: &str = "not enough memory to copy";

    /// The clipboard, held open until dropped. Another app may hold it for a moment, so opening retries.
    struct Open;

    impl Open {
        fn new(owner: Owner) -> Option<Open> {
            // SAFETY: OpenClipboard only reads the window handle it is given.
            (0..10).any(|_| unsafe { OpenClipboard(owner) } != 0 || { std::thread::sleep(std::time::Duration::from_millis(20)); false }).then_some(Open)
        }
    }

    impl Drop for Open {
        fn drop(&mut self) {
            // SAFETY: only built by `new`, which opened the clipboard.
            unsafe { CloseClipboard() };
        }
    }

    /// A movable global block holding `bytes`, ready for SetClipboardData.
    fn global(bytes: &[u8]) -> Result<*mut c_void, String> {
        // SAFETY: the block is ours until SetClipboardData takes it; it is freed here on every failure before that.
        unsafe {
            let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
            if mem.is_null() {
                return Err(MEMORY.into());
            }
            let dst = GlobalLock(mem) as *mut u8;
            if dst.is_null() {
                GlobalFree(mem);
                return Err(MEMORY.into());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), dst, bytes.len());
            GlobalUnlock(mem);
            Ok(mem)
        }
    }

    /// Replaces the clipboard with these formats.
    fn put(owner: Owner, items: Vec<(u32, Vec<u8>)>) -> Result<(), String> {
        let _open = Open::new(owner).ok_or("the clipboard is busy in another app; try again")?;
        // SAFETY: the clipboard is open; Windows owns a block once SetClipboardData takes it, so only a refused block is freed.
        unsafe {
            EmptyClipboard();
            for (format, bytes) in items {
                let mem = global(&bytes)?;
                if SetClipboardData(format, mem).is_null() {
                    GlobalFree(mem);
                    return Err("could not put it on the clipboard".into());
                }
            }
        }
        Ok(())
    }

    pub fn put_text(owner: Owner, text: &str) -> Result<(), String> {
        put(owner, vec![(CF_UNICODETEXT as u32, text.encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()).collect())])
    }

    /// The files as a file list plus the hint that a paste copies them rather than moves them.
    pub fn put_files(owner: Owner, paths: &[PathBuf]) -> Result<(), String> {
        put(owner, vec![(CF_HDROP as u32, super::drop_list(paths)), (copy_effect_format(), 1u32.to_le_bytes().to_vec())])
    }

    /// The text on the clipboard up to its first NUL, as Windows keeps it.
    pub fn get_text() -> Option<String> {
        let _open = Open::new(std::ptr::null_mut())?;
        // SAFETY: the clipboard is open; the block is only read between GlobalLock and GlobalUnlock, never past GlobalSize.
        unsafe {
            let h = GetClipboardData(CF_UNICODETEXT as u32);
            if h.is_null() {
                return None;
            }
            let p = GlobalLock(h) as *const u16;
            if p.is_null() {
                return None;
            }
            let units = std::slice::from_raw_parts(p, GlobalSize(h) / 2);
            let text = String::from_utf16(&units[..units.iter().position(|&u| u == 0).unwrap_or(units.len())]).ok();
            GlobalUnlock(h);
            text
        }
    }

    /// The files of the file list on the clipboard, in order.
    pub fn get_files() -> Vec<PathBuf> {
        let Some(_open) = Open::new(std::ptr::null_mut()) else { return Vec::new() };
        // SAFETY: the clipboard is open and the handle is a file list, which DragQueryFileW reads without keeping.
        unsafe {
            let h = GetClipboardData(CF_HDROP as u32);
            if h.is_null() {
                return Vec::new();
            }
            let count = DragQueryFileW(h, u32::MAX, std::ptr::null_mut(), 0);
            (0..count)
                .map(|i| {
                    let len = DragQueryFileW(h, i, std::ptr::null_mut(), 0);
                    let mut buf = vec![0u16; len as usize + 1];
                    let got = DragQueryFileW(h, i, buf.as_mut_ptr(), buf.len() as u32);
                    PathBuf::from(std::ffi::OsString::from_wide(&buf[..got as usize]))
                })
                .collect()
        }
    }

    /// Every format on the clipboard, or None when it cannot be opened.
    #[cfg(test)]
    pub fn formats() -> Option<Vec<u32>> {
        use windows_sys::Win32::System::DataExchange::EnumClipboardFormats;
        let _open = Open::new(std::ptr::null_mut())?;
        // SAFETY: the clipboard is open; EnumClipboardFormats ends with 0.
        Some(std::iter::successors(Some(unsafe { EnumClipboardFormats(0) }), |&f| Some(unsafe { EnumClipboardFormats(f) })).take_while(|&f| f != 0).collect())
    }

    #[cfg(test)]
    pub fn empty() {
        if let Some(_open) = Open::new(std::ptr::null_mut()) {
            // SAFETY: the clipboard is open.
            unsafe { EmptyClipboard() };
        }
    }

    /// The registered "Preferred DropEffect" format: a DWORD of 1 says copy.
    pub fn copy_effect_format() -> u32 {
        let name: Vec<u16> = "Preferred DropEffect".encode_utf16().chain([0]).collect();
        // SAFETY: the name is NUL-terminated and outlives the call.
        unsafe { RegisterClipboardFormatW(name.as_ptr()) }
    }

    /// The Windows build and display version, from the registry (no network).
    pub fn release() -> String {
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
        let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        let key = wide(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        // ponytail: a 64-character buffer is plenty for a build number and a version label; a longer value reads as missing
        let read = |name: &str| -> Option<String> {
            let name = wide(name);
            let mut buf = [0u16; 64];
            let mut bytes = std::mem::size_of_val(&buf) as u32;
            // SAFETY: the strings are NUL-terminated and outlive the call; the buffer is as big as `bytes` says.
            let status = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut bytes) };
            if status != 0 {
                return None;
            }
            let end = buf.iter().position(|&u| u == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..end]))
        };
        super::release_text(read("CurrentBuildNumber").as_deref(), read("DisplayVersion").as_deref())
    }
}

#[cfg(not(windows))]
mod os {
    pub fn release() -> String {
        std::env::consts::OS.to_string()
    }
}

/// The window that should own what is placed, as a number so it can cross to the worker thread.
#[cfg(windows)]
fn owner_of(window: &tauri::WebviewWindow) -> usize {
    window.hwnd().map(|h| h.0 as usize).unwrap_or(0)
}

/// APP-016: copies text from the app side and reads it back; an error says the copy failed.
#[tauri::command]
pub async fn clip_copy_text(window: tauri::WebviewWindow, text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let owner = owner_of(&window);
        tauri::async_runtime::spawn_blocking(move || verified_copy(&text, |t| os::put_text(owner as os::Owner, t), os::get_text)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, text);
        Err(UNSUPPORTED.into())
    }
}

/// APP-016: puts files on the clipboard as a file list, only when every path is a full path inside a
/// permitted root; replies with how many files were placed.
#[tauri::command]
pub async fn clip_copy_files(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, Mutex<crate::state::Store>>,
    guard: tauri::State<'_, crate::fence::Fence>,
    git: tauri::State<'_, crate::git::Git>,
    paths: Vec<String>,
) -> Result<usize, String> {
    let list = permit(&paths, |p| guard.allow(p, &store, &git, false))?;
    #[cfg(windows)]
    {
        let owner = owner_of(&window);
        tauri::async_runtime::spawn_blocking(move || {
            os::put_files(owner as os::Owner, &list)?;
            if os::get_files().len() == list.len() {
                Ok(list.len())
            } else {
                Err("The copy failed: the clipboard does not hold the files that were copied.".to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, list);
        Err(UNSUPPORTED.into())
    }
}

/// What APP-037's box adds under the user's text, besides the version the front end already has.
#[derive(serde::Serialize)]
pub struct Facts {
    release: String,
    arch: String,
    login: Option<String>,
}

#[tauri::command]
pub async fn feedback_facts() -> Result<Facts, String> {
    tauri::async_runtime::spawn_blocking(|| Facts { release: os::release(), arch: std::env::consts::ARCH.to_string(), login: crate::scm::gh_login() })
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(tag: &str) -> crate::test_dir::TempDir {
        crate::test_dir::temp(tag)
    }

    /// Runs a closure when dropped, also while a panic unwinds: how the real-clipboard tests put the
    /// user's clipboard back even when their body fails.
    struct OnDrop<F: FnMut()>(F);
    impl<F: FnMut()> Drop for OnDrop<F> {
        fn drop(&mut self) {
            (self.0)();
        }
    }

    #[test]
    fn fix1_the_restore_guard_runs_when_a_test_body_ends_and_when_it_panics() {
        let ran = std::cell::Cell::new(0);
        {
            let _guard = OnDrop(|| ran.set(ran.get() + 1));
        }
        assert_eq!(ran.get(), 1, "it runs at the end of a normal body");
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = OnDrop(|| ran.set(ran.get() + 1));
            panic!("the body failed on purpose");
        }));
        assert!(outcome.is_err());
        assert_eq!(ran.get(), 2, "it runs while a panic unwinds");
    }

    #[test]
    fn fix1_every_test_that_touches_the_real_desktop_clipboard_is_opt_in() {
        // A default `cargo test` on any lane must never write to the person's clipboard: the tests in
        // the real module run only with `-- --ignored --test-threads=1`.
        let src = include_str!("clipboard.rs");
        let at = src.rfind(concat!("mod re", "al {")).expect("the real-clipboard module is there");
        let lines: Vec<&str> = src[at..].lines().map(str::trim).collect();
        let mut tests = 0;
        for (i, line) in lines.iter().enumerate() {
            if *line == "#[test]" {
                tests += 1;
                assert!(lines[i + 1].starts_with("#[ignore"), "not opted in: {}", lines[i + 2]);
            }
        }
        assert_eq!(tests, 2, "both real-clipboard tests are counted");
    }

    fn utf16z(s: &str) -> Vec<u8> {
        s.encode_utf16().chain([0]).flat_map(|u| u.to_le_bytes()).collect()
    }

    #[test]
    fn app016_the_file_list_has_the_header_wide_names_each_ending_in_zero_and_a_last_zero() {
        let list = drop_list(&[PathBuf::from(r"C:\a\b.txt"), PathBuf::from(r"C:\a\c d.txt")]);
        assert_eq!(u32::from_le_bytes(list[0..4].try_into().unwrap()), 20, "names start right after the header");
        assert_eq!(&list[4..16], &[0u8; 12], "drop point and the non-client flag are zero");
        assert_eq!(i32::from_le_bytes(list[16..20].try_into().unwrap()), 1, "names are wide");
        let mut want = utf16z(r"C:\a\b.txt");
        want.extend(utf16z(r"C:\a\c d.txt"));
        want.extend([0, 0]);
        assert_eq!(&list[20..], &want[..]);
    }

    #[test]
    fn app016_the_file_list_gives_the_shell_plain_drive_paths() {
        let list = drop_list(&[PathBuf::from(r"\\?\C:\x\y.txt"), PathBuf::from("D:/p/q.txt")]);
        let mut want = utf16z(r"C:\x\y.txt");
        want.extend(utf16z(r"D:\p\q.txt"));
        want.extend([0, 0]);
        assert_eq!(&list[20..], &want[..]);
    }

    fn fenced(root: &Path) -> impl Fn(&str) -> Result<PathBuf, String> + '_ {
        let roots = vec![root.to_path_buf()];
        move |p| crate::fence::check(Path::new(p), &roots, &[], false)
    }

    #[test]
    fn app016_only_absolute_existing_paths_inside_the_permitted_roots_pass() {
        let t = temp("clip-permit");
        let inside = t.join("proj");
        fs::create_dir_all(&inside).unwrap();
        let a = inside.join("a.txt");
        let b = inside.join("b.txt");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        let outside = t.join("elsewhere.txt");
        fs::write(&outside, "x").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let allow = fenced(&inside);

        let got = permit(&[s(&a), s(&b)], &allow).unwrap();
        assert_eq!(got, vec![a.clone(), b.clone()]);

        assert!(permit(&[], &allow).is_err(), "nothing to copy is refused");
        let err = permit(&[s(&a), s(&outside)], &allow).unwrap_err();
        assert!(err.contains("elsewhere.txt"), "one path outside the roots refuses the whole copy: {err}");
        let err = permit(&["src\\a.txt".into()], &allow).unwrap_err();
        assert!(err.to_lowercase().contains("full path"), "a relative path is refused: {err}");
        assert!(permit(&[s(&inside.join("gone.txt"))], &allow).is_err(), "a file that is not there is refused");
        #[cfg(windows)]
        {
            assert!(permit(&["C:a.txt".into()], &allow).is_err(), "a drive-relative path is refused");
            assert!(permit(&[r"\\server\share\a.txt".into()], &allow).is_err(), "a network share is refused");
            assert!(permit(&[r"\a.txt".into()], &allow).is_err(), "a root-relative path is refused");
        }
    }

    #[test]
    fn app016_written_text_must_read_back_byte_for_byte_or_the_copy_is_reported_failed() {
        let text = "one\r\ntwo\r\n\r\nthree\u{1f600}";
        let keep = std::cell::RefCell::new(String::new());
        let put = |t: &str| {
            *keep.borrow_mut() = t.to_string();
            Ok(())
        };
        assert!(verified_copy(text, put, || Some(keep.borrow().clone())).is_ok());
        // line endings changed on the way: failed, and the message says so
        let err = verified_copy(text, |_| Ok(()), || Some(text.replace("\r\n", "\n"))).unwrap_err();
        assert!(err.to_lowercase().contains("failed"), "{err}");
        // cut short (a NUL ends clipboard text), nothing read back, or the write itself failing
        assert!(verified_copy("a\0b", |_| Ok(()), || Some("a".into())).is_err());
        assert!(verified_copy("a", |_| Ok(()), || None).unwrap_err().to_lowercase().contains("failed"));
        assert_eq!(verified_copy("a", |_| Err("busy".into()), || Some("a".into())).unwrap_err(), "busy");
    }

    #[test]
    fn app037_the_system_release_reads_as_a_build_and_a_version_or_says_plain_windows() {
        assert_eq!(release_text(Some("26200"), Some("24H2")), "Windows build 26200 (24H2)");
        assert_eq!(release_text(Some("19045"), None), "Windows build 19045");
        assert_eq!(release_text(None, Some("24H2")), "Windows");
        assert_eq!(release_text(Some(" "), None), "Windows");
    }

    #[cfg(windows)]
    mod real {
        use super::*;
        use std::sync::Mutex;

        /// One test at a time on the one real clipboard.
        static ONE: Mutex<()> = Mutex::new(());

        /// Runs `body` with the real clipboard, then puts its earlier text back, also when `body`
        /// panics (a guard restores it on the way out). SKIPPED (printed) when the clipboard cannot
        /// be opened here or holds something other than text, which could not be put back.
        ///
        /// Both tests below are `#[ignore]`: a default `cargo test` on any lane never touches the
        /// desktop clipboard, because two test processes at once would each snapshot the other's text
        /// as the earlier one (an in-process lock cannot stop that). Run them by hand, one at a time:
        /// `cargo test --lib clipboard -- --ignored --test-threads=1`.
        fn guarded(name: &str, body: impl FnOnce()) {
            let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
            let Some(formats) = os::formats() else {
                println!("SKIPPED {name}: the clipboard cannot be opened here");
                return;
            };
            // text, OEM text, Unicode text, locale: what a text copy leaves
            if formats.iter().any(|f| ![1, 7, 13, 16].contains(f)) {
                println!("SKIPPED {name}: the clipboard holds something other than text, which a test could not put back");
                return;
            }
            let prior = if formats.contains(&13) { os::get_text() } else { None };
            let _restore = OnDrop(move || match &prior {
                // no panic in here: a second panic while one unwinds would abort the whole test run
                Some(t) => {
                    if let Err(e) = os::put_text(std::ptr::null_mut(), t) {
                        eprintln!("COULD NOT PUT THE EARLIER CLIPBOARD TEXT BACK: {e}");
                    }
                }
                None => os::empty(),
            });
            body();
        }

        #[test]
        #[ignore = "touches the real desktop clipboard: cargo test --lib clipboard -- --ignored --test-threads=1"]
        fn app016_windows_line_endings_survive_a_real_clipboard_round_trip_byte_for_byte() {
            guarded("app016 text round trip", || {
                let text = "line one\r\nline two\r\n\r\nlast line \u{e9}\u{1f600}\r\n";
                verified_copy(text, |t| os::put_text(std::ptr::null_mut(), t), os::get_text).expect("the copy verifies");
                let back = os::get_text().expect("text on the clipboard");
                assert_eq!(back.as_bytes(), text.as_bytes());
            });
        }

        #[test]
        #[ignore = "touches the real desktop clipboard: cargo test --lib clipboard -- --ignored --test-threads=1"]
        fn app016_a_real_file_list_reads_back_as_the_same_files_with_the_copy_hint() {
            guarded("app016 file list round trip", || {
                let t = temp("clip-files");
                let a = t.join("one.txt");
                let b = t.join("two words.txt");
                fs::write(&a, "1").unwrap();
                fs::write(&b, "2").unwrap();
                os::put_files(std::ptr::null_mut(), &[a.clone(), b.clone()]).expect("files placed");
                assert_eq!(os::get_files(), vec![a, b]);
                let formats = os::formats().expect("clipboard opens");
                assert!(formats.contains(&15), "CF_HDROP is there");
                assert!(formats.contains(&os::copy_effect_format()), "the copy-not-move hint is there");
            });
        }
    }
}
