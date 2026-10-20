//! T-184-b (TERM-105, APP-052; DT-C27 reversed by Txais 2026-10-20: terminals keep running after
//! quit): the window's side of the background terminal service (`pty::service`).
//!
//! - One attached connection per window (`Link`): a reader thread hands each terminal's output and
//!   exit to the handlers the window registered for it, in the order the service sent them. Events
//!   for a terminal whose handlers are not registered yet (output that arrives while its start is
//!   still answering, or between the attach answer and the adoption) are held, up to a cap, and
//!   handed over first when they are.
//! - One control connection per terminal (`Remote`), so typing into a program that is not reading
//!   holds up only that pane, never another pane's typing, resize or close.
//! - A start sends the commands the window built (program, arguments, folder, the whole
//!   environment, fallbacks in order), so a pane starts exactly as it would in the window.
//! - The connection closing (the service ended) ends every terminal it carried, as unverifiable.

use super::service::{Client, Endpoint};
use base64::Engine as _;
use portable_pty::CommandBuilder;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

/// How long a control request (a start, typing, a resize, a close) waits for its answer.
pub const CONTROL_WAIT: Duration = Duration::from_secs(30);
/// Output held per terminal before its handlers are registered; older bytes are dropped first.
const EARLY_CAP: usize = 256 * 1024;

pub type OnOutput = Box<dyn FnMut(&[u8]) + Send>;
pub type OnExit = Box<dyn FnOnce(Option<u32>) + Send>;

#[derive(Debug, PartialEq)]
enum Ev {
    Output(Vec<u8>),
    Exit(Option<u32>),
}

struct Handler {
    output: OnOutput,
    exit: Option<OnExit>,
    backlog: Vec<Ev>,
}

impl Handler {
    fn run(&mut self, ev: Ev) {
        match ev {
            Ev::Output(data) => (self.output)(&data),
            Ev::Exit(code) => {
                if let Some(f) = self.exit.take() {
                    f(code);
                }
            }
        }
    }

    fn drain(&mut self) {
        for ev in std::mem::take(&mut self.backlog) {
            self.run(ev);
        }
    }
}

#[derive(Default)]
struct Table {
    by_id: HashMap<u32, Arc<Mutex<Handler>>>,
    early: HashMap<u32, Vec<Ev>>,
    /// The connection is gone: every terminal it carried has ended.
    closed: bool,
    /// The window is quitting: nothing more is handed on (the terminals go on in the service).
    detached: bool,
}

/// Keeps at most `EARLY_CAP` bytes of held output for one terminal, dropping the oldest chunks.
fn hold(list: &mut Vec<Ev>, ev: Ev) {
    list.push(ev);
    let mut total: usize = list.iter().map(|e| if let Ev::Output(d) = e { d.len() } else { 0 }).sum();
    while total > EARLY_CAP && matches!(list.first(), Some(Ev::Output(_))) {
        if let Ev::Output(d) = list.remove(0) {
            total -= d.len();
        }
    }
}

/// A window's attachment to one running service.
pub struct Link {
    ep: Endpoint,
    generation: u64,
    table: Mutex<Table>,
    alive: AtomicBool,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn decode(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s).unwrap_or_default()
}

impl Link {
    /// Attaches `events` (a connection that passed the hello) as this window. Answers the link and
    /// the service's running terminals, each with its recent output (`data`, base64), output count
    /// (`seq`) and the `meta` the window that started it stored.
    pub fn connect(ep: Endpoint, mut events: Client) -> Result<(Arc<Link>, Vec<Value>), String> {
        events.set_wait(None)?;
        let answer = events.request(json!({ "op": "attach" }), &mut Vec::new())?;
        let generation = answer["generation"].as_u64().unwrap_or(ep.generation);
        let rows = answer["terminals"].as_array().cloned().unwrap_or_default();
        let link = Arc::new(Link { ep, generation, table: Mutex::new(Table::default()), alive: AtomicBool::new(true) });
        let reader = link.clone();
        std::thread::Builder::new()
            .name("terminal-service-events".into())
            .spawn(move || {
                while let Ok(v) = events.read() {
                    reader.dispatch(&v);
                }
                reader.close_all();
            })
            .map_err(|e| e.to_string())?;
        Ok((link, rows))
    }

