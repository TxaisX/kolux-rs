# Reclaiming the old Kolux from your PC

Written 2026-10-30 for Txais, who asked that day for "removing the original kolux and all of its
information beside the documentation build of this application so that we can keep a digital report
on it in the github repo". This page says what the old Kolux left behind, what is safe to delete, what
must stay, and the order to do it in. Nothing here has been deleted on your PC yet: you do that
yourself, with the script `scripts\reclaim-old-kolux.ps1`.

The repository side is already done: the screenshots of the old app that were kept in this repository
were removed on 2026-10-30 (see PROVENANCE.md). The design measurements made from them stay, because
Kolux RS uses them.

## What the old Kolux left on the PC

- **Its code folders on G:\Dev.** The old repository, its scratch and workspace folders, and backup
  copies of it. They are the folders named in the first three bullets of section 0 of `LOOP.md` (the
  "NEVER open" list). This page does not repeat their names; the script reads them from `LOOP.md`.
  Together with the rest below they take **about 408 GB**.
- **The installed app.** The old Kolux program itself, installed under your user's programs folder.
- **Its agent hooks.** Small scripts the old app put in the `agent-hooks` folder inside `.kolux` in
  your user folder (`~\.kolux\agent-hooks`). Claude Code and other agents may still be set up to run
  them.
- **Your own settings and data** in `~\.kolux` and `%APPDATA%\kolux`. These are yours, not the old
  app's code, and Kolux RS still uses them (see below).

## Safe to delete

| What | How |
|---|---|
| The old code folders on G:\Dev (repo, scratch, workspaces, backups) | The script, with `-Delete` |
| The installed old app | Windows **Settings > Apps > Installed apps > Kolux > Uninstall** |
| The old hook scripts in `~\.kolux\agent-hooks` | The script, with `-Delete` (only that one folder) |

## Must STAY

- **`~\.kolux` and `%APPDATA%\kolux` as a whole** (except the agent-hooks folder above). Kolux RS's
  importer reads them, and Kolux RS reads your shortcuts from `~\.kolux\keybindings.json`.
- **Anything under `~\.kolux-rs`.** That is Kolux RS's own data, including its release signing key.
- **Your vault notes** (Txais Brain).
- **`G:\Temp\live-signin`.** Test account A for the live checks now lives there.
- **This repository** (`G:\Dev\kolux-rs`). The script refuses to touch it.

## The order

1. **Close the old Kolux and Kolux RS.** Nothing should be using these folders while they go.
2. **Uninstall the old app** (Settings > Apps > Installed apps > Kolux > Uninstall). Do this first.
   The old app's hooks may still be listed in Claude Code's settings file (`~\.claude\settings.json`).
   If the hook scripts are deleted while those entries remain, every Claude session prints hook errors.
   Uninstalling takes the entries out first. Kolux RS's own hooks live elsewhere and are not affected.
   (The script checks this too: while Claude Code's settings still point at the old hooks folder, it
   keeps that folder.) Make sure you uninstall the old Kolux, not Kolux RS, if both are listed.
3. **Sign test account A in at its new folder.** The live checks used to keep test account A inside
   one of the old scratch folders, which the script deletes. They now use
   `G:\Temp\live-signin\account-a` (or the folder in the `KOLUX_LIVE_ACCOUNT_A` setting, if you set
   one). Open a terminal and run:
   ```
   $env:CLAUDE_CONFIG_DIR = 'G:\Temp\live-signin\account-a'; claude
   ```
   then sign in with test account A and close it.
4. **Run the reclaim script.** In PowerShell 7, from this repository's folder:
   ```
   pwsh -NoProfile -File scripts\reclaim-old-kolux.ps1
   ```
   This only lists the folders and their sizes; it deletes nothing. Check the list. Then run it again
   with `-Delete`:
   ```
   pwsh -NoProfile -File scripts\reclaim-old-kolux.ps1 -Delete
   ```
   It asks you to type `DELETE` (capital letters). Anything else stops it. It then removes each folder
   and prints how much space came back, about 408 GB in all.

What the script will not do: it takes only the G:\Dev folders that `LOOP.md` section 0 lists, refuses
anything outside G:\Dev or G:\Dev itself, refuses this repository, and from `.kolux` removes only the
agent-hooks folder. Folders that are already gone are skipped.

## The old GitHub repositories

The two old repositories on GitHub, **TxaisX/kolux** and **TxaisX/kolux-releases**, are being
**archived by you, not deleted**. An archived repository stays readable (useful as a record) but nobody
can change it. For each of the two:

1. Open the repository on github.com.
2. Go to **Settings**, scroll to the **Danger Zone** at the bottom.
3. Click **Archive this repository** and confirm by typing the repository's name.

You can undo this later with **Unarchive this repository** in the same place.
