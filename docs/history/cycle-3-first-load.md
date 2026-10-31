# First load reaches 1,471,768 bytes

<!-- html -->

Closing A-condition 4's "first load under 1.5 MB" for the first time, by taking CodeMirror out of the
document store and moving the Help menu's sheet behind `import()`.

**Status:** merged to `main` in PR #25 (`a1c590d0`).
**Condition:** the brief's A-condition 4 requires first load below 1,500,000 bytes.

---

## The result

| Stage | First load | Chunks |
|---|---|---|
| Baseline in the worktree | 1,864,072 | 41 |
| After `buffers.ts` stopped carrying CodeMirror | 1,525,286 | — |
| After the Help menu's sheet moved behind `import()` | **1,471,768** | 38 |

That is **28,232 bytes under the 1,500,000-byte bar**. It is the first time this condition has been
met; every previous cycle ended at 3.18 MB or 1.86 MB.

```
$ pnpm build && node scripts/bundle-budget.mjs
bundle-budget: first load 1471768 bytes in 38 chunks (ceiling 1485000)
bundle-budget: OK
```

## Cause 1 — the document store carried a code editor

`src/editor/buffers.ts` is the editor's document store. It needed one thing from
`@codemirror/commands` — the undo annotation — and that import pulled in `@codemirror/view` and
`@codemirror/language` with it: a **315,352-byte chunk** that the first frame paid for even when the
user only ever opened a terminal.

The CodeMirror side now lives in `src/editor/editors.ts` (62 lines). `buffers.ts` imports nothing
from CodeMirror and stays a pure text store.

This is the separation that mattered: the *store* is needed by the window; the *editor* is not
needed until a file is opened.

## Cause 2 — the Help button pulled in the whole guide

`onboarding/HelpMenu.tsx` imported the guide's steps, its ring, the tour catalogue, and five small
modules (`notifications`, `setupChoice`, `firstRun`, `hooksOn`, `features`) that were reachable only
through it. None of that is needed to draw the first frame.

The menu is now a button. `onboarding/HelpSheet.tsx` holds the sheet and is a `deferred()` page,
loaded the first time the button is clicked.

## Why this lane had already been rejected once

An earlier attempt (`lane3/first-load-2`) reached the same target but was abandoned: its improvised
merge with the T-603 line-ending work silently broke the editor. A rewritten file gained an extra
line ending, and `isDirty` was comparing `sliceDoc` instead of `fileText`.

Those two failures are the reason this lane was checked rather than trusted:

- `isDirty` still compares **`fileText(view.state)`** against the disk text — verified in the merged code
- `lineEndsFor` and `fileText` stayed in `buffers.ts`; only the CodeMirror side moved
- `mixedLineEnds.test.ts` gained **one import line** (`"./editors"`); no assertion changed
- every other editor test changed exactly one line, the import moving `./buffers` → `./editors`

## The ceiling is now a ratchet

`scripts/bundle-budget.mjs` lowered `CEILING` from `1,880,000` to `1,485,000`. The old value would
have let the first frame grow by 379 kB before anything complained.

`scripts/bundle-budget.test.mjs` changed with it, and the claim got stronger, not weaker:

```diff
- expect(CEILING).toBeGreaterThan(1_500_000);   // protected the bar while the bar was unmet
+ expect(CEILING).toBeLessThanOrEqual(1_500_000);
+ expect(CEILING).toBeGreaterThan(1_450_000);
```

The ceiling can no longer be raised back over the bar it exists to hold.

## Gates

| Gate | Result |
|---|---|
| `pnpm exec tsc` | exit 0, no output |
| `pnpm test` | 708 files / 5,157 tests passed, 131.02 s |
| `pnpm build` + `bundle-budget` | 1,471,768 bytes in 38 chunks, within ceiling |

Raw proof: `evidence/cycle3-first-load-3.txt`.

## Caveat

The 1,471,768 figure comes from a **local Vite build**. The abandoned lane measured 1,470,936 for the
equivalent change — the two agree within 832 bytes — but neither has been confirmed against the
packaged release bundle. That confirmation belongs to the 0.1.3 release verification.
