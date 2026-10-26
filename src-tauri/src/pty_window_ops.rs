//! Fix-term row 801 (stress S6): on Windows the console host honours `CSI 8;rows;cols t` ("resize
//! the text area") itself, so a program printing `ESC[8;1;1t` leaves the pty at 1x1 while the page
//! still believes it is 44 rows, and nothing ever tells the host otherwise. The host does not
//! always report the shrink in its output, so two signs are watched and either puts the pty back to
//! the size the page last asked for: a report of a size the page did not ask for, and the way a 1x1
//! console draws (every character as `ESC[H LF char`).
use portable_pty::{MasterPty, PtySize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

/// The pty master a session shares with its output watcher.
pub type SharedMaster = Arc<Mutex<Box<dyn MasterPty + Send>>>;

/// Longest run of digits and `;` after `ESC[8;` that still reads as a size.
const MAX_ARGS: usize = 12;
const REPORT: &[u8] = b"\x1b[8;";
const HOME: &[u8] = b"\x1b[H";
/// The cursor show/hide the console host puts around each draw.
const CURSOR: [&[u8]; 2] = [b"\x1b[?25h", b"\x1b[?25l"];
/// How many 1x1-style draws within `SQUEEZE_WINDOW` count as a squeezed console.
const SQUEEZE_HITS: u32 = 4;
const SQUEEZE_WINDOW: Duration = Duration::from_secs(2);

/// Reads the output chunks for the two signs, including one cut between chunks.
#[derive(Default)]
pub struct WindowOpScan {
    /// An unfinished sign at the end of the last chunk.
    tail: Vec<u8>,
    hits: u32,
    since: Option<Instant>,
}

enum At {
    /// `ESC[8;rows;cols t`, sizes as (cols, rows) when they parse.
    Report(Option<(u16, u16)>),
    Squeeze,
    Other,
    Unfinished,
}

fn at(rest: &[u8]) -> At {
    let n = rest.len().min(REPORT.len());
    if rest[..n] != REPORT[..n] {
        return home_lf(rest);
    }
    if rest.len() <= REPORT.len() {
        return At::Unfinished;
    }
    let args = &rest[REPORT.len()..];
    for (k, &b) in args.iter().enumerate() {
        match b {
            b't' => {
                let text = std::str::from_utf8(&args[..k]).unwrap_or("");
                let size = text.split_once(';').and_then(|(r, c)| Some((c.parse().ok()?, r.parse().ok()?)));
                return At::Report(size);
            }
            b'0'..=b'9' | b';' if k < MAX_ARGS => {}
            _ => return At::Other,
        }
    }
    At::Unfinished
}

/// `ESC[H`, up to three cursor show/hide, then a line feed: how a 1x1 console draws a character.
fn home_lf(rest: &[u8]) -> At {
    let n = rest.len().min(HOME.len());
    if rest[..n] != HOME[..n] {
        return At::Other;
    }
    if rest.len() < HOME.len() {
        return At::Unfinished;
    }
    let mut at = HOME.len();
    for _ in 0..4 {
        let tail = &rest[at..];
        match tail.first() {
            None => return At::Unfinished,
            Some(b'\n') => return At::Squeeze,
            Some(0x1b) => match CURSOR.iter().find(|c| tail.starts_with(c)) {
                Some(c) => at += c.len(),
                None if CURSOR.iter().any(|c| c.starts_with(tail)) => return At::Unfinished,
                None => return At::Other,
            },
            Some(_) => return At::Other,
        }
    }
    At::Other
}

impl WindowOpScan {
    /// True when `chunk` shows the pty is not at `page` (cols, rows), the size the page asked for.
    pub fn feed(&mut self, chunk: &[u8], page: (u16, u16)) -> bool {
        self.feed_at(chunk, page, Instant::now())
    }

    pub(super) fn feed_at(&mut self, chunk: &[u8], page: (u16, u16), now: Instant) -> bool {
        if self.tail.is_empty() && !chunk.contains(&0x1b) {
            return false;
        }
        let joined;
        let buf = if self.tail.is_empty() {
            chunk
        } else {
            joined = [self.tail.as_slice(), chunk].concat();
            &joined
        };
        let mut found = false;
        let mut keep = None;
        let mut from = 0;
        while let Some(p) = buf[from..].iter().position(|&b| b == 0x1b) {
            let i = from + p;
            match at(&buf[i..]) {
                At::Report(size) => found |= size != Some(page),
                At::Squeeze => {
                    if self.since.is_none_or(|t| now.duration_since(t) > SQUEEZE_WINDOW) {
                        (self.since, self.hits) = (Some(now), 0);
                    }
                    self.hits += 1;
                    if self.hits >= SQUEEZE_HITS {
                        self.hits = 0;
                        found = true;
                    }
                }
                At::Unfinished => {
                    keep = Some(i);
                    break;
                }
                At::Other => {}
            }
            from = i + 1;
        }
        self.tail = keep.map(|i| buf[i..].to_vec()).unwrap_or_default();
        found
    }
}

/// What the watcher needs to put the pty back: the page's latest size and a weak hold on the master.
pub struct SizeKeeper {
    master: Weak<Mutex<Box<dyn MasterPty + Send>>>,
    size: AtomicU32,
    pending: AtomicBool,
}

impl SizeKeeper {
    pub fn new(master: &SharedMaster, cols: u16, rows: u16) -> Arc<Self> {
        Arc::new(Self { master: Arc::downgrade(master), size: AtomicU32::new(pack(cols, rows)), pending: AtomicBool::new(false) })
    }

    /// Records the size the page asked for; call it holding the master's lock, so a restore
    /// running at the same time cannot put an older size back.
    pub fn set(&self, cols: u16, rows: u16) {
        self.size.store(pack(cols, rows), Ordering::SeqCst);
    }

    /// The size the page last asked for, as (cols, rows).
    pub fn size(&self) -> (u16, u16) {
        unpack(self.size.load(Ordering::SeqCst))
    }

    /// Re-applies the recorded size on its own thread (a resize can wait on the very output the
    /// caller is reading); requests that arrive while one is queued fold into it.
    pub fn restore(self: &Arc<Self>) {
        if self.pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let keeper = self.clone();
        let started = std::thread::Builder::new().name("pty-size-restore".into()).spawn(move || {
            keeper.pending.store(false, Ordering::SeqCst);
            if let Some(master) = keeper.master.upgrade() {
                if let Ok(m) = master.lock() {
                    let (cols, rows) = keeper.size();
                    let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                }
            }
        });
        if started.is_err() {
            self.pending.store(false, Ordering::SeqCst);
        }
    }
}

fn pack(cols: u16, rows: u16) -> u32 {
    (u32::from(cols) << 16) | u32::from(rows)
}

fn unpack(size: u32) -> (u16, u16) {
    ((size >> 16) as u16, (size & 0xffff) as u16)
}

/// Wraps the output callback so a sign that the pty left the page's size puts it back.
pub fn guarded(keeper: Arc<SizeKeeper>, mut on_output: impl FnMut(&[u8]) + Send + 'static) -> impl FnMut(&[u8]) + Send + 'static {
    let mut scan = WindowOpScan::default();
    move |chunk| {
        // Only the Windows console host resizes itself; elsewhere the output is left unread.
        if cfg!(windows) && scan.feed(chunk, keeper.size()) {
            keeper.restore();
        }
        on_output(chunk);
    }
}
