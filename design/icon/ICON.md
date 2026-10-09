# Kolux app icon and top-bar mark

## Provenance

Txais confirmed on 2026-10-08 that he made this icon; it carries over as-is. Recreated as vector from the on-screen rendering only.
No file of the old app was read: the only inputs were pixels Windows drew on screen (the taskbar) and an earlier PrintWindow capture of the Kolux window (`../reference/top-bar-left.png`).

## What it looks like

**App icon (`kolux-icon.svg`, viewBox 0 0 512 512).** A rounded square in deep indigo, darkening diagonally from top-left to bottom-right. In the middle sits a warm cream six-spoke asterisk. One spoke points straight up, one straight down, and the other four sit at 30 degrees above and below the horizontal, so the spokes are 60 degrees apart. Each spoke is a rounded bar that narrows to a thin neck where it meets a round centre dot. The glyph is slightly brighter at the centre than at the tips.

**Top-bar mark (`kolux-mark.svg`, viewBox 0 0 24 24).** The same six-spoke glyph on its own, filled with `currentColor`. In the old app it is drawn light grey on the dark top bar.

| Element | Value | Sampled from capture |
|---|---|---|
| Plate gradient, top-left | `#251c52` | interior near the top-left `#231b4e` |
| Plate gradient, bottom-right | `#0b0820` | interior near the bottom-right `#0d0a22` |
| Glyph, centre | `#fffaea` | centre pixel `#faf2dd` |
| Glyph, tips | `#f1e2c2` | spoke pixels `#f1e4c8`, `#e6dac1` |
| Top-bar mark in the old UI | `#c5c5c5` on `#171717` | exact, from the crisp top-bar capture |

| Geometry at 512 px | Value |
|---|---|
| Plate | 488 x 488, inset 12 px, corner radius 93 px (19% of the plate side) |
| Glyph span | about 307 px tip to tip (60% of the canvas), centred |
| Spoke width | 38 px at its widest, round tip |
| Centre dot | radius 34 px |

## What was captured, from where

| File | Source | Size |
|---|---|---|
| `capture-taskbar.png` | Screen copy of the whole primary taskbar (window class `Shell_TrayWnd`, 1920 x 48). Nothing clicked, no focus change. | 1920 x 48 |
| `capture-taskbar-button.png` (+ `@8x`) | Crop of the button named "Kolux - 1 running window" (AppID `com.txais.kolux`, x 1183 to 1227). Identified by reading the taskbar buttons' accessible names through UI Automation. | 44 x 48 button, icon 24 x 24 |
| `capture-topbar-mark.png` (+ `@8x`), `capture-topbar-left@8x.png` | Crop of the six-spoke mark from the earlier window capture `../reference/top-bar-left.png`. | 24 x 24, mark about 14 px |

The largest size Windows shows on screen without touching the app is **24 x 24 px** (the taskbar at 100% scaling). Comparing pipelines showed the taskbar icon matches best as a 32 px icon frame scaled down to 24 px: the error was 14.2, against 18.6 for a direct 24 px render. So Windows is downscaling a 32 px frame, which is why the capture looks soft.

## How the SVGs were fitted

`gen.py` builds both SVGs from about a dozen numbers (`params.json`). `joint.py` tuned those numbers against both captures together, using headless Edge renders. Fitting both at once forces one glyph shape to explain the crisp top-bar mark and the blurry taskbar icon. Final error, on a 0 to 255 per-channel scale:

- **Icon vs taskbar:** 10.7
- **Mark vs top bar:** 7.8

For comparison, a plain three-line asterisk (uniform bars, no dot) scored 18.6 against the top bar, so the narrowing spokes and centre dot are what the pixels show. `compare-icon.png` shows, left to right: the capture at 8x, the SVG through the same 32-to-24 path at 8x, the SVG at 32 px (6x), and the SVG at 256 px. `compare-mark.png` shows the top-bar capture, the SVG at 24 px, and the SVG at 240 px.

## How faithful it is

- **Confident:**
  - the plate shape, inset and corner radius (each to within a few px at 512)
  - the plate colours (within a few levels)
  - six spokes at 60 degrees with one vertical
  - glyph size and centring
  - cream on indigo
  - the centre dot
  - spokes that narrow toward the centre
- **Approximate:**
  - the exact neck profile, meaning how thin each spoke gets and how it joins the dot (it is about one pixel wide in both captures)
  - the spoke tip shape (drawn as round)
  - the glyph gradient, which may really be a flat cream with brightness added by overlap
  - whether the plate inset is real or comes from Windows scaling. The original artwork may be full-bleed.
- **Not recoverable from 24 px:** any detail smaller than about 20 px at 512 scale, such as an inner shadow, a subtle rim or texture. None is visible in the capture.

If the original source artwork still exists somewhere other than the old app's install folder (for example Txais's own design file), checking it against `render-icon-512.png` would settle the neck and tip details.
