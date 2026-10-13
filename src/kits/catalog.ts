// SKILL-001: the six starter kits. Each is a small business job done by three AIs, each in its own
// role, on the user's own files. A role's prompt names inputs as {input-id}; the catalogue check
// below keeps every placeholder declared and every required input used. Sample files are built
// into the app from src-tauri/kits/<kit id>/ (SKILL-005).

export type Vendor = "claude" | "codex" | "grok";
export const VENDORS: Vendor[] = ["claude", "codex", "grok"]; // SKILL-003's fixed rotation order
/** The kit vendors among `agents` that are installed; pass the switched-on ones (offeredAgents), so a kit never counts or casts an AI switched off on the Agents page (ONB-005). */
export const readyVendors = (agents: { id: string; installed: boolean }[]): Vendor[] => VENDORS.filter((v) => agents.some((a) => a.id === v && a.installed));
export const VENDOR_NAME: Record<Vendor, string> = { claude: "Claude", codex: "Codex", grok: "Grok" };

export type Category = "data" | "marketing" | "research" | "sales" | "operations";
export const CATEGORY_NAME: Record<Category, string> = { data: "Data", marketing: "Marketing", research: "Research", sales: "Sales", operations: "Operations" };

export type KitInput = {
  id: string;
  label: string;
  kind: "file" | "text";
  required: boolean;
  hint: string;
  /** File types the input takes, without the dot; empty takes any file. */
  accept?: string[];
  /** A file input's sample file name (in the kit's samples folder), a text input's sample value. */
  sample: string;
};

export type KitRole = {
  /** Also the role's own subfolder of the results folder. */
  id: string;
  title: string;
  prefers: Vendor;
  prompt: string;
  /** The files this role hands over, inside its folder. */
  delivers: string[];
  /** A role of the same kit this one waits for (SKILL-008). */
  waitsFor?: string;
};

export type Kit = { id: string; title: string; summary: string; category: Category; minutes: number; inputs: KitInput[]; roles: KitRole[] };

const csv = (id: string, label: string, hint: string, sample: string): KitInput => ({ id, label, kind: "file", required: true, hint, accept: ["csv"], sample });
const note = (id: string, label: string, hint: string, sample: string): KitInput => ({ id, label, kind: "text", required: false, hint, sample });