    /// The run of the service this link is attached to.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// False once the service's connection closed.
    pub fn alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn dispatch(&self, v: &Value) {
        let Some(id) = v["id"].as_u64().and_then(|i| u32::try_from(i).ok()) else { return };
        match v["ev"].as_str() {
            Some("output") => self.deliver(id, Ev::Output(decode(v["data"].as_str().unwrap_or_default()))),
            Some("exit") => self.deliver(id, Ev::Exit(v["code"].as_u64().and_then(|c| u32::try_from(c).ok()))),
            _ => {}
        }
    }

    fn deliver(&self, id: u32, ev: Ev) {
        let handler = {
            let mut t = lock(&self.table);
            if t.detached {
                return;
            }
            let exit = matches!(ev, Ev::Exit(_));
            let found = if exit { t.by_id.remove(&id) } else { t.by_id.get(&id).cloned() };
            match found {
                Some(h) => h,
                None => {
                    hold(t.early.entry(id).or_default(), ev);
                    return;
                }
            }
        };
        let mut h = lock(&handler);
        h.drain();
        h.run(ev);
    }

    /// Registers terminal `id`'s handlers; anything held for it is handed on at the next event or
    /// at `flush` (call it once the caller holds no lock its handlers take).
    pub fn register(&self, id: u32, output: OnOutput, exit: OnExit) {
        let mut t = lock(&self.table);
        let mut backlog = t.early.remove(&id).unwrap_or_default();
        if t.closed {
            backlog.push(Ev::Exit(None));
        }
        t.by_id.insert(id, Arc::new(Mutex::new(Handler { output, exit: Some(exit), backlog })));
    }

    /// Hands terminal `id` what was held for it.
    pub fn flush(&self, id: u32) {
        let Some(h) = lock(&self.table).by_id.get(&id).cloned() else { return };
        let mut h = lock(&h);
        let ended = h.backlog.iter().any(|e| matches!(e, Ev::Exit(_)));
        h.drain();
        drop(h);
        if ended {
            lock(&self.table).by_id.remove(&id);
        }
    }

    /// The service is gone: every terminal it carried has ended (how is not known).
    fn close_all(&self) {
        self.alive.store(false, Ordering::SeqCst);
        let all: Vec<_> = {
            let mut t = lock(&self.table);
            t.closed = true;
            t.by_id.drain().map(|(_, h)| h).collect()
        };
        for h in all {
            let mut h = lock(&h);
            h.drain();
            h.run(Ev::Exit(None));
        }
    }

    /// The window is quitting: its handlers are dropped unrun and the terminals go on.
    pub fn detach(&self) {
        let mut t = lock(&self.table);
        t.detached = true;
        t.by_id.clear();
        t.early.clear();
    }

    /// Starts a terminal in the service from the commands the window built (first that starts
    /// wins), at `cols` x `rows`, storing `meta` with it for the window that adopts it later.
    pub fn spawn(self: &Arc<Self>, commands: &[CommandBuilder], cols: u16, rows: u16, meta: Value) -> Result<Remote, String> {
        let mut client = Client::connect(&self.ep, CONTROL_WAIT)?;
        let list: Vec<Value> = commands.iter().map(command_json).collect();
        let row = client.request(json!({ "op": "spawn", "commands": list, "cols": cols, "rows": rows, "meta": meta }), &mut Vec::new())?;
        Remote::from_row(self, &row, Some(client)).ok_or_else(|| "the terminal service answered a start without a terminal".to_string())
    }
}

/// A command the window built, as the service reads it back (`command_from`).
pub fn command_json(cmd: &CommandBuilder) -> Value {
    let argv: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect();
    let env: Vec<[&str; 2]> = cmd.iter_full_env_as_str().map(|(k, v)| [k, v]).collect();
    json!({ "argv": argv, "cwd": cmd.get_cwd().map(|c| c.to_string_lossy().into_owned()), "env": env })
}

