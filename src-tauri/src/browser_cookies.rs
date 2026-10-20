//! T-240 (BROW-028) and BROW-029: cookies brought in from a file. The file is a JSON list in the
//! browser-extension export shape: `name`, `value`, `domain`, then optional `path`, `secure`,
//! `httpOnly`, `sameSite` and `expirationDate` (seconds; `expiry` and `expires` are read too). A
//! bad entry is skipped and named, a file with nothing usable is refused, and every site in the
//! file is replaced as a whole: its old cookies go, the file's come in, and a site that fails gets
//! its old cookies back. A Google sign-in never comes along (BROW-029): google.com and its
//! country domains are left out, YouTube is not, and nothing of Google's is deleted.

use serde::Serialize;
use serde_json::Value;
use tauri::webview::cookie::{time::OffsetDateTime, Cookie, SameSite};

/// A cookie file larger than this is refused unread.
pub const FILE_MAX: u64 = 4 * 1024 * 1024;
/// Reasons kept in the report (the count is kept whole).
const REASONS_MAX: usize = 10;

#[derive(Debug, Default, Serialize, PartialEq)]
pub struct Report {
    pub imported: usize,
    pub sites: usize,
    pub skipped: usize,
    pub google: usize,
    pub reasons: Vec<String>,
}

/// One entry of the file, checked.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<SameSite>,
    pub expires: Option<i64>,
}

/// The file's text as entries plus the report of what was left out. `Err` when the file as a
/// whole is unusable: not JSON, not a list, empty, or nothing in it passes.
pub fn parse(text: &str, now: i64) -> Result<(Vec<Entry>, Report), String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("the file is not JSON ({e})"))?;
    let Value::Array(list) = v else {
        return Err("the file is not a JSON list of cookies".into());
    };
    if list.is_empty() {
        return Err("the file holds an empty list".into());
    }
    let mut out = Vec::new();
    let mut report = Report::default();
    for (i, item) in list.iter().enumerate() {
        match entry_of(item, now) {
            Ok(e) if google_family(&e.domain) => report.google += 1,
            Ok(e) => out.push(e),
            Err(why) => {
                report.skipped += 1;
                if report.reasons.len() < REASONS_MAX {
                    report.reasons.push(format!("entry {}: {why}", i + 1));
                }
            }
        }
    }
    if out.is_empty() {
        let google = if report.google > 0 { format!("; {} Google sign-in cookie(s) are never imported", report.google) } else { String::new() };
        return Err(format!("none of the {} entries could be imported: {}{google}", list.len(), report.reasons.join("; ")));
    }
    Ok((out, report))
}

fn entry_of(item: &Value, now: i64) -> Result<Entry, String> {
    let Value::Object(o) = item else {
        return Err("not an object".into());
    };
    let text = |k: &str| o.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
    let flag = |k: &str| o.get(k).and_then(Value::as_bool).unwrap_or(false);
    let name = text("name").ok_or("no name")?;
    if name.chars().any(|c| c.is_control() || c.is_whitespace() || matches!(c, ';' | '=' | ',' | '"')) {
        return Err(format!("the name {name:?} is not a cookie name"));
    }
    let value = o.get("value").and_then(Value::as_str).ok_or("no value")?;
    if value.chars().any(|c| c.is_control() || c == ';') {
        return Err(format!("the value of {name} holds a control character or semicolon"));
    }
    let domain = text("domain").ok_or("no domain")?.to_ascii_lowercase();
    if domain.chars().any(|c| c.is_whitespace() || matches!(c, '/' | ':' | ';' | '\\' | '@')) || domain.trim_start_matches('.').is_empty() {
        return Err(format!("the domain {domain:?} is not a host name"));
    }
    let path = text("path").unwrap_or("/");
    if !path.starts_with('/') || path.chars().any(|c| c.is_control() || c == ';') {
        return Err(format!("the path {path:?} must start with /"));
    }
    let same_site = match text("sameSite").map(str::to_ascii_lowercase).as_deref() {
        None | Some("unspecified") | Some("") => None,
        Some("strict") => Some(SameSite::Strict),
        Some("lax") => Some(SameSite::Lax),
        Some("none") | Some("no_restriction") => Some(SameSite::None),
        Some(other) => return Err(format!("sameSite {other:?} is not strict, lax or none")),
    };
    let expires = ["expirationDate", "expiry", "expires"].iter().find_map(|k| o.get(*k)).filter(|v| !v.is_null());
    let expires = match expires {
        None => None,
        Some(v) => {
            let secs = v.as_f64().ok_or("the expiry is not a number of seconds")?;
            if !secs.is_finite() || secs <= 0.0 {
                return Err("the expiry is not a number of seconds".into());
            }
            if (secs as i64) <= now {
                return Err(format!("{name} has expired"));
            }
            Some(secs as i64)
        }
    };
    Ok(Entry { name: name.into(), value: value.into(), domain, path: path.into(), secure: flag("secure"), http_only: flag("httpOnly"), same_site, expires })
}

