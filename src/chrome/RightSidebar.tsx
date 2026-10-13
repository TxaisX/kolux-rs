// VIEW-056 / VIEW-057 (T-146-a): one right sidebar on the Terminals screen. It holds the Explorer
// and Source Control as tabs, opens with Ctrl+L, and comes back after a restart open or closed, on
// the same tab and at the same width; its left edge drags to resize. VIEW-073 adds Checks; Agents,
// Search, the More overflow and folder-workspace tabs come with T-146-b.
import { useRef, type ReactNode } from "react";

export type RightTab = "explorer" | "scm" | "checks";
export const RIGHT_TABS: { id: RightTab; label: string; hint: string }[] = [
  { id: "explorer", label: "Explorer", hint: "Explorer (Ctrl+Shift+E)" },
  { id: "scm", label: "Source Control", hint: "Source Control (Ctrl+Shift+G)" },
  { id: "checks", label: "Checks", hint: "Checks on this workspace's pull request" },
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
    tab: s[RIGHT_KEYS.tab] === "scm" || s[RIGHT_KEYS.tab] === "checks" ? (s[RIGHT_KEYS.tab] as RightTab) : "explorer",
    width: typeof w === "number" && Number.isFinite(w) && w >= RIGHT_MIN ? Math.round(w) : RIGHT_DEFAULT,
  };
}

/** The width actually used: at least the minimum, and never into the workspace's reserved room. */
export const clampWidth = (w: number, windowWidth: number, leftWidth: number) => Math.max(RIGHT_MIN, Math.min(w, windowWidth - leftWidth - RESERVED));

type Props = { tab: RightTab; width: number; hidden?: boolean; onTab: (t: RightTab) => void; onWidth: (w: number, done: boolean) => void; children: ReactNode };

export default function RightSidebar({ tab, width, hidden = false, onTab, onWidth, children }: Props) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <aside className="rside" aria-label="Right sidebar" hidden={hidden} style={{ width }}>
      <div
        className="rside-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the right sidebar"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => drag.current && onWidth(drag.current.w + drag.current.x - e.clientX, false)}
        onPointerUp={(e) => {
          if (!drag.current) return;
          onWidth(drag.current.w + drag.current.x - e.clientX, true);
          drag.current = null;
        }}
      />
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
