//! T-240 (BROW-028) and BROW-029: cookies brought in from a file: a Netscape cookies.txt file
//! (see parse_netscape; the guided "Import from Google Chrome" ends here) or a JSON list in the
//! browser-extension export shape: `name`, `value`, `domain`, then optional `path`, `secure`,
//! `httpOnly`, `sameSite` and `expirationDate` (seconds; `expiry` and `expires` are read too). A
//! bad entry is skipped and named, a file with nothing usable is refused, and every site in the
//! file is replaced as a whole: its old cookies go, the file's come in, and a site that fails gets
//! its old cookies back. A Google sign-in never comes along (BROW-029): google.com and its
//! country domains are left out, YouTube is not, and nothing of Google's is deleted.

use serde::Serialize;
use serde_json::Value;
use tauri::webview::cookie::SameSite;

/// A cookie file larger than this is refused unread.
pub const FILE_MAX: u64 = 4 * 1024 * 1024;
/// How long one engine cookie call is waited for.
pub const COOKIE_WAIT: std::time::Duration = std::time::Duration::from_secs(15);
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

/// The file's text as entries plus the report of what was left out. A file that starts with `[`
/// or `{` is the JSON list; anything else is read as a Netscape cookies.txt file (the shape a
/// cookies.txt export extension writes from Chrome, which is how "Import from Google Chrome"
/// works: Chrome's own store is never opened). `Err` when the file as a whole is unusable.
pub fn parse(text: &str, now: i64) -> Result<(Vec<Entry>, Report), String> {
    let body = text.trim_start_matches('\u{feff}');
    match body.trim_start().chars().next() {
        None => Err("the file is empty".into()),
        Some('[' | '{') => parse_json(body, now),
        Some(_) => parse_netscape(body, now),
    }
}

/// A Netscape cookies.txt file: one cookie per line, seven tab-separated fields (domain,
/// include-subdomains TRUE/FALSE, path, secure TRUE/FALSE, expiry in seconds with 0 for a session
/// cookie, name, value). `#HttpOnly_` before the domain marks an HTTP-only cookie; other `#` lines
/// and blank lines are skipped; CRLF line ends are fine. A malformed line is skipped and named by
/// its line number (never by its value).
pub fn parse_netscape(text: &str, now: i64) -> Result<(Vec<Entry>, Report), String> {
    let mut out = Vec::new();
    let mut report = Report::default();
    let mut lines = 0;
    for (i, raw) in text.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.trim().is_empty() {
            continue;
        }
        let (line, http_only) = match line.strip_prefix("#HttpOnly_") {
            Some(rest) => (rest, true),
            None if line.starts_with('#') => continue,
            None => (line, false),
        };
        lines += 1;
        match netscape_entry(line, http_only, now) {
            Ok(e) if google_family(&e.domain) => report.google += 1,
            Ok(e) => out.push(e),
            Err(why) => {
                report.skipped += 1;
                if report.reasons.len() < REASONS_MAX {
                    report.reasons.push(format!("line {}: {why}", i + 1));
                }
            }
        }
    }
    if lines == 0 {
        return Err("the file holds no cookies: it is neither a JSON list of cookies nor a cookies.txt file with cookie lines".into());
    }
    if out.is_empty() {
        let google = if report.google > 0 { format!("; {} Google sign-in cookie(s) are never imported", report.google) } else { String::new() };
        return Err(format!("none of the {lines} cookie lines could be imported: {}{google}", report.reasons.join("; ")));
    }
    Ok((out, report))
}

fn netscape_entry(line: &str, http_only: bool, now: i64) -> Result<Entry, String> {
    let f: Vec<&str> = line.split('\t').collect();
    if f.len() != 7 {
        return Err(format!("{} tab-separated fields; a cookies.txt line has 7", f.len()));
    }
    let flag = |s: &str, what: &str| match s.trim().to_ascii_uppercase().as_str() {
        "TRUE" => Ok(true),
        "FALSE" => Ok(false),
        _ => Err(format!("the {what} flag is not TRUE or FALSE")),
    };
    let subdomains = flag(f[1], "include-subdomains")?;
    let secure = flag(f[3], "secure")?;
    let host = f[0].trim().trim_start_matches('.');
    let domain = if subdomains { format!(".{host}") } else { host.to_string() };
    let expiry: i64 = f[4].trim().parse().map_err(|_| "the expiry is not a whole number of seconds".to_string())?;
    if expiry < 0 {
        return Err("the expiry is not a whole number of seconds".into());
    }
    let mut o = serde_json::json!({ "name": f[5], "value": f[6], "domain": domain, "path": f[2], "secure": secure, "httpOnly": http_only });
    if expiry > 0 {
        o["expirationDate"] = expiry.into();
    }
    entry_of(&o, now)
}

