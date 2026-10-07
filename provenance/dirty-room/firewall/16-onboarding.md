# Firewall scrub report · 16 · Onboarding & guidance

- Date: 2026-10-06 (16:10–17:10)
- Input: `provenance/dirty-room/cards-raw/16-onboarding.json` (42 cards: 41 from round 0, 1 from
  critic round 1, D-16-042; 15 notes; 186 evidence entries; last modified 16:03, after both critic
  coverage rounds `coverage/16-onboarding-r1.csv` 15:50 and `-r2.csv` 16:05, unchanged at the end of
  this pass)
- Output: `spec/16-onboarding.md` (830 lines, ids ONB-001 … ONB-042, number taken from D-16-nnn)
- Generator (dirty-room scratch, not shipped): rewritten prose in the session scratchpad
  `fw16-onboarding/onb-data.js`, rendered by `fw16-onboarding/gen.js`, which reads tier, pushed,
  state and related straight from the raw JSON so sorting, tier counts, the related-areas line and the
  H/D lists are mechanical. Structural check in `fw16-onboarding/check.js`.

## Cards written per tier

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 19 | 19 |
| P2 | 13 | 13 |
| H | 5 | 5 |
| X | 1 | 1 |
| D | 4 | 4 |
| **Total** | **42** | **42** |