/// The service's side of `command_json`: exactly that program, folder and environment.
pub fn command_from(v: &Value) -> Option<CommandBuilder> {
    let argv: Vec<std::ffi::OsString> = v["argv"].as_array()?.iter().filter_map(|a| a.as_str().map(Into::into)).collect();
    if argv.is_empty() {
        return None;
    }
    let mut cmd = CommandBuilder::from_argv(argv);
    cmd.env_clear();
    for pair in v["env"].as_array().into_iter().flatten() {
        if let (Some(k), Some(val)) = (pair[0].as_str(), pair[1].as_str()) {
            cmd.env(k, val);
        }
    }
    if let Some(dir) = v["cwd"].as_str() {
        cmd.cwd(dir);
    }
    Some(cmd)
}

/// One terminal the service runs for this window: its id there, the process, and its own control
/// connection (opened again on the next request after a failure).
pub struct Remote {
    pub id: u32,
    pub pid: Option<u32>,
    pub program: String,
    ctl: Arc<Mutex<Option<Client>>>,
    link: Arc<Link>,
    writer: crate::pty::SharedWriter,
}

struct RemoteWriter {
    id: u32,
    ctl: Arc<Mutex<Option<Client>>>,
    link: Arc<Link>,
}

fn call(link: &Link, ctl: &Mutex<Option<Client>>, req: Value) -> Result<Value, String> {
    let mut slot = lock(ctl);
    if slot.is_none() {
        *slot = Some(Client::connect(&link.ep, CONTROL_WAIT)?);
    }
    let result = slot.as_mut().map(|c| c.request(req, &mut Vec::new())).unwrap_or_else(|| Err("no connection".into()));
    if result.as_ref().is_err_and(|e| !e.starts_with("no terminal")) {
        *slot = None;
    }
    result
}

impl Write for RemoteWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let req = json!({ "op": "write", "id": self.id, "data": base64::engine::general_purpose::STANDARD.encode(buf), "generation": self.link.generation });
        call(&self.link, &self.ctl, req).map(|_| buf.len()).map_err(std::io::Error::other)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Remote {
    /// A terminal from a service row (a start's answer or an attach row).
    pub fn from_row(link: &Arc<Link>, row: &Value, client: Option<Client>) -> Option<Remote> {
        let id = row["id"].as_u64().and_then(|i| u32::try_from(i).ok())?;
        let ctl = Arc::new(Mutex::new(client));
        let writer: crate::pty::SharedWriter = Arc::new(Mutex::new(Box::new(RemoteWriter { id, ctl: ctl.clone(), link: link.clone() })));
        Some(Remote {
            id,
            pid: row["pid"].as_u64().and_then(|p| u32::try_from(p).ok()),
            program: row["program"].as_str().unwrap_or_default().to_string(),
            ctl,
            link: link.clone(),
            writer,
        })
    }

    pub fn writer(&self) -> crate::pty::SharedWriter {
        self.writer.clone()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        call(&self.link, &self.ctl, json!({ "op": "resize", "id": self.id, "cols": cols, "rows": rows })).map(|_| ())
    }

    /// Ends the terminal in the service (closing a pane); its exit event follows.
    pub fn kill(&self) {
        let _ = call(&self.link, &self.ctl, json!({ "op": "kill", "id": self.id }));
    }
}

// ---------------------------------------------------------------- pure rules

/// Coordinator default (2026-10-20, Txais may overrule): an installed (release) build keeps its
/// terminals in the background service; a development build only when `KOLUX_TERMINAL_SERVICE=1`,
/// so lane rebuilds and smoke runs never leave a service holding the build's own program file.
pub fn wanted(release: bool, env: Option<&str>) -> bool {
    match env {
        Some("1") => true,
        Some("0") => false,
        _ => release,
    }
}

/// The handle an adopted terminal keeps: the one it had (programs inside it know themselves by
/// it), unless that id is already taken, then the next free one.
pub fn adopted_id(had: Option<u32>, taken: &dyn Fn(u32) -> bool, next: u32) -> u32 {
    match had.filter(|h| *h > 0 && !taken(*h)) {
        Some(h) => h,
        None => {
            let mut id = next.max(1);
            while taken(id) {
                id += 1;
            }
            id
        }
    }
}

