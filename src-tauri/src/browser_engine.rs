//! The thin glue to WebView2's own events and calls, reached through webview2-com (a direct
//! dependency since the coordinator's 2026-10-20 decision, pinned to the version wry builds).
//!
//! Glue only: every decision is a pure function elsewhere and tested there (certificates in
//! browser_certs.rs). Nothing here runs in a unit test (a test binary that links the window
//! toolkit does not load), so this file is proved live: see the LIVE PROOF PENDING steps in
//! evidence/T-158.txt.
//!
//! - T-158 (BROW-024): every page answers the engine's server-certificate-error event with
//!   `certs::on_engine`: allow for an approved local certificate, cancel for everything else,
//!   never the engine's default error page (which has its own click-through).
//! - T-251 (CLI-047): `kolux screenshot` / `full-screenshot` take a picture through the engine's
//!   DevTools call (Page.captureScreenshot), `kolux pdf` prints through the engine's PrintToPdf.
//!   Both are started on the main thread and waited for on the command line's own thread.
//! - T-286-b (APP-040): the engine's process-failed event, from every browser page and the app's
//!   own view, becomes a crash record when it is a real crash (browser_crash.rs decides).
//! - T-272-d: the engine's accelerator-key event records each real key pressed in a page, so a
//!   keyboard chord that page's script sends counts only after a real press there (browser_holder.rs).
//! - T-239-b (BROW-025): at every navigation start a page (and a popup) is given desktop Firefox
//!   with no client hints on the sign-in hosts, its own identity elsewhere, unless its profile is
//!   in native mode (`profiles::firefox_at` decides).
//! - T-272-b (BROW-032): a page's permission requests are answered by `permissions::answer`; a
//!   refusal is told to its pane (PERMISSION_EVENT) with the permission named.
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Webview};

