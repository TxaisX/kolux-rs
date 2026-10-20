// EDIT-010 (T-234-b): tables in the rich markdown view. A table is a block of rows of cells; each cell
// holds one line of text and nothing else, so what is typed is what the markdown table says.
// Tab and Shift+Tab move between cells, Enter goes down a row (a new one after the last), Backspace in
// an empty row removes it, and the context menu adds or removes rows and columns. The header row stays,
// and removing the last column removes the table. Every change is one editor update, so one undo step.
// A row that was not changed is written back with its original text (spacing and all), so a table the
// user did not touch is never reformatted (EDIT-019).
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  ElementNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  type EditorConfig,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import type { MultilineElementTransformer } from "@lexical/markdown";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";

export type Align = "" | "left" | "center" | "right";

// ---- markdown text of a table (pure) ----

/** The cells of one table line: outer pipes dropped, split on pipes that are not escaped, each trimmed. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) cur += s[i] + s[++i];
    else if (s[i] === "|") (out.push(cur.trim()), (cur = ""));
    else cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

const DELIM_CELL = /^:?-+:?$/;
/** True for the line under the header: cells of dashes with optional colons. */
export const isDelimiterRow = (line: string): boolean => line.includes("-") && /^[\s|:-]*$/.test(line) && splitRow(line).every((c) => DELIM_CELL.test(c));
export const alignOf = (cell: string): Align => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "");
const delimCell = (a: Align) => (a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---");

/** The canonical line for a row of cell texts. */
export const rowLine = (cells: string[]): string => `| ${cells.join(" | ")} |`;
export const delimLine = (align: Align[]): string => `| ${align.map(delimCell).join(" | ")} |`;

// ---- nodes ----

type SerializedTable = Spread<{ align: Align[]; rawDelim: string; canonDelim: string }, SerializedElementNode>;
type SerializedRow = Spread<{ raw: string; canon: string }, SerializedElementNode>;
type SerializedCell = Spread<{ header: boolean }, SerializedElementNode>;

export class TableNode extends ElementNode {
  __align: Align[];
  __rawDelim: string;
  __canonDelim: string;
  static getType() {
    return "kolux-table";
  }
  static clone(n: TableNode) {
    return new TableNode(n.__align, n.__rawDelim, n.__canonDelim, n.__key);
  }
  constructor(align: Align[] = [], rawDelim = "", canonDelim = "", key?: NodeKey) {
    super(key);
    this.__align = align;
    this.__rawDelim = rawDelim;
    this.__canonDelim = canonDelim;
  }
  static importJSON(j: SerializedTable) {
    return new TableNode(j.align, j.rawDelim, j.canonDelim).updateFromJSON(j);
  }
  exportJSON(): SerializedTable {
    return { ...super.exportJSON(), align: this.__align, rawDelim: this.__rawDelim, canonDelim: this.__canonDelim };
  }
  createDOM(_c: EditorConfig) {
    const t = document.createElement("table");
    t.className = "md-table";
    return t;
  }
  updateDOM() {
    return false;
  }
  isInline() {
    return false;
  }
  getAlign(): Align[] {
    return this.getLatest().__align;
  }
  setAlign(a: Align[]) {
    this.getWritable().__align = a;
    return this;
  }
}

export class TableRowNode extends ElementNode {
  __raw: string;
  __canon: string;
  static getType() {
    return "kolux-table-row";
  }
  static clone(n: TableRowNode) {
    return new TableRowNode(n.__raw, n.__canon, n.__key);
  }
  constructor(raw = "", canon = "", key?: NodeKey) {
    super(key);
    this.__raw = raw;
    this.__canon = canon;
  }
  static importJSON(j: SerializedRow) {
    return new TableRowNode(j.raw, j.canon).updateFromJSON(j);
  }
  exportJSON(): SerializedRow {
    return { ...super.exportJSON(), raw: this.__raw, canon: this.__canon };
  }
  createDOM() {
    return document.createElement("tr");
  }
  updateDOM() {
    return false;
  }
  isInline() {
    return false;
  }
}

export class TableCellNode extends ElementNode {
  __header: boolean;
  static getType() {
    return "kolux-table-cell";
  }
  static clone(n: TableCellNode) {
    return new TableCellNode(n.__header, n.__key);
  }
  constructor(header = false, key?: NodeKey) {
    super(key);
    this.__header = header;
  }
  static importJSON(j: SerializedCell) {
    return new TableCellNode(j.header).updateFromJSON(j);
  }
  exportJSON(): SerializedCell {
    return { ...super.exportJSON(), header: this.__header };
  }
  createDOM() {
    return document.createElement(this.__header ? "th" : "td");
  }
  updateDOM(prev: TableCellNode) {
    return prev.__header !== this.__header;
  }
  isInline() {
    return false;
  }
  isHeader() {
    return this.getLatest().__header;
  }
  /** A cell is one line: Enter is the table's own (next row), so no new block is made after a cell. */
  insertNewAfter(): null {
    return null;
  }
  canBeEmpty() {
    return true;
  }
}

export const $isTableNode = (n: LexicalNode | null | undefined): n is TableNode => n instanceof TableNode;
export const $isTableRowNode = (n: LexicalNode | null | undefined): n is TableRowNode => n instanceof TableRowNode;
export const $isTableCellNode = (n: LexicalNode | null | undefined): n is TableCellNode => n instanceof TableCellNode;
export const TABLE_NODES = [TableNode, TableRowNode, TableCellNode];

const $cell = (text: string, header: boolean) => {
  const c = new TableCellNode(header);
  if (text) c.append($createTextNode(text));
  return c;
};
const $row = (texts: string[], header: boolean, raw = "") => {
  const r = new TableRowNode(raw, raw ? rowLine(texts) : "");
  for (const t of texts) r.append($cell(t, header));
  return r;
};

/** A table of `cols` columns and `rows` rows, the first one the header. Cells are empty. */
export function $createTable(rows: number, cols: number): TableNode {
  const t = new TableNode(Array<Align>(cols).fill(""));
  for (let i = 0; i < rows; i++) t.append($row(Array(cols).fill(""), i === 0));
  return t;
}

const cellTexts = (row: TableRowNode): string[] => row.getChildren().map((c) => c.getTextContent());

// ---- markdown ----

/** The table in markdown. Rows keep their original text while their cells still say what they said. */
export const TABLE: MultilineElementTransformer = {
  dependencies: TABLE_NODES,
  regExpStart: /^ {0,3}\|?.*\|.*$/,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    const head = lines[startLineIndex];
    const delim = lines[startLineIndex + 1];
    if (delim === undefined || !isDelimiterRow(delim) || !head.includes("|")) return null;
    const heads = splitRow(head);
    const delims = splitRow(delim);
    if (heads.length !== delims.length) return null;
    const t = new TableNode(delims.map(alignOf), delim, delimLine(delims.map(alignOf)));
    t.append($row(heads, true, head));
    let i = startLineIndex + 2;
    for (; i < lines.length && lines[i].trim() !== "" && lines[i].includes("|"); i++) {
      const cells = splitRow(lines[i]).slice(0, heads.length);
      while (cells.length < heads.length) cells.push("");
      t.append($row(cells, false, lines[i]));
    }
    rootNode.append(t);
    return [true, i - 1];
  },
  replace: () => false,
  export: (node) => {
    if (!$isTableNode(node)) return null;
    const lines: string[] = [];
    node.getChildren().forEach((r, i) => {
      if (!$isTableRowNode(r)) return;
      const canon = rowLine(cellTexts(r));
      lines.push(r.__raw && r.__canon === canon ? r.__raw : canon);
      if (i === 0) {
        const dl = delimLine(node.getAlign());
        lines.push(node.__rawDelim && node.__canonDelim === dl ? node.__rawDelim : dl);
      }
    });
    return lines.join("\n");
  },
  type: "multiline-element",
};

