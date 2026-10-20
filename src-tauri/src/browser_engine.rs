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
use std::time::Duration;
use tauri::{AppHandle, Webview};

#[cfg(windows)]
mod imp {
    use crate::browser::certs;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use std::sync::mpsc::Sender;
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, ClearServerCertificateErrorActionsCompletedHandler, PrintToPdfCompletedHandler, ServerCertificateErrorDetectedEventHandler};
    use windows::core::{Interface, HSTRING, PWSTR};
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
}

/// Hooks a new page's engine events (main thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn attach(id: u32, pw: &tauri::webview::PlatformWebview) {
    imp::attach(id, &pw.controller());
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