/// TERM-105: the output a terminal printed while no window was attached, to add to its pane's
/// saved output before the pane replays it: the newest `now - seen` bytes of the service's tail
/// (all of the tail when more than that was missed). Nothing when the window never recorded what
/// it had seen (it did not quit cleanly), or the tail is not newer.
pub fn missed(seen: Option<u64>, now: u64, tail: &[u8]) -> &[u8] {
    let Some(seen) = seen else { return &[] };
    let gap = now.saturating_sub(seen);
    let take = usize::try_from(gap).unwrap_or(usize::MAX).min(tail.len());
    &tail[tail.len() - take..]
}

/// The file the window writes at quit: which run of the service, and each terminal's output count
/// the window had drawn into its pane's saved output.
pub const SEEN_FILE: &str = "terminals-seen.json";

pub fn write_seen(dir: &std::path::Path, generation: u64, seen: &[(u32, u64)]) {
    let map: serde_json::Map<String, Value> = seen.iter().map(|(id, seq)| (id.to_string(), json!(seq))).collect();
    let _ = std::fs::write(dir.join(SEEN_FILE), json!({ "generation": generation, "seen": map }).to_string());
}

/// What the last window of service run `generation` had seen of terminal `id`.
pub fn read_seen(dir: &std::path::Path, generation: u64) -> HashMap<u32, u64> {
    let Ok(v) = std::fs::read(dir.join(SEEN_FILE)).map_err(|_| ()).and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|_| ())) else { return HashMap::new() };
    if v["generation"].as_u64() != Some(generation) {
        return HashMap::new();
    }
    v["seen"].as_object().map(|m| m.iter().filter_map(|(k, s)| Some((k.parse().ok()?, s.as_u64()?))).collect()).unwrap_or_default()
}

