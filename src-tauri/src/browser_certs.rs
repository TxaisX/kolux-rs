//! T-158 (BROW-024): trusting a self-signed certificate on a local dev server. The rules, kept
//! apart from the engine: approval is offered only for this computer's own addresses, it covers
//! that host and port alone, it is offered only while a matching certificate challenge is pending
//! (an error restored after a restart cannot be approved), only the app sends it (an app command,
//! never the page), and an approved address that later shows a different bad certificate is
//! refused again until approved again. Approvals are revocable and last for the run.
//!
//! The engine side (answering WebView2's server-certificate-error event) needs that event's COM
//! interface, reachable only through the webview2-com crate as a direct dependency; until then the
//! failure overlay offers no approval and every address keeps strict checks (PLAN T-158 note).
use super::popup::loopback;
use std::collections::HashMap;
use tauri::Url;

/// One host and port, as approved.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Site {
    pub host: String,
    pub port: u16,
}

impl Site {
    /// The https site of an address on this computer; `None` for anything else.
    pub fn local(url: &Url) -> Option<Site> {
        if url.scheme() != "https" {
            return None;
        }
        let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
        if !loopback(&host) {
            return None;
        }
        Some(Site { host, port: url.port_or_known_default()? })
    }
}

/// The certificate rules for one run.
#[derive(Default)]
pub struct Trust {
    /// tab id -> the challenge the engine raised and has not had answered (site, fingerprint)
    pending: HashMap<u32, (Site, String)>,
    /// site -> the one certificate fingerprint the user approved for it
    approved: HashMap<Site, String>,
}

/// What the engine is told for a certificate error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    /// The user approved this exact certificate for this site: load it.
    Allow,
    /// Strict checks: the failure overlay shows; `offer` says whether it may show Approve.
    Refuse { offer: bool },
}

impl Trust {
    /// The engine reports a bad certificate for `url` in `tab`.
    pub fn challenge(&mut self, tab: u32, url: &Url, fingerprint: &str) -> Answer {
        let Some(site) = Site::local(url) else {
            self.pending.remove(&tab);
            return Answer::Refuse { offer: false };
        };
        if self.approved.get(&site).map(String::as_str) == Some(fingerprint) {
            self.pending.remove(&tab);
            return Answer::Allow;
        }
        // A different bad certificate on an approved site is refused until approved again.
        self.approved.remove(&site);
        self.pending.insert(tab, (site, fingerprint.to_string()));
        Answer::Refuse { offer: true }
    }

    /// The user pressed Approve on the overlay of `tab` for `url`. Only a pending challenge for that
    /// exact site can be approved.
    pub fn approve(&mut self, tab: u32, url: &Url) -> Result<(), String> {
        let site = Site::local(url).ok_or("only an https address on this computer can be trusted")?;
        match self.pending.get(&tab) {
            Some((s, fp)) if *s == site => {
                self.approved.insert(site, fp.clone());
                self.pending.remove(&tab);
                Ok(())
            }
            _ => Err("no certificate challenge is waiting for this address; retry the page first".into()),
        }
    }

    /// The user takes the trust back; the next visit shows the failure again.
    pub fn revoke(&mut self, url: &Url) -> bool {
        Site::local(url).is_some_and(|s| self.approved.remove(&s).is_some())
    }

    /// A tab closed or navigated away: its challenge can no longer be answered.
    pub fn forget(&mut self, tab: u32) {
        self.pending.remove(&tab);
    }

    pub fn approved(&self) -> Vec<Site> {
        self.approved.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn brow024_approval_covers_one_local_host_and_port_and_no_other_tab_or_port() {
        let mut t = Trust::default();
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "AA"), Answer::Refuse { offer: true });
        t.approve(1, &u("https://localhost:8443/app")).unwrap();
        assert_eq!(t.challenge(1, &u("https://localhost:8443/other"), "AA"), Answer::Allow);
        // another tab on the same site with the same certificate: the approval is the site's
        assert_eq!(t.challenge(2, &u("https://localhost:8443/"), "AA"), Answer::Allow);
        // another port stays strict
        assert_eq!(t.challenge(1, &u("https://localhost:9443/"), "AA"), Answer::Refuse { offer: true });
        assert_eq!(t.approved(), vec![Site { host: "localhost".into(), port: 8443 }]);
    }

    #[test]
    fn brow024_public_hosts_and_lookalikes_are_never_offered() {
        let mut t = Trust::default();
        for a in ["https://example.com/", "https://localhost.example.com/", "https://10.0.0.2/", "http://localhost:8080/"] {
            assert_eq!(t.challenge(1, &u(a), "AA"), Answer::Refuse { offer: false }, "{a}");
            assert!(t.approve(1, &u(a)).is_err(), "{a}");
        }
        assert_eq!(t.challenge(1, &u("https://127.0.0.1:8443/"), "AA"), Answer::Refuse { offer: true });
        assert_eq!(t.challenge(1, &u("https://[::1]:8443/"), "AA"), Answer::Refuse { offer: true });
    }

    #[test]
    fn brow024_no_approval_without_a_pending_challenge_for_that_site() {
        let mut t = Trust::default();
        // an overlay restored after a restart: nothing pending
        assert!(t.approve(1, &u("https://localhost:8443/")).is_err());
        t.challenge(1, &u("https://localhost:8443/"), "AA");
        // a different site than the one challenged
        assert!(t.approve(1, &u("https://localhost:9443/")).is_err());
        // the tab navigated away or closed
        t.forget(1);
        assert!(t.approve(1, &u("https://localhost:8443/")).is_err());
    }

    #[test]
    fn brow024_a_different_bad_certificate_is_refused_again_and_trust_can_be_revoked() {
        let mut t = Trust::default();
        t.challenge(1, &u("https://localhost:8443/"), "AA");
        t.approve(1, &u("https://localhost:8443/")).unwrap();
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "BB"), Answer::Refuse { offer: true });
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "AA"), Answer::Refuse { offer: true }, "the old approval is gone");
        t.approve(1, &u("https://localhost:8443/")).unwrap();
        assert!(t.revoke(&u("https://localhost:8443/x")));
        assert!(!t.revoke(&u("https://localhost:8443/x")));
        assert_eq!(t.challenge(1, &u("https://localhost:8443/"), "AA"), Answer::Refuse { offer: true });
    }
}