// ---- places and edits ----

type At = { table: TableNode; row: TableRowNode; cell: TableCellNode; r: number; c: number };

/** The cell the caret is in (call inside an editor read or update), with its row and column number. */
export function $tableAt(): At | null {
  const sel = $getSelection();
  if (!$isRangeSelection(sel)) return null;
  const cell = $findMatchingParent(sel.anchor.getNode(), $isTableCellNode);
  const row = cell?.getParent();
  const table = row?.getParent();
  if (!cell || !$isTableRowNode(row) || !$isTableNode(table)) return null;
  return { table, row, cell, r: row.getIndexWithinParent(), c: cell.getIndexWithinParent() };
}

const rowsOf = (t: TableNode) => t.getChildren().filter($isTableRowNode);
const cellsOf = (r: TableRowNode) => r.getChildren().filter($isTableCellNode);
const place = (cell: TableCellNode | undefined) => void cell?.selectEnd();

/** Puts a table of the given size after the block holding the caret (or in place of an empty one) and
 *  the caret in its first header cell. */
export function $insertTable(rows = 3, cols = 3): TableNode | null {
  const sel = $getSelection();
  if (!$isRangeSelection(sel)) return null;
  const top = sel.anchor.getNode().getTopLevelElementOrThrow();
  const t = $createTable(rows, cols);
  if (top.isEmpty() && top.getType() === "paragraph") top.replace(t);
  else top.insertAfter(t);
  place(cellsOf(rowsOf(t)[0])[0]);
  return t;
}

