# Evidence harness

Proof screenshots for `evidence/<task>.png` come from the running app, never from the screen. Start the app with `pnpm tauri dev`, then from Windows PowerShell:
- `.\scripts\evidence\shot.ps1 -Out evidence\T-00x.png` captures the Kolux RS window by PrintWindow (the window paints itself into the file, so nothing else on screen is caught); `-Grow 200` enlarges the window first.
- `.\scripts\evidence\type.ps1 -Click "120,140" -Text "hello`n" -Out evidence\after.png` posts a click and keystrokes straight to the app's web view child window and captures afterwards; the shared keyboard and mouse are never used, so nothing lands in another program.
- Coordinates are client pixels of the web view, top-left origin; take a plain shot first to find them.
