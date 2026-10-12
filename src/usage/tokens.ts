// USAGE-012 / USAGE-013: the token figures the Usage page draws, from the rows the backend scans out
// of Claude Code's and Codex's own logs (src-tauri/src/token_usage.rs). Cached input is its own
// count in every row, so adding providers never counts it twice; reasoning sits inside output.
import { estimate } from "./pricing";

export type Provider = "claude" | "codex";
export const PROVIDERS: Provider[] = ["claude", "codex"];
export const NAMES: Record<Provider, string> = { claude: "Claude", codex: "Codex" };
export type Pick = "overview" | Provider;

export type Row = { day: string; session: string; model: string; cwd: string; band: number; input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number; reasoning: number; last: number };
export type Saved = { scannedAt: number; rows: Row[]; error: string | null };
export type Usage = { tracking: Record<Provider, boolean>; claude: Saved | null; codex: Saved | null };

export const tokensOf = (r: Row) => r.input + r.cacheRead + r.cacheWrite + r.output;

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type Overview = {
  tokens: number;
  usd: number;
  partial: boolean;
  activeDays: number;
  /** The share of all input read back from the cache (writes are input sent fresh). */
  cacheShare: number;
  mix: { fresh: number; cache: number; output: number; reasoning: number };
  providers: number;
  days: Record<string, number>;
  best: { day: string; tokens: number } | null;
};

export function overview(sets: Partial<Record<Provider, Row[]>>): Overview {
  const mix = { fresh: 0, cache: 0, output: 0, reasoning: 0 };
  const days: Record<string, number> = {};
  let usd = 0;
  let partial = false;
  let providers = 0;
  let reads = 0;
  for (const p of PROVIDERS) {
    const rows = sets[p] ?? [];
    if (rows.some((r) => tokensOf(r) > 0)) providers++;
    const cost = estimate(p, rows);
    usd += cost.usd;
    partial ||= cost.unpriced.length > 0;
    for (const r of rows) {
      mix.fresh += r.input;
      mix.cache += r.cacheRead + r.cacheWrite;
      reads += r.cacheRead;
      mix.output += r.output - r.reasoning;
      mix.reasoning += r.reasoning;
      days[r.day] = (days[r.day] ?? 0) + tokensOf(r);
    }
  }
  const tokens = mix.fresh + mix.cache + mix.output + mix.reasoning;
  const active = Object.entries(days).filter(([, t]) => t > 0);
  const best = active.reduce<Overview["best"]>((b, [day, t]) => (b && b.tokens >= t ? b : { day, tokens: t }), null);
  return { tokens, usd, partial, activeDays: active.length, cacheShare: mix.fresh + mix.cache ? reads / (mix.fresh + mix.cache) : 0, mix, providers, days, best };
}

export type Cell = { day: string; tokens: number; level: 0 | 1 | 2 | 3 | 4; best: boolean; future: boolean };

/** `weeks` columns of seven local days (Sunday first), the last holding today. */
export function grid(days: Record<string, number>, today: Date, weeks: number, best?: string): Cell[][] {
  const top = Math.max(0, ...Object.values(days));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (weeks - 1) * 7);
  const now = localDay(today);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
      const tokens = days[day] ?? 0;
      const level = (tokens > 0 && top > 0 ? Math.max(1, Math.ceil((tokens / top) * 4)) : 0) as Cell["level"];
      return { day, tokens, level, best: day === best, future: day > now };
    }),
  );
}

const rowsOf = (u: Usage, p: Provider) => u[p]?.rows ?? [];

/** The providers a panel reads (and rescans): the tracked ones it shows. */
export function shownProviders(u: Usage, pick: Pick): Provider[] {
  return (pick === "overview" ? PROVIDERS : [pick]).filter((p) => u.tracking[p]);
}

export function panelState(u: Usage, pick: Pick): "off" | "empty" | "figures" {
  const shown = shownProviders(u, pick);
  if (!shown.length) return "off";
  return shown.some((p) => rowsOf(u, p).length > 0) ? "figures" : "empty";
}

export { rowsOf };
