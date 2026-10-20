// EDIT-056 (T-237-b): the view switch in every file tab's header. Which views a file offers, and whether
// Changes (the last commit beside the working copy) is among them.
export type View = "edit" | "source" | "rich" | "rendered" | "changes";

export type FileFacts = { path: string; untitled?: boolean; inWorktree?: boolean; binary?: boolean; kind?: "diff" | "conflict" };

const ext = (p: string) => (/\.([^./\\]+)$/.exec(p)?.[1] ?? "").toLowerCase();
const DIAGRAM = new Set(["mmd", "mermaid", "puml", "plantuml", "dot", "gv"]);
const TABLE = new Set(["csv", "tsv"]);

export type Offer = { views: View[]; why?: Partial<Record<View, string>> };

/** The views a tab offers, in switch order. Notebooks offer only source and rendered cells; Changes is left out
 * for untitled files, files outside the worktree, binary files, notebooks and diff or conflict tabs. */
export function viewsFor(f: FileFacts): Offer {
  const e = ext(f.path);
  if (f.kind) return { views: [] }; // diff and conflict tabs show changes already and have no switch
  if (e === "ipynb") return { views: ["source", "rendered"] };
  const base: View[] = e === "md" || e === "markdown" ? ["source", "rich"] : DIAGRAM.has(e) || TABLE.has(e) ? ["source", "rendered"] : ["edit"];
  const changes = !f.untitled && f.inWorktree !== false && !f.binary;
  return changes ? { views: [...base, "changes"], why: { changes: "Compares with the last commit (uncommitted work), not with the base branch." } } : { views: base };
}

/** What the Changes view shows: the banner when nothing is uncommitted, a plain diff otherwise. */
export const changesBanner = (committed: string | null, working: string) => (committed !== null && committed === working ? "Nothing uncommitted in this file." : null);

/** The rendered CSV or TSV table is read-only; every other view the switch offers can be typed in. */
export const viewEditable = (path: string, v: View) => !(v === "rendered" && TABLE.has(ext(path)));
