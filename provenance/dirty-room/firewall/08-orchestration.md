# Firewall scrub report · 08 Orchestration

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/08-orchestration.json` (67 cards: 65 from round 0, D-08-066 added
  by critic round 1, D-08-067 by critic round 2; round 3 added rules only)
- Output: `spec/08-orchestration.md` (ids ORCH-nnn, number taken from D-08-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 17 | 17 |
| P1 | 31 | 31 |
| P2 | 10 | 10 |
| H | 5 | 5 |
| X | 0 | 0 |
| D | 4 | 4 |
| **Total** | **67** | **67** |

Sort order in the spec: tier, then `pushed` (null last), then id. A generator copied tier, pushed and
state from the raw JSON and checked every card: no card missing, no extra card, every card has at least
two acceptance items, and Decision lines appear on the H and D cards only (9). All prose was rewritten,
not transcribed: titles, user does, user sees, rules, acceptance, compat and decision. The spec also
has a `## Dropped by default (tier D)` section listing 4 cards and a `## Hidden or retired (tier H)`
section listing 5.

## Leaks found and how each was fixed

Method:
1. A naive render of the raw card prose was run through `scripts/firewall-check.ps1`. It found 75 hits.
2. The raw cards were read by hand against the forbidden list, which found 7 more leaks.
3. The spec was then put through the similarity hunt below.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Stored and wire values (snake_case) | 26 tokens | Message types, result values and ids. worker_done ×8 (003, 014, 015, 023). outcome_unknown ×3 (017, 038). already_released ×3 (024). release_pending and release_unknown ×3. Message and delivery ids ×4. merge_ready, dispatch_id, decision_gate and run_id ×5. | Prose uses plain words, such as "worker-done report", "release outcome unknown" and "already released". A value the user types as a flag argument appears only inside a `kolux orchestration …` command span on a Compat line. No stored key is named. |
| Settings keys and fields (camelCase) | 10 tokens | The routing setting ×2 (018). The nested depth setting ×2 (032). The Agent Teams mode setting ×2 (041). The wait setting ×2 (020). The leftover-resources field (017). The structured chat flag (049). | Each is named the way the user sees it: "the Model routing section of the Agents settings page", "nested worker depth", "Agent Teams mode preference", "structured native chat flag". The leftover-resources field is described as behaviour. |
| File name | 1 | D-08-015 example of a changed file | Replaced with "one changed file". |
| Inline code that is not an interface | 38 spans | Command spans without the `kolux` prefix. The keepalive and heartbeat marker keys. Group tokens. The dev build's command name. JSON option literals. | Commands were rewritten as full `kolux …` spans or as prose. The marker keys are described, not named ("a keepalive marker every 15 seconds"). Group tokens moved into kolux spans. The dev build is called "a development build". JSON literals became "a JSON list of strings". |
| Paths | 2 | D-08-043, the two home-directory skill folders | Called "the shared cross-agent skills folder in the home directory" and "Claude's own home skills folder". |
| Error text | 1 | D-08-028, the missing-gate refusal | The refusal is described, not quoted. |
| JSON payload literal | 1 | D-08-009, the example payload | Rewritten as "a JSON payload". |
| Internal stage token | 1 | D-08-017, the setup-stage marker | Rewritten as prose: "the receipt names setup as the stage reached". |
| Internal call name | 1 | D-08-047, the retired coordinator's runtime method | Rewritten as "the retired coordinator command". |
| Library/protocol name | 1 | D-08-051, the transport used by the remote runtime | Generalised to "a local channel" or "the network". |

Leaks fixed (counted): 75 script hits + 7 manual = **82**.

The `evidence` field is not rendered. It stays in cards-raw only and is not counted as a leak.

## Firewall script

