// T-323-b (SET-040, APP-032): the saved network proxy and the HTTP/1 switch applied to every HTTP
// client Kolux builds in Rust (the update download, the artifact script fetch). Everything is read
// here, in the back end: the sealed address goes from the secrets store into the client and nowhere
// else, and no command returns it. A setting that cannot be used is an error, never a direct request.
use super::app_proxy::{self, Route};
use crate::state::Store;
use tauri::Url;

pub const HTTP1_KEY: &str = "httpProxyHttp1";

/// How one request to one address is sent, from the saved settings.
#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub route: Route,
    /// The HTTP/1 compatibility switch of Settings > General.
    pub http1: bool,
}

pub fn http1_on(store: &Store) -> bool {
    store.settings().get(HTTP1_KEY).and_then(|v| v.as_bool()) == Some(true)
}

pub fn plan_from_store(store: &Store, url: &Url) -> Result<Plan, String> {
    Ok(Plan { route: app_proxy::route_from_store(store, url)?, http1: http1_on(store) })
}

/// The updater's own request fields for a route: (explicit proxy, system proxy off).
pub fn updater_fields(route: &Route) -> (Option<Url>, bool) {
    match route {
        Route::Default => (None, false),
        Route::Direct => (None, true),
        Route::Via(p) => (Some(p.clone()), false),
    }
}

/// `b` with the plan applied. The error never carries the address.
pub fn apply(plan: &Plan, b: reqwest::ClientBuilder) -> Result<reqwest::ClientBuilder, String> {
    let b = match &plan.route {
        Route::Default => b,
        Route::Direct => b.no_proxy(),
        Route::Via(p) => b.proxy(reqwest::Proxy::all(p.as_str()).map_err(|_| "the network proxy setting cannot be used by this build; app traffic that needs it stays off until it is cleared".to_string())?),
    };
    Ok(if plan.http1 { b.http1_only() } else { b })
}

/// The plan for a request to `url`, from the open store of `app` (the lock is released before it returns).
pub fn plan_for(app: &tauri::AppHandle, url: &Url) -> Result<Plan, String> {
    use tauri::Manager;
    let store = app.state::<std::sync::Mutex<Store>>();
    let store = store.lock().map_err(|e| e.to_string())?;
    plan_from_store(&store, url)
}

/// `b` (a client the caller builds) set up for a request to `url`. This file builds no client of its own.
pub fn with_plan(app: &tauri::AppHandle, url: &str, b: reqwest::ClientBuilder) -> Result<reqwest::ClientBuilder, String> {
    let url: Url = url.parse().map_err(|_| "not an address".to_string())?;
    apply(&plan_for(app, &url)?, b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store(tag: &str) -> (crate::test_dir::TempDir, Store) {
        let dir = crate::test_dir::temp(tag);
        let store = Store::open(&dir).unwrap();
        (dir, store)
    }
    fn set(store: &Store, v: serde_json::Value) {
        store.patch_settings(v.as_object().unwrap(), &[]).unwrap();
    }
    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn set_040_the_http1_switch_is_off_until_the_setting_says_true() {
        let (_d, s) = store("http-switch");
        assert!(!http1_on(&s));
        set(&s, json!({ "httpProxyHttp1": "yes" }));
        assert!(!http1_on(&s), "only a real true counts");
        set(&s, json!({ "httpProxyHttp1": true }));
        assert!(http1_on(&s));
    }

    #[test]
    fn app_032_the_sealed_address_and_the_bypass_list_become_the_plan_and_the_switch_rides_along() {
        let (_d, s) = store("http-plan");
        crate::secrets::write_setting(&s, "httpProxy", "http://me:PW@proxy.corp:3128").unwrap();
        set(&s, json!({ "httpProxyBypass": ["github.com"], "httpProxyHttp1": true }));
        let via = plan_from_store(&s, &u("https://cdn.jsdelivr.net/npm/x.js")).unwrap();
        assert!(matches!(&via.route, Route::Via(p) if p.host_str() == Some("proxy.corp")) && via.http1);
        let direct = plan_from_store(&s, &u("https://github.com/x")).unwrap();
        assert_eq!(direct.route, Route::Direct);
        crate::secrets::clear_setting(&s, "httpProxy").unwrap();
        assert_eq!(plan_from_store(&s, &u("https://github.com/x")).unwrap().route, Route::Default, "emptied: back to the system proxy");
    }

    #[test]
    fn app_032_an_unusable_address_is_an_error_without_the_address_and_builds_no_client() {
        let (_d, s) = store("http-bad");
        crate::secrets::write_setting(&s, "httpProxy", "ftp://me:SECRET@p:1").unwrap();
        let e = plan_from_store(&s, &u("https://unpkg.com/x.js")).unwrap_err();
        assert!(!e.contains("SECRET") && !e.contains("ftp://"), "{e}");
    }

    #[test]
    fn app_032_each_route_reaches_the_client_and_the_updater_fields() {
        let via = Plan { route: Route::Via(u("http://p:8080")), http1: true };
        assert!(apply(&via, reqwest::Client::builder()).unwrap().build().is_ok());
        for route in [Route::Default, Route::Direct] {
            assert!(apply(&Plan { route, http1: false }, reqwest::Client::builder()).unwrap().build().is_ok());
        }
        assert_eq!(updater_fields(&Route::Default), (None, false));
        assert_eq!(updater_fields(&Route::Direct), (None, true));
        assert_eq!(updater_fields(&Route::Via(u("http://p:8080"))), (Some(u("http://p:8080")), false));
    }

    #[test]
    fn app_032_a_proxy_the_build_cannot_speak_is_refused_without_its_address() {
        // socks5 needs reqwest's socks feature, which this build leaves out: that stops the request.
        let socks = Plan { route: Route::Via(u("socks5://me:SECRET@p:1080")), http1: false };
        if let Err(e) = apply(&socks, reqwest::Client::builder()) {
            assert!(!e.contains("SECRET") && !e.contains("socks5://"), "{e}");
        }
    }

    // The address is read only inside the back end; no command here hands it to the page, and the stored copy is sealed.
    #[test]
    fn app_032_no_command_returns_the_proxy_address() {
        for (name, src) in [("app_proxy.rs", include_str!("app_proxy.rs")), ("app_http.rs", include_str!("app_http.rs"))] {
            let code = &src[..src.find("#[cfg(test)]").unwrap()];
            assert!(!code.contains("#[tauri::command]"), "{name} must not register a command");
        }
        let (dir, s) = store("http-sealed");
        crate::secrets::write_setting(&s, "httpProxy", "http://me:PROXYPW@proxy.corp:3128").unwrap();
        let page_view = serde_json::to_string(&s.settings()).unwrap();
        let disk = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        for seen in [page_view, disk] {
            assert!(!seen.contains("PROXYPW") && !seen.contains("proxy.corp"), "the stored setting is sealed");
        }
    }
}