Structural check (script): 42 headings, 42 unique ids, every `Source:` maps to the raw card with the
same number; tier, pushed and state match the JSON card by card; every card has User does / User
sees / Rules / Acceptance (at least 2) / Compat; `Decision:` sits on exactly the 9 H and D cards; the
X card (ONB-026) carries its replace verdict in its rules, as in areas 02, 06 and 21. Order is tier,
then pushed ascending with `null` last (`Pushed: —`), then id. Related areas line is the union of the
cards' `related` fields (01, 02, 03, 04, 05, 06, 07, 08, 09, 11, 13, 15, 17, 19, 20, 21).
Decisions: ONB-013 "H: default build" (the designed newcomer path, unreachable only through a version
gate); ONB-030, 035, 039, 041 "H: default skip"; 4 D cards "default cut: … Revive via DECISIONS.md."
No card is P0, matching the raw JSON (nothing in this area is in README "What it does" or in a
2026-09-22+ HANDOFF entry by the reader's reading); flagged below as a residual.

## Leaks found and fixed (6 forbidden tokens, plus 1 script hit on new wording)

| # | Category | Where (raw card) | Leaked token | Fix in spec |
|---|---|---|---|---|
| 1 | identifier (env var) | D-16-035 compat | the developer env var that re-enables first-run education (SCREAMING_SNAKE, `=1`) | "a developer-only environment variable switches first-run education back on" |
| 2 | identifier (key name) | D-16-022 rule | `ArrowUp` | "the up and down arrow keys, Home and End" |
| 3 | identifier (key name) | D-16-022 rule | `ArrowDown` | same sentence |
| 4 | schema (stored version numbers) | D-16-013 rule | onboarding flow version 5 vs 7 | "tied to an older stored onboarding version, but every profile is moved to the current version on load" |
| 5 | schema (field list) | D-16-007 compat | flow version / closed time / outcome / last completed step / checklist booleans / milestone times as a field list | data categories in words: "which wizard version it belongs to, when it closed, whether it was completed or dismissed, the last completed screen, the checklist ticks and the milestone times" |
| 6 | library / web API | D-16-023 rule | per-browser local storage (the web storage API) | "kept in browser-side storage on this machine, not in the profile" |

Script hit on new wording (not a leak from the raw card): `[code-keyword] import l` on line 543 —
the English phrase "a profile import loses it" tripped the import-statement pattern. Rewritten to
"moving to another profile by importing loses it". After that the script reported 0 hits.

By category: identifier 3, schema 2, library 1. None in the categories path, UI copy over six words,
or verbatim error text. All 186 `evidence` entries (paths with line numbers, test files, registry
keys) and every file name in the 15 notes stayed in cards-raw; none reached the spec. Quoted labels
kept, all six words or fewer: Get started, I'll do this later, Pick a folder, Try with sample data,
Start kit, Just open a session, Skip, No, keep going, Onboarding, Getting Started with Kolux,
Milestones, Hide from sidebar, Explore Kolux, Install CLI & Skills, Got it, Split terminal, Later,
Star on GitHub, Dismiss, Open GitHub. The eight Setup Guide step names in ONB-014 are on-screen labels
of five words or fewer.

Other rewrites (not forbidden tokens, internal jargon replaced with behaviour words): "launch-agents
modal" → launch-agents window; "on the next tick" → straight afterwards; "shared checkout" → the
project's main copy rather than a separate worktree; "re-renders" → a redraw; "mounted / unmount" →
content stays in place / teardown; "IME composition" → input-method composition; "flow version" →
wizard version. Every sentence of every card was rewritten in new words rather than lightly edited.

Notes folded into cards (behaviour the clean room needs, taken from the raw `notes`):
- ONB-006: the skip question must name the real way back (the help menu's Onboarding item); at 0.15.0
  it names Explore Kolux, which neither reopens the wizard nor replays the grid tour.
- ONB-011: milestones show nowhere but copied diagnostics; the planned About-box line was never built.
- ONB-012: nothing replays the grid tour at 0.15.0.
- ONB-017: owner question on the WSL routing (area 18 cuts WSL execution).
- ONB-023: visit state lives outside the profile, so importing loses it; the rebuild should decide.

Format completions (18 acceptance checks added; raw 83 usable checks → spec 101):
- 8 cards had only an "n/a — decision item" placeholder (D-16-019, 021, 030, 034, 035, 039, 040,
  041). Each now has two checks: "the rebuild does not offer it" plus "if revived / if built: …",
  derived from the card's own rules.
- 2 cards had a single check: D-16-013 (added: with the first two items ticked the checklist points at
  open results, from its fixed-order rule) and D-16-026 (added: no tile shows remote workspaces).

## Similarity hunt

Three passes; the first two used ripgrep, the third a deterministic scan written for this pass,
because ripgrep turned out to drop matches when given a large pattern file.

- Pass 1 (rg): 6,790 windows (six consecutive words; raw with punctuation, and punctuation-stripped
  within each clause) from all spec prose, `rg -iF -o -f <windows>` over src, tests, docs, README.md,
  HANDOFF.md, HANDOFF-HISTORY.md. 1 hit: "and fails the build if a"
  (docs/reference/linux-glibc-compatibility.md:68) in ONB-036 → "a banned word found there breaks
  the build".
- Pass 2 (rg over the whole tracked tree): 6 hits, all rewritten:

| Phrase | Old-repo location | Spec card | Rewrite |
|---|---|---|---|
| "the live grid: what a session" | specs/business-frame/SPEC-guided-first-run.md:37 | ONB-012 sees | "a tour of three callouts laid over the running grid, explaining what a session is" |
| "a ping when an AI is" | specs/business-frame/SPEC-guided-first-run.md:47 | ONB-005 sees | "a switch, on at first, asking for a ping whenever an AI finishes" |
| "split step when the split command" | src/renderer/src/store/slices/ui-contextual-tours.test.ts:343 | ONB-033 rule | "running the split command carries the parallel-agents tour past its split step" |
| "can wait for another tour to" | src/renderer/src/components/contextual-tours/request-contextual-tour-when-ready.test.ts:75 | ONB-032 rule | "is able to hold off until a different tour has finished" |
| "every required input and an agent" | src/renderer/src/components/onboarding/use-onboarding-kit-state.ts:24 and its test:91 | ONB-005 rule | "already fills in all the inputs the kit needs and some agent is ready to use" |
| "so first-launch setup is ready to" | src/renderer/src/components/onboarding/onboarding-feature-setup.test.ts:109 | ONB-017 rule | "all setup items begin switched on, so setup on the first launch can run right away" |

- Tooling finding: ripgrep 15.0.0 (the copy bundled with VS Code; `rg` is not on PATH) is not
  reliable with a 6,800-line `-iF -f` pattern file across several search roots. The same command gave
  1, 1, then 4 matching files on three identical runs, and `-o` with the default thread count returned
  nothing where `-j1` or a single root found the matches. Pass 1 therefore under-reported, and the
  "0 hit" lines other areas got from the same method may be under-counted too.
- Pass 3 (deterministic, node): every six-word window of the spec prose, punctuation ignored and
  crossing clause boundaries (6,155 unique windows), compared with every six-word run in all 22,591
  tracked text files of the old repo (about 149 M characters: src, tests, docs, specs, config, the
  three root records and the rest). This is stricter than the brief's rg check, since punctuation
  never hides a match. First run: 12 matching windows in 7 passages, all rewritten:

| Phrase | Old-repo location | Spec card | Rewrite |
|---|---|---|---|
| "gitlab bitbucket azure devops gitea jira" | config/scripts/locale-ko-value-overrides.mjs:212, config/scripts/locale-translation-policy-ko-round5.test.mjs:37, src/renderer/src/i18n locale files | ONB-019 decision | providers listed in a different order |
| "first ai connected first kit launched first results opened" (4 windows) | specs/business-frame/SPEC-guided-first-run.md:60–61 | ONB-011 rule | "the first time an AI is connected, the first kit launch, and the first time results are opened" |
| "worktree checkout clone repo pty cli shell" (2 windows) | specs/business-frame/SPEC-plain-language.md:61 | ONB-036 rule | banned words listed in a different order |
| "the rest of the app uses" | src/renderer/src/components/github-project/GhAuthErrorHelp.tsx:94 | ONB-003 sees | "the same Connect cards found elsewhere in Kolux" |
| "the latch so the user can retry" (2 windows) | src/renderer/src/components/onboarding/use-onboarding-flow-persistence.ts:47 | ONB-007 rule | "a failed store frees it again so another attempt is possible" |
| "welcome connect an ai your work" | src/shared/constants.ts:45 | ONB-001 rule | "the screens always run welcome first, then connecting an AI, then the user's work, then picking a kit" |
| "no keep going returns to the" | tests/e2e/onboarding.spec.ts:651 | ONB-006 rule | "'No, keep going' puts the user back on the screen they were on" |

- Pass 3 re-run after the fixes: **0 spec hits**. Positive controls appended to the window set were all
  found: "Kolux is a desktop workspace for" (README.md:5), and the two pre-fix phrases "every required
  input and an agent" (onboarding kit-state source :24 and test :91) and "can wait for another tour to"
  (contextual-tour test :75), so the scan finds both prose and source-code matches.
- Totals: 14 passages rewritten (1 + 6 + 7), covering 19 matching windows.

## Final firewall script line

```text
firewall-check: 0 hit(s) across 1 file(s)
```

The script reported 1 hit on the first run (the "import" false positive above) and 0 on every run
after that, including after each similarity rewrite.

## Allowlist candidates (not edited)

None. No legitimate interface token had to be rewritten around: the spec quotes no `kolux` command, no
hook event, and no keybinding id. The developer environment variable from D-16-035 is internal to dev
builds, not a user interface, so it is not proposed.

## Residual risks

1. No P0 cards. The guided first run, Connect AI screen and jargon guard belong to theme 6 (business-
   user frame), which is not a top-5 theme, so the reader tiered them P1 (14 cards pushed 6, 1 pushed
   10, 27 unpushed). A reviewer may want to confirm that no HANDOFF "Recent work" entry dated
   2026-09-22 or later names them, which would make them P0.
2. Tuned constants carried over as behaviour: card about 860 × 880 px; half-second reopen debounce;
   about fifty prompt checks; about twenty tour-target attempts; one automatic tour per session; star
   threshold 35 agents, three-day cooldown, doubling; about one second of quiet before the
   finished-task prompt; about forty tracked features. User-visible, but the old app's chosen numbers.
3. Lists of names kept as behaviour: the eight Setup Guide step labels (ONB-014), the five Explore
   Kolux workflows and their sub-stops (ONB-022), the tour catalogue (ONB-033), the banned plain-
   language words (ONB-036, reordered). They are on-screen labels or the rule itself, each item short.
4. The 18 added acceptance checks are derived from each card's own text, not from an old test.
5. ONB-017 and ONB-028 keep the WSL routing rules with an owner question attached; area 18 cuts WSL
   execution, so the owner may drop them.
6. The critic notes that the old end-to-end onboarding tests still drive the retired five-step
   wizard; the clean room needs new end-to-end checks for ONB-001 … ONB-012 (the spec's acceptance
   lines are the starting point).
7. The ripgrep reliability finding above applies to every area whose similarity hunt used a large
   `-f` pattern file; the orchestrator may want those hunts re-run with a single root, `-j1`, or a
   deterministic scan.
