// Live layout check: fails (exit 1) when two elements on the dev app's page overlap.
// usage: CDP_PORT=9231 node overlap.mjs <urlMatch> "<selector A>" "<selector B>" [more pairs...]
// Start the dev app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>.
const PORT = process.env.CDP_PORT || "9222";
const [match, ...sels] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = targets.find((t) => t.type === "page" && t.url.includes(match));
if (!t) { console.error("no page matching", match); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const expr = `(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; return { w: innerWidth, rects: ${JSON.stringify(sels)}.map(r) }; })()`;
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
const { w, rects } = await new Promise((r) => (ws.onmessage = (e) => r(JSON.parse(e.data).result.result.value)));
let bad = 0;
for (let i = 0; i + 1 < sels.length; i += 2) {
  const [a, b] = [rects[i], rects[i + 1]];
  if (!a || !b) { console.log(`missing: ${a ? sels[i + 1] : sels[i]}`); bad++; continue; }
  const hit = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  console.log(`${hit ? "OVERLAP" : "ok"} at ${w}px: ${sels[i]} ${Math.round(a.l)}-${Math.round(a.r)} · ${sels[i + 1]} ${Math.round(b.l)}-${Math.round(b.r)}`);
  if (hit) bad++;
}
process.exit(bad ? 1 : 0);
