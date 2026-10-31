# APP-059 box 1 is proven, and a strike I got wrong is withdrawn

<!-- html -->

Release **v0.1.3** shipped, which satisfies APP-059 box 1 on its own terms. In the previous PR I had
struck that box as untestable. That was a misreading and is corrected here.

---

## The release

```
release 0.1.3 from main a1c590d (project 0.1.0, newest release v0.1.2)
  Compiling kolux-rs v0.1.3
  Finished `release` profile [optimized] target(s) in 15m 06s
  Finished 1 bundle: Kolux RS_0.1.3_x64-setup.exe (11.27 MiB)
smoke test passed: the installer, kolux --version, --help and the old-profile migration all say 0.1.3
signed 0.1.3; the signature checks out against the public key the app carries
published 0.1.3 to TxaisX/kolux-rs
```

| | |
|---|---|
| Previous release | v0.1.2 |
| This release | **v0.1.3** |
| Assets | `Kolux.RS_0.1.3_x64-setup.exe`, `.exe.sig`, `latest.json` |
| Notes | one line per shipped commit, plus the `<!-- kolux-rs-source: … -->` marker |

## The box, and my error

APP-059 box 1 reads:

> Ship to main → a release one patch higher appears with the three files and notes listing the
> shipped commits.

DT-C54 says GitHub CI is not used and that APP-059 box 1 is "a release run on GitHub's runners…
not applicable". I took that at face value and struck the box in PR #27.

**The card does not say that.** It says a release appears when you ship — and this release, built
and published from this PC under DT-R40, meets every one of its conditions. A decision's gloss is not
the card, and I should have checked the card's own words before striking it.

The strike is removed. APP-060 box 1 — which genuinely asks for *four CI shards* — stays struck.

## Why the count does not move

P0 stays at **215/228**, and that is the honest figure:

- Before: APP-059 passed because a *struck* box counts as passing
- After: APP-059 passes because the box is **ticked with evidence**

Same number, entirely different quality. One was a declaration that the card could not be judged; the
other is a run that satisfies it. A scoreboard that reaches the same total by better means is worth
more than one that gains a point.

## Evidence

`evidence/APP-059-release-013.txt` records the version step, the three assets, the notes body, the
source marker and the release job's own output lines.

## Verified

| Check | Result |
|---|---|
| `gh release list` | v0.1.3 published 2026-10-31T09:08:01Z |
| `gh release view v0.1.3` | three assets present |
| `plan-check` | `plan-check: OK`, APP-059 in the passing list, 215/228 |
| Strikes remaining | APP-060 box 1, CLI-007 box 2, EDIT-053 box 2, TERM-030 box 2 |
