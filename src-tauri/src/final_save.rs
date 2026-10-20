//! T-075 (APP-050): the final save at quit, as one barrier with a deadline. Once the quit has begun
//! no batched save queues another write; every quit step runs on its own thread and is waited for
//! only as long as the deadline leaves, so a stalled profile drive (a save that never returns) can
//! cap the wait but never freeze the app; a step that fails or panics is reported and the rest run.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

static QUITTING: AtomicBool = AtomicBool::new(false);

/// The longest the final save as a whole may take (APP-050's quit deadline).
pub const QUIT_DEADLINE: Duration = Duration::from_secs(5);

/// The quit has begun: from now on `quitting()` is true and batched savers write nothing more.
/// True for the first caller only, so the final save runs once.
pub fn begin() -> bool {
    !QUITTING.swap(true, Ordering::SeqCst)
}

/// Whether the final save has begun (batched savers check this before writing).
pub fn quitting() -> bool {
    QUITTING.load(Ordering::SeqCst)
}

/// One step of the final save: its name for the report, and the work.
pub type Step = (&'static str, Box<dyn FnOnce() + Send>);

/// A step from a closure.
pub fn step(name: &'static str, work: impl FnOnce() + Send + 'static) -> Step {
    (name, Box::new(work))
}

/// What became of each step.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    /// Ran to the end within the deadline.
    pub finished: Vec<&'static str>,
    /// Panicked (its thread ended without finishing).
    pub failed: Vec<&'static str>,
    /// Still running when its share of the deadline ran out; left to end with the app.
    pub timed_out: Vec<&'static str>,
    /// Started after the deadline was spent: started anyway, not waited for.
    pub not_waited: Vec<&'static str>,
    pub elapsed: Duration,
}

impl Report {
    /// One line for the diagnostics log.
    pub fn line(&self) -> String {
        let mut s = format!("final save: {} finished in {} ms", self.finished.len(), self.elapsed.as_millis());
        for (what, names) in [("failed", &self.failed), ("timed out", &self.timed_out), ("not waited for", &self.not_waited)] {
            if !names.is_empty() {
                s.push_str(&format!("; {what}: {}", names.join(", ")));
            }
        }
        s
    }
}

/// Runs `steps` one after another, each on its own thread, waiting for each only as long as the
/// deadline leaves. Returns within about `deadline` whatever the steps do.
pub fn run(deadline: Duration, steps: Vec<Step>) -> Report {
    let start = Instant::now();
    let mut report = Report::default();
    for (name, work) in steps {
        // A panic inside the step is caught, so the thread always reports and the rest still run.
        let guarded = move || std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).is_ok();
        let left = deadline.saturating_sub(start.elapsed());
        if left.is_zero() {
            std::thread::spawn(guarded);
            report.not_waited.push(name);
            continue;
        }
        // ACCT-025's bounded quit step (secrets::within): its own thread, waited for at most `left`.
        match crate::secrets::within(left, guarded) {
            Some(true) => report.finished.push(name),
            Some(false) => report.failed.push(name),
            None => report.timed_out.push(name),
        }
    }
    report.elapsed = start.elapsed();
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn note(log: &Arc<Mutex<Vec<&'static str>>>, what: &'static str) -> Step {
        let log = log.clone();
        step(what, move || log.lock().unwrap().push(what))
    }

    /// A slow fake writer (a stalled profile drive): the quit waits for it only until the deadline,
    /// the steps before it finish, and the ones after it are started but not waited for.
    #[test]
    fn t075_b_a_stalled_writer_cannot_hold_the_quit_past_the_deadline() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let stalled = Arc::new(Mutex::new(()));
        let hold = stalled.lock().unwrap(); // the fake drive never answers while this is held
        let drive = stalled.clone();
        let after = log.clone();
        let steps = vec![
            note(&log, "activity counts"),
            step("layout to a stalled drive", move || drop(drive.lock().unwrap())),
            step("sign-ins sealed", move || after.lock().unwrap().push("sign-ins sealed")),
        ];
        let report = run(Duration::from_millis(300), steps);
        assert!(report.elapsed < Duration::from_secs(2), "the quit did not wait on the drive: {:?}", report.elapsed);
        assert!(report.elapsed >= Duration::from_millis(300), "the stalled step was given its share: {:?}", report.elapsed);
        assert_eq!(report.finished, vec!["activity counts"]);
        assert_eq!(report.timed_out, vec!["layout to a stalled drive"]);
        assert_eq!(report.not_waited, vec!["sign-ins sealed"]);
        assert!(report.line().starts_with("final save: 1 finished in "), "{}", report.line());
        assert!(report.line().contains("timed out: layout to a stalled drive; not waited for: sign-ins sealed"), "{}", report.line());
        drop(hold);
        // The step started after the deadline still ran on its own thread.
        let waited = Instant::now();
        while !log.lock().unwrap().contains(&"sign-ins sealed") && waited.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(*log.lock().unwrap(), vec!["activity counts", "sign-ins sealed"]);
    }

    /// Steps run in order; a step that fails (panics, a drive that rejects writes) is reported and
    /// does not stop the ones after it; fast steps end well inside the deadline.
    #[test]
    fn t075_b_steps_run_in_order_and_a_failing_step_does_not_stop_the_rest() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let steps = vec![note(&log, "first"), step("drive rejects writes", || panic!("write failed")), note(&log, "last")];
        let report = run(QUIT_DEADLINE, steps);
        assert_eq!(*log.lock().unwrap(), vec!["first", "last"]);
        assert_eq!(report.finished, vec!["first", "last"]);
        assert_eq!(report.failed, vec!["drive rejects writes"]);
        assert!(report.timed_out.is_empty() && report.not_waited.is_empty());
        assert!(report.elapsed < Duration::from_secs(2), "{:?}", report.elapsed);
        assert_eq!(report.line(), format!("final save: 2 finished in {} ms; failed: drive rejects writes", report.elapsed.as_millis()));
    }

    /// The barrier: the first begin() wins, and from then on batched savers see quitting().
    #[test]
    fn t075_b_begin_is_a_one_time_barrier() {
        let first = begin();
        assert!(quitting());
        assert!(!begin(), "a second final save never starts");
        assert!(first, "the only caller in the test process is the first");
    }
}