/** A new empty row under row `r` (or above it; never above the header). */
function $addRowAt(t: TableNode, r: number, where: "above" | "below"): TableRowNode {
  const cols = t.getAlign().length;
  const fresh = $row(Array(cols).fill(""), false);
  const rows = rowsOf(t);
  const anchor = rows[Math.max(r, 0)];
  if (where === "above" && r > 0) anchor.insertBefore(fresh);
  else anchor.insertAfter(fresh);
  return fresh;
}

export const $addRow = (where: "above" | "below"): boolean => {
  const at = $tableAt();
  if (!at) return false;
  place(cellsOf($addRowAt(at.table, at.r, where))[at.c]);
  return true;
};

export const $removeRow = (): boolean => {
  const at = $tableAt();
  if (!at || at.r === 0) return false; // the header row always stays
  const prev = rowsOf(at.table)[at.r - 1];
  at.row.remove();
  place(cellsOf(prev)[at.c]);
  return true;
};

export function $addColumn(where: "left" | "right"): boolean {
  const at = $tableAt();
  if (!at) return false;
  const i = where === "left" ? at.c : at.c + 1;
  for (const r of rowsOf(at.table)) {
    const cells = cellsOf(r);
    const fresh = $cell("", r.getIndexWithinParent() === 0);
    if (i >= cells.length) r.append(fresh);
    else cells[i].insertBefore(fresh);
  }
  const a = [...at.table.getAlign()];
  a.splice(i, 0, "");
  at.table.setAlign(a);
  place(cellsOf(at.row)[i]);
  return true;
}

export function $removeColumn(): boolean {
  const at = $tableAt();
  if (!at) return false;
  const cols = at.table.getAlign().length;
  if (cols <= 1) {
    // the last column takes the table with it
    const p = $createParagraphNode();
    at.table.replace(p);
    p.selectStart();
    return true;
  }
  for (const r of rowsOf(at.table)) cellsOf(r)[at.c]?.remove();
  const a = [...at.table.getAlign()];
  a.splice(at.c, 1);
  at.table.setAlign(a);
  place(cellsOf(at.row)[Math.min(at.c, cols - 2)]);
  return true;
}

/** Tab (+1) or Shift+Tab (-1): the next cell in reading order; Tab from the last cell grows a row. */
export function $moveCell(step: 1 | -1): boolean {
  const at = $tableAt();
  if (!at) return false;
  const flat = rowsOf(at.table).flatMap(cellsOf);
  const i = flat.indexOf(at.cell) + step;
  if (i < 0) place(flat[0]);
  else if (i >= flat.length) place(cellsOf($addRowAt(at.table, at.r, "below"))[0]);
  else place(flat[i]);
  return true;
}

/** Enter: the cell under this one; from the last row, a new row. */
export function $enterDown(): boolean {
  const at = $tableAt();
  if (!at) return false;
  const rows = rowsOf(at.table);
  const next = at.r + 1 < rows.length ? rows[at.r + 1] : $addRowAt(at.table, at.r, "below");
  place(cellsOf(next)[at.c]);
  return true;
}