/// The tail bytes of an attach row.
pub fn row_tail(row: &Value) -> Vec<u8> {
    decode(row["data"].as_str().unwrap_or_default())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::service::{write_endpoint, Config, Service};
    use super::*;
    use crate::terminal::{generation, PROTOCOL};
    use std::net::TcpListener;
    use std::time::Instant;

    pub(crate) struct Running {
        pub(crate) service: Service,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
        ep: Endpoint,
    }

    impl Drop for Running {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
            self.service.end_all();
        }
    }

    pub(crate) fn start(name: &str) -> (Running, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-t184b-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let ep = Endpoint { port: listener.local_addr().unwrap().port(), token: crate::cli::secret(), pid: std::process::id(), generation: generation(), protocol: PROTOCOL };
        write_endpoint(&dir, &ep).unwrap();
        let service = Service::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (s, st, token) = (service.clone(), stop.clone(), ep.token.clone());
        let thread = std::thread::spawn(move || s.run(listener, Config { token, protocol: PROTOCOL, idle: Duration::from_secs(600) }, Instant::now, &st).unwrap());
        (Running { service, stop, thread: Some(thread), ep }, dir)
    }

    pub(crate) fn link(r: &Running) -> (Arc<Link>, Vec<Value>) {
        Link::connect(r.ep.clone(), Client::connect(&r.ep, Duration::from_secs(10)).unwrap()).unwrap()
    }

    /// A window pane: collects what it is handed and answers the console's cursor question.
    /// How a pane ended: None while it runs, then its exit code (None when unknown).
    type Ended = Arc<Mutex<Option<Option<u32>>>>;

    fn pane(link: &Arc<Link>, remote: &Remote) -> (Arc<Mutex<String>>, Ended) {
        let text = Arc::new(Mutex::new(String::new()));
        let ended = Arc::new(Mutex::new(None));
        let (t, e, w) = (text.clone(), ended.clone(), remote.writer());
        link.register(
            remote.id,
            Box::new(move |chunk: &[u8]| {
                let s = String::from_utf8_lossy(chunk).into_owned();
                if s.contains("\x1b[6n") {
                    let _ = crate::pty::write_shared(&w, b"\x1b[1;1R");
                }
                lock(&t).push_str(&s);
            }),
            Box::new(move |code| *lock(&e) = Some(code)),
        );
        link.flush(remote.id);
        (text, ended)
    }

    fn wait(what: &str, secs: u64, mut ok: impl FnMut() -> bool) {
        let until = Instant::now() + Duration::from_secs(secs);
        while !ok() {
            assert!(Instant::now() < until, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(30));
        }
    }

    pub(crate) fn shell() -> Vec<CommandBuilder> {
        let mut cmds = crate::pty::shell_commands(None, None);
        for c in &mut cmds {
            c.env("KOLUX_T184B", "routed");
            c.env_remove("PROMPT_COMMAND");
        }
        cmds
    }

    #[test]
    fn t184b_a_command_crosses_to_the_service_with_its_program_folder_and_whole_environment() {
        let mut cmd = CommandBuilder::new("prog.exe");
        cmd.arg("--flag");
        cmd.cwd("C:\\work");
        cmd.env("KOLUX_PANE_KEY", "secret");
        cmd.env_remove("PATH");
        let back = command_from(&command_json(&cmd)).unwrap();
        assert_eq!(back.get_argv(), cmd.get_argv());
        assert_eq!(back.get_cwd(), cmd.get_cwd());
        assert_eq!(back.get_env("KOLUX_PANE_KEY").and_then(|v| v.to_str()), Some("secret"));
        assert!(back.get_env("PATH").is_none(), "a variable the window removed stays removed");
        let mut a: Vec<_> = cmd.iter_full_env_as_str().collect();
        let mut b: Vec<_> = back.iter_full_env_as_str().collect();
        a.sort_unstable();
        b.sort_unstable();
        assert_eq!(a, b);
        assert!(command_from(&json!({ "argv": [] })).is_none());
    }

    #[test]
    fn t184b_events_before_the_handlers_are_held_in_order_and_capped() {
        let (r, dir) = start("early");
        let (link, _) = link(&r);
        link.deliver(7, Ev::Output(b"one ".to_vec()));
        link.deliver(7, Ev::Output(b"two ".to_vec()));
        link.deliver(7, Ev::Exit(Some(3)));
        let got = Arc::new(Mutex::new(Vec::new()));
        let (g, g2) = (got.clone(), got.clone());
        link.register(7, Box::new(move |c: &[u8]| lock(&g).push(String::from_utf8_lossy(c).into_owned())), Box::new(move |code| lock(&g2).push(format!("exit {code:?}"))));
        link.flush(7);
        assert_eq!(*lock(&got), vec!["one ".to_string(), "two ".into(), "exit Some(3)".into()]);
        assert!(lock(&link.table).by_id.is_empty(), "an ended terminal's handlers go");
        let mut list = Vec::new();
        for _ in 0..5 {
            hold(&mut list, Ev::Output(vec![0; EARLY_CAP / 2]));
        }
        assert_eq!(list.len(), 2, "held output stays within the cap, newest kept");
        drop(r);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn t184b_a_pane_routed_through_the_service_types_resizes_outlives_its_window_and_is_adopted_back() {
        let (r, dir) = start("route");
        let (first, rows) = link(&r);
        assert!(rows.is_empty());
        assert_eq!(first.generation(), generation());
        let meta = json!({ "id": 5, "pane": 42, "key": "k", "program": null });
        let remote = first.spawn(&shell(), 100, 30, meta.clone()).unwrap();
        assert!(remote.pid.is_some());
        let (text, ended) = pane(&first, &remote);
        crate::pty::write_shared(&remote.writer(), b"echo kolux-t184b-%KOLUX_T184B%$env:KOLUX_T184B\r\n").unwrap();
        wait("the routed typing's output", 30, || lock(&text).contains("routed"));
        remote.resize(120, 40).unwrap();
        // Quit: the window detaches; the terminal goes on in the service and its exit is never run.
        first.detach();
        drop(first);
        drop(remote);
        assert_eq!(*lock(&ended), None);
        let before = r.service.counts().0;
        assert_eq!(before, 1, "the terminal outlived its window");
        // Reopen: a new window gets it back with its meta and recent output, and can type again.
        let (second, rows) = link(&r);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["meta"], meta);
        assert!(String::from_utf8_lossy(&row_tail(&rows[0])).contains("routed"));
        let back = Remote::from_row(&second, &rows[0], None).unwrap();
        let (again, gone) = pane(&second, &back);
        crate::pty::write_shared(&back.writer(), b"echo kolux-t184b-again\r\n").unwrap();
        wait("output after the reopen", 30, || lock(&again).contains("kolux-t184b-again"));
        // Closing the pane ends the terminal; the exit reaches the pane.
        back.kill();
        wait("the exit", 15, || lock(&gone).is_some());
        assert_eq!(r.service.counts().0, 0);
        drop(r);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn t184b_the_service_ending_ends_every_pane_it_carried() {
        use std::io::{BufRead, BufReader};
        // A service that answers the hello and the attach, sends one output and goes away.
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let ep = Endpoint { port: listener.local_addr().unwrap().port(), token: "t".into(), pid: 1, generation: 5, protocol: PROTOCOL };
        let fake = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut out = stream.try_clone().unwrap();
            let mut lines = BufReader::new(stream).lines();
            let _hello = lines.next();
            writeln!(out, "{}", json!({ "ok": true, "result": { "generation": 5, "protocol": PROTOCOL, "pid": 1 } })).unwrap();
            let attach: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
            let row = json!({ "id": 3, "pid": null, "program": "x", "seq": 2, "data": "aGk=" });
            writeln!(out, "{}", json!({ "re": attach["re"], "ok": true, "result": { "terminals": [row], "generation": 5 } })).unwrap();
            writeln!(out, "{}", json!({ "ev": "output", "id": 3, "data": "IHRoZXJl", "seq": 8, "generation": 5 })).unwrap();
        });
        let (l, rows) = Link::connect(ep.clone(), Client::connect(&ep, Duration::from_secs(10)).unwrap()).unwrap();
        assert_eq!((l.generation(), rows.len(), row_tail(&rows[0])), (5, 1, b"hi".to_vec()));
        fake.join().unwrap();
        wait("the connection's end", 15, || !l.alive());
        // Registered after the end: it gets what was held for it, then the unverifiable end.
        let got = Arc::new(Mutex::new(Vec::new()));
        let (g, g2) = (got.clone(), got.clone());
        l.register(3, Box::new(move |c: &[u8]| lock(&g).push(String::from_utf8_lossy(c).into_owned())), Box::new(move |code| lock(&g2).push(format!("exit {code:?}"))));
        l.flush(3);
        assert_eq!(*lock(&got), vec![" there".to_string(), "exit None".into()]);
    }

    #[test]
    fn t184b_only_installed_builds_use_the_service_unless_told() {
        assert!(wanted(true, None));
        assert!(!wanted(false, None));
        assert!(wanted(false, Some("1")));
        assert!(!wanted(true, Some("0")));
        assert!(wanted(true, Some("yes")));
    }

    #[test]
    fn t184b_an_adopted_terminal_keeps_its_handle_unless_taken() {
        let taken = |id: u32| id == 3 || id == 4;
        assert_eq!(adopted_id(Some(7), &taken, 1), 7);
        assert_eq!(adopted_id(Some(3), &taken, 3), 5);
        assert_eq!(adopted_id(None, &taken, 1), 1);
        assert_eq!(adopted_id(Some(0), &taken, 2), 2);
    }

    #[test]
    fn t184b_the_saved_output_gets_only_what_was_printed_while_no_window_was_open() {
        let tail = b"0123456789";
        assert_eq!(missed(Some(100), 103, tail), b"789");
        assert_eq!(missed(Some(100), 100, tail), b"");
        assert_eq!(missed(Some(10), 500, tail), tail, "more missed than kept: all of the tail");
        assert_eq!(missed(None, 500, tail), b"", "no clean quit: nothing is guessed");
        let dir = std::env::temp_dir().join(format!("kolux-t184b-seen-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_seen(&dir, 77, &[(4, 1200), (9, 5)]);
        assert_eq!(read_seen(&dir, 77), HashMap::from([(4, 1200), (9, 5)]));
        assert!(read_seen(&dir, 78).is_empty(), "another run of the service: nothing carries over");
        let _ = std::fs::remove_dir_all(dir);
    }
}
