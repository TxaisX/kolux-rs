// The explorer (EDIT-033): the worktree's files as a tree in a panel on the right. Arrows, Home and
// End move the highlight; Right opens a folder or steps into it, Left folds it or climbs to its
// parent; Enter or a click opens a file; Mod-click and Shift-click select several rows. Only the rows
// on screen are drawn, so a huge folder scrolls smoothly. A symlink opens as a folder only once
// it is confirmed to point at one. Open folders and the scroll survive hiding the panel; App mounts
// one explorer per worktree, so they reset when the worktree changes.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Close, FileCode } from "../chrome/icons";

export type Node = { name: string; path: string; kind: "dir" | "file" | "link" };
export type Row = { node: Node; depth: number; parent: string | null };

const ROW = 22; // px
const SPARE = 10; // rows drawn beyond each edge

/** The rows on show: every loaded child of an open folder, depth first. */
export function flatten(root: string, kids: Record<string, Node[] | undefined>, open: Set<string>): Row[] {
  const out: Row[] = [];
  const walk = (dir: string, depth: number) => {
    for (const node of kids[dir] ?? []) {
      out.push({ node, depth, parent: dir === root ? null : dir });
      if (open.has(node.path)) walk(node.path, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** The paths from row a to row b, either way round. */
export const between = (rows: Row[], a: number, b: number) => rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.node.path);

type Props = { root: string; hidden: boolean; focusAsk: number; onOpen: (path: string) => void; onClose: () => void };

export default function Explorer({ root, hidden, focusAsk, onOpen, onClose }: Props) {
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

  const load = (dir: string) =>
    invoke<Node[]>("dir_list", { path: dir }).then(
      (list) => {
        setKids((k) => ({ ...k, [dir]: list }));
        setFailed(({ [dir]: _, ...f }) => f);
      },
      (err) => setFailed((f) => ({ ...f, [dir]: String(err) })),
    );
  useEffect(() => void load(root), [root]);

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

  const rows = flatten(root, kids, open);
  const index = rows.findIndex((r) => r.node.path === at);
  const isDir = (n: Node) => n.kind === "dir" || (n.kind === "link" && real[n.path] === "dir");

  const show = (i: number) => {
    const el = box.current;
    if (!el || i < 0) return;
    if (i * ROW < el.scrollTop) el.scrollTop = i * ROW;
    else if ((i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW - el.clientHeight;
  };
  const moveTo = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    setAt(r.node.path);
    setSel(new Set([r.node.path]));
    anchor.current = r.node.path;
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

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== box.current) return; // a field inside the panel keeps its own keys
    const r = rows[index];
    switch (e.key) {
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
    setSel(new Set([n.path]));
    anchor.current = n.path;
    activate(n);
  };

  const first = Math.max(0, Math.floor(scroll / ROW) - SPARE);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + SPARE);
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  return (
    <aside className="explorer" hidden={hidden} aria-label="Explorer">
      <header className="explorer-head">
        <span className="title">Explorer</span>
        <span className="path" title={root}>
          {name}
        </span>
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => onRow(e, i)}
                title={r.node.path}
              >
                <span className="ex-twist">{dir ? <ChevronDown size={10} style={isOpen ? undefined : { transform: "rotate(-90deg)" }} /> : <FileCode size={11} />}</span>
                <span className="ex-name">{r.node.name}</span>
                {r.node.kind === "link" && <span className="ex-link">link</span>}
                {failed[r.node.path] && <span className="ex-link" title={failed[r.node.path]}>not readable</span>}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
