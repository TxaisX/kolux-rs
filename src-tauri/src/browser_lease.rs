//! T-312-b (ORCH-061): page leases for the runtime browser commands. A lease is a named page
//! placement (where an agent's pages go in the Kolux browser); one holder at a time owns it.
//! Pages an agent opens under its lease are recorded on it, and releasing the lease hands those
//! pages back so the caller closes them. The table lives in memory for the app's run: a restart
//! starts with no leases, as the pages they placed are gone too.

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{LazyLock, Mutex};

/// The longest placement or holder name kept (a name is a label, not a payload).
pub const NAME_MAX: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    pub holder: String,
    pub pages: Vec<u32>,
    /// Unix milliseconds when the holder took it.
    pub since: i64,
}

#[derive(Debug, Default)]
pub struct Leases {
    by_place: BTreeMap<String, Lease>,
}

/// A placement or holder name, trimmed; refused when empty or too long.
pub fn name(raw: &str, what: &str) -> Result<String, String> {
    let n = raw.trim();
    if n.is_empty() {
        return Err(format!("the {what} name cannot be empty"));
    }
    if n.chars().count() > NAME_MAX {
        return Err(format!("the {what} name is longer than {NAME_MAX} characters"));
    }
    Ok(n.to_string())
}

impl Leases {
    /// Takes `place` for `holder`. Taking a lease you already hold is fine (`Ok(false)`); a lease
    /// someone else holds is refused with their name, so only one holder owns a placement.
    pub fn acquire(&mut self, place: &str, holder: &str, now: i64) -> Result<bool, String> {
        match self.by_place.get(place) {
            Some(l) if l.holder == holder => Ok(false),
            Some(l) => Err(format!("placement {place} is held by {}; it is free again once that holder releases it", l.holder)),
            None => {
                self.by_place.insert(place.to_string(), Lease { holder: holder.to_string(), pages: Vec::new(), since: now });
                Ok(true)
            }
        }
    }

    /// Records `page` as placed under `place`; only the holder may place pages there.
    pub fn add_page(&mut self, place: &str, holder: &str, page: u32) -> Result<(), String> {
        let l = self.by_place.get_mut(place).ok_or_else(|| format!("no lease is held on placement {place}"))?;
        if l.holder != holder {
            return Err(format!("placement {place} is held by {}", l.holder));
        }
        if !l.pages.contains(&page) {
            l.pages.push(page);
        }
        Ok(())
    }

    /// Frees `place` and hands back the pages placed under it that are still `open`, for the
    /// caller to close. Only the holder may release it.
    pub fn release(&mut self, place: &str, holder: &str, open: &[u32]) -> Result<Vec<u32>, String> {
        let l = self.by_place.get(place).ok_or_else(|| format!("no lease is held on placement {place}"))?;
        if l.holder != holder {
            return Err(format!("placement {place} is held by {}, not {holder}", l.holder));
        }
        let pages = self.by_place.remove(place).map(|l| l.pages).unwrap_or_default();
        Ok(pages.into_iter().filter(|p| open.contains(p)).collect())
    }

    /// Drops pages that are no longer open (closed by hand) from every lease.
    pub fn prune(&mut self, open: &[u32]) {
        for l in self.by_place.values_mut() {
            l.pages.retain(|p| open.contains(p));
        }
    }

    /// after-list 732: frees every lease whose holder is a Kolux terminal (`term-<n>`) that `live`
    /// says is gone, so a closed terminal never keeps a placement from the next holder. A named
    /// `--holder` or the plain command line cannot be judged and is left alone. The freed leases'
    /// pages stay open as ordinary tabs (coordinator default: no page vanishes behind the user's
    /// back); their placements are returned.
    pub fn free_gone(&mut self, live: impl Fn(&str) -> bool) -> Vec<String> {
        let gone: Vec<String> = self.by_place.iter().filter(|(_, l)| terminal_holder(&l.holder) && !live(&l.holder)).map(|(p, _)| p.clone()).collect();
        for p in &gone {
            self.by_place.remove(p);
        }
        gone
    }

    /// The placement a page was opened under, if any.
    pub fn place_of(&self, page: u32) -> Option<&str> {
        self.by_place.iter().find(|(_, l)| l.pages.contains(&page)).map(|(p, _)| p.as_str())
    }

