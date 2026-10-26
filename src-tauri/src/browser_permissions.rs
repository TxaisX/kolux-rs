//! T-272-b (BROW-032): how a page's permission request is answered, and the notice a refusal
//! brings. Pure and unit-tested; browser_engine.rs hooks the engine's permission event to it.
//!
//! Pointer lock and storage access never reach this: the engine grants both without raising its
//! permission event. Autoplay and repeated automatic downloads keep the engine's own handling
//! (downloads have their own rules in browser_downloads.rs). Everything else is refused, and the
//! pane says which permission in plain words; a kind this list does not know is named by its raw
//! number.

/// What the engine is told to do with one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    /// The engine's own handling, with no notice.
    Engine,
    /// Refused; the pane shows this notice.
    Deny(String),
    /// Refused with no notice (autoplay and downloads have their own).
    DenyQuiet,
}

/// The engine's permission kinds, as numbered by WebView2.
const NAMES: [(i32, &str); 13] = [
    (0, "unknown"),
    (1, "microphone"),
    (2, "camera"),
    (3, "location"),
    (4, "notifications"),
    (5, "motion sensors"),
    (6, "clipboard reading"),
    (7, "multiple downloads"),
    (8, "file editing"),
    (9, "autoplay"),
    (10, "local fonts"),
    (11, "MIDI devices"),
    (12, "window placement"),
];

/// The permission's name in plain words, or its raw kind for one this list does not know.
pub fn name(kind: i32) -> String {
    NAMES.iter().find(|(n, _)| *n == kind).map(|(_, s)| s.to_string()).unwrap_or_else(|| format!("permission {kind}"))
}

/// How one request of `kind` is answered.
pub fn answer(kind: i32) -> Answer {
    match kind {
        7 | 9 => Answer::Engine,
        k => Answer::Deny(format!("{} access was denied", name(k))),
    }
}

/// After-list 285 (BROW-040): a preview is denied every request, the kinds the engine would
/// handle itself included; anything else is `answer`.
pub fn answer_for(kind: i32, preview: bool) -> Answer {
    match (answer(kind), preview) {
        (Answer::Engine, true) => Answer::DenyQuiet,
        (a, _) => a,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow032_a_refused_camera_names_the_camera() {
        assert_eq!(answer(2), Answer::Deny("camera access was denied".into()));
        assert_eq!(answer(1), Answer::Deny("microphone access was denied".into()));
        assert_eq!(answer(3), Answer::Deny("location access was denied".into()));
        assert_eq!(answer(12), Answer::Deny("window placement access was denied".into()));
    }

    #[test]
    fn brow032_an_unknown_permission_is_named_by_its_raw_kind() {
        assert_eq!(answer(0), Answer::Deny("unknown access was denied".into()));
        assert_eq!(answer(42), Answer::Deny("permission 42 access was denied".into()));
        assert_eq!(name(-1), "permission -1");
    }

    #[test]
    fn brow032_autoplay_and_downloads_keep_the_engine_s_own_handling() {
        assert_eq!(answer(9), Answer::Engine);
        assert_eq!(answer(7), Answer::Engine);
        // every named kind but those two is refused with a notice
        for k in 0..=12 {
            assert_eq!(matches!(answer(k), Answer::Deny(_)), k != 7 && k != 9, "kind {k}");
        }
    }

    #[test]
    fn after285_every_request_from_a_preview_is_denied() {
        for k in 0..=12 {
            assert_ne!(answer_for(k, true), Answer::Engine, "kind {k}");
        }
        assert_eq!(answer_for(2, true), Answer::Deny("camera access was denied".into()));
        assert_eq!(answer_for(3, true), Answer::Deny("location access was denied".into()));
        assert_eq!(answer_for(4, true), Answer::Deny("notifications access was denied".into()));
        // autoplay and downloads have their own notices (or none); no second one here
        assert_eq!(answer_for(9, true), Answer::DenyQuiet);
        assert_eq!(answer_for(7, true), Answer::DenyQuiet);
        assert_eq!(answer_for(77, true), Answer::Deny("permission 77 access was denied".into()));
    }

    #[test]
    fn after285_a_page_that_is_not_a_preview_is_answered_as_before() {
        for k in [-1, 0, 1, 2, 3, 4, 7, 9, 12, 42] {
            assert_eq!(answer_for(k, false), answer(k), "kind {k}");
        }
    }
}