#[cfg(windows)]
mod imp {
    use crate::browser::certs;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use std::sync::mpsc::Sender;
    use crate::browser::{cookies, crash, holder, permissions, profiles};
    use cookies::Entry;
    use tauri::webview::cookie::SameSite;
    use tauri::Emitter;
    use std::path::PathBuf;
    use webview2_com::{AcceleratorKeyPressedEventHandler, CallDevToolsProtocolMethodCompletedHandler, ClearServerCertificateErrorActionsCompletedHandler, GetCookiesCompletedHandler, NavigationStartingEventHandler, PermissionRequestedEventHandler, PrintToPdfCompletedHandler, ProcessFailedEventHandler, ServerCertificateErrorDetectedEventHandler, WebResourceRequestedEventHandler};
    use windows::core::{w, Interface, BOOL, HSTRING, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;

    /// A string the engine hands over in memory the caller frees; empty when it hands none.
    ///
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

    /// Hooks a new page's engine events (called once, on the main thread, as the page is made).
    pub fn attach(id: u32, controller: &ICoreWebView2Controller) {
        // T-272-d: every real key the engine reports in this page (before the page sees it) is
        // recorded, so a chord the page's script sends counts only after a real press there.
        let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let (mut kind, mut vk) = (COREWEBVIEW2_KEY_EVENT_KIND::default(), 0u32);
            // SAFETY: KeyEventKind and VirtualKey only write plain values; Handled is left alone,
            // so the page still gets the key.
            if unsafe { args.KeyEventKind(&mut kind) }.is_ok() && unsafe { args.VirtualKey(&mut vk) }.is_ok() {
                holder::engine_key(id, kind.0, vk);
            }
            Ok(())
        }));
        let mut key_token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        if unsafe { controller.add_AcceleratorKeyPressed(&keys, &mut key_token) }.is_ok() {
            holder::watch(id);
        }
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        if let Ok(core14) = core.cast::<ICoreWebView2_14>() {
            let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                // SAFETY: RequestUri and ToPemEncoding write CoTaskMem strings `take` frees.
                let uri = unsafe { take(|p| args.RequestUri(p)) };
                let pem = unsafe { args.ServerCertificate() }.map(|c| unsafe { take(|p| c.ToPemEncoding(p)) }).unwrap_or_default();
                let fp = if pem.is_empty() { String::new() } else { certs::fingerprint(&pem) };
                let action = match certs::TRUST.lock() {
                    Ok(mut t) => certs::on_engine(&mut t, id, &uri, &fp),
                    Err(_) => certs::EngineAction::Cancel,
                };
                let a = match action {
                    certs::EngineAction::AlwaysAllow => COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                    certs::EngineAction::Cancel => COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL,
                };
                // SAFETY: SetAction only records the answer on the event's arguments.
                unsafe { args.SetAction(a) }
            }));
            let mut token = 0i64;
            // SAFETY: the handler lives as long as the engine holds it; the token is written once.
            let _ = unsafe { core14.add_ServerCertificateErrorDetected(&handler, &mut token) };
        }
    }

    /// T-286-b (APP-040): hooks a view's process-failed event; each failure is read as far as the
    /// runtime goes (kind; reason, exit code and process on newer runtimes; the faulting module on
    /// newer still) and handed to `crash::report` with the memory reading taken now.
    pub fn watch_failures(source: crash::Source, controller: &ICoreWebView2Controller, dir: PathBuf) {
        // SAFETY: CoreWebView2 hands back the view's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            // SAFETY: the getters below only write plain values or CoTaskMem strings `take` frees.
            unsafe { args.ProcessFailedKind(&mut kind) }?;
            let mut f = crash::Failure { kind: kind.0, ..Default::default() };
            if let Ok(a2) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                let (mut reason, mut code) = (COREWEBVIEW2_PROCESS_FAILED_REASON::default(), 0i32);
                if unsafe { a2.Reason(&mut reason) }.is_ok() {
                    f.reason = Some(reason.0);
                }
                if unsafe { a2.ExitCode(&mut code) }.is_ok() {
                    f.exit_code = Some(code);
                }
                f.process = unsafe { take(|p| a2.ProcessDescription(p)) };
            }
            if let Ok(a3) = args.cast::<ICoreWebView2ProcessFailedEventArgs3>() {
                f.module = unsafe { take(|p| a3.FailureSourceModulePath(p)) };
            }
            let open = match source {
                crash::Source::Page(id) => crate::browser::tabs().iter().any(|t| t.id == id),
                crash::Source::App => true,
            };
            let when = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            crash::report(&dir, &f, source, open, crash::memory_now(), when);
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_ProcessFailed(&handler, &mut token) };
    }

    /// Forgets the engine's remembered certificate allowances for one page's engine.
    pub fn clear(controller: &ICoreWebView2Controller) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        if let Ok(core14) = core.cast::<ICoreWebView2_14>() {
            let done = ClearServerCertificateErrorActionsCompletedHandler::create(Box::new(|_| Ok(())));
            // SAFETY: the completion handler is kept alive by the engine until it runs.
            let _ = unsafe { core14.ClearServerCertificateErrorActions(&done) };
        }
    }

    /// The engine's own identity, read from the first page before anything changes it (every page
    /// runs on the same engine, so one reading serves all).
    static STOCK: std::sync::OnceLock<String> = std::sync::OnceLock::new();

    /// T-239-b (BROW-025): a page in a profile's normal mode shows desktop Firefox with no client
    /// hints on the sign-in hosts and its own identity everywhere else. Decided again at every
    /// navigation start (each redirect hop starts one) by `profiles::firefox_at`.
    pub fn identity(controller: &ICoreWebView2Controller, spoof: bool) {
        // SAFETY: CoreWebView2 and Settings hand back the page's engine and its settings.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let Ok(settings) = (unsafe { core.Settings() }).and_then(|s| s.cast::<ICoreWebView2Settings2>()) else { return };
        // SAFETY: UserAgent writes a CoTaskMem string `take` frees.
        let here = unsafe { take(|p| settings.UserAgent(p)) };
        let firefox = profiles::firefox_identity();
        let stock = STOCK.get_or_init(|| if here == firefox { String::new() } else { here.clone() }).clone();
        if !spoof || stock.is_empty() {
            return;
        }
        let (fx, own) = (HSTRING::from(firefox.as_str()), HSTRING::from(stock.as_str()));
        let nav = NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: Uri writes a CoTaskMem string `take` frees.
            let uri = unsafe { take(|p| args.Uri(p)) };
            let on = profiles::firefox_at(&uri, true);
            let ua = if on { &fx } else { &own };
            // SAFETY: SetUserAgent and the header calls only record values on the engine and on
            // this navigation's request.
            unsafe {
                let _ = settings.SetUserAgent(ua);
                if let Ok(h) = args.RequestHeaders() {
                    let _ = h.SetHeader(w!("User-Agent"), ua);
                    if on {
                        for name in profiles::CLIENT_HINTS {
                            let _ = h.RemoveHeader(&HSTRING::from(*name));
                        }
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_NavigationStarting(&nav, &mut token) };
        // The sign-in hosts' own requests (scripts, frames, fetches) lose their client hints too.
        for host in profiles::SIGN_IN_HOSTS {
            // SAFETY: the filter only names which requests the event below reports.
            let _ = unsafe { core.AddWebResourceRequestedFilter(&HSTRING::from(format!("https://{host}/*")), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL) };
        }
        let req = WebResourceRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // SAFETY: Request and Uri hand back the request and a CoTaskMem string `take` frees;
            // RemoveHeader only edits the outgoing request's headers.
            unsafe {
                let Ok(r) = args.Request() else { return Ok(()) };
                if profiles::sign_in_host(&take(|p| r.Uri(p))) {
                    if let Ok(h) = r.Headers() {
                        for name in profiles::CLIENT_HINTS {
                            let _ = h.RemoveHeader(&HSTRING::from(*name));
                        }
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_WebResourceRequested(&req, &mut token) };
        let script = HSTRING::from(profiles::no_hints_script());
        // SAFETY: the script is copied by the engine; no completion handler is needed.
        let _ = unsafe { core.AddScriptToExecuteOnDocumentCreated(&script, None::<&ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>) };
    }

    /// T-272-b (BROW-032): answers each permission request of a page by `permissions::answer`; a
    /// refusal reaches the page's pane as a notice naming the permission.
    pub fn permissions(id: u32, controller: &ICoreWebView2Controller, app: tauri::AppHandle) {
        // SAFETY: CoreWebView2 hands back the page's engine object.
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            // SAFETY: PermissionKind only writes a plain value; SetState only records the answer.
            unsafe { args.PermissionKind(&mut kind) }?;
            if let permissions::Answer::Deny(text) = permissions::answer(kind.0) {
                unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY) }?;
                let _ = app.emit(crate::browser::PERMISSION_EVENT, serde_json::json!({ "id": id, "text": text }));
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the handler lives as long as the engine holds it; the token is written once.
        let _ = unsafe { core.add_PermissionRequested(&handler, &mut token) };
    }

    /// One DevTools call on the page's engine; its JSON answer (or why not) goes to `tx`.
    pub fn devtools(controller: &ICoreWebView2Controller, method: &str, params: &str, tx: Sender<Result<String, String>>) {
        let fail = tx.clone();
        let start = move || -> windows::core::Result<()> {
            // SAFETY: CoreWebView2 hands back the page's engine object.
            let core = unsafe { controller.CoreWebView2() }?;
            let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |r, json| {
                let _ = tx.send(r.map(|_| json).map_err(|e| e.message()));
                Ok(())
            }));
            // SAFETY: the strings outlive the call; the engine keeps the handler until it runs.
            unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params), &done) }
        };
        if let Err(e) = start() {
            let _ = fail.send(Err(e.message()));
        }
    }

    /// The engine prints the page to `path`; whether it succeeded (or why not) goes to `tx`.
    pub fn print_pdf(controller: &ICoreWebView2Controller, path: &str, tx: Sender<Result<bool, String>>) {
        let fail = tx.clone();
        let start = move || -> windows::core::Result<()> {
            // SAFETY: CoreWebView2 hands back the page's engine object.
            let core = unsafe { controller.CoreWebView2() }?.cast::<ICoreWebView2_7>()?;
            let done = PrintToPdfCompletedHandler::create(Box::new(move |r, ok| {
                let _ = tx.send(r.map(|_| ok).map_err(|e| e.message()));
                Ok(())
            }));
            // SAFETY: the path outlives the call; no settings means the engine's defaults.
            unsafe { core.PrintToPdf(&HSTRING::from(path), None::<&ICoreWebView2PrintSettings>, &done) }
        };
        if let Err(e) = start() {
            let _ = fail.send(Err(e.message()));
        }
    }

    fn cookie_manager(controller: &ICoreWebView2Controller) -> windows::core::Result<ICoreWebView2CookieManager> {
        // SAFETY: CoreWebView2 and CookieManager hand back the page's engine objects.
        unsafe { controller.CoreWebView2() }?.cast::<ICoreWebView2_2>().and_then(|c| unsafe { c.CookieManager() })
    }

    /// An engine cookie with its domain exactly as stored (leading dot kept; the cookie crate drops it).
    fn entry_of(c: &ICoreWebView2Cookie) -> windows::core::Result<Entry> {
        let mut same = COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX;
        let (mut http_only, mut secure, mut session) = (BOOL::default(), BOOL::default(), BOOL::default());
        let mut expires = 0.0;
        // SAFETY: the getters write plain values, or CoTaskMem strings `take` frees.
        unsafe {
            c.SameSite(&mut same)?;
            c.IsHttpOnly(&mut http_only)?;
            c.IsSecure(&mut secure)?;
            c.IsSession(&mut session)?;
            c.Expires(&mut expires)?;
        }
        let same_site = match same {
            COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT => Some(SameSite::Strict),
            COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE => Some(SameSite::None),
            _ => Some(SameSite::Lax),
        };
        Ok(Entry {
            // SAFETY: Name, Value, Domain and Path write CoTaskMem strings `take` frees.
            name: unsafe { take(|p| c.Name(p)) },
            value: unsafe { take(|p| c.Value(p)) },
            domain: unsafe { take(|p| c.Domain(p)) },
            path: unsafe { take(|p| c.Path(p)) },
            secure: secure.as_bool(),
            http_only: http_only.as_bool(),
            same_site,
            expires: if session.as_bool() || expires < 0.0 { None } else { Some(expires as i64) },
        })
    }

    fn cookie_to_engine(m: &ICoreWebView2CookieManager, e: &Entry) -> windows::core::Result<ICoreWebView2Cookie> {
        // SAFETY: the strings outlive the call; CreateCookie hands back a new engine cookie.
        let c = unsafe { m.CreateCookie(&HSTRING::from(e.name.as_str()), &HSTRING::from(e.value.as_str()), &HSTRING::from(cookies::engine_domain(e)), &HSTRING::from(e.path.as_str())) }?;
        // SAFETY: the setters only record plain values on the cookie object.
        unsafe {
            if let Some(at) = e.expires {
                c.SetExpires(at as f64)?;
            }
            c.SetIsHttpOnly(e.http_only)?;
            c.SetIsSecure(e.secure)?;
            if let Some(s) = e.same_site {
                c.SetSameSite(match s {
                    SameSite::Strict => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT,
                    SameSite::None => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE,
                    SameSite::Lax => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX,
                })?;
            }
        }
        Ok(c)
    }

    /// Every cookie of the page's profile with its domain kept as stored; the list goes to `tx`.
    pub fn cookies(controller: &ICoreWebView2Controller, tx: Sender<Result<Vec<Entry>, String>>) {
        let fail = tx.clone();
        let start = move || -> windows::core::Result<()> {
            let m = cookie_manager(controller)?;
            let done = GetCookiesCompletedHandler::create(Box::new(move |r, list| {
                let read = || -> windows::core::Result<Vec<Entry>> {
                    r?;
                    let Some(list) = list else { return Ok(Vec::new()) };
                    let mut n = 0;
                    // SAFETY: Count and GetValueAtIndex only read the engine's list.
                    unsafe { list.Count(&mut n) }?;
                    Ok((0..n).filter_map(|i| unsafe { list.GetValueAtIndex(i) }.ok().and_then(|c| entry_of(&c).ok())).collect())
                };
                let _ = tx.send(read().map_err(|e| e.message()));
                Ok(())
            }));
            // SAFETY: a null address asks for every cookie; the engine keeps the handler until it runs.
            unsafe { m.GetCookies(windows::core::PCWSTR::null(), &done) }
        };
        if let Err(e) = start() {
            let _ = fail.send(Err(e.message()));
        }
    }

    /// Adds or replaces one cookie in the page's profile (`delete`: removes it), scope kept exactly.
    pub fn put_cookie(controller: &ICoreWebView2Controller, e: &Entry, delete: bool, tx: Sender<Result<(), String>>) {
        let run = || -> windows::core::Result<()> {
            let m = cookie_manager(controller)?;
            let c = cookie_to_engine(&m, e)?;
            // SAFETY: the engine takes its own cookie object back.
            unsafe { if delete { m.DeleteCookie(&c) } else { m.AddOrUpdateCookie(&c) } }
        };
        let _ = tx.send(run().map_err(|e| e.message()));
    }
}

