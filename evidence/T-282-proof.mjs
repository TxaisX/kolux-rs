// T-282 (EDIT-008) and T-328 (USAGE-031) proof steps, run by evidence/T-282-run.mjs against the
// live dev app over CDP. Pastes are real paste events with a DataTransfer, sent to the focused
// editor surface; the code view's EditorView is found the way EditorView.findFromDOM finds it
// (the tile on .cm-content under .cm-editor). Usage reads go through the app's own claude-usage
// event, the one the status-line report raises.
import { execFile } from "node:child_process";
import { join } from "node:path";
const ROOT = "G:/Dev/kolux-rs-lanes/look";
const run = (f, a, o = {}) => new Promise((res) => execFile(f, a, { maxBuffer: 1 << 24, ...o }, (e, so, se) => res((so + se).trim())));
const cdp = (js) => run(process.execPath, [join(ROOT, "scripts", "evidence", "cdp.mjs"), "main", "eval", js], { env: { ...process.env, CDP_PORT: "9249" } });
const NL = "String.fromCharCode(10)";
const lib = `
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const t0 = performance.now(); let v; while (!(v = f()) && performance.now() - t0 < ms) await wait(50); return v; };
const titles = () => [...document.querySelectorAll('section.pane.editor .title')].map((t) => t.textContent).join(', ');
const pane = (n) => [...document.querySelectorAll('section.pane.editor')].find((s) => s.querySelector('.title')?.textContent === n);
const viewOf = (p) => { const c = p?.querySelector('.cm-editor')?.querySelector('.cm-content'); return c?.cmTile?.root?.view ?? null; };
const paste = (target, text) => { target.focus(); const dt = new DataTransfer(); dt.setData('text/plain', text); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e.defaultPrevented; };
const toast = async () => (await until(() => document.querySelector('.toast')?.textContent, 3000)) || '(no toast)';
const frames = () => { let worst = 0, last = performance.now(), on = true; const tick = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (on) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return () => { on = false; return Math.round(worst); }; };
`;
const GRANT = `for (const b of document.querySelectorAll('section.pane.editor button[title^="Allows this one file"]')) b.click(); await wait(1500);`;
const wrap = (body) => `(async () => { ${lib} try { ${body} } catch (e) { return 'error: ' + (e && e.stack || e); } })()`;
const step = process.argv[3];
if (step === "code") {
  console.log(await cdp(wrap(`
    ${GRANT} // "Open this file anyway": the scratch repo is not a project
    const p = await until(() => pane('notes.txt')); if (!p) return 'no notes.txt pane; editor panes: ' + titles();
    const v = await until(() => viewOf(p)); if (!v) return 'no EditorView under .cm-editor';
    const before = v.state.doc.length; const big = ('0123456789abcdef'.repeat(4) + ${NL}).repeat(Math.ceil(3 * 1024 * 1024 / 65));
    const stop = frames(); const t0 = performance.now(); const prevented = paste(v.contentDOM, big);
    const sync = Math.round(performance.now() - t0);
    await until(() => v.state.doc.length >= before + big.length);
    const total = Math.round(performance.now() - t0); const worst = stop();
    const lines = ['code view, notes.txt: ' + before + ' chars before',
      'pasted ' + big.length + ' chars (' + (big.length / 1048576).toFixed(2) + ' MB): default prevented ' + prevented + ', paste handler returned in ' + sync + ' ms, all text in after ' + total + ' ms',
      'doc now ' + v.state.doc.length + ' chars; pasted text intact: ' + v.state.doc.toString().includes(big) + '; longest gap between painted frames while it went in: ' + worst + ' ms'];
    v.contentDOM.focus(); v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(200); lines.push('one Ctrl+Z: doc back to ' + v.state.doc.length + ' chars');
    const huge = 'x'.repeat(32 * 1024 * 1024 + 1); const len0 = v.state.doc.length;
    const pr2 = paste(v.contentDOM, huge); await wait(300);
    lines.push('pasted ' + huge.length + ' chars (32 MB + 1): default prevented ' + pr2 + ', doc ' + len0 + ' -> ' + v.state.doc.length + ' chars, toast: ' + (await toast()));
    return lines.join(${NL});`)));
} else if (step === "rich") {
  console.log(await cdp(wrap(`
    await wait(4000); // the code step's toast clears first
    const p = await until(() => pane('note.md')); if (!p) return 'no note.md pane; editor panes: ' + titles();
    const r = await until(() => { const x = p.querySelector('.md-rich'); return x && !x.hidden && x.textContent.includes('Some text') ? x : null; });
    if (!r) return 'rich view never showed the note: ' + JSON.stringify(p.querySelector('.md-rich')?.textContent);
    const before = r.textContent; const lines = ['rich view, note.md: text before ' + JSON.stringify(before)];
    const sel = window.getSelection(); r.focus(); sel.selectAllChildren(r.lastElementChild ?? r); sel.collapseToEnd(); await wait(100);
    const pr = paste(r, ' pasted-normally'); await until(() => r.textContent.includes('pasted-normally'), 3000);
    lines.push('normal paste (16 chars): default prevented ' + pr + ', text now ' + JSON.stringify(r.textContent));
    const mid = r.textContent; const huge = 'y'.repeat(32 * 1024 * 1024 + 1);
    const pr2 = paste(r, huge); await wait(500);
    lines.push('pasted ' + huge.length + ' chars (32 MB + 1): default prevented ' + pr2 + ', text unchanged ' + (r.textContent === mid) + ' (' + r.textContent.length + ' chars), toast: ' + (await toast()));
    return lines.join(${NL});`)));
} else if (step === "forecast") {
  // Two reads of the weekly window 5 min 10 s apart (the forecast needs two at least 5 min apart).
  const RESET = Math.floor((Date.now() + 6 * 86400000) / 60000) * 60000; // one window, one reset time, as a real report gives
  const emit = (used) => cdp(wrap(`
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'claude-usage', payload: { limits: [{ kind: 'seven_day', usedPercent: ${used}, resetsAt: ${RESET} }, { kind: 'five_hour', usedPercent: 10, resetsAt: ${RESET} }] } });
    const pill = await until(() => { const x = document.querySelector('[data-claude-state="ok"]'); return x && x.title.includes('${100 - used}% left') ? x : null; }, 10000);
    return new Date().toISOString() + ' (page loaded ' + new Date(performance.timeOrigin).toISOString() + ') read seven_day ${used}% used; pill ' + JSON.stringify(pill?.textContent) + ' hover: ' + JSON.stringify(pill?.title ?? '(no pill)');`));
  console.log(await emit(40));
  await new Promise((r) => setTimeout(r, 310_000));
  console.log(await emit(41));
}
else console.log("unknown step", step);
