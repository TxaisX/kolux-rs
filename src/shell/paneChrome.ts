// TERM-026 pane header density and TERM-057 tab strip scrolling. Pure rules plus two tiny installers; the pane and tab
// markup stay where they are and the look comes from shell.css through one attribute on the page root.
import "./shell.css";

/** The saved setting for header density. */
export const DENSITY_FIELD = "paneHeaderDensity";
export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/** A saved density, or comfortable for anything else (the default). */
export function readDensity(s: Record<string, unknown> | null | undefined): Density {
  return s?.[DENSITY_FIELD] === "compact" ? "compact" : "comfortable";
}

/** Pane header heights in px: comfortable keeps the shipped 27, compact is visibly shorter. */
export const HEAD_HEIGHT: Record<Density, number> = { comfortable: 27, compact: 22 };

/** Put the density on the page root; shell.css reads it. */
export function applyDensity(s: Record<string, unknown> | null | undefined, root: HTMLElement = document.documentElement): Density {
  const d = readDensity(s);
  if (d === "compact") root.setAttribute("data-pane-density", "compact");
  else root.removeAttribute("data-pane-density");
  return d;
}

/** How far a wheel turn over the tab strip moves it sideways: a sideways turn as is, a vertical one by its amount, lines scaled to px. */
export function wheelShift(e: { deltaX: number; deltaY: number; deltaMode?: number }): number {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  return d * unit;
}

/** True when the strip holds more than it shows, so there is something to scroll (and the thin bar is on). */
export const overflows = (el: { scrollWidth: number; clientWidth: number }) => el.scrollWidth > el.clientWidth + 1;

/**
 * Wheel over any tab strip scrolls it sideways (TERM-057). One delegated listener on the document; a strip that fits is left
 * alone so the wheel keeps working for whatever is under it. Returns the remover.
 */
export function installTabWheel(doc: Document = document): () => void {
  const on = (e: WheelEvent) => {
    const t = e.target as Element | null;
    const strip = t?.closest?.(".tabs") as HTMLElement | null;
    if (!strip || e.ctrlKey || !overflows(strip)) return;
    const dx = wheelShift(e);
    if (!dx) return;
    strip.scrollLeft += dx;
    e.preventDefault();
  };
  doc.addEventListener("wheel", on, { passive: false });
  return () => doc.removeEventListener("wheel", on);
}
