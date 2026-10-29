# Launch + agents rework, 2026-10-28

Txais's evening asks: a chooser instead of an instant terminal, no starter kits, one default model and effort,
OpenCode back, every agent in one dropdown with Install, then a faster install that people pick from.

## What shipped

| Round | Tasks | Main |
|---|---|---|
| 1 | T-568 kits removed · T-569 new workspace opens the launch chooser · T-570 agent dropdown + Install · T-571 one default model/effort (opus/high) · T-572 OpenCode back, Hermes wired · T-573/T-574/T-576 install table, `agents_install`, `--install-agents`, OFFICIAL allow-list · T-575 status-line test · T-577 merge fixes | 52e03a72 -> 7c2a924b |
| 2 | T-578 batch engine (`agents_install_many`, `agent-install-progress` event, npm in one call, scripts 4 at once, winget/uv in order; installer no longer installs agents) · T-579 "Install coding agents" picker in the first-run wizard and Settings > Agents | 7c2a924b -> b246e387 |

## Measurements

- Round 1 install-all on this PC, one at a time: 25 installed, 6 already present, OpenClaw failed (Node 24.19.0 below its engines floor), ante/trae/rovo website-only; about 10-15 min.
- Round 2 engine: 5 npm agents reinstalled in 48 s (evidence/T-578-timing.txt).
- Live picker check (scratch profile, Settings > Agents, only OpenClaw ticked): button read "Install selected (1)", row went Installing… -> Installed in 95 s.
- Real `--install-agents --interactive openclaw` after Txais upgraded Node to 26.13.0: ok in 1 min 43 s, `openclaw --version` = OpenClaw 2026.10.8.

## Round 2 merge gates (lane/launch-merge-2)

cargo build ok · clippy 0 · cargo test --lib 2551 passed · integration tests 246 passed, 0 failed (scratch USERPROFILE/HOME, real RUSTUP_HOME/CARGO_HOME) · tsc 0 · pnpm test 4975/4975 (676 files, TEMP scratch) · plan-check OK · firewall 0 new · smoke 4/4 (evidence/smoke-776488f9.txt).
cargo-deny: advisories FAILED with no Cargo.lock change since round 1 (new RUSTSEC entries; after-list row). overlap.mjs not run (needs an attached app).

## Found on the way (after-list rows)

- A scratch app run that installs OpenClaw writes the scratch npm folder into the real user PATH (HKCU); detection then counts OpenClaw as installed. Removed by hand.
- OpenClaw's Node engines floor gives an unclear failure sentence.
- New RUSTSEC advisories: zip (via tauri-plugin-updater) and pulldown-cmark, plus unmaintained zbus crates.
- PC note, not Kolux: Node 26 no longer ships corepack, which broke every `pnpm` shim; fixed with `npm i -g corepack` + `corepack enable --install-directory ~/.local/bin pnpm` (same pnpm 12.0.0).

## Decisions (overrulable, in DECISIONS-history.md)

Kits gone; one default model/effort; chooser on new workspaces; OpenCode back; the installer installs no agents and every installable, not-installed agent starts ticked in the picker.

## Round 3: fixes from the after-list (2026-10-29, main 155280c3 -> 91262628)

| Task | What changed |
|---|---|
| T-580 | A fenced (debug + scratch) install batch saves the real user Path before script installs and writes it back afterwards (also on panic); a real run ignores Path folders below a scratch or smoke-temp marker; an npm engine refusal reads "OpenClaw needs a newer Node.js (>=24.22.1 <25 \|\| >=26.12.1). Update Node.js (winget upgrade OpenJS.NodeJS.LTS), then install again." |
| T-581 | cargo-deny green: pulldown-cmark 0.13.4 -> 0.13.5; zip x3 (tauri-plugin-updater 2.13.3 is the newest 2.x, zip >= 9 only in the 3.0 alpha) and zbus_names/zvariant/zvariant_derive (notify-rust 4.18.2 pins zbus 5) recorded as deny.toml ignores with reasons. |

Gates on the merged lane: build, clippy 0, cargo-deny ok, lib 2565/2566 (pty row1014 timing test failed under load, passes alone; the deps builder saw the same), integration 246/0, tsc 0, pnpm 4975/4975, plan-check OK, firewall 0 new, smoke 4/4 (evidence/smoke-ae44023d.txt).
Overlap at 1400 and 1920: partial. A fresh scratch profile opens on the first-run screen, so 4 of the 8 standard pairs (top bar, pane header, group row) are not on the page; the 4 present are clear (evidence/fix-overlap-*.txt; after-list row to seed a workspace first).
