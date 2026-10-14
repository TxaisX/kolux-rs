// T-546-c (OD-09): the control tower in its own window, for a second screen. The main window keeps
// every pane; it sends the Tower window a snapshot of the seats and the usage cards whenever they
// change, and a row clicked in the Tower window opens that pane in the main window. When the window
// cannot be made (the permission is missing, the platform refuses) the Tower stays the switcher
// screen it is today and says so.
import type { AccountUsage, Seat } from "./tower";

export const TOWER_LABEL = "tower";
/** The Tower window loads the app's own page with this address; main.tsx draws only the Tower for it. */
export const TOWER_HASH = "#tower-window";
/** main -> tower: the seats and usage to show. */
export const TOWER_SNAPSHOT = "kolux-tower-snapshot";
/** tower -> main: the Tower window is up and wants the current snapshot. */
export const TOWER_READY = "kolux-tower-ready";
/** tower -> main: open this pane (its key) and bring the main window forward. */
export const TOWER_OPEN = "kolux-tower-open";

export type Snapshot = { seats: Seat[]; usage: AccountUsage[] };
/** A monitor in physical pixels plus its scale, as the window API reports it. */
export type Screen = { x: number; y: number; width: number; height: number; scale: number };

/** FIX-2 (council P3): whether the Tower's own window can open in this build. It needs a coordinator
 * change first (the window-creating capability, main.tsx drawing the Tower for its hash, a
 * tower-only capability, and closing the main window closing the Tower: T-546-c); until then
 * the Own window button is not offered, since every click would only show NO_WINDOW. */
export const OWN_WINDOW_WIRED = false;

export const isTowerWindow = (hash: string) => hash === TOWER_HASH;

/** The screen the Tower goes to: the first one that is not the main window's; none with a single screen. */
export function pickScreen(all: Screen[], current: Screen | null): Screen | null {
  return all.find((s) => !current || s.x !== current.x || s.y !== current.y) ?? null;
}

export function snapshotChanged(last: Snapshot | null, next: Snapshot): boolean {
  return last === null || JSON.stringify(last) !== JSON.stringify(next);
}

/** What openTowerWindow needs from the window system; the real one is below, tests pass their own. */
export type WindowApi = {
  /** Bring an open Tower window forward; false when there is none. */
  focus: (label: string) => Promise<boolean>;
  screens: () => Promise<{ all: Screen[]; current: Screen | null }>;
  /** Make the window; resolves false when it could not be made. */
  create: (label: string, opts: Record<string, unknown>) => Promise<boolean>;
};

export type OpenResult = "opened" | "focused" | "failed";

export async function openTowerWindow(api: WindowApi = tauriWindows): Promise<OpenResult> {
  try {
    if (await api.focus(TOWER_LABEL)) return "focused";
  } catch {
    // no window to bring forward, or not allowed to: try to make one
  }
  const screens = await api.screens().catch(() => ({ all: [] as Screen[], current: null }));
  const to = pickScreen(screens.all, screens.current);
  // Window options are in logical pixels; a monitor reports physical ones.
  const place = to
    ? { x: to.x / to.scale, y: to.y / to.scale, width: to.width / to.scale, height: to.height / to.scale, maximized: true }
    : { center: true, width: 1200, height: 800, maximized: false };
  try {
    return (await api.create(TOWER_LABEL, { url: `index.html${TOWER_HASH}`, title: "Kolux Tower", focus: true, ...place })) ? "opened" : "failed";
  } catch {
    return "failed";
  }
}

const screenOf = (m: { position: { x: number; y: number }; size: { width: number; height: number }; scaleFactor: number }): Screen => ({
  x: m.position.x,
  y: m.position.y,
  width: m.size.width,
  height: m.size.height,
  scale: m.scaleFactor || 1,
});

/** The real window system (Tauri 2). Loaded lazily so the module stays importable in tests. */
export const tauriWindows: WindowApi = {
  focus: async (label) => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const w = await WebviewWindow.getByLabel(label);
    if (!w) return false;
    await w.unminimize().catch(() => {});
    await w.setFocus();
    return true;
  },
  screens: async () => {
    const { availableMonitors, currentMonitor } = await import("@tauri-apps/api/window");
    const [all, current] = await Promise.all([availableMonitors(), currentMonitor()]);
    return { all: all.map(screenOf), current: current ? screenOf(current) : null };
  },
  create: async (label, opts) => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const w = new WebviewWindow(label, opts);
    return new Promise<boolean>((done) => {
      void w.once("tauri://created", () => done(true));
      void w.once("tauri://error", () => done(false));
      setTimeout(() => done(false), 5000);
    });
  },
};