/// Hooks a new page's engine events (main thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn attach(id: u32, pw: &tauri::webview::PlatformWebview) {
    imp::attach(id, &pw.controller());
}

/// T-239-b (BROW-025): a page shows desktop Firefox on the sign-in hosts unless its profile is in
/// native mode (main thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn identity(pw: &tauri::webview::PlatformWebview, spoof: bool) {
    imp::identity(&pw.controller(), spoof);
}

/// T-272-b (BROW-032): a page's permission requests are answered by the permission rules (main
/// thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn permissions(id: u32, pw: &tauri::webview::PlatformWebview, app: AppHandle) {
    imp::permissions(id, &pw.controller(), app);
}

/// T-272-b (BROW-032, after-list 718): a popup's permission requests are answered by the same
/// rules as its opener tab's page, and a refusal's notice goes to the opener's pane (`tab`).
pub fn popup_permissions(w: &tauri::WebviewWindow, tab: u32, app: AppHandle) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::permissions(tab, &pw.controller(), app));
    #[cfg(not(windows))]
    let _ = (w, tab, app);
}

/// T-239-b (BROW-025): a popup follows the mode of its tab's profile. A popup opened straight onto
/// a sign-in host already starts as Firefox (its builder sets that); this keeps every later hop
/// right.
pub fn popup_identity(w: &tauri::WebviewWindow, spoof: bool) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::identity(&pw.controller(), spoof));
    #[cfg(not(windows))]
    let _ = (w, spoof);
}