export const KITS: Kit[] = [
  {
    id: "spreadsheet",
    title: "Analyse a spreadsheet",
    summary: "Find what matters in a table of numbers and turn it into a short report.",
    category: "data",
    minutes: 15,
    inputs: [csv("data", "Spreadsheet (CSV)", "Save the sheet as CSV first; the first row should name the columns.", "sales.csv"), note("question", "Your question", "What you most want to know. Leave blank for a general look.", "Which region grew fastest, and why?")],
    roles: [
      { id: "analyst", title: "Analyst", prefers: "claude", prompt: "Study the table in {data}. Answer this question if one is given: {question}. Write the five findings that matter most, each with the numbers behind it.", delivers: ["findings.md"] },
      { id: "report", title: "Report builder", prefers: "codex", prompt: "Build a one-page report of the table in {data}: totals, the main trends over time and the biggest movers, with charts.", delivers: ["report.html"] },
      { id: "checker", title: "Checker", prefers: "grok", prompt: "Check the analyst's findings in ../analyst/findings.md against the table in {data}. Recompute every number and list any that are wrong or unsupported.", delivers: ["checks.md"], waitsFor: "analyst" },
    ],
  },
  {
    id: "tidy-merge",
    title: "Tidy and merge two data files",
    summary: "Clean two lists of the same kind of records and merge them into one.",
    category: "data",
    minutes: 20,
    inputs: [csv("first", "First file (CSV)", "One list of records, such as customers.", "customers-a.csv"), csv("second", "Second file (CSV)", "The other list; its columns may be named differently.", "customers-b.csv"), note("instructions", "How to merge", "How to match records and which value wins. Leave blank to match on the most reliable column.", "Match on email; keep the newest phone number.")],
    roles: [
      { id: "merger", title: "Merger", prefers: "codex", prompt: "Merge {first} and {second} into one clean CSV: line up their columns, tidy spacing and letter case, and join duplicate records. Follow these instructions if given: {instructions}.", delivers: ["merged.csv"] },
      { id: "quality", title: "Quality notes", prefers: "claude", prompt: "Read {first} and {second} and write plain notes on their quality: missing values, clashing records, odd formats, and what a merge has to decide.", delivers: ["quality-notes.md"] },
      { id: "spot-check", title: "Spot check", prefers: "grok", prompt: "Spot-check ../merger/merged.csv against {first} and {second}: pick ten records, trace each back to its sources and say whether the merge kept the right values.", delivers: ["spot-check.md"], waitsFor: "merger" },
    ],
  },
  {
    id: "marketing",
    title: "Report on a marketing campaign",
    summary: "Turn campaign numbers into a clear account of what worked.",
    category: "marketing",
    minutes: 20,
    inputs: [csv("metrics", "Campaign metrics (CSV)", "Spend, reach and results by channel or week.", "campaign.csv"), note("focus", "Focus", "A decision the report should help with. Leave blank for an overall view.", "Which channel should get more budget?")],
    roles: [
      { id: "writer", title: "Writer", prefers: "claude", prompt: "Write a campaign report from {metrics} for a busy manager: what happened, what worked, what did not, and what to do next. Keep this focus in mind if given: {focus}.", delivers: ["campaign-report.md"] },
      { id: "metrics", title: "Metrics table", prefers: "codex", prompt: "From {metrics}, build a table per channel with total spend, cost per click, cost per result and the change over the period.", delivers: ["metrics.csv"] },
      { id: "context", title: "Context scan", prefers: "grok", prompt: "Look at {metrics} and note the outside context that could explain the swings in it: seasons, holidays and common patterns for these channels. Mark guesses as guesses. Focus, if given: {focus}.", delivers: ["context.md"] },
    ],
  },
  {
    id: "research",
    title: "Write a research brief",
    summary: "Gather what is known on a topic and boil it down to a brief.",
    category: "research",
    minutes: 25,
    inputs: [
      { id: "topic", label: "Topic", kind: "text", required: true, hint: "One line on what to research.", sample: "Four-day work weeks in small companies" },
      { id: "notes", label: "Your notes (optional)", kind: "file", required: false, hint: "A Markdown or plain-text file with what you already know.", accept: ["md", "txt"], sample: "notes.md" },
    ],
    roles: [
      { id: "researcher", title: "Researcher", prefers: "grok", prompt: "Research this topic: {topic}. Start from the notes in {notes} if a file is given. List the key sources and what each one says.", delivers: ["sources.md"] },
      { id: "writer", title: "Writer", prefers: "claude", prompt: "Write a two-page brief on {topic} for a reader short on time: the main points, the open questions and a recommendation. Build on the notes in {notes} if a file is given.", delivers: ["brief.md"] },
      { id: "comparison", title: "Comparison table", prefers: "codex", prompt: "Make a table comparing the main options or positions on {topic}: one row each, with their pros, cons and the evidence for them.", delivers: ["comparison.csv"] },
    ],
  },
  {
    id: "sales",
    title: "Build a sales follow-up list",
    summary: "Rank open deals and draft the follow-ups worth sending this week.",
    category: "sales",
    minutes: 15,
    inputs: [csv("leads", "CRM export (CSV)", "Export your open deals or leads from the CRM as CSV.", "crm-export.csv"), note("priority", "Priority", "What matters most this week. Leave blank to rank by value and timing.", "Deals closing this quarter first.")],
    roles: [
      { id: "scorer", title: "Lead scorer", prefers: "codex", prompt: "Score every deal in {leads} from 1 to 10 on value, stage and how recently it was touched, and sort them best first. Weigh this priority if given: {priority}.", delivers: ["scored-leads.csv"] },
      { id: "drafts", title: "Follow-up drafts", prefers: "claude", prompt: "Draft a short, friendly follow-up email for each of the most promising deals in {leads}, each tailored to its stage. Priority, if given: {priority}.", delivers: ["follow-ups.md"] },
      { id: "data-check", title: "Data-quality check", prefers: "grok", prompt: "Check {leads} for problems that would spoil a follow-up: missing contacts, stale dates, odd values and duplicates. List each with its row.", delivers: ["data-quality.md"] },
    ],
  },
  {
    id: "weekly",
    title: "Sum up the week's metrics",
    summary: "Work out the week's numbers and spot anything unusual.",
    category: "operations",
    minutes: 15,
    inputs: [csv("kpis", "KPI table (CSV)", "One row per day or week, one column per measure.", "kpis.csv"), note("emphasis", "Emphasis", "A measure to look at closely. Leave blank to treat them all the same.", "Customer support response times.")],
    roles: [
      { id: "calculator", title: "Calculator", prefers: "codex", prompt: "From {kpis}, work out the week's totals, averages and the change from the start of the week to the end for every measure.", delivers: ["weekly-numbers.csv"] },
      { id: "summary", title: "One-page summary", prefers: "claude", prompt: "Write a one-page summary of the week in {kpis} for a manager: the headline numbers, what moved and why it matters, with a small chart. Emphasis, if given: {emphasis}.", delivers: ["summary.html"] },
      { id: "anomalies", title: "Anomaly finder", prefers: "grok", prompt: "Using ../calculator/weekly-numbers.csv and {kpis}, find the days or measures that look unusual and suggest a plain reason for each. Emphasis, if given: {emphasis}.", delivers: ["anomalies.md"], waitsFor: "calculator" },
    ],
  },
];

const CATEGORIES = Object.keys(CATEGORY_NAME);

