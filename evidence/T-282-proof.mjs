// T-282 (EDIT-008) proof steps, run by evidence/T-282-run.mjs against the live dev app over CDP.
// Pastes are real paste events with a DataTransfer, sent to the focused editor surface.
import { execFile } from "node:child_process";
import { join } from "node:path";
const ROOT = "G:/Dev/kolux-rs-lanes/look";
const run = (f, a, o = {}) => new Promise((res) => execFile(f, a, { maxBuffer: 1 << 24, ...o }, (e, so, se) => res((so + se).trim())));
const cdp = (js) => run(process.execPath, [join(ROOT, "scripts", "evidence", "cdp.mjs"), "main", "eval", js], { env: { ...process.env, CDP_PORT: "9249" } });
const lib = `
const pane = (n) => [...document.querySelectorAll('section.pane.editor')].find((s) => s.querySelector('.title')?.textContent === n);
const cmView = (el) => { const c = el.querySelector('.cm-content'); return c.cmView?.rootView?.view ?? c.cmTile?.root?.view ?? c.cmView?.view; };
const paste = (target, text) => { target.focus(); const dt = new DataTransfer(); dt.setData('text/plain', text); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e.defaultPrevented; };
const toast = () => document.querySelector('.toast')?.textContent ?? '(no toast)';
const frames = () => { let worst = 0, last = performance.now(), on = true; const tick = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (on) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return () => { on = false; return Math.round(worst); }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
`;
const step = process.argv[3];
if (step === "code") {
  console.log(await cdp(`(async () => { ${lib}
    const p = pane('notes.txt'); const v = cmView(p); if (!v) return 'no view';
    const before = v.state.doc.length; const big = ('0123456789abcdef'.repeat(4) + String.fromCharCode(10)).repeat(Math.ceil(3 * 1024 * 1024 / 65));
    const stop = frames(); const t0 = performance.now(); const prevented = paste(p.querySelector('.cm-content'), big);
    const sync = Math.round(performance.now() - t0);
    while (v.state.doc.length < before + big.length && performance.now() - t0 < 20000) await wait(20);
    const total = Math.round(performance.now() - t0); const worst = stop();
    const ok = v.state.doc.sliceString(0, big.length) === big || v.state.doc.toString().includes(big);
    const lines = ['code view, notes.txt: ' + before + ' chars before',
      'pasted ' + big.length + ' chars (' + (big.length / 1048576).toFixed(2) + ' MB): default prevented ' + prevented + ', paste handler returned in ' + sync + ' ms, all text in after ' + total + ' ms',
      'doc now ' + v.state.doc.length + ' chars; pasted text intact: ' + ok + '; longest gap between painted frames while it went in: ' + worst + ' ms'];
    p.querySelector('.cm-content').focus();
    p.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(100); lines.push('one Ctrl+Z: doc back to ' + v.state.doc.length + ' chars');
    const huge = 'x'.repeat(32 * 1024 * 1024 + 1); const len0 = v.state.doc.length;
    const pr2 = paste(p.querySelector('.cm-content'), huge); await wait(300);
    lines.push('pasted ' + huge.length + ' chars (32 MB + 1): default prevented ' + pr2 + ', doc ' + len0 + ' -> ' + v.state.doc.length + ' chars, toast: ' + toast());
    return lines.join(String.fromCharCode(10)); })()`));
} else if (step === "rich") {
  console.log(await cdp(`(async () => { ${lib}
    const p = pane('note.md'); const r = p.querySelector('.md-rich'); if (!r || r.hidden) return 'rich view not shown';
    const before = r.textContent; const lines = ['rich view, note.md: text before ' + JSON.stringify(before)];
    const sel = window.getSelection(); r.focus(); sel.selectAllChildren(r.lastElementChild ?? r); sel.collapseToEnd(); await wait(50);
    const pr = paste(r, ' pasted-normally'); await wait(300);
    lines.push('normal paste (16 chars): default prevented ' + pr + ', text now ' + JSON.stringify(r.textContent));
    const mid = r.textContent; const huge = 'y'.repeat(32 * 1024 * 1024 + 1);
    const pr2 = paste(r, huge); await wait(500);
    lines.push('pasted ' + huge.length + ' chars (32 MB + 1): default prevented ' + pr2 + ', text unchanged ' + (r.textContent === mid) + ' (' + r.textContent.length + ' chars), toast: ' + toast());
    return lines.join(String.fromCharCode(10)); })()`));
} else console.log("unknown step", step);