/// T-286-b (APP-040): a browser page's engine reports its process failures (main thread, from
/// `browser_open`'s web view callback); `dir` is the profile folder holding the crash store.
#[cfg(windows)]
pub fn watch_page_failures(id: u32, pw: &tauri::webview::PlatformWebview, dir: Option<PathBuf>) {
    if let Some(dir) = dir {
        imp::watch_failures(super::crash::Source::Page(id), &pw.controller(), dir);
    }
}

/// T-286-b (APP-040): the app's own view reports its engine's process failures (an interface
/// process crash is a crash). Called once at startup.
pub fn watch_app_failures(w: &tauri::WebviewWindow, dir: PathBuf) {
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| imp::watch_failures(super::crash::Source::App, &pw.controller(), dir));
    #[cfg(not(windows))]
    let _ = (w, dir);
}

/// Starts `job` on the page's engine (main thread) and waits for its answer here; never called
/// from the main thread (the command line's requests run on their own).
#[cfg(windows)]
fn on_engine<T: Send + 'static>(v: &Webview, wait: Duration, job: impl FnOnce(&webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller, std::sync::mpsc::Sender<Result<T, String>>) + Send + 'static) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    v.with_webview(move |pw| job(&pw.controller(), tx)).map_err(|e| e.to_string())?;
    rx.recv_timeout(wait).map_err(|_| format!("the page's engine did not answer within {} s", wait.as_secs()))?
}

