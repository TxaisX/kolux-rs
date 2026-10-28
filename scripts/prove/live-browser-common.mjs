// Shared pieces of the in-app browser LIVE proofs (spec/13): scratch loopback pages and a small CDP client for a browser tab's own page target.
import http from "node:http";
import { appendFileSync } from "node:fs";

export const TODAY = "2026-10-27";
const TOKEN = "<script>window.__token=Math.random();window.__loaded=(window.__loaded||0)+1</script>";
const html = (title, body) => `<!doctype html><meta charset=utf-8><title>${title}</title>${body}${TOKEN}`;

/** One loopback server (127.0.0.1) with the pages the browser boxes need; hits[path] counts requests per path. */
export function makeSites() {
  const hits = {};
  const open = new Set();
  const pages = {
    "/form": html("Form page", '<input id="t" aria-label="scratch field"><p>form</p>'),
    "/closer": html("Closer page", '<p id="alive">alive</p><script>window.close()</script>'),
    "/ok": html("Ok page", "<p>ok</p>"),
    "/die": html("Die page", "<p>die</p>"),
  };
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/favicon.ico") return res.writeHead(404).end();
    hits[path] = (hits[path] ?? 0) + 1;
    if (path === "/slow") {
      // Headers and a first chunk, then the response never ends: the page stays in the loading state.
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.write(`<!doctype html><title>Slow page</title><p>partial</p>${" ".repeat(2048)}`);
      open.add(res);
      return;
    }
    const body = pages[path];
    if (!body) return res.writeHead(404).end("no");
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(body);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ port, base: `http://127.0.0.1:${port}`, hits, stop: () => { for (const r of open) r.destroy(); server.close(); } });
    }),
  );
}

/** A server on port 9 (both IPv4 and IPv6, since localhost may resolve to either); started only when asked. */
export function listenOn9(log) {
  const s = http.createServer((req, res) => {
    log(`port 9 saw ${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Nine page</title><p>nine</p>");
  });
  return new Promise((resolve, reject) => {
    s.once("error", reject);
    s.listen({ port: 9, host: "::", ipv6Only: false }, () => resolve(s));
  });
}

export const targets = async () => (await fetch("http://127.0.0.1:9290/json")).json();
export const pageTarget = async (re) => (await targets()).find((t) => t.type === "page" && re.test(t.url)) ?? null;

/** One CDP command on the page target whose URL matches re. */
export async function targetCall(re, method, params = {}, ms = 8000) {
  const t = await pageTarget(re);
  if (!t) throw new Error(`no page target for ${re}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error("ws error")); });
  const res = await new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error(`cdp timeout ${method}`)), ms);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(timer); ok(m); } };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  if (res.error) throw new Error(`${method}: ${res.error.message}`);
  return res.result;
}
export const targetEval = async (re, expression, ms) => (await targetCall(re, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, ms)).result?.value;
export const targetInsert = (re, text) => targetCall(re, "Input.insertText", { text });

/** Appends one dated LIVE section to evidence/cards-<card>.txt in the lane tree. */
export function evidence(root, card, lines, script = "live-BROW.mjs") {
  appendFileSync(`${root}/evidence/cards-${card}.txt`, `\n\nLIVE ${TODAY} (scripts/prove/${script}, hidden dev app, scratch loopback pages)\n${lines.join("\n")}\n`);
}
