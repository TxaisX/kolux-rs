# The P0 scoreboard stopped counting untestable boxes

<!-- html -->

Five acceptance boxes can never be ticked on this machine. They are now struck rather than left
open, so **P0 moves 210/228 → 215/228** without a single line of app code changing.

---

## The problem

The brief's headline measure is "228/228 P0 cards". `plan-check.mjs` counts a card as passing when
every one of its acceptance boxes is ticked. A box that names a machine, an installation or a
workflow this project no longer has can never be ticked — so it sits there forever, dragging the
number down and making real progress invisible.

Five boxes were in that state:

| Card | Box | What it needs |
|---|---|---|
| APP-059 | 1 | A release run on GitHub's runners |
| APP-060 | 1 | Four CI shards on GitHub |
| CLI-007 | 2 | An older `kolux` registered machine-wide |
| EDIT-053 | 2 | Linux, and an extensionless file with the execute bit |
| TERM-030 | 2 | macOS `Cmd+Shift+J` |

Two of these were already decided. **DT-C54** says GitHub CI is not used and releases ship from
this PC — and its text explicitly names APP-059 box 1 and APP-060 box 1 as "not applicable". But
DT-C54 was written in prose, and `plan-check` only understands one form:

```
a line carrying `strikes CARD-nnn [box N]` AND `confirmed by Txais YYYY-MM-DD`
```

So the decision existed and the scoreboard never saw it.

## The fix

Two new rows in `DECISIONS.md`, using the mechanism that was already there:

- **DT-C60** — records that DT-C54's two CI boxes are unreachable here. Strikes `APP-059 box 1`,
  `APP-060 box 1`.
- **DT-C61** — records the three hardware/installation boxes: the old app was deleted on
  2026-10-31 (CLI-007), and Linux and macOS are not machines this project runs on (EDIT-053,
  TERM-030). Strikes `CLI-007 box 2`, `EDIT-053 box 2`, `TERM-030 box 2`.

Both carry `confirmed by Txais 2026-10-31`.

```
$ node scripts/plan-check.mjs
head: cutline left 0/18 · merge gate 0 waiting · P0 cards passing 215/228 · done 719/775 tasks
plan-check: OK
```

## What was deliberately *not* struck

- **SAFE-004 box 3** — DT-C59 keeps it open on purpose. It is a product decision, not a machine
  limit, and the safe default is the answer.
- **USAGE-021 box 3** — it waits on T-547. That is future work, not an impossibility, so it stays
  open and stays counted.

The difference matters: a box is struck only when **no code change could ever close it**, not when
it is merely unfinished.

## Why strike instead of tick

A struck box is honest in a way a ticked one would not be. Ticking these would claim they were
verified; striking says only that they cannot be verified here. The spec keeps every box and its
text — nothing was deleted — and each strike can be reversed the day a Mac, a Linux machine or the
old installation is available.

## Not affected

The Windows halves of all three hardware cards are ticked with evidence and are untouched:
CLI-007 box 1, EDIT-053 boxes 1/3/4, TERM-030 box 1.

## Gates

| Gate | Result |
|---|---|
| `node scripts/plan-check.mjs` | `plan-check: OK`, 215/228 P0, 719/775 tasks |
| `vitest run scripts/plan-check.test.mjs` | 10 tests passed |
