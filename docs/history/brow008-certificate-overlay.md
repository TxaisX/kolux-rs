# BROW-008: a refused certificate now shows the recovery overlay

<!-- html -->

The card asks for a public site with a broken certificate to show certificate wording and no
local-server advice. The published 0.1.4 showed nothing: the pane kept the previous page and the
overlay never appeared. This records the cause and the fix now on the lane.

## What actually happened

A normal `https://example.com/` navigation works: the page commits and the address bar keeps the URL.
`https://expired.badssl.com/` behaves differently in the engine:

- the navigation leaves the page on `about:blank`;
- the engine sends neither `started` nor `finished` for the refused certificate;
- the probe (`location.href`) therefore answered `about:blank`, and the old rule called that a live
  page;
- the pane stayed in `loading`, which deliberately ignores probes, so no overlay was ever built.

A second, separate defect showed up while proving it: when the engine did send `started`, it named
`about:blank` (or an empty URL), which overwrote the address the user typed. The diagnosis then ran
on a blank host and produced "Kolux could not find ." with local-server advice.

## The fix

1. **Probe classification** (`src-tauri/src/browser.rs`): `about:blank` is `error-page`, not `page`.
   A real New Tab is in the blank phase and is never probed, so it is unaffected.
2. **Typed navigation enters loading** (`src/browser/loadState.ts`): `navigate` now carries the URL
   and sets `loading`. After 32 probes (about 8 s at 250 ms) a page that is still on the error page
   becomes a failed load with the overlay. A page that commits early goes to `ok` and does not wait.
3. **The typed URL survives the engine's events**: `started` and `finished` ignore `about:blank` and
   keep the address the user typed, so the diagnosis names the real site.
4. **The proof reaches the address bar** (`scripts/prove/live-checks.mjs`): the check focuses the
   React-controlled input and inserts text with `Input.insertText`, then waits for the asynchronous
   certificate wording instead of reading the first overlay frame.

## Tests

- `src/browser/loadState.test.ts`: 33 tests, including the loading grace, a page that commits early,
  an empty `started` URL and an `about:blank` `started` URL.
- `src-tauri/src/browser.rs`: `probe_result` now expects `about:blank` to be `error-page`.
- `pnpm exec tsc` is clean.

## The live proof

The proof ran on the 0.1.4 code plus this fix, as a local release build, against a scratch profile
beside the installed app:

```
B-7 / BROW-008 box 2 — a broken certificate gets its own message
  app: Kolux RS 0.1.4
PASS  a browser tab opens
PASS  the address bar is there
PASS  the page shows an overlay
  certificate wording: present
  overlay: {"kind":"failed","text":"This page could not load
expired.badssl.com showed a certificate Kolux does not trust, so the page stays blocked.
Certificate checking stays strict. Retry Open Externally","retry":true}
PASS  it names the certificate problem
PASS  it offers Retry
PASS  it gives no local-server advice
RESULT: PASS
```

Evidence: `evidence/live-installed-b7.txt`. The published 0.1.4 does not contain the fix; the next
release (0.1.5) is the one that ships it.
