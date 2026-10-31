# The live-proof harness could not run at all

<!-- html -->

`scripts/prove/live-installed.mjs` threw `ReferenceError: isMain is not defined` before doing
anything, and would have killed the session that ran it. Both are fixed.

---

## Bug 1 — the harness never started

Every command in the file is gated on a variable that was never declared:

```js
if (isMain && cmd === 'start') { … }
if (isMain && cmd === 'stop')  { … }
if (isMain && cmd === 'probe') { … }
```

Six references, no definition. The module failed at load:

```
ReferenceError: isMain is not defined
    at scripts/prove/live-installed.mjs:194
```

This is the harness the project's whole live-proof strategy depends on — 80+ per-card scripts and
nineteen open P0 cards waiting to be ticked by it. It could not execute a single one.

**Fix.** One line, using the `pathToFileURL` import that was already there:

```js
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
```

## Bug 2 — it would kill its own caller

`start` and `stop` call `closeRunning()`, which gracefully closes every `kolux-rs.exe` window. That
is correct when a proof is driven from a plain shell.

It is catastrophic when the proof is driven from **inside a Kolux terminal**, because Kolux hosts
the terminal service, the terminal service hosts the shell, and the shell hosts the proof. Closing
the app kills the proof, the terminal and the session that asked for it.

This is not hypothetical. The process chain that found the bug:

```
powershell.exe
  └─ opencode.exe
      └─ opencode.exe
          └─ kolux-rs.exe --terminal-service     ← closeRunning() would end here
```

**Fix.** A guard that reads the pane marker first, falls back to the parent chain for
`kolux-rs.exe`, and refuses before touching anything:

```
$ node scripts/prove/live-installed.mjs start
refusing: start/stop close every Kolux window, and this process is running inside a Kolux
terminal. That would end the session running the proof. Run it from a plain Windows Terminal
or PowerShell window instead:  node scripts/prove/live-installed.mjs start
```

Exit code 2, app untouched.

The reliable check is the pane marker. A terminal Kolux starts carries `KOLUX_APP_DIR` in its own
environment (CLI-007), every child inherits it, and it outlives the restarts that break the
process tree: a pane taken back from an earlier copy, or a shell an agent re-parented, no longer
has `kolux-rs.exe` anywhere in its ancestry. That is how the same loop came back after this guard
landed. The parent walk stays as the fallback for a pane older than the marker. Neither refuses on
a guess: if the walk cannot tell, the run is allowed, because a guard that blocks legitimate
proofs is worse than no guard.

## Consequence, revised the same day

The guard was the stopgap. The fix is **one copy per profile**: `lifecycle::mutex_name_for` and
`pty_service::lock_name` key the copy test and the terminal service's own lock on the profile
folder, so a proof on its scratch home is a first copy and runs beside the installed app.
`closeRunning()` now closes only the copy on its own profile, found by the pid in that profile's
`cli.json`, with the terminal service's command line as the fallback. Nothing else on the machine
is touched.

`PROVE_REAL=1` is the one mode that still closes the real app, and the one mode the guard refuses
to start from inside a Kolux terminal. Everything else can be run where the work happens:

```powershell
cd G:\Dev\kolux-rs
node scripts/prove/live-installed.mjs start
node scripts/prove/live-checks.mjs b7     # BROW-008 box 2
node scripts/prove/live-installed.mjs stop
```

## Verified

| Check | Result |
|---|---|
| `node scripts/prove/live-installed.mjs probe` | no longer `ReferenceError`; reaches CDP attach |
| `app001_one_copy_per_profile_and_two_profiles_run_side_by_side` | passes: one name per profile, case-insensitive, two profiles differ |
| `t075b_one_service_per_identifier_and_profile...` | passes: a second copy of the same profile is refused, another profile is not |
| `node scripts/prove/live-installed.mjs stop` with `KOLUX_APP_DIR` set | exit 2, app untouched |
