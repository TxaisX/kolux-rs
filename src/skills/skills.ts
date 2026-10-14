// SKILL-017: what the Skills page shows, worked out from one scan (src-tauri/src/skills.rs).

export type Source = "home" | "workspace" | "bundled" | "plugin";
export type AgentId = "claude" | "codex" | "grok" | "hermes" | "shared";

export type Skill = {
  name: string;
  description: string | null;
  updated: number | null;
  path: string;
  source: Source;
  agents: AgentId[];
  plugin: string | null;
};

export type Root = {
  path: string;
  label: string;
  source: Source;
  agents: AgentId[];
  state: "scanned" | "partial" | "not-found" | "not-scanned" | "error";
  count: number;
  note: string | null;
};

export type Scan = { skills: Skill[]; roots: Root[] };

export const SOURCES: Array<{ id: Source; label: string }> = [
  { id: "home", label: "Home" },
  { id: "workspace", label: "Workspace" },
  { id: "bundled", label: "Bundled" },
  { id: "plugin", label: "Plugin" },
];

/** The Filter by agent menu: all agents, each AI, and the shared skills folder. */
export const AGENT_FILTERS: Array<{ id: "all" | AgentId; label: string }> = [
  { id: "all", label: "All agents" },
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
  { id: "hermes", label: "Hermes" },
  { id: "shared", label: "Shared skills folder" },
];

/** A pasted search longer than this is refused. */
export const QUERY_LIMIT = 200;

export type Filters = { query: string; agent: "all" | AgentId; sources: Source[] };
export const NO_FILTERS: Filters = { query: "", agent: "all", sources: [] };

export const filtersOn = (f: Filters) => f.query.trim() !== "" || f.agent !== "all" || f.sources.length > 0;

/** Every typed word has to appear in the name, description or path, ignoring case. */
function matches(s: Skill, query: string): boolean {
  const hay = `${s.name}\n${s.description ?? ""}\n${s.path}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** The rows left after the agent filter, the source chips and the search. */
export function visible(skills: Skill[], f: Filters): Skill[] {
  return skills.filter((s) => (f.agent === "all" || s.agents.includes(f.agent)) && (f.sources.length === 0 || f.sources.includes(s.source)) && matches(s, f.query));
}

/** Each source chip's count, after the agent filter and search but before the chips themselves. */
export function sourceCounts(skills: Skill[], f: Filters): Record<Source, number> {
  const out: Record<Source, number> = { home: 0, workspace: 0, bundled: 0, plugin: 0 };
  for (const s of visible(skills, { ...f, sources: [] })) out[s.source] += 1;
  return out;
}

/** Long paths keep their start and their last two parts, with an ellipsis between. */
export function shortPath(p: string, max = 64): string {
  if (p.length <= max) return p;
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(sep);
  const tail = parts.slice(-2).join(sep);
  const head = parts.slice(0, 2).join(sep);
  const short = `${head}${sep}…${sep}${tail}`;
  return short.length < p.length && short.length <= max + 8 ? short : `…${p.slice(-(max - 1))}`;
}

export const NO_DESCRIPTION = "No description";
export const NO_DATE = "Date unknown";

export function dateText(ms: number | null, loc?: string): string {
  return ms == null ? NO_DATE : new Date(ms).toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric" });
}

/** What the folders popover says about one root. */
export function rootState(r: Root): string {
  const n = `${r.count} skill${r.count === 1 ? "" : "s"}`;
  switch (r.state) {
    case "scanned":
      return n;
    case "partial":
      return `${n}, partly scanned${r.note ? `: ${r.note}` : ""}`;
    case "not-found":
      return "Not found";
    case "not-scanned":
      return `Not scanned${r.note ? `: ${r.note}` : ""}`;
    case "error":
      return `Scan failed${r.note ? `: ${r.note}` : ""}`;
  }
}

/** The page's state. A root that failed makes the whole scan a failure, never a shorter list. */
export type View = "scanning" | "failed" | "empty" | "no-matches" | "list";
export function viewOf(scan: Scan | null, failed: string | null, scanning: boolean, shown: number): View {
  if (failed || scan?.roots.some((r) => r.state === "error")) return "failed";
  if (!scan) return scanning ? "scanning" : "failed";
  if (scan.skills.length === 0) return scanning ? "scanning" : "empty";
  return shown === 0 ? "no-matches" : "list";
}

/** Escape closes the page, but never takes Escape away from a focused input. */
export function escapeCloses(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable);
}
