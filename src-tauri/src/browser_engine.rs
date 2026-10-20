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
use tauri::AppHandle;

#[cfg(windows)]
mod imp {
    use crate::browser::certs;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{ClearServerCertificateErrorActionsCompletedHandler, ServerCertificateErrorDetectedEventHandler};
    use windows::core::{Interface, PWSTR};
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
}

/// Hooks a new page's engine events (main thread, from `browser_open`'s web view callback).
#[cfg(windows)]
pub fn attach(id: u32, pw: &tauri::webview::PlatformWebview) {
    imp::attach(id, &pw.controller());
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
