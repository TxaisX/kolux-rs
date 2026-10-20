// EDIT-055 (T-318): Mod+Shift+M starts a note from the repository's own templates. The templates are
// listed by the md_templates command (files.rs reads .kolux/templates at the worktree root); with
// none, a blank note is made without asking. These helpers hold the decisions that need no screen.

export type Template = { name: string; path: string };
/** One line of the picker: Blank first (no template path), then each template by its readable name. */
export type Row = { label: string; path: string | null };

export const rows = (templates: Template[]): Row[] => [{ label: "Blank", path: null }, ...templates.map((t) => ({ label: t.name, path: t.path }))];

/** The row after an arrow key: it stops at both ends, and other keys leave it where it is. */
export function step(at: number, key: string, count: number): number {
  if (key === "ArrowDown") return Math.min(at + 1, count - 1);
  if (key === "ArrowUp") return Math.max(at - 1, 0);
  return at;
}

export type Io = {
  list: (root: string) => Promise<Template[]>;
  make: (root: string, template: string | null) => Promise<string>;
};

/** What Mod+Shift+M does first: with no templates (or a templates folder that cannot be read) a blank note
 *  is made at once and its path comes back; with templates the list comes back for the picker. */
export async function beginNote(root: string, io: Io): Promise<{ opened: string } | { ask: Template[] }> {
  const found = await io.list(root).catch(() => [] as Template[]);
  if (found.length === 0) return { opened: await io.make(root, null) };
  return { ask: found };
}