- First run on the generated spec: `firewall-check: 0 hit(s) across 1 file(s)`.
- Final run, after all similarity rewrites and regeneration: `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

Method: an exhaustive search, stronger than three phrases per card.

- Pass 1 used ripgrep with fixed-string, case-insensitive matching over `src`, `tests`, `docs`,
  `README.md`, `HANDOFF.md` and `HANDOFF-HISTORY.md`. A control count gave the same file total (1,053)
  with the default thread count and with `-j4`, so no results were dropped.
- Pass 2 was a whitespace-normalised substring search over the 40 markdown files under `docs`, plus
  README and both HANDOFF files. It catches phrases split across lines.

| Run | Phrases | Matches | Action |
|---|---|---|---|
| Picked set, 3 per card from each card's three longest clauses | 200 | 0 | — |
| Clause shingles of the draft card prose | 3,659 | 13 | All rewritten, see below |
| Clause and raw-token shingles after the rewrites | 6,988 | 0 | — |
| Every prose line of the finished file: scope, Dropped and Hidden lists, Compat and Decision lines included | 8,903 | 1 | Rewritten |
| Final, every prose line, pass 1 | 8,924 | 0 | — |
| Final, every prose line, pass 2 (markdown, wrap-insensitive) | 8,924 | 0 | — |

The 14 hits were generic phrasings shared with old comments, help text and docs. Each was rewritten
with different structure:
- "the chat session is not attached on this …" became "has no attachment on this computer".
- "report that does not come from …" became "sent from any terminal other than the worker's own".
- "while one is still in flight" became "the repeats join the first one".
- The settings breadcrumb was rewritten as "the Model routing section of the Agents settings page".
- "means Kolux looked and found no …" became "says Kolux checked and saw no open prompt".
- "not every worker has a terminal" became "some workers have no terminal at all".
- "exits while its own stop is …" became "if the process ends during its own stop …".
- "must be a JSON array of …" became "choices are written as a JSON list of strings".
- "the daemon session is still alive" became "whether or not the daemon's session for them survived".
- "must run in the live coordinator …" became "only the coordinator agent terminal that is live right
  now can do it".
- "the host refuses a structured session" became "the host declines to open a structured session".
- ORCH-054's title became "The command line reaches the open app through a local channel".
- "is the single source of truth" became "taken from the published inventory and nowhere else".
- ORCH-010's "a JSON array of task ids" became "a JSON list naming the tasks waited on".

Similarity hits fixed: **14**.

## Allowlist candidates

None are required. Every hit was resolved without changing the allowlist. Typed interface values all
sit inside `kolux orchestration …` spans, where the existing `re:^kolux(\s|$)` rule already admits them:
- the message types worker_done, merge_ready and decision_gate (after `--type`);
- the terminal states release_pending and release_unknown (after `--terminal-state`).

The clean room may need to write these values outside a command span. If so, they are the candidates:
`worker_done`, `merge_ready`, `decision_gate`, `release_pending`, `release_unknown`.

## Residual risks

1. The keepalive marker's literal name was withheld because it is an internal key. If the owner's
   skills look for that exact marker, the rebuild must re-derive it from the skill guide, not from this
   spec.
2. "tmux" is named as the outside protocol that Claude Agent Teams uses (ORCH-041). It is the third
   party's interface, not a dependency of the old app.
3. Model ids (the gpt-5.6 sol/terra/luna family, plus fable, opus, sonnet and haiku) are kept as the
   names the user types in model routing.
4. Some acceptance items were written at this stage. Many raw cards had only one item, and the D and H
   cards had "n/a — decision item". These items come from each card's own user-sees, rules and
   decision text, not from new evidence.
5. Tier questions for the owner:
   - ORCH-045 (the Runs view behind the experimental dashboard flag) duplicates D-05-030.
   - ORCH-060 may belong in D along with area 18.
   - The Agent Teams launcher (ORCH-041) is P1 but does not work on the owner's Windows platform.
   - Legacy takeover (ORCH-048) is H, but an importer may still need to carry old Runs.
6. The depth cap is a fixed default plus a flag (ORCH-032, ORCH-044). The flag's name is left for the
   rebuild to choose.
7. Confidence is low that the bare-shell rule in ORCH-014 can be reached in practice.
8. The flag lists on the Compat lines mirror the old command-line help. They are interface and allowed,
   but they set the rebuild's flag surface one for one.
9. Concrete numbers are carried as behaviour facts: the 15-second keepalive and the default timeout for
   questions both come from help text. They mirror the old implementation's constants.
10. Pass 1 matches line by line in code and tests. A copied phrase split across two lines of a source
    comment or a multi-line test title would not be caught. Markdown was covered by pass 2.