/** SKILL-001: what is wrong with a catalogue; empty when every rule holds. */
export function catalogueProblems(kits: Kit[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const k of kits) {
    if (ids.has(k.id)) out.push(`${k.id}: the kit id is used twice`);
    ids.add(k.id);
    if (k.roles.length !== 3) out.push(`${k.id}: has ${k.roles.length} roles, not 3`);
    if (k.inputs.length === 0) out.push(`${k.id}: asks for no input`);
    if (!CATEGORIES.includes(k.category)) out.push(`${k.id}: unknown category ${k.category}`);
    if (k.minutes < 15 || k.minutes > 25) out.push(`${k.id}: an estimate of ${k.minutes} minutes`);
    const declared = new Set(k.inputs.map((i) => i.id));
    const roleIds = new Set(k.roles.map((r) => r.id));
    if (roleIds.size !== k.roles.length) out.push(`${k.id}: two roles share a folder`);
    for (const r of k.roles) {
      for (const [, name] of r.prompt.matchAll(/\{([^}]+)\}/g)) if (!declared.has(name)) out.push(`${k.id}/${r.id}: the prompt names {${name}}, which the kit does not ask for`);
      if (r.waitsFor && (!roleIds.has(r.waitsFor) || r.waitsFor === r.id)) out.push(`${k.id}/${r.id}: waits for ${r.waitsFor}, not another role of this kit`);
      if (r.delivers.length === 0 || r.delivers.some((f) => f.includes("/") || f.includes("\\"))) out.push(`${k.id}/${r.id}: deliverables must be plain file names in its own folder`);
    }
    for (const i of k.inputs) {
      if (i.required && !k.roles.some((r) => r.prompt.includes(`{${i.id}}`))) out.push(`${k.id}: the required input ${i.id} is used by no role`);
      if (!i.sample.trim()) out.push(`${k.id}: the input ${i.id} has no sample`);
    }
  }
  return out;
}

/** SKILL-003: a role gets its preferred AI when that one is connected; the others are dealt out
 * in rotation from the connected AIs in the order Claude, Codex, Grok. Null with none connected. */
export function assignRoles(kit: Kit, connected: Vendor[]): (Vendor | null)[] {
  const pool = VENDORS.filter((v) => connected.includes(v));
  let next = 0;
  return kit.roles.map((r) => {
    if (pool.length === 0) return null;
    if (pool.includes(r.prefers)) return r.prefers;
    return pool[next++ % pool.length];
  });
}

/** SKILL-004: path checks that need no disk. */
const EXCEL = ["xlsx", "xls", "xlsm", "xlsb", "ods"];
export const extOf = (path: string) => (/\.([^./\\]+)$/.exec(path.trim())?.[1] ?? "").toLowerCase();
export const isWorkbook = (path: string) => EXCEL.includes(extOf(path));
/** The quotes that Copy as path adds: one surrounding pair goes. */
export const unquote = (path: string) => {
  const t = path.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : path;
};
/** A dropped list: the first file fills the field, folders are skipped. */
export const firstDropped = (drops: { path: string; dir: boolean }[]) => drops.find((d) => !d.dir)?.path ?? null;

/** SKILL-005: remembered inputs per workspace and kit, in settings. */
export const RECALL_KEY = "kitInputs";
const recallId = (dir: string, kit: string) => `${dir.toLowerCase()}|${kit}`;
export function recalled(settings: Record<string, unknown>, dir: string, kit: Kit): Record<string, string> {
  const all = (settings[RECALL_KEY] ?? {}) as Record<string, Record<string, unknown>>;
  const mine = all[recallId(dir, kit.id)] ?? {};
  const known = new Set(kit.inputs.map((i) => i.id));
  return Object.fromEntries(Object.entries(mine).filter(([k, v]) => known.has(k) && typeof v === "string" && v.trim() !== "")) as Record<string, string>;
}
export function remember(settings: Record<string, unknown>, dir: string, kit: Kit, values: Record<string, string>): Record<string, unknown> {
  const all = { ...((settings[RECALL_KEY] ?? {}) as Record<string, unknown>) };
  all[recallId(dir, kit.id)] = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
  return { ...settings, [RECALL_KEY]: all };
}
/** Sample values for a kit whose samples live in `folder`; files become full paths. */
export function sampleValues(kit: Kit, folder: string): Record<string, string> {
  const sep = folder.includes("/") && !folder.includes("\\") ? "/" : "\\";
  return Object.fromEntries(kit.inputs.map((i) => [i.id, i.kind === "file" ? `${folder.replace(/[\\/]+$/, "")}${sep}${i.sample}` : i.sample]));
}
/** Remembered values fill only the fields the sample step left empty. */
export const fillEmpty = (base: Record<string, string>, extra: Record<string, string>) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) if (!out[k]?.trim()) out[k] = v;
  return out;
};
/** Where a kit's results go: the results folder at the project root, one subfolder per role. */
export const RESULTS_FOLDER = "kit-results";
