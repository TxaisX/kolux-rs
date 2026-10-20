// T-301 (APP-012, SET-041): the app icon variant and the window background blur. Rust reads the same
// keys (src-tauri/src/app_look.rs) and puts them on the window; the page only keeps the CSS side of
// the blur (a see-through background) in step. The key `appIcon` is shared with the settings tidy.
export const ICON_FIELD = "appIcon";
export const BLUR_FIELD = "windowBlur";

export const APP_ICONS = [
  { id: "classic", label: "Classic" },
  { id: "watercolor", label: "Watercolor" },
  { id: "blue", label: "Blue" },
] as const;
export type AppIcon = (typeof APP_ICONS)[number]["id"];

/** SET-041: an unknown or missing value means Classic. */
export function appIcon(s: Record<string, unknown>): AppIcon {
  const v = s[ICON_FIELD];
  return APP_ICONS.some((i) => i.id === v) ? (v as AppIcon) : "classic";
}

/** APP-012: blur is off by default; only a saved `true` turns it on. */
export function blurOn(s: Record<string, unknown>): boolean {
  return s[BLUR_FIELD] === true;
}

type Host = { dataset: DOMStringMap };

/** Marks the page so styles.css lets the blurred window show through the background. */
export function applyWindowBlur(s: Record<string, unknown>, root: Host | undefined = typeof document !== "undefined" ? document.documentElement : undefined): void {
  if (!root) return;
  if (blurOn(s)) root.dataset.windowBlur = "on";
  else delete root.dataset.windowBlur;
}

export function appLookSummary(s: Record<string, unknown>): string {
  const icon = APP_ICONS.find((i) => i.id === appIcon(s))!.label;
  return blurOn(s) ? `${icon} icon · Blur` : `${icon} icon`;
}
