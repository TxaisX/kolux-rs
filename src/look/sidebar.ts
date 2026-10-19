// VIEW-052 / SET-021 (T-268): how the left sidebar is painted. Three looks: the standard surface,
// the terminal's background, or a chosen tint laid over the standard surface at a chosen strength.
// Pure: theme.ts hands in the two colours it already works out and writes the result as
// `--sidebar-bg`, which styles.css reads for the left sidebar only (the source-control sidebar on the
// right keeps the standard surface).

export const SIDEBAR_LOOKS = ["standard", "terminal", "tinted"] as const;
export type SidebarLook = (typeof SIDEBAR_LOOKS)[number];

export const SIDEBAR_LABEL: Record<SidebarLook, string> = { standard: "Standard", terminal: "Match terminal", tinted: "Tinted" };

/** Strength in per cent: [lowest, highest, default]. */
export const STRENGTH_SPAN = [0, 100, 20] as const;
/** The tint a first choice of Tinted starts from (a calm blue). */
export const DEFAULT_TINT = "#4f6bed";
/** At 100 % the tint covers this much of the surface, so row text always keeps a ground it reads on. */
export const MAX_WASH = 0.8;

export const sidebarLookOf = (v: unknown): SidebarLook => (SIDEBAR_LOOKS as readonly string[]).includes(v as string) ? (v as SidebarLook) : "standard";

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** The sidebar's background. Standard (and any look that cannot be worked out) is the standard
 *  surface token, so an untinted sidebar carries no colour of its own. */
export function sidebarBackground(look: SidebarLook, tint: string, strength: number, surface: string, terminalBg: string | undefined): string {
  if (look === "terminal" && isHex(terminalBg)) return terminalBg.toLowerCase();
  if (look === "tinted" && isHex(tint) && isHex(surface)) {
    const s = Math.min(STRENGTH_SPAN[1], Math.max(STRENGTH_SPAN[0], strength));
    return mix(surface.toLowerCase(), tint.toLowerCase(), (s / 100) * MAX_WASH);
  }
  return "var(--surface)";
}
