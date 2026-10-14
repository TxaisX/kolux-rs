// BROW-012: a browser tab's zoom moves through the usual browser steps and stops at the ends.
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** The next level from `now`: "in" or "out" by one step (snapping a level between steps to the
 *  nearest one in that direction), "reset" to 100%. */
export function nextZoom(now: number, how: "in" | "out" | "reset"): number {
  if (how === "reset") return 1;
  if (how === "in") return ZOOM_STEPS.find((s) => s > now + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((s) => s < now - 1e-6) ?? ZOOM_STEPS[0];
}

export const zoomPercent = (level: number) => `${Math.round(level * 100)}%`;