/** True when the caret is collapsed at the very start (or end) of its cell. */
function $atCellEdge(at: At, edge: "start" | "end"): boolean {
  const sel = $getSelection();
  if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
  const n = sel.anchor.getNode();
  const o = sel.anchor.offset;
  if (n === at.cell) return o === (edge === "start" ? 0 : at.cell.getChildrenSize());
  if (edge === "start") return o === 0 && n.getPreviousSibling() === null;
  return o === n.getTextContentSize() && n.getNextSibling() === null;
}

/** Backspace at the start of an empty body row removes the row. Anywhere else at a cell's start it
 *  does nothing (a table's cells never merge). Returns false outside tables or away from the start. */
export function $backspace(): boolean {
  const at = $tableAt();
  if (!at || !$atCellEdge(at, "start")) return false;
  if (at.r > 0 && cellsOf(at.row).every((c) => c.getTextContentSize() === 0)) $removeRow();
  return true;
}

// ---- keys ----

/** Wires the table's keys into the editor. Runs ahead of the rich text and list handlers. */
export function registerTable(editor: LexicalEditor): () => void {
  const on = (cmd: LexicalCommand<KeyboardEvent> | LexicalCommand<KeyboardEvent | null>, f: (e: KeyboardEvent) => boolean) =>
    editor.registerCommand(
      cmd as LexicalCommand<KeyboardEvent>,
      (e) => {
        const ok = f(e);
        if (ok) e?.preventDefault();
        return ok;
      },
      COMMAND_PRIORITY_HIGH,
    );
  return mergeRegister(
    on(KEY_TAB_COMMAND, (e) => $moveCell(e.shiftKey ? -1 : 1)),
    on(KEY_ENTER_COMMAND, () => $enterDown()),
    on(KEY_BACKSPACE_COMMAND, () => $backspace()),
    on(KEY_DELETE_COMMAND, () => {
      const at = $tableAt();
      return !!at && $atCellEdge(at, "end");
    }),
    on(KEY_ARROW_DOWN_COMMAND, () => {
      // Down from the last row leaves the table (a paragraph is made if nothing follows it).
      const at = $tableAt();
      if (!at || at.r !== rowsOf(at.table).length - 1) return false;
      let next = at.table.getNextSibling();
      if (!next) at.table.insertAfter((next = $createParagraphNode()));
      if ($isElementNode(next)) next.selectStart();
      return true;
    }),
    editor.registerCommand(
      PASTE_COMMAND,
      (e) => {
        if (!$tableAt()) return false;
        // a cell takes one line: pasted lines run together
        const text = (e as ClipboardEvent).clipboardData?.getData("text/plain");
        if (!text) return false;
        (e as ClipboardEvent).preventDefault();
        const sel = $getSelection();
        if ($isRangeSelection(sel)) sel.insertText(text.replace(/\s*\r?\n\s*/g, " "));
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}

/** The table menu's buttons: what each does to the table around the caret. */
export const TABLE_ACTIONS = [
  { id: "row-above", label: "Row above", run: () => $addRow("above") },
  { id: "row-below", label: "Row below", run: () => $addRow("below") },
  { id: "row-del", label: "Delete row", run: () => $removeRow() },
  { id: "col-left", label: "Column left", run: () => $addColumn("left") },
  { id: "col-right", label: "Column right", run: () => $addColumn("right") },
  { id: "col-del", label: "Delete column", run: () => $removeColumn() },
] as const;
export type TableActionId = (typeof TABLE_ACTIONS)[number]["id"];

/** Runs one table menu action as a single edit (one undo step). */
export function runTableAction(editor: LexicalEditor, id: TableActionId): boolean {
  const a = TABLE_ACTIONS.find((x) => x.id === id);
  if (!a) return false;
  let done = false;
  editor.update(() => void (done = a.run()), { discrete: true });
  return done;
}

/** Tells `show` whether the caret is in a table (true) or not, after each change of selection. */
export function watchTable(editor: LexicalEditor, show: (inTable: boolean) => void): () => void {
  let was = false;
  return editor.registerUpdateListener(({ editorState }) => {
    const now = editorState.read(() => $tableAt() !== null);
    if (now !== was) show((was = now));
  });
}
