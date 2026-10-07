# Area 18 — Dropped inventory (single agent, no cards)

**Goal:** `provenance/dirty-room/dropped-18-inventory.md`, a complete list by name of what the
owner dropped with area 18, so `DECISIONS.md` can record each item with its reason, and the data
importer knows what to skip. You own that one file.

## Inputs

- `briefs/00-shared.md` (read fully; the area 18 row and the "stays elsewhere" list matter most).
- `dumps/tests/18-remote-hosts-DROPPED.describes.txt` (fully) and `.files.txt` (skim the folders).
- `dumps/cli/`: the help files for the `environment`, `vm`, `emulator`, `host`, `serve`, `mobile`,
  `ssh`, `relay` words (grep the file names), plus `_tree.txt`.
- `dumps/registries/settings-sections.tsv` rows ssh, servers, mobile, mobile-emulator;
  `settings-keys.tsv` rows containing ssh, remote, host, relay, mobile, emulator, vm, wsl, serve, speech;
  `menu-items.tsv` and `keybindings.tsv` rows with those words.
- `dumps/records/handoff-history-index.csv` rows mentioning remote, ssh, mobile, relay, WSL, emulator,
  VM, serve, pairing — read those HANDOFF-HISTORY entries in the old repo (read-only) for dates.
- Old-repo source only to resolve what a feature did (grep, then read 40–80 lines).

## Output (`dropped-18-inventory.md`)

1. `## Dropped features` — a table: feature · what the user could do (one sentence, own words) ·
   where it surfaced (settings page, menu, CLI group, view) · first/last date seen · evidence
   (paths allowed here). One row per distinct feature, not per test. Expect 25–60 rows.
2. `## Looked remote but stays` — the local daemon that keeps terminals alive across restarts, the
   local hook server, `kolux status` / `kolux open`, WSL path handling that the 10-06 close-out made
   local again, and anything else in those folders that the local app depends on; name the area each
   belongs to (03, 04, 12, 19, 20).
3. `## Importer must skip` — the data categories the profile importer must leave behind (remote host
   records, saved environments, pairing codes, mobile pairing, speech models, emulator settings) with
   where they live in the profile (`%APPDATA%\kolux` or `~/.kolux`) if the code shows it.
4. `## CLI groups removed` — environment, vm, emulator, host, serve, and any other 18-only group or
   command, each with its one-line purpose.
5. `## Counts`.

Last action: `git -C G:\Dev\Kolux\kolux status --short` → must print nothing.

## Return (data only)

```json
{ "features_dropped": 0, "stays": 0, "importer_skip": 0, "cli_groups_removed": 0,
  "old_repo_clean": true, "notes": ["..."] }
```
