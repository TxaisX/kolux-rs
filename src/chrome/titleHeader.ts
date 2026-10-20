// T-049-c / VIEW-003: which bar the window wears. The New look has the full-width top bar; Classic
// has a title header exactly as wide as the left sidebar card and no top bar. Pure, so a test can
// prove the mapping without a browser. The header's width follows the sidebar card: the card sits
// 8 px in from the window edge (styles.css .sidebar-wrap), so the header ends where the card ends.

/** The room the header's own controls need (mark, menu, sidebar toggle, back, forward) when no sidebar is open. */
export const HEADER_MIN = 168;
/** The gap left of the sidebar card; RightSidebar.tsx uses the same 8 px when it measures what the left side takes. */
export const SIDEBAR_GAP = 8;
/** The sidebar width a profile that never resized it gets (RightSidebar.tsx LEFT_DEFAULT). */
export const SIDEBAR_DEFAULT = 289;

export type ChromeLayout = {
  /** The class on the bar element: `topbar` (New) or `titlebar` (Classic). */
  bar: "topbar" | "titlebar";
  /** The full-width top bar is drawn (New look only). */
  topBar: boolean;
  /** The sidebar-width title header is drawn (Classic only). */
  titleHeader: boolean;
  /** The Agents / Board / Terminals switcher is drawn (New look only; Classic stays on Terminals). */
  switcher: boolean;
  /** Pixel width of the header's left cell in Classic; null in the New look, whose bar spans the window. */
  headerWidth: number | null;
};

/** The sidebar card's outer width plus its gap, never less than the controls need. A hidden sidebar leaves the minimum. */
export function headerWidth(sidebarOpen: boolean, sidebarWidth: number): number {
  if (!sidebarOpen || !Number.isFinite(sidebarWidth)) return HEADER_MIN;
  return Math.max(HEADER_MIN, Math.round(sidebarWidth) + SIDEBAR_GAP);
}

export function chromeLayout(classic: boolean, sidebarOpen: boolean, sidebarWidth: number = SIDEBAR_DEFAULT): ChromeLayout {
  return classic
    ? { bar: "titlebar", topBar: false, titleHeader: true, switcher: false, headerWidth: headerWidth(sidebarOpen, sidebarWidth) }
    : { bar: "topbar", topBar: true, titleHeader: false, switcher: true, headerWidth: null };
}
