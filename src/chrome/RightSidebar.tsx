// VIEW-056 / VIEW-057 (T-146-a): one right sidebar on the Terminals screen. It holds the Explorer
// and Source Control as tabs, opens with Ctrl+L, and comes back after a restart open or closed, on
// the same tab and at the same width; its left edge drags to resize. Agents, Checks, Search, the
// More overflow and folder-workspace tabs come with T-146-b. VIEW-050 (T-051): the left sidebar's
// width lives here too, and both sidebars resize by the same Grip.
import { useRef, type ReactNode } from "react";

export type RightTab = "explorer" | "scm";
export const RIGHT_TABS: { id: RightTab; label: string; hint: string }[] = [
  { id: "explorer", label: "Explorer", hint: "Explorer (Ctrl+Shift+E)" },
  { id: "scm", label: "Source Control", hint: "Source Control (Ctrl+Shift+G)" },
];
export const RIGHT_KEYS = { open: "rightSidebarOpen", tab: "rightSidebarTab", width: "rightSidebarWidth" } as const;
export const RIGHT_MIN = 240;
const RIGHT_DEFAULT = 300;
/** What the workspace keeps beside the sidebars, so the panes never vanish. */
const RESERVED = 400;

export function readRight(s: Record<string, unknown>): { open: boolean; tab: RightTab; width: number } {
  const w = s[RIGHT_KEYS.width];
  return {
    open: s[RIGHT_KEYS.open] !== false,
    // an older saved "search" tab, or any other unknown one, opens the Explorer
    tab: s[RIGHT_KEYS.tab] === "scm" ? "scm" : "explorer",
    width: typeof w === "number" && Number.isFinite(w) && w >= RIGHT_MIN ? Math.round(w) : RIGHT_DEFAULT,
  };
}

/** The width actually used: at least the minimum, and never into the workspace's reserved room. */
export const clampWidth = (w: number, windowWidth: number, leftWidth: number) => Math.max(RIGHT_MIN, Math.min(w, windowWidth - leftWidth - RESERVED));

export const LEFT_KEY = "leftSidebarWidth";
export const LEFT_MIN = 220;
export const LEFT_MAX = 480;
export const LEFT_DEFAULT = 289;
export const clampLeft = (w: number) => Math.round(Math.max(LEFT_MIN, Math.min(LEFT_MAX, w)));
/** VIEW-050: a saved left width is clamped into range; anything that is not a number keeps `current`. */
export function readLeft(s: Record<string, unknown>, current = LEFT_DEFAULT): number {
  const w = s[LEFT_KEY];
  return typeof w === "number" && Number.isFinite(w) ? clampLeft(w) : current;
}

/** A sidebar's drag edge. `side` is where the sidebar sits: dragging away from it widens it. */
export function Grip({ side, width, label, className, onWidth }: { side: "left" | "right"; width: number; label: string; className: string; onWidth: (w: number, done: boolean) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const at = (x: number) => (drag.current ? drag.current.w + (side === "left" ? x - drag.current.x : drag.current.x - x) : width);
  return (
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => drag.current && onWidth(at(e.clientX), false)}
      onPointerUp={(e) => {
        if (!drag.current) return;
        onWidth(at(e.clientX), true);
        drag.current = null;
      }}
    />
  );
}

type Props = { tab: RightTab; width: number; hidden?: boolean; onTab: (t: RightTab) => void; onWidth: (w: number, done: boolean) => void; children: ReactNode };

export default function RightSidebar({ tab, width, hidden = false, onTab, onWidth, children }: Props) {
  return (
    <aside className="rside" aria-label="Right sidebar" hidden={hidden} style={{ width }}>
      <Grip side="right" width={width} label="Resize the right sidebar" className="rside-grip" onWidth={onWidth} />
      <div className="rside-tabs" role="tablist">
        {RIGHT_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} title={t.hint} className="rside-tab" onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="rside-body">{children}</div>
    </aside>
  );
}