    /// Every lease as rows, by placement name.
    pub fn rows(&self) -> Vec<Value> {
        self.by_place.iter().map(|(p, l)| json!({ "lease": p, "holder": l.holder, "pages": l.pages, "since": l.since })).collect()
    }
}

/// A holder named after a Kolux terminal (`term-<n>`, what a call from inside one gets).
fn terminal_holder(h: &str) -> bool {
    h.strip_prefix("term-").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

static LEASES: LazyLock<Mutex<Leases>> = LazyLock::new(Default::default);

/// Runs `f` on the app's one lease table.
pub fn with<T>(f: impl FnOnce(&mut Leases) -> T) -> T {
    let mut g = LEASES.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut g)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_holders_asking_for_one_placement_only_one_holds_it() {
        let mut l = Leases::default();
        assert_eq!(l.acquire("review", "agent-a", 1), Ok(true));
        let refused = l.acquire("review", "agent-b", 2).unwrap_err();
        assert!(refused.contains("held by agent-a"), "{refused}");
        // The holder asking again keeps it.
        assert_eq!(l.acquire("review", "agent-a", 3), Ok(false));
        // Another holder cannot place pages or release it.
        assert!(l.add_page("review", "agent-b", 7).is_err());
        assert!(l.release("review", "agent-b", &[7]).unwrap_err().contains("not agent-b"));
        // Once released, the other holder gets it.
        assert_eq!(l.release("review", "agent-a", &[]), Ok(vec![]));
        assert_eq!(l.acquire("review", "agent-b", 4), Ok(true));
        assert_eq!(l.rows()[0]["holder"], "agent-b");
    }

    #[test]
    fn releasing_hands_back_the_pages_still_open_for_closing() {
        let mut l = Leases::default();
        l.acquire("docs", "a", 1).unwrap();
        l.add_page("docs", "a", 3).unwrap();
        l.add_page("docs", "a", 5).unwrap();
        l.add_page("docs", "a", 5).unwrap();
        assert_eq!(l.place_of(5), Some("docs"));
        assert_eq!(l.place_of(9), None);
        // Page 3 was closed by hand: only 5 comes back to close.
        assert_eq!(l.release("docs", "a", &[5, 9]), Ok(vec![5]));
        assert!(l.rows().is_empty());
        assert!(l.release("docs", "a", &[]).unwrap_err().contains("no lease"));
    }

    #[test]
    fn placing_without_a_lease_is_refused_and_prune_drops_closed_pages() {
        let mut l = Leases::default();
        assert!(l.add_page("x", "a", 1).unwrap_err().contains("no lease"));
        l.acquire("x", "a", 1).unwrap();
        l.add_page("x", "a", 1).unwrap();
        l.add_page("x", "a", 2).unwrap();
        l.prune(&[2]);
        assert_eq!(l.rows()[0]["pages"], json!([2]));
    }

    #[test]
    fn a_lease_whose_holder_terminal_closed_is_freed_for_the_next_holder() {
        let mut l = Leases::default();
        l.acquire("review", "term-4", 1).unwrap();
        l.add_page("review", "term-4", 9).unwrap();
        l.acquire("docs", "term-5", 1).unwrap();
        l.acquire("named", "planner", 1).unwrap();
        l.acquire("plain", "cli", 1).unwrap();
        l.acquire("odd", "term-", 1).unwrap();
        // term-4 closed; term-5 still runs. Names that are not terminals are never judged.
        let freed = l.free_gone(|h| h == "term-5");
        assert_eq!(freed, vec!["review".to_string()]);
        assert_eq!(l.acquire("review", "term-7", 2), Ok(true));
        assert!(l.acquire("docs", "term-7", 2).unwrap_err().contains("held by term-5"));
        assert!(l.acquire("named", "x", 2).is_err());
        assert!(l.acquire("plain", "x", 2).is_err());
        assert!(l.acquire("odd", "x", 2).is_err());
        // Nothing gone: nothing freed.
        assert!(l.free_gone(|_| true).is_empty());
    }

    #[test]
    fn names_are_trimmed_and_bounded() {
        assert_eq!(name("  review ", "lease"), Ok("review".into()));
        assert!(name("   ", "lease").unwrap_err().contains("cannot be empty"));
        assert!(name(&"x".repeat(NAME_MAX + 1), "holder").unwrap_err().contains("longer than"));
        assert!(name(&"é".repeat(NAME_MAX), "holder").is_ok());
    }
}
