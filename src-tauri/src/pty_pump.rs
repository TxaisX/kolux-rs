//! Fix-term 787: what the PTY reader hands on is batched. One thread only reads the PTY, so the
//! program is never held up by the app's bookkeeping; a second takes what has piled up since its last
//! call (up to `BATCH_MAX`) and passes it on as one chunk. An idle terminal costs one thread hop and
//! never waits on a timer; a flood costs one event, one lock and one file write per ~128 KB instead
//! of one per 8 KB read. The queue between the two is bounded, so the reader blocks (and the program
//! with it) once the app is that far behind, which is the flow control the pane's own acks sit on top of.

use std::io::Read;
use std::sync::mpsc::sync_channel;
use std::thread;

/// One read from the PTY.
const READ_BUF: usize = 32 * 1024;
/// Reads that may wait for the pump.
const QUEUE_DEPTH: usize = 4;
/// The most one call to `on_output` carries.
const BATCH_MAX: usize = 128 * 1024;

/// Starts the reader and the pump over `reader`; `first` is delivered before anything read. The
/// threads end when the reader hits end of file or an error.
pub(super) fn start(mut reader: impl Read + Send + 'static, first: Option<String>, mut on_output: impl FnMut(&[u8]) + Send + 'static) -> Result<(), String> {
    let (tx, rx) = sync_channel::<Vec<u8>>(QUEUE_DEPTH);
    thread::Builder::new()
        .name("pty-reader".into())
        .spawn(move || {
            let mut buf = vec![0u8; READ_BUF];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    thread::Builder::new()
        .name("pty-pump".into())
        .spawn(move || {
            if let Some(n) = first {
                on_output(n.as_bytes());
            }
            let mut batch: Vec<u8> = Vec::with_capacity(BATCH_MAX + READ_BUF);
            while let Ok(read) = rx.recv() {
                batch.clear();
                batch.extend_from_slice(&read);
                while batch.len() < BATCH_MAX {
                    match rx.try_recv() {
                        Ok(more) => batch.extend_from_slice(&more),
                        Err(_) => break,
                    }
                }
                on_output(&batch);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// What one call to the sink costs.
    #[derive(Clone, Copy)]
    enum Cost {
        Sleep(Duration),
        /// Load flake fix: not a clock. The call returns once the reader has made this many reads beyond
        /// the ones already delivered, so what piles up behind a call is the same on a busy machine
        /// as on an idle one (the queue holds 4 and the reader 1, so 4 can always be reached).
        Reads(usize),
    }

    /// A reader that yields `total` bytes of numbered lines in reads of uneven size.
    struct Lines {
        text: Vec<u8>,
        at: usize,
        n: usize,
        /// Where the text stood after each read.
        ends: Arc<Mutex<Vec<usize>>>,
        ended: Arc<AtomicBool>,
    }

    impl Lines {
        fn new(lines: usize) -> Lines {
            let mut text = Vec::new();
            for i in 0..lines {
                text.extend_from_slice(format!("{i:08} {}\n", "x".repeat(90)).as_bytes());
            }
            Lines { text, at: 0, n: 0, ends: Arc::default(), ended: Arc::default() }
        }
    }

    impl Read for Lines {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            self.n += 1;
            let want = [1, 7, 4096, 8192, 100, 30_000][self.n % 6].min(out.len()).min(self.text.len() - self.at);
            out[..want].copy_from_slice(&self.text[self.at..self.at + want]);
            self.at += want;
            self.ends.lock().unwrap().push(self.at);
            if want == 0 {
                self.ended.store(true, SeqCst);
            }
            Ok(want)
        }
    }

    fn collect(lines: usize, cost: Cost) -> (Vec<u8>, usize, usize, Duration) {
        let seen = Arc::new(Mutex::new((Vec::<u8>::new(), 0usize, 0usize)));
        let sink = seen.clone();
        let started = Instant::now();
        let reader = Lines::new(lines);
        let (ends, ended) = (reader.ends.clone(), reader.ended.clone());
        start(reader, Some("note\r\n".into()), move |chunk| {
            let mut s = sink.lock().unwrap();
            s.0.extend_from_slice(chunk);
            s.1 += 1;
            s.2 = s.2.max(chunk.len());
            let (calls, delivered) = (s.1, s.0.len() - "note\r\n".len());
            drop(s);
            match cost {
                Cost::Sleep(d) => thread::sleep(d),
                // The opening note is delivered before the queue has drained, so the reader cannot move yet.
                Cost::Reads(_) if calls == 1 => {}
                Cost::Reads(more) => {
                    let give_up = Instant::now() + Duration::from_secs(30);
                    let consumed = ends.lock().unwrap().partition_point(|end| *end <= delivered);
                    while ends.lock().unwrap().len() < consumed + more && !ended.load(SeqCst) && Instant::now() < give_up {
                        thread::sleep(Duration::from_micros(100));
                    }
                }
            }
        })
        .unwrap();
        let want = lines * 100 + 6;
        // Load flake fix: gives up only when no byte has arrived for 60 s, not after 60 s in all.
        let (mut last, mut quiet_since) = (0, Instant::now());
        loop {
            let got = seen.lock().unwrap().0.len();
            if got >= want || quiet_since.elapsed() > Duration::from_secs(60) {
                break;
            }
            if got != last {
                (last, quiet_since) = (got, Instant::now());
            }
            thread::sleep(Duration::from_millis(2));
        }
        let s = seen.lock().unwrap();
        (s.0.clone(), s.1, s.2, started.elapsed())
    }

    /// Fix-term 787: a long numbered stream arrives whole and in order, in fewer and larger calls than reads.
    #[test]
    fn after787_a_numbered_stream_arrives_complete_in_order_in_big_batches() {
        let lines = 60_000; // ~6 MB
        let (got, calls, biggest, took) = collect(lines, Cost::Sleep(Duration::from_micros(200)));
        let text = String::from_utf8(got).unwrap();
        let mut it = text.lines();
        assert_eq!(it.next(), Some("note"));
        for (i, l) in it.enumerate() {
            assert_eq!(&l[..8], format!("{i:08}"), "line {i} is out of place");
        }
        assert_eq!(text.lines().count(), lines + 1);
        assert!(biggest <= BATCH_MAX + READ_BUF, "a batch of {biggest} bytes");
        println!("PUMP slow sink: {} KB in {calls} calls, biggest {biggest} B, {:?}", text.len() / 1024, took);
    }

    /// Fix-term 787: with a sink that costs a fixed time per call, the pump moves more bytes per call
    /// than the 8 KB the reader used to hand over, so the same stream is delivered faster.
    #[test]
    fn after787_a_sink_that_costs_per_call_sees_far_fewer_calls() {
        let lines = 200_000; // ~20 MB
        let (got, calls, _, took) = collect(lines, Cost::Reads(4));
        assert_eq!(got.len(), lines * 100 + 6);
        let per_8k = got.len() / 8192;
        println!("PUMP per-call-cost sink: 20 MB in {calls} calls ({per_8k} calls at 8 KB), {took:?}");
        assert!(calls < per_8k / 2, "{calls} calls");
    }
}
