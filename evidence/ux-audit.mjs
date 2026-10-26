// UX audit host (lane ux, 2026-10-25). Launches the app once through scripts/evidence/app-launch.mjs and then
// runs the flow scripts dropped in G:/Temp/ux-v3/cmd/*.mjs one at a time (each: export default async ({ app, h }) => result),
// so a flow can be fixed without a 15 minute rebuild. Result of cmd N goes to cmd/N.out.json.
// Nothing here launches the app another way; nothing starts a real agent.
import { createApp, sleep, ps } from "../scripts/evidence/app-launch.mjs";
import { mkdirSync, readdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { freemem, totalmem } from "node:os";

const root = resolve(import.meta.dirname, "..");
const TEMP = "G:/Temp/ux-v3/run";
const CMD = "G:/Temp/ux-v3/cmd";
const SHOTS = join(root, "evidence", "ux-shots");
const CDP = 9280;
mkdirSync(CMD, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const app = createApp({ root, port: 1460, cdp: CDP, identifier: "com.txaisxiong.kolux-rs.ux.smoke", temp: TEMP, suffix: ".smoke", offscreen: true, keep: true });

// ---- a persistent connection to the page, for timings the cdp.mjs child process (a spawn per call) cannot give ----
class Page {
  ws = null;
  id = 0;
  waiting = new Map();
  errors = [];
  async connect() {
    const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    const t = targets.find((x) => x.type === "page" && /localhost:1460|tauri\.localhost/.test(x.url));
    if (!t) throw new Error("no app page target");
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.waiting.has(m.id)) { this.waiting.get(m.id)(m); this.waiting.delete(m.id); return; }
      if (m.method === "Runtime.exceptionThrown") this.errors.push({ t: Date.now(), kind: "exception", text: (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? "").slice(0, 300) });
      else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) this.errors.push({ t: Date.now(), kind: "console." + m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300) });
      else if (m.method === "Log.entryAdded" && (m.params.entry.level === "error" || m.params.entry.level === "warning")) this.errors.push({ t: Date.now(), kind: "log." + m.params.entry.level, text: (m.params.entry.text + " " + (m.params.entry.url ?? "")).slice(0, 300) });
    };
    this.ws = ws;
    for (const m of ["Runtime.enable", "Log.enable", "Page.enable"]) await this.send(m);
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      if (!this.ws || this.ws.readyState !== 1) return rej(new Error("page socket closed"));
      const i = ++this.id;
      this.waiting.set(i, res);
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async ensure() { if (!this.ws || this.ws.readyState !== 1) await this.connect(); }
  async ev(expr) {
    await this.ensure();
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error("page threw: " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    return r.result?.result?.value;
  }
  async key(name, mods = 0, text) {
    await this.ensure();
    const K = { Enter: [13, "\r"], Escape: [27], Tab: [9], Backspace: [8], ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37], ArrowRight: [39] };
    const [vk, tx] = K[name] ?? [name.toUpperCase().charCodeAt(0), name.length === 1 && !(mods & 2) ? name : undefined];
    const base = { key: name, code: K[name] ? name : (/^[0-9]$/.test(name) ? "Digit" : "Key") + name.toUpperCase(), windowsVirtualKeyCode: vk, modifiers: mods };
    const t = text ?? tx;
    await this.send("Input.dispatchKeyEvent", { type: t ? "keyDown" : "rawKeyDown", ...base, ...(t ? { text: t, unmodifiedText: t } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async insert(text) { await this.ensure(); await this.send("Input.insertText", { text }); }
  async shot(name) {
    await this.ensure();
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
    return name + ".png";
  }
  async mouse(type, x, y, button = "left") { await this.ensure(); await this.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1, buttons: type === "mouseReleased" ? 0 : 1 }); }
}
const page = new Page();

const h = {
  page,
  sleep,
  now: () => performance.now(),
  shot: (n) => page.shot(n),
  async load() {
    const cpu = await ps("(Get-CimInstance Win32_Processor).LoadPercentage").catch(() => "?");
    return { cpuPct: Number(cpu) || cpu, freeMemMB: Math.round(freemem() / 1048576), totalMemMB: Math.round(totalmem() / 1048576) };
  },
  // Wall time (ms) from now until probe() is truthy, polling every `every` ms in the page; returns { ms, value }.
  async until(probeExpr, ms = 15000, every = 10) {
    const t0 = performance.now();
    for (;;) {
      const v = await page.ev(probeExpr);
      if (v) return { ms: Math.round(performance.now() - t0), value: v };
      if (performance.now() - t0 > ms) return { ms: null, value: null, timedOut: true };
      await sleep(every);
    }
  },
  errorsSince: (t) => page.errors.filter((e) => e.t >= t),
  sel: { termAny: "section.pane[data-agent]", shell: 'section.pane[data-agent="shell"]' },
};
globalThis.h = h;

// ---- the host loop ----
let quit = false;
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const done = new Set();
log("host ready; cmd dir", CMD);
while (!quit) {
  const files = readdirSync(CMD).filter((f) => f.endsWith(".mjs") && !done.has(f) && !existsSync(join(CMD, f.replace(/\.mjs$/, ".out.json")))).sort();
  if (files.length === 0) { await sleep(300); continue; }
  const f = files[0];
  done.add(f);
  log("run", f);
  let out;
  try {
    const mod = await import(pathToFileURL(join(CMD, f)).href + "?t=" + Date.now());
    const value = await mod.default({ app, h, page, quit: () => (quit = true) });
    out = { ok: true, value };
  } catch (e) {
    out = { ok: false, error: String(e?.stack ?? e).slice(0, 3000) };
  }
  writeFileSync(join(CMD, f.replace(/\.mjs$/, ".out.json")), JSON.stringify(out, null, 1).slice(0, 60000));
  log("done", f, out.ok);
}
log("host exiting");
process.exit(0);
