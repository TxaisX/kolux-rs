//! Fix-term row 801 (stress S6): a program printing `CSI 8;1;1t` must not leave the pane at 1x1.
use super::*;
use super::window_ops::WindowOpScan;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const COLS: u16 = 100;
const ROWS: u16 = 30;

/// A running PowerShell with its output collected; answers the console host's cursor query.
struct Probe {
    session: PtySession,
    rx: mpsc::Receiver<Vec<u8>>,
    seen: String,
    answered: usize,
}

impl Probe {
    fn start(script: &str) -> Self {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let args = vec!["-NoLogo".to_string(), "-NoProfile".to_string(), "-Command".to_string(), script.to_string()];
        let session = PtySession::spawn(
            program_command("powershell", &args, None),
            COLS,
            ROWS,
            move |chunk| {
                let _ = tx.send(chunk.to_vec());
            },
            |_| {},
        )
        .expect("spawn powershell in a pty");
        Self { session, rx, seen: String::new(), answered: 0 }
    }

    /// Reads until `marker` shows up in the readable text (30 s at most) and returns that text.
    fn until(&mut self, marker: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !plain(&self.seen).contains(marker) {
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "`{marker}` not read back within 30s; saw:\n{:?}", self.seen);
            if let Ok(chunk) = self.rx.recv_timeout(left.min(Duration::from_millis(200))) {
                self.seen.push_str(&String::from_utf8_lossy(&chunk));
            }
            let asks = self.seen.matches("\x1b[6n").count();
            while self.answered < asks {
                self.session.write(b"\x1b[1;1R").expect("answer cursor query");
                self.answered += 1;
            }
        }
        plain(&self.seen)
    }
}

