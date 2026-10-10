// The explorer (EDIT-033): the worktree's files as a tree in a panel on the right. Arrows, Home and
// End move the highlight; Right opens a folder or steps into it, Left folds it or climbs to its
// parent; Enter or a click opens a file; Mod-click and Shift-click select several rows. Only the rows
// on screen are drawn, so a huge folder scrolls smoothly. A symlink opens as a folder only once
// it is confirmed to point at one. Open folders and the scroll survive hiding the panel; App mounts
// one explorer per worktree, so they reset when the worktree changes.
// File operations (EDIT-034, part 1): New file and New folder in the header, F2 renames in place
// (Enter or leaving the field commits, Escape cancels), Delete moves the selection to the trash after
// one question, Mod+Z and Mod+Shift+Z (or Ctrl+Y) undo and redo those, and the path or the relative
// path can be copied. Copy, move and drop-in come with T-094-b2.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Close, FileCode, FolderPlus, Plus } from "../chrome/icons";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";

export type Node = { name: string; path: string; kind: "dir" | "file" | "link" };
export type Row = { node: Node; depth: number; parent: string | null };
export type Draft = { dir: string; folder: boolean };
/** One explorer action, as the undo history keeps it. */
export type Op = { kind: "create"; path: string } | { kind: "rename"; from: string; to: string } | { kind: "trash"; paths: string[] };
type Gone = { path: string; permanent: boolean; error: string | null };

const ROW = 22; // px
const SPARE = 10; // rows drawn beyond each edge
/** A WSL share has no trash, so a delete there is for good (matches fsops::is_wsl). */
export const isWsl = (p: string) => /^(\\\\|\/\/)(\?[\\/]unc[\\/])?wsl(\$|\.localhost)[\\/]/i.test(p);
export const DRAFT = "\u0000draft"; // the path of the row a new name is typed into