/// BROW-029: google.com and its country forms (google.de, google.co.uk, google.com.au) with every
/// host under them; YouTube and the other Google-owned names are not in the family.
pub fn google_family(domain: &str) -> bool {
    let labels: Vec<&str> = domain.trim_start_matches('.').split('.').collect();
    let Some(i) = labels.iter().position(|l| *l == "google") else {
        return false;
    };
    match &labels[i + 1..] {
        ["com"] => true,
        [cc] => cc.len() == 2,
        ["co" | "com", cc] => cc.len() == 2,
        _ => false,
    }
}

/// T-158 (BROW-029): an import from an installed browser asks for that browser's decryption key
/// only when a row it keeps is encrypted, so Google rows (dropped first) never cause the question.
/// The installed-browser import itself waits for Txais (PLAN T-240).
#[allow(dead_code)]
pub fn needs_key<'a>(rows: impl IntoIterator<Item = (&'a str, bool)>) -> bool {
    rows.into_iter().any(|(domain, encrypted)| encrypted && !google_family(domain))
}

/// The entry as the engine takes it; without an expiry the cookie lasts the session.
pub fn cookie_of(e: &Entry) -> Cookie<'static> {
    let mut b = Cookie::build((e.name.clone(), e.value.clone())).domain(e.domain.clone()).path(e.path.clone()).secure(e.secure).http_only(e.http_only);
    if let Some(s) = e.same_site {
        b = b.same_site(s);
    }
    if let Some(at) = e.expires.and_then(|s| OffsetDateTime::from_unix_timestamp(s).ok()) {
        b = b.expires(at);
    }
    b.build()
}

/// The entries grouped by site, in the file's order.
pub fn by_site(entries: &[Entry]) -> Vec<(&str, Vec<&Entry>)> {
    let mut sites: Vec<(&str, Vec<&Entry>)> = Vec::new();
    for e in entries {
        let key = e.domain.trim_start_matches('.');
        match sites.iter_mut().find(|(d, _)| *d == key) {
            Some((_, list)) => list.push(e),
            None => sites.push((key, vec![e])),
        }
    }
    sites
}

