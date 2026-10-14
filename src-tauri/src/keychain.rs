//! ACCT-005's macOS keychain rules for a managed Claude sign-in (T-043-e), and CLI-014's put-back of
//! the user's own keychain login when `kolux account add` is interrupted.
//!
//! Claude Code's public docs (code.claude.com/docs/en/authentication, "Credential management", read
//! 2026-10-13) say that on macOS the login lives in the login keychain, that with `CLAUDE_CONFIG_DIR`
//! set the keychain entry is keyed to that folder (so every managed account's folder has an entry of
//! its own), and that when the keychain refuses the write the login goes to `.credentials.json` in
//! the folder instead. Older Claude builds kept one shared entry whatever the folder, so a sign-in
//! for a second account replaced the user's own login there. These functions are the rule table over
//! a `Keychain`; the names of both entries come in from the caller, because the docs do not give
//! them. ponytail: no `security`-backed keychain and no wiring into `sign_in` yet; both need a Mac to
//! read the entry names from a real Claude Code and to prove live (T-043-f, DECISIONS.md DT-C18).

/// A keychain entry's secret and when it was last written (ms since the epoch).
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub secret: String,
    pub written: i64,
}

/// The login keychain, by service name.
pub trait Keychain {
    fn read(&self, service: &str) -> Option<Item>;
    fn write(&mut self, service: &str, secret: &str) -> Result<(), String>;
    fn delete(&mut self, service: &str) -> Result<(), String>;
}

/// The two entries that matter for one account.
pub struct Entries<'a> {
    /// The older shared entry Claude Code used whatever the folder; the user's own login sits here.
    pub shared: &'a str,
    /// The entry keyed to this account's own configuration folder.
    pub account: &'a str,
}

/// Both entries as they were before the browser step.
#[derive(Clone, Debug, Default)]
pub struct Before {
    pub shared: Option<Item>,
    pub account: Option<Item>,
}

pub fn before(kc: &dyn Keychain, e: &Entries) -> Before {
    Before { shared: kc.read(e.shared), account: kc.read(e.account) }
}

/// The account's credentials as they stand: its own entry, else the older shared one.
pub fn current(kc: &dyn Keychain, e: &Entries) -> Option<Item> {
    kc.read(e.account).or_else(|| kc.read(e.shared))
}

fn secret(i: &Option<Item>) -> Option<&str> {
    i.as_ref().map(|i| i.secret.as_str())
}

/// What the login produced, if Kolux may take it: the account's own entry when it changed; with
/// that entry absent, only a shared entry that changed (older builds); never credentials identical
/// to those there before. When the keychain copy and the folder's file copy (`file`, with the file
/// as it was before in `file_before`) disagree, the newer one wins; a tie goes to the keychain.
pub fn pick(kc: &dyn Keychain, e: &Entries, was: &Before, file: Option<Item>, file_before: Option<&str>) -> Option<String> {
    let changed = |now: Option<Item>, then: Option<&str>| now.filter(|n| !n.secret.trim().is_empty() && Some(n.secret.as_str()) != then);
    let keychain = match kc.read(e.account) {
        Some(own) => changed(Some(own), secret(&was.account)),
        None => changed(kc.read(e.shared), secret(&was.shared)),
    };
    match (keychain, changed(file, file_before)) {
        (Some(k), Some(f)) if f.written > k.written => Some(f.secret),
        (Some(k), _) => Some(k.secret),
        (None, f) => f.map(|f| f.secret),
    }
}

/// Puts the shared entry back as it was before the browser step (the user's own Claude login).
pub fn put_back_shared(kc: &mut dyn Keychain, e: &Entries, was: &Before) -> Result<(), String> {
    restore(kc, e.shared, &was.shared)
}