/// T-251 (CLI-047): one DevTools call on a page's engine, waited for; the answer's JSON text.
pub fn devtools(v: &Webview, method: &str, params: String, wait: Duration) -> Result<String, String> {
    #[cfg(windows)]
    {
        let method = method.to_string();
        on_engine(v, wait, move |c, tx| imp::devtools(c, &method, &params, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, method, params, wait);
        Err("page capture needs WebView2 (Windows)".into())
    }
}

/// T-251 (CLI-047): the engine prints a page to a PDF file at `path`, waited for.
pub fn print_pdf(v: &Webview, path: &str, wait: Duration) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let path = path.to_string();
        on_engine(v, wait, move |c, tx| imp::print_pdf(c, &path, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, path, wait);
        Err("printing needs WebView2 (Windows)".into())
    }
}

/// After-list 612: the page profile's cookies with each domain as stored, leading dot kept (the
/// cookie crate's getter drops it, so host-only and domain cookies could not be told apart).
pub fn cookies(v: &Webview, wait: Duration) -> Result<Vec<super::cookies::Entry>, String> {
    #[cfg(windows)]
    {
        on_engine(v, wait, imp::cookies)
    }
    #[cfg(not(windows))]
    {
        let _ = (v, wait);
        Err("cookies need WebView2 (Windows)".into())
    }
}

/// After-list 612: adds or replaces one cookie, host-only or for subdomains as its domain says.
pub fn set_cookie(v: &Webview, e: super::cookies::Entry, wait: Duration) -> Result<(), String> {
    #[cfg(windows)]
    {
        on_engine(v, wait, move |c, tx| imp::put_cookie(c, &e, false, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, e, wait);
        Err("cookies need WebView2 (Windows)".into())
    }
}

/// After-list 612: removes the cookie of that name, domain (dot kept) and path.
pub fn delete_cookie(v: &Webview, e: super::cookies::Entry, wait: Duration) -> Result<(), String> {
    #[cfg(windows)]
    {
        on_engine(v, wait, move |c, tx| imp::put_cookie(c, &e, true, tx))
    }
    #[cfg(not(windows))]
    {
        let _ = (v, e, wait);
        Err("cookies need WebView2 (Windows)".into())
    }
}

/// T-158 (BROW-024): after Stop Trusting, every open page's engine forgets the allowances it
/// remembered, so the next visit to a no-longer-trusted site is asked again.
pub fn clear_certificate_allowances(app: &AppHandle) {
    for t in super::tabs() {
        if let Ok(v) = super::view(app, t.id) {
            #[cfg(windows)]
            let _ = v.with_webview(|pw| imp::clear(&pw.controller()));
            #[cfg(not(windows))]
            let _ = v;
        }
    }
}