/// The text a user would read: escape sequences, CR and LF removed (a 1x1 console draws one
/// character per line, with a cursor move between them).
fn plain(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        match c {
            '\x1b' => match chars.next() {
                Some('[') => {
                    for n in chars.by_ref() {
                        if ('@'..='~').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    for n in chars.by_ref() {
                        if n == '\x07' {
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\r' | '\n' => {}
            c => out.push(c),
        }
    }
    out
}

/// The size the program itself reads back, as `W<tag>=<cols>x<rows>`.
fn size_of(text: &str, tag: &str) -> (u16, u16) {
    let at = text.find(&format!("W{tag}=")).unwrap_or_else(|| panic!("no W{tag} in:\n{text}"));
    let rest = &text[at + 3..];
    let end = rest.find(|c: char| !(c.is_ascii_digit() || c == 'x')).unwrap_or(rest.len());
    let (c, r) = rest[..end].split_once('x').expect("cols x rows");
    (c.parse().unwrap(), r.parse().unwrap())
}

const SIZE: &str = "$Host.UI.RawUI.WindowSize";

/// The program prints a text-area request, reports its size, waits for a line, reports again.
fn script(request: &str, wait_ms: u32) -> String {
    format!(
        "'ready'; Start-Sleep -Milliseconds {wait_ms}; [Console]::Out.Write([string][char]27 + '{request}'); 1..8 | ForEach-Object {{ 'f' }}; Start-Sleep -Milliseconds 1000; \
         'W1=' + {SIZE}.Width + 'x' + {SIZE}.Height + ' end1'; $null = [Console]::In.ReadLine(); \
         'W2=' + {SIZE}.Width + 'x' + {SIZE}.Height + ' end2'; Start-Sleep -Milliseconds 300"
    )
}

/// Prints the request, waits for the pane's answer, reports the size the program reads back.
fn size_after(request: &str, wait_ms: u32, before_request: impl FnOnce(&PtySession)) -> (u16, u16) {
    let mut p = Probe::start(&script(request, wait_ms));
    p.until("ready");
    before_request(&p.session);
    let t = p.until("end1");
    p.session.kill();
    size_of(&t, "1")
}

/// Row 801: the console host honours the request itself and shrinks to 1x1; the pane must come
/// back to the size the page asked for without any further call from the page.
#[test]
fn after801_a_1x1_text_area_request_does_not_leave_the_pty_at_1x1() {
    assert_eq!(size_after("[8;1;1t", 0, |_| {}), (COLS, ROWS));
}

/// The size restored is the page's latest, not the one the pty started with.
#[test]
fn after801_the_size_restored_is_the_pages_latest() {
    let got = size_after("[8;1;1t", 600, |s| s.resize(90, 25).unwrap());
    assert_eq!(got, (90, 25));
}

/// A request for a huge text area (harmless on its own) also ends at the page's size.
#[test]
fn after801_a_huge_text_area_request_ends_at_the_pages_size() {
    assert_eq!(size_after("[8;99999;99999t", 0, |_| {}), (COLS, ROWS));
}

const PAGE: (u16, u16) = (100, 30);

#[test]
fn after801_scan_flags_a_report_of_a_size_the_page_did_not_ask_for() {
    let mut scan = WindowOpScan::default();
    assert!(scan.feed(b"abc \x1b[8;1;1t def", PAGE));
    assert!(!scan.feed(b"the host echoing the page's own size \x1b[8;30;100t", PAGE), "no loop on its own answer");
    assert!(!scan.feed(b"plain text \x1b[31mred\x1b[0m", PAGE));
    assert!(scan.feed(b"\x1b[8;99999;99999t", PAGE));
}

#[test]
fn after801_scan_finds_a_report_split_across_chunks() {
    let mut scan = WindowOpScan::default();
    assert!(!scan.feed(b"\x1b[8;", PAGE));
    assert!(!scan.feed(b"1", PAGE));
    assert!(scan.feed(b";1t tail", PAGE), "split in three");
    assert!(!scan.feed(b"\x1b", PAGE));
    assert!(scan.feed(b"[8;1;1t", PAGE), "split inside the introducer");
}

#[test]
fn after801_scan_ignores_look_alikes_and_forgets_a_broken_start() {
    let mut scan = WindowOpScan::default();
    assert!(!scan.feed(b"\x1b[18t \x1b[8;1;1x \x1b[8t \x1b[8;;", PAGE));
    assert!(!scan.feed(b"1;1 more text, t", PAGE), "a broken start is not completed by later text");
    assert!(!scan.feed(b"\x1b[8;1234567890123456789;t", PAGE), "too long to be a size");
    assert!(!scan.feed(&[0x1b; 100], PAGE));
    assert!(scan.feed(b"\x1b[8;1;1t", PAGE));
}

#[test]
fn after801_scan_flags_the_way_a_1x1_console_draws() {
    let mut scan = WindowOpScan::default();
    let now = Instant::now();
    let unit = b"\x1b[?25lW\x1b[H\n1\x1b[?25h";
    // the same draw as the console host emits it with the cursor toggled between home and line feed
    let spread = b"\x1b[?25l\x1b[H\x1b[?25h\x1b[?25l\nf";
    assert!(!scan.feed_at(unit, PAGE, now));
    assert!(!scan.feed_at(spread, PAGE, now));
    assert!(!scan.feed_at(unit, PAGE, now));
    assert!(scan.feed_at(spread, PAGE, now), "the fourth draw within the window");
    assert!(!scan.feed_at(unit, PAGE, now), "counting starts again after a flag");
    // ordinary full-screen drawing homes the cursor but does not follow it with a line feed
    let mut scan = WindowOpScan::default();
    for _ in 0..50 {
        assert!(!scan.feed_at(b"\x1b[H\x1b[2Jline one\r\nline two", PAGE, now));
    }
    // slow, spread-out draws are not a squeeze
    let mut scan = WindowOpScan::default();
    for k in 0..8u64 {
        assert!(!scan.feed_at(unit, PAGE, now + Duration::from_secs(3 * k)));
    }
}

#[test]
fn after801_scan_finds_a_1x1_draw_cut_between_chunks() {
    let mut scan = WindowOpScan::default();
    let now = Instant::now();
    assert!(!scan.feed_at(b"x\x1b[H", PAGE, now));
    assert!(!scan.feed_at(b"\n1\x1b[", PAGE, now));
    assert!(!scan.feed_at(b"H\n2 \x1b[H\n3", PAGE, now));
    assert!(scan.feed_at(b"\x1b[H\n4", PAGE, now));
}