/// After a cancelled or failed add or re-authentication (and an interrupted `kolux account add`):
/// the shared entry and the account's own entry go back to what they were; a new one is removed.
pub fn undo(kc: &mut dyn Keychain, e: &Entries, was: &Before) -> Result<(), String> {
    let shared = put_back_shared(kc, e, was);
    restore(kc, e.account, &was.account).and(shared)
}

fn restore(kc: &mut dyn Keychain, service: &str, then: &Option<Item>) -> Result<(), String> {
    if secret(&kc.read(service)) == secret(then) {
        return Ok(());
    }
    match then {
        Some(t) => kc.write(service, &t.secret),
        None => kc.delete(service),
    }
}

/// The whole step after the browser: pick the new credentials, put the user's own shared login
/// back, and keep the new ones in the account's own entry. Any failure undoes the keychain and the
/// add fails; a shared login that cannot be put back fails it rather than leaving it replaced.
pub fn after_login(kc: &mut dyn Keychain, e: &Entries, was: &Before, file: Option<Item>, file_before: Option<&str>) -> Result<String, String> {
    let fresh = pick(kc, e, was, file, file_before);
    let why = match (put_back_shared(kc, e, was), fresh) {
        (Err(why), _) => format!("Your own Claude sign-in in the keychain could not be put back, so nothing was added: {why}"),
        (Ok(()), None) => "The sign-in left no new credentials, so nothing was added.".into(),
        (Ok(()), Some(fresh)) => match kc.write(e.account, &fresh) {
            Ok(()) => return Ok(fresh),
            Err(why) => format!("The new sign-in could not be kept in the keychain: {why}"),
        },
    };
    let _ = undo(kc, e, was);
    Err(why)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// An invented keychain: entries in memory, a clock that ticks on every write, and a switch
    /// that makes it refuse writes (a locked keychain).
    #[derive(Default)]
    struct Fake {
        items: HashMap<String, Item>,
        clock: i64,
        locked: bool,
    }
    impl Keychain for Fake {
        fn read(&self, service: &str) -> Option<Item> {
            self.items.get(service).cloned()
        }
        fn write(&mut self, service: &str, secret: &str) -> Result<(), String> {
            if self.locked {
                return Err("the keychain is locked".into());
            }
            self.clock += 1;
            self.items.insert(service.into(), Item { secret: secret.into(), written: self.clock });
            Ok(())
        }
        fn delete(&mut self, service: &str) -> Result<(), String> {
            if self.locked {
                return Err("the keychain is locked".into());
            }
            self.items.remove(service);
            Ok(())
        }
    }
    const E: Entries = Entries { shared: "shared-entry", account: "entry-for-folder-a1" };
    fn own_login() -> Fake {
        let mut kc = Fake::default();
        kc.write(E.shared, "users-own-login").unwrap();
        kc
    }
    fn secret_of(kc: &Fake, s: &str) -> Option<String> {
        kc.read(s).map(|i| i.secret)
    }

    #[test]
    fn acct_005_a_newer_claude_writes_the_accounts_own_entry_and_the_users_login_is_untouched() {
        let mut kc = own_login();
        let was = before(&kc, &E);
        kc.write(E.account, "fake-a1").unwrap(); // the login, keyed to the account's folder
        assert_eq!(after_login(&mut kc, &E, &was, None, None).unwrap(), "fake-a1");
        assert_eq!(secret_of(&kc, E.shared).as_deref(), Some("users-own-login"));
        assert_eq!(secret_of(&kc, E.account).as_deref(), Some("fake-a1"));
    }

    #[test]
    fn acct_005_an_older_claude_replaces_the_shared_entry_which_is_taken_then_put_back() {
        let mut kc = own_login();
        let was = before(&kc, &E);
        kc.write(E.shared, "fake-a1").unwrap(); // an older build: one shared entry
        assert_eq!(after_login(&mut kc, &E, &was, None, None).unwrap(), "fake-a1");
        assert_eq!(secret_of(&kc, E.shared).as_deref(), Some("users-own-login"), "the user's own login is put back");
        assert_eq!(secret_of(&kc, E.account).as_deref(), Some("fake-a1"), "the account keeps an entry of its own");
    }

    #[test]
    fn acct_005_an_unchanged_shared_entry_or_identical_credentials_are_never_taken() {
        let mut kc = own_login();
        let was = before(&kc, &E);
        let err = after_login(&mut kc, &E, &was, None, None).unwrap_err();
        assert!(err.contains("no new credentials"), "{err}");
        assert_eq!(kc.read(E.account), None);
        // A re-authentication that hands back the very credentials already there.
        kc.write(E.account, "fake-a1").unwrap();
        let was = before(&kc, &E);
        kc.write(E.account, "fake-a1").unwrap();
        assert_eq!(pick(&kc, &E, &was, Some(Item { secret: "fake-a1".into(), written: 99 }), Some("fake-a1")), None);
        // The account's own entry is present but unchanged: a changed shared entry does not count.
        kc.write(E.shared, "someone-else").unwrap();
        assert_eq!(pick(&kc, &E, &was, None, None), None);
    }

    #[test]
    fn acct_005_when_the_keychain_and_the_file_disagree_the_newer_wins() {
        let mut kc = own_login();
        let was = before(&kc, &E);
        kc.write(E.account, "keychain-copy").unwrap();
        let written = kc.read(E.account).unwrap().written;
        let file = |secret: &str, written: i64| Some(Item { secret: secret.into(), written });
        assert_eq!(pick(&kc, &E, &was, file("file-copy", written + 5), None).as_deref(), Some("file-copy"));
        assert_eq!(pick(&kc, &E, &was, file("file-copy", written - 5), None).as_deref(), Some("keychain-copy"));
        // The keychain refused the write, so only the file has it.
        let kc = own_login();
        assert_eq!(pick(&kc, &E, &was, file("file-copy", 1), None).as_deref(), Some("file-copy"));
    }

    #[test]
    fn acct_005_a_shared_login_that_cannot_be_put_back_fails_the_add() {
        let mut kc = own_login();
        let was = before(&kc, &E);
        kc.write(E.shared, "fake-a1").unwrap();
        kc.locked = true;
        let err = after_login(&mut kc, &E, &was, None, None).unwrap_err();
        assert!(err.contains("could not be put back"), "{err}");
        assert_eq!(kc.read(E.account), None, "nothing partial is kept");
    }

    #[test]
    fn acct_005_cli_014_a_cancelled_sign_in_puts_both_entries_back() {
        // A re-authentication: the account had credentials, and the user had their own login.
        let mut kc = own_login();
        kc.write(E.account, "fake-a1-earlier").unwrap();
        let was = before(&kc, &E);
        kc.write(E.shared, "half-done").unwrap();
        kc.write(E.account, "half-done").unwrap();
        undo(&mut kc, &E, &was).unwrap();
        assert_eq!(secret_of(&kc, E.shared).as_deref(), Some("users-own-login"));
        assert_eq!(secret_of(&kc, E.account).as_deref(), Some("fake-a1-earlier"), "a failed re-auth keeps the earlier credentials");
        // A new add interrupted (Ctrl+C in `kolux account add`): its new entry is removed.
        let mut kc = own_login();
        let was = before(&kc, &E);
        kc.write(E.account, "half-done").unwrap();
        undo(&mut kc, &E, &was).unwrap();
        assert_eq!(kc.read(E.account), None);
        assert_eq!(secret_of(&kc, E.shared).as_deref(), Some("users-own-login"));
    }

    #[test]
    fn acct_005_the_older_shared_entry_can_still_be_read() {
        let mut kc = own_login();
        assert_eq!(current(&kc, &E).map(|i| i.secret).as_deref(), Some("users-own-login"));
        kc.write(E.account, "fake-a1").unwrap();
        assert_eq!(current(&kc, &E).map(|i| i.secret).as_deref(), Some("fake-a1"));
    }
}