/// Puts the file's cookies into the tab's engine, one site at a time: the site's old cookies go,
/// the new ones come in; when a site fails its old cookies are put back and the import stops
/// there, naming the site. Blocking (the engine answers on the main thread): called from an
/// async command, never from the main thread.
pub fn apply(page: &tauri::Webview, entries: &[Entry], report: &mut Report) -> Result<(), String> {
    for (site, list) in by_site(entries) {
        let old: Vec<Cookie<'static>> = page.cookies().map_err(|e| format!("the tab's cookies could not be read: {e}"))?.into_iter().filter(|c| c.domain().is_some_and(|d| d.trim_start_matches('.') == site)).collect();
        let put_back = |done: &[Cookie<'static>]| {
            for c in done {
                let _ = page.delete_cookie(c.clone());
            }
            for c in &old {
                let _ = page.set_cookie(c.clone());
            }
        };
        for c in &old {
            if let Err(e) = page.delete_cookie(c.clone()) {
                put_back(&[]);
                return Err(format!("{site}: an old cookie could not be replaced ({e}); its cookies were put back"));
            }
        }
        let mut done = Vec::new();
        for e in &list {
            let c = cookie_of(e);
            if let Err(err) = page.set_cookie(c.clone()) {
                put_back(&done);
                return Err(format!("{site}: {} could not be set ({err}); its cookies were put back", e.name));
            }
            done.push(c);
        }
        report.imported += list.len();
        report.sites += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    #[test]
    fn brow028_the_file_must_be_a_non_empty_json_list_and_bad_entries_are_skipped_and_named() {
        assert!(parse("{not json", NOW).unwrap_err().starts_with("the file is not JSON"));
        assert_eq!(parse(r#"{"name":"a"}"#, NOW).unwrap_err(), "the file is not a JSON list of cookies");
        assert_eq!(parse("[]", NOW).unwrap_err(), "the file holds an empty list");
        let all_bad = parse(r#"[{"name":"a"}, 5, {"name":"b","value":"1","domain":"x.test","expirationDate":1}]"#, NOW).unwrap_err();
        assert!(all_bad.starts_with("none of the 3 entries could be imported: entry 1: no value; entry 2: not an object; entry 3: b has expired"), "{all_bad}");
        let text = format!(
            r#"[{{"name":"sid","value":"v1","domain":".example.test","path":"/app","secure":true,"httpOnly":true,"sameSite":"lax","expirationDate":{}}},
                {{"name":"bad name","value":"x","domain":"example.test"}},
                {{"name":"s","value":"x","domain":"example.test","sameSite":"weird"}},
                {{"name":"plain","value":"","domain":"Other.Test"}}]"#,
            NOW + 60
        );
        let (entries, report) = parse(&text, NOW).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0], Entry { name: "sid".into(), value: "v1".into(), domain: ".example.test".into(), path: "/app".into(), secure: true, http_only: true, same_site: Some(SameSite::Lax), expires: Some(NOW + 60) });
        assert_eq!(entries[1], Entry { name: "plain".into(), value: String::new(), domain: "other.test".into(), path: "/".into(), secure: false, http_only: false, same_site: None, expires: None });
        assert_eq!((report.skipped, report.google, report.imported), (2, 0, 0));
        assert_eq!(report.reasons, vec!["entry 2: the name \"bad name\" is not a cookie name", "entry 3: sameSite \"weird\" is not strict, lax or none"]);
        let c = cookie_of(&entries[0]);
        assert_eq!((c.name(), c.value(), c.domain(), c.path(), c.secure(), c.http_only(), c.same_site()), ("sid", "v1", Some("example.test"), Some("/app"), Some(true), Some(true), Some(SameSite::Lax)));
        assert_eq!(c.expires_datetime().map(|t| t.unix_timestamp()), Some(NOW + 60));
        assert_eq!(cookie_of(&entries[1]).expires(), None);
    }

    #[test]
    fn brow029_google_sign_ins_are_left_out_youtube_is_kept() {
        for d in ["google.com", ".google.com", "accounts.google.com", "google.de", "google.co.uk", "www.google.com.au", "mail.google.fr"] {
            assert!(google_family(d), "{d}");
        }
        for d in ["youtube.com", ".youtube.com", "googleusercontent.com", "googleapis.com", "google.example.test", "notgoogle.com", "google.community"] {
            assert!(!google_family(d), "{d}");
        }
        let text = r#"[{"name":"SID","value":"g","domain":".google.com"},{"name":"LOGIN_INFO","value":"y","domain":".youtube.com"}]"#;
        let (entries, report) = parse(text, NOW).unwrap();
        assert_eq!(entries.iter().map(|e| e.domain.as_str()).collect::<Vec<_>>(), vec![".youtube.com"]);
        assert_eq!((report.google, report.skipped), (1, 0));
        let only_google = parse(r#"[{"name":"SID","value":"g","domain":"google.com"}]"#, NOW).unwrap_err();
        assert!(only_google.ends_with("; 1 Google sign-in cookie(s) are never imported"), "{only_google}");
    }

    #[test]
    fn brow028_sites_are_replaced_as_a_whole_in_the_files_order() {
        let text = r#"[{"name":"a","value":"1","domain":".b.test"},{"name":"c","value":"1","domain":"a.test"},{"name":"d","value":"1","domain":"b.test"}]"#;
        let (entries, _) = parse(text, NOW).unwrap();
        let sites = by_site(&entries);
        assert_eq!(sites.iter().map(|(d, l)| (*d, l.len())).collect::<Vec<_>>(), vec![("b.test", 2), ("a.test", 1)]);
    }

    #[test]
    fn brow029_no_decryption_key_is_asked_for_google_rows_alone() {
        assert!(!needs_key([(".google.com", true), ("accounts.google.co.uk", true), ("github.com", false)]));
        assert!(needs_key([(".google.com", true), ("github.com", true)]));
        assert!(needs_key([(".youtube.com", true)]), "YouTube still comes across");
        assert!(needs_key([("google.com.evil.io", true)]), "a lookalike is not Google");
        assert!(!needs_key(std::iter::empty()));
    }
}