/** The rows on show: every loaded child of an open folder, depth first; a draft row leads its folder. */
export function flatten(root: string, kids: Record<string, Node[] | undefined>, open: Set<string>, draft?: Draft | null): Row[] {
  const out: Row[] = [];
  const walk = (dir: string, depth: number) => {
    const parent = dir === root ? null : dir;
    if (draft?.dir === dir) out.push({ node: { name: "", path: DRAFT, kind: draft.folder ? "dir" : "file" }, depth, parent });
    for (const node of kids[dir] ?? []) {
      out.push({ node, depth, parent });
      if (open.has(node.path)) walk(node.path, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** The paths from row a to row b, either way round. */
export const between = (rows: Row[], a: number, b: number) => rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.node.path);
export const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
export const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
const inside = (p: string, dir: string) => p.startsWith(dir + "\\") || p.startsWith(dir + "/");
/** A selection to delete: a folder chosen along with things inside it goes once, as the folder. */
export const tops = (paths: string[]) => paths.filter((p) => p !== DRAFT && !paths.some((q) => q !== p && inside(p, q)));
/** The call that undoes an action, and the one that does it again. */
export const undoOf = (op: Op): [string, Record<string, unknown>] =>
  op.kind === "create" ? ["fs_trash", { paths: [op.path] }] : op.kind === "rename" ? ["fs_rename", { path: op.to, name: baseName(op.from) }] : ["fs_restore", { paths: op.paths }];
export const redoOf = (op: Op): [string, Record<string, unknown>] =>
  op.kind === "create" ? ["fs_restore", { paths: [op.path] }] : op.kind === "rename" ? ["fs_rename", { path: op.from, name: baseName(op.to) }] : ["fs_trash", { paths: op.paths }];
const touched = (op: Op) => (op.kind === "trash" ? op.paths : op.kind === "create" ? [op.path] : [op.from, op.to]);

type Props = { root: string; hidden: boolean; focusAsk: number; onOpen: (path: string) => void; onClose: () => void };

export default function Explorer({ root, hidden, focusAsk, onOpen, onClose }: Props) {
  const keymap = useKeymap();
  const [kids, setKids] = useState<Record<string, Node[] | undefined>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [real, setReal] = useState<Record<string, string>>({}); // a link's confirmed kind
  const [at, setAt] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [asking, setAsking] = useState<string[] | null>(null); // paths waiting for the delete answer
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null); // bad notes show as failures
  const done = useRef<Op[]>([]);
  const undone = useRef<Op[]>([]);

  const load = (dir: string) =>
    invoke<Node[]>("dir_list", { path: dir }).then(
      (list) => {
        setKids((k) => ({ ...k, [dir]: list }));
        setFailed(({ [dir]: _, ...f }) => f);
      },
      (err) => setFailed((f) => ({ ...f, [dir]: String(err) })),
    );
  useEffect(() => void load(root), [root]);
  const reloadAround = (paths: string[]) => new Set(paths.map(parentOf)).forEach((d) => void load(d));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.clientHeight && setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Hidden, the panel loses its scroll; showing it again puts the scroll back.
  useEffect(() => {
    if (!hidden && box.current) box.current.scrollTop = scroll;
    // A hidden tree must not keep the keyboard.
    if (hidden && box.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }, [hidden]);
  useEffect(() => {
    if (focusAsk && !hidden) box.current?.focus();
  }, [focusAsk, hidden]);

  const rows = flatten(root, kids, open, draft);
  const index = rows.findIndex((r) => r.node.path === at);
  const isDir = (n: Node) => n.kind === "dir" || (n.kind === "link" && real[n.path] === "dir");

  const show = (i: number) => {
    const el = box.current;
    if (!el || i < 0) return;
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW;
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight;
  };
  const pick = (path: string) => {
    setAt(path);
    setSel(new Set([path]));
    anchor.current = path;
  };
  const moveTo = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    pick(r.node.path);
    show(rows.indexOf(r));
  };
  const fold = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      next.delete(path);
      return next;
    });
  // Opens a folder, or a link once it is known to be one; anything else opens as a file.
  const expand = async (n: Node) => {
    let kind = n.kind === "link" ? real[n.path] : n.kind;
    if (n.kind === "link" && !kind) {
      kind = await invoke<string>("path_kind", { path: n.path }).catch(() => "missing");
      setReal((r) => ({ ...r, [n.path]: kind! }));
    }
    if (kind !== "dir") return onOpen(n.path);
    setOpen((o) => new Set(o).add(n.path));
    if (!kids[n.path]) void load(n.path);
  };
  const activate = (n: Node) => (open.has(n.path) ? fold(n.path) : n.kind === "file" ? onOpen(n.path) : void expand(n));

  // --- file operations (EDIT-034) ---
  const fail = (err: unknown) => setNote({ text: String(err), bad: true });
  const record = (op: Op) => {
    done.current.push(op);
    undone.current = [];
    setNote(null);
  };
  const back = () => box.current?.focus();
  const startNew = (folder: boolean) => {
    const r = rows[index];
    const dir = !r || r.node.path === DRAFT ? root : isDir(r.node) ? r.node.path : (r.parent ?? root);
    if (dir !== root) setOpen((o) => new Set(o).add(dir));
    setRenaming(null);
    setDraft({ dir, folder });
    setNote(null);
  };
  const commitNew = (name: string) => {
    const d = draft;
    setDraft(null);
    back();
    if (!d || !name.trim()) return;
    invoke<string>("fs_create", { dir: d.dir, name, folder: d.folder }).then((path) => {
      record({ kind: "create", path });
      void load(d.dir).then(() => pick(path));
    }, fail);
  };
  const commitRename = (from: string, name: string) => {
    setRenaming(null);
    back();
    if (!name.trim() || name === baseName(from)) return;
    invoke<string>("fs_rename", { path: from, name }).then((to) => {
      record({ kind: "rename", from, to });
      setOpen((o) => new Set([...o].map((p) => (p === from || inside(p, from) ? to + p.slice(from.length) : p))));
      void load(parentOf(from)).then(() => pick(to));
    }, fail);
  };
  const askDelete = () => {
    const chosen = tops(sel.size ? [...sel] : at ? [at] : []);
    if (chosen.length) setAsking(chosen);
  };
  const doDelete = (paths: string[]) => {
    setAsking(null);
    back();
    invoke<Gone[]>("fs_trash", { paths }).then((gone) => {
      const binned = gone.filter((g) => !g.error && !g.permanent).map((g) => g.path);
      if (binned.length) record({ kind: "trash", paths: binned });
      const errors = gone.filter((g) => g.error).map((g) => g.error);
      setNote(errors.length ? { text: `Not deleted: ${errors.join("; ")}`, bad: true } : null);
      reloadAround(paths);
      setSel(new Set());
    }, fail);
  };
  const replay = (from: typeof done, to: typeof done, call: (op: Op) => [string, Record<string, unknown>]) => {
    const op = from.current.pop();
    if (!op) return;
    const [cmd, args] = call(op);
    invoke<Gone[] | string | null>(cmd, args).then(
      (res) => {
        const err = Array.isArray(res) ? res.find((g) => g.error)?.error : null;
        if (err) return fail(err);
        to.current.push(op);
        setNote(null);
        reloadAround(touched(op));
      },
      (err) => {
        from.current.push(op); // still there to try again
        fail(err);
      },
    );
  };
  const relative = (p: string) => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, "") : p);
  const copy = (text: string) =>
    invoke("clip_write", { text })
      .catch(() => navigator.clipboard.writeText(text))
      .then(() => setNote({ text: `Copied ${text}` }), fail);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== box.current) return; // a field inside the panel keeps its own keys
    const r = rows[index];
    const hit = matchEvent(keymap, e.nativeEvent, ["explorer"]);
    switch (hit?.id ?? e.key) {
      case "fileExplorer.undo":
        replay(done, undone, undoOf);
        break;
      case "fileExplorer.redo":
        replay(undone, done, redoOf);
        break;
      case "fileExplorer.copyPath":
        if (at) void copy(at);
        break;
      case "fileExplorer.copyRelativePath":
        if (at) void copy(relative(at));
        break;
      case "fileExplorer.delete":
        askDelete();
        break;
      case "F2":
        if (r) setRenaming(r.node.path);
        break;
      case "ArrowDown":
        moveTo(index + 1);
        break;
      case "ArrowUp":
        moveTo(index < 0 ? 0 : index - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      case "ArrowRight":
        if (!r) moveTo(0);
        else if (r.node.kind === "file" || (r.node.kind === "link" && real[r.node.path] && !isDir(r.node))) break;
        else if (!open.has(r.node.path)) void expand(r.node);
        else if (rows[index + 1]?.parent === r.node.path) moveTo(index + 1);
        break;
      case "ArrowLeft":
        if (!r) break;
        if (open.has(r.node.path)) fold(r.node.path);
        else if (r.parent) moveTo(rows.findIndex((x) => x.node.path === r.parent));
        break;
      case "Enter":
        if (r) activate(r.node);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  const onRow = (e: React.MouseEvent, i: number) => {
    const n = rows[i].node;
    if (n.path === DRAFT || n.path === renaming) return;
    box.current?.focus();
    setAt(n.path);
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => {
        const next = new Set(s);
        if (!next.delete(n.path)) next.add(n.path);
        return next;
      });
      anchor.current = n.path;
      return;
    }
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((x) => x.node.path === anchor.current);
      setSel(new Set(between(rows, a < 0 ? i : a, i)));
      return;
    }
    pick(n.path);
    activate(n);
  };

  const first = Math.max(0, Math.floor(scroll / ROW) - SPARE);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + SPARE);
  const name = baseName(root.replace(/[\\/]+$/, "")) || root;
  const wsl = asking?.some(isWsl);
  return (
    <aside className="explorer" hidden={hidden} aria-label="Explorer">
      <header className="explorer-head">
        <span className="title">Explorer</span>
        <span className="path" title={root}>
          {name}
        </span>
        <button className="ib" onClick={() => startNew(false)} title="New file" aria-label="New file">
          <Plus size={12} />
        </button>
        <button className="ib" onClick={() => startNew(true)} title="New folder" aria-label="New folder">
          <FolderPlus size={12} />
        </button>
        <button className="ib" onClick={onClose} title="Hide the explorer (Ctrl+Shift+E)" aria-label="Hide the explorer">
          <Close size={12} />
        </button>
      </header>
      {failed[root] && (
        <div className="notice load-failed" role="alert">
          The folder did not load: {failed[root]}
          <button className="btn" onClick={() => void load(root)}>
            Retry
          </button>
        </div>
      )}
      {asking && (
        <div className="notice ex-ask" role="alertdialog" aria-label="Delete">
          <span>
            {wsl ? "Delete" : "Move"} {asking.length === 1 ? baseName(asking[0]) : `${asking.length} items`} {wsl ? "for good? A WSL share has no trash." : "to the trash?"}
          </span>
          <button className="btn" autoFocus onClick={() => doDelete(asking)}>
            {wsl ? "Delete" : "Move to trash"}
          </button>
          <button className="btn" onClick={() => (setAsking(null), back())}>
            Cancel
          </button>
        </div>
      )}
      {note && (
        <div className={`notice${note.bad ? "" : " ex-note"}`} role={note.bad ? "alert" : "status"}>
          <span>{note.text}</span>
          <button className="ib" onClick={() => setNote(null)} aria-label="Dismiss">
            <Close size={10} />
          </button>
        </div>
      )}
      <div
        className="explorer-rows"
        ref={box}
        tabIndex={0}
        role="tree"
        aria-label={`Files of ${name}`}
        aria-multiselectable
        aria-activedescendant={index >= 0 ? `ex-row-${index}` : undefined}
        onKeyDown={onKey}
        onFocus={() => index < 0 && rows.length && setAt(rows[0].node.path)}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        {kids[root] && !rows.length && <div className="menu-hint">This folder is empty.</div>}
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {rows.slice(first, last).map((r, k) => {
            const i = first + k;
            const dir = r.node.kind !== "file" && !(r.node.kind === "link" && real[r.node.path] && !isDir(r.node));
            const isOpen = open.has(r.node.path);
            const editing = r.node.path === DRAFT || r.node.path === renaming;
            return (
              <div
                key={r.node.path}
                id={`ex-row-${i}`}
                role="treeitem"
                aria-level={r.depth + 1}
                aria-expanded={dir ? isOpen : undefined}
                aria-selected={sel.has(r.node.path)}
                className={`ex-row${sel.has(r.node.path) ? " sel" : ""}${i === index ? " at" : ""}`}
                style={{ top: i * ROW, paddingLeft: 8 + r.depth * 12 }}
                onMouseDown={(e) => editing || e.preventDefault()}
                onClick={(e) => onRow(e, i)}
                title={editing ? undefined : r.node.path}
              >
                <span className="ex-twist">{dir ? <ChevronDown size={10} style={isOpen ? undefined : { transform: "rotate(-90deg)" }} /> : <FileCode size={11} />}</span>
                {editing ? (
                  <NameField
                    initial={r.node.name}
                    label={r.node.path === DRAFT ? (r.node.kind === "dir" ? "New folder name" : "New file name") : `New name for ${r.node.name}`}
                    onDone={(v) => (v === null ? (setDraft(null), setRenaming(null), back()) : r.node.path === DRAFT ? commitNew(v) : commitRename(r.node.path, v))}
                  />
                ) : (
                  <span className="ex-name">{r.node.name}</span>
                )}
                {r.node.kind === "link" && <span className="ex-link">link</span>}
                {failed[r.node.path] && (
                  <span className="ex-link" title={failed[r.node.path]}>
                    not readable
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/** The in-place name field: Enter or leaving it commits, Escape cancels (null). */
function NameField({ initial, label, onDone }: { initial: string; label: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const finish = (v: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(v);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length); // the name without its extension
  }, []);
  return (
    <input
      ref={ref}
      className="ex-input"
      aria-label={label}
      defaultValue={initial}
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