fn parse_json(text: &str, now: i64) -> Result<(Vec<Entry>, Report), String> {
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

/// The domain WebView2's CreateCookie takes. A leading dot means "this host and its subdomains" and
/// none means "this host only"; the cookie crate's domain getter drops that dot, so the engine is
/// handed this text, not a `Cookie` (after-list 612).
pub fn engine_domain(e: &Entry) -> String {
    let host = e.domain.trim_start_matches('.').to_ascii_lowercase();
    if e.domain.starts_with('.') {
        format!(".{host}")
    } else {
        host
    }
}

/// Whether an engine cookie's domain (dotted or bare) belongs to `site` (a bare host).
pub fn in_site(domain: &str, site: &str) -> bool {
    domain.trim_start_matches('.').eq_ignore_ascii_case(site)
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

/// Puts the file's cookies into the tab's engine, one site at a time: the site's old cookies go
/// (host-only and domain ones alike), the new ones come in with their own scope; when a site fails
/// its old cookies are put back and the import stops there, naming the site. Blocking (the engine
/// answers on the main thread): called from an async command, never from the main thread.
pub fn apply(page: &tauri::Webview, entries: &[Entry], report: &mut Report) -> Result<(), String> {
    use super::engine;
    for (site, list) in by_site(entries) {
        let old: Vec<Entry> = engine::cookies(page, COOKIE_WAIT).map_err(|e| format!("the tab's cookies could not be read: {e}"))?.into_iter().filter(|c| in_site(&c.domain, site)).collect();
        let put_back = |done: &[Entry]| {
            for c in done {
                let _ = engine::delete_cookie(page, c.clone(), COOKIE_WAIT);
            }
            for c in &old {
                let _ = engine::set_cookie(page, c.clone(), COOKIE_WAIT);
            }
        };
        for c in &old {
            if let Err(e) = engine::delete_cookie(page, c.clone(), COOKIE_WAIT) {
                put_back(&[]);
                return Err(format!("{site}: an old cookie could not be replaced ({e}); its cookies were put back"));
            }
        }
        let mut done = Vec::new();
        for e in &list {
            if let Err(err) = engine::set_cookie(page, (*e).clone(), COOKIE_WAIT) {
                put_back(&done);
                return Err(format!("{site}: {} could not be set ({err}); its cookies were put back", e.name));
            }
            done.push((*e).clone());
        }
        report.imported += list.len();
        report.sites += 1;
    }
    Ok(())
}

/// T-319-b (BROW-030): browsers installed where their installers put them, named by the toolbar's
/// import hint. Only whether the program file exists is looked at: no profile, cookie store or
/// setting of theirs is ever opened.
const BROWSERS: [(&str, &str); 6] = [
    ("Google Chrome", r"Google\Chrome\Application\chrome.exe"),
    ("Microsoft Edge", r"Microsoft\Edge\Application\msedge.exe"),
    ("Brave", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
    ("Firefox", r"Mozilla Firefox\firefox.exe"),
    ("Vivaldi", r"Vivaldi\Application\vivaldi.exe"),
    ("Opera", r"Programs\Opera\opera.exe"),
];

/// The browsers whose program is under one of `roots`, in the table's order.
pub fn installed(roots: &[std::path::PathBuf], exists: impl Fn(&std::path::Path) -> bool) -> Vec<&'static str> {
    BROWSERS.iter().filter(|(_, rel)| roots.iter().any(|r| exists(&r.join(rel)))).map(|(name, _)| *name).collect()
}

#[tauri::command]
pub fn browser_import_sources() -> Vec<&'static str> {
    let roots: Vec<std::path::PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter().filter_map(std::env::var_os).map(Into::into).collect();
    installed(&roots, |p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow030_installed_browsers_are_named_from_their_program_file_alone() {
        let roots = [std::path::PathBuf::from("P"), std::path::PathBuf::from("L")];
        let have = [roots[1].join(r"Google\Chrome\Application\chrome.exe"), roots[0].join(r"Mozilla Firefox\firefox.exe")];
        assert_eq!(installed(&roots, |p| have.iter().any(|h| h == p)), vec!["Google Chrome", "Firefox"]);
        assert!(installed(&roots, |_| false).is_empty());
        assert!(installed(&[], |_| true).is_empty());
        assert_eq!(installed(&roots, |_| true).len(), BROWSERS.len());
    }

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
    }

    fn at(domain: &str) -> Entry {
        Entry { name: "n".into(), value: "v".into(), domain: domain.into(), path: "/".into(), secure: false, http_only: false, same_site: None, expires: None }
    }

    #[test]
    fn after612_host_only_and_domain_cookies_reach_the_engine_as_different_domains() {
        let text = ".example.test\tTRUE\t/\tFALSE\t0\ta\t1\nexample.test\tFALSE\t/\tFALSE\t0\tb\t2\n";
        let (entries, _) = parse_netscape(text, NOW).unwrap();
        assert_eq!((engine_domain(&entries[0]).as_str(), engine_domain(&entries[1]).as_str()), (".example.test", "example.test"));
        let json = r#"[{"name":"a","value":"1","domain":".Example.test"},{"name":"b","value":"2","domain":"example.test"}]"#;
        let (entries, _) = parse(json, NOW).unwrap();
        assert_eq!((engine_domain(&entries[0]).as_str(), engine_domain(&entries[1]).as_str()), (".example.test", "example.test"));
        assert_ne!(engine_domain(&at(".x.test")), engine_domain(&at("x.test")));
    }

    #[test]
    fn after612_a_stray_run_of_dots_keeps_one_and_a_bare_host_stays_bare() {
        assert_eq!(engine_domain(&at("..x.test")), ".x.test");
        assert_eq!(engine_domain(&at(".x.test")), ".x.test");
        assert_eq!(engine_domain(&at("x.test")), "x.test");
        assert_eq!(engine_domain(&at("X.Test")), "x.test");
    }

    #[test]
    fn after612_replacing_a_site_takes_both_kinds_and_nothing_of_a_look_alike() {
        let site = "example.test";
        assert!(in_site(".example.test", site));
        assert!(in_site("example.test", site));
        assert!(!in_site("notexample.test", site));
        assert!(!in_site(".sub.example.test", site));
        assert!(!in_site("example.test.evil", site));
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

    // Made-up fixture cookies only; no real browser profile or cookie file is ever read.
    #[test]
    fn brow028_a_cookies_txt_file_is_read_with_httponly_lines_comments_and_crlf() {
        let text = format!(
            "\u{feff}# Netscape HTTP Cookie File\r\n# made-up fixture\r\n\r\n.example.test\tTRUE\t/\tTRUE\t{}\tsid\tfixture-1\r\n#HttpOnly_shop.example.test\tFALSE\t/cart\tFALSE\t0\tcart\tfixture-2\r\nother.test\tTRUE\t/\tFALSE\t0\tempty\t\n",
            NOW + 60
        );
        let (entries, report) = parse(&text, NOW).unwrap();
        assert_eq!(report, Report::default());
        assert_eq!(entries[0], Entry { name: "sid".into(), value: "fixture-1".into(), domain: ".example.test".into(), path: "/".into(), secure: true, http_only: false, same_site: None, expires: Some(NOW + 60) });
        assert_eq!(entries[1], Entry { name: "cart".into(), value: "fixture-2".into(), domain: "shop.example.test".into(), path: "/cart".into(), secure: false, http_only: true, same_site: None, expires: None });
        assert_eq!((entries[2].domain.as_str(), entries[2].value.as_str(), entries[2].expires), (".other.test", "", None));
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn brow028_malformed_cookies_txt_lines_are_counted_and_named_by_line_never_by_value() {
        let text = format!(
            "# Netscape HTTP Cookie File\n\
             a.test\tTRUE\t/\tFALSE\t0\tok\tfixture-ok\n\
             a.test\tTRUE\t/\tFALSE\t0\tshort-secret\n\
             a.test\tMAYBE\t/\tFALSE\t0\tn\tfixture-secret-1\n\
             a.test\tTRUE\t/\tFALSE\tsoon\tn\tfixture-secret-2\n\
             a.test\tTRUE\t/\tFALSE\t{}\told\tfixture-secret-3\n\
             a.test\tTRUE\tnoslash\tFALSE\t0\tn\tfixture-secret-4\n\
             a.test\tTRUE\t/\tFALSE\t0\tbad name\tfixture-secret-5\n\
             .google.com\tTRUE\t/\tTRUE\t0\tSID\tfixture-g\n",
            NOW - 1
        );
        let (entries, report) = parse(&text, NOW).unwrap();
        assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["ok"]);
        assert_eq!((report.skipped, report.google), (6, 1));
        assert_eq!(
            report.reasons,
            vec![
                "line 3: 6 tab-separated fields; a cookies.txt line has 7",
                "line 4: the include-subdomains flag is not TRUE or FALSE",
                "line 5: the expiry is not a whole number of seconds",
                "line 6: old has expired",
                "line 7: the path \"noslash\" must start with /",
                "line 8: the name \"bad name\" is not a cookie name",
            ]
        );
        assert!(report.reasons.iter().all(|r| !r.contains("fixture") && !r.contains("secret")), "{:?}", report.reasons);
        let none = parse("# only a comment\r\nx.test\tTRUE\t/\tFALSE\t0\tn\n", NOW).unwrap_err();
        assert_eq!(none, "none of the 1 cookie lines could be imported: line 2: 6 tab-separated fields; a cookies.txt line has 7");
        assert!(parse("# Netscape HTTP Cookie File\n\n", NOW).unwrap_err().starts_with("the file holds no cookies"));
        assert_eq!(parse("\u{feff}  \r\n", NOW).unwrap_err(), "the file is empty");
        assert!(parse("[]", NOW).is_err(), "a JSON file still takes the JSON path");
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
