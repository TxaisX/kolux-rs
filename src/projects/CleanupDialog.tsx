// PROJ-080: the workspace cleanup dialog. It scans one project (a repeated open joins the scan
// that is already running), lists the workspaces that have gone quiet with the clean, inactive
// ones ticked, and removes the ticked ones without forcing anything. Only workspaces Kolux made
// are ever listed (T-113-b).
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_VIEW,
  arrangeRows,
  childrenFirst,
  needsSizes,
  sizeText,
  type CleanupView,
  type Sizes,
  lastScan,
  rememberScan,
  rememberShowAll,
  rememberTicks,
  rememberedShowAll,
  rememberedTicks,
  rowFacts,
  rowLabel,
  shownRows,
  tickedPaths,
  ticksAfterScan,
  type Cleaned,
  type KeptItem,
  type Scan,
} from "./cleanup";

type Props = {
  project: { id: string; name: string };
  onClose: () => void;
  /** Workspaces that were removed, so the sidebar forgets them. */
  onRemoved: (paths: string[]) => void;
  /** Branches left behind by removed workspaces opened on an existing branch (PROJ-073). */
  onKept: (items: KeptItem[]) => void;
  /** T-149: a workspace's parent by path, so children are removed before their parents. */
  parentOf?: (path: string) => string | null | undefined;
};

export default function CleanupDialog({ project, onClose, onRemoved, onKept, parentOf }: Props) {
  // The previous result shows straight away while the new scan runs.
  const [scan, setScan] = useState<Scan | null>(() => lastScan(project.id));
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => {
    const before = lastScan(project.id);
    return before ? ticksAfterScan(rememberedTicks(project.id), before) : {};
  });
  const [showAll, setShowAll] = useState(() => rememberedShowAll(project.id));
  const [scanning, setScanning] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  // PROJ-081: filters, search and sort; sizes are read only once a size filter or sort needs them.
  const [view, setView] = useState<CleanupView>(DEFAULT_VIEW);
  const [sizes, setSizes] = useState<Sizes>({});
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const fresh = await invoke<Scan>("cleanup_scan", { projectId: project.id });
      rememberScan(fresh);
      setScan((old) => (fresh.error !== null && old ? { ...old, error: fresh.error, timedOut: fresh.timedOut } : fresh));
      if (fresh.error === null) setTicks(ticksAfterScan(Object.keys(ticksRef.current).length > 0 ? ticksRef.current : rememberedTicks(project.id), fresh));
    } catch (err) {
      setSaid([String(err)]);
    } finally {
      setScanning(false);
    }
  }, [project.id]);

  useEffect(() => {
    void rescan();
  }, [rescan]);
  useEffect(() => rememberTicks(project.id, ticks), [project.id, ticks]);

  const listed = scan ? shownRows(scan, showAll) : [];
  const rows = arrangeRows(listed, view, sizes);
  const shownSet = new Set(rows.map((r) => r.path));
  const chosen = scan ? childrenFirst(tickedPaths(ticks, scan, showAll).filter((p) => shownSet.has(p)), parentOf) : [];
  const unread = needsSizes(view) ? listed.map((r) => r.path).filter((p) => !(p in sizes)) : [];
  useEffect(() => {
    if (unread.length === 0) return;
    let live = true;
    invoke<(number | null)[]>("cleanup_sizes", { paths: unread })
      .then((got) => live && setSizes((old) => ({ ...old, ...Object.fromEntries(unread.map((p, i) => [p, got[i] ?? null])) })))
      .catch(() => live && setSizes((old) => ({ ...old, ...Object.fromEntries(unread.map((p) => [p, null])) })));
    return () => {
      live = false;
    };
  }, [unread.join("\n")]);
  const pick = <K extends keyof CleanupView>(k: K, v: CleanupView[K]) => setView((old) => ({ ...old, [k]: v }));
  const remove = async () => {
    setRemoving(true);
    try {
      const out = await invoke<Cleaned>("cleanup_remove", { projectId: project.id, paths: chosen });
      if (out.removed.length > 0) onRemoved(out.removed);
      if (out.kept.length > 0) onKept(out.kept.map((k) => ({ ...k, projectId: project.id })));
      setSaid(out.left.map((l) => `${l.path}: ${l.why}`));
    } catch (err) {
      setSaid([String(err)]);
    } finally {
      setRemoving(false);
    }
    await rescan();
  };

  return (
    <div className="sb-form" data-cleanup={project.id} role="dialog" aria-label={`Clean up workspaces in ${project.name}`}>
      <label>Clean up workspaces in {project.name}</label>
      {scanning && (
        <span aria-busy="true" data-cleanup-progress>
          {scan ? "Scanning again… the last result is shown meanwhile." : "Scanning workspaces…"}
        </span>
      )}
      {scan?.error && <span className="note warn">{scan.error}</span>}
      <div className="btn-row" data-cleanup-view>
        <input type="search" aria-label="search workspaces" placeholder="Search" value={view.query} onChange={(e) => pick("query", e.target.value)} />
        <select aria-label="Git state" value={view.git} onChange={(e) => pick("git", e.target.value as CleanupView["git"])}>
          <option value="any">Any Git state</option>
          <option value="merged">Merged</option>
          <option value="unmerged">Unmerged commits</option>
          <option value="changes">Uncommitted changes</option>
          <option value="clean">Clean</option>
          <option value="missing">Folder gone</option>
        </select>
        <select aria-label="activity" value={view.activity} onChange={(e) => pick("activity", e.target.value as CleanupView["activity"])}>
          <option value="any">Any activity</option>
          <option value="active">Terminal open</option>
          <option value="idle">Idle a week or more</option>
          <option value="never">Never visited</option>
        </select>
        <select aria-label="size" value={view.size} onChange={(e) => pick("size", e.target.value as CleanupView["size"])}>
          <option value="any">Any size</option>
          <option value="large">500 MB or more</option>
          <option value="small">Under 500 MB</option>
        </select>
        <select aria-label="safety" value={view.safety} onChange={(e) => pick("safety", e.target.value as CleanupView["safety"])}>
          <option value="any">Any</option>
          <option value="safe">Ticked by default</option>
          <option value="unsafe">Needs a look</option>
        </select>
        <select aria-label="sort by" value={view.sort} onChange={(e) => pick("sort", e.target.value as CleanupView["sort"])}>
          <option value="scan">Scan order</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="idle">Idle time</option>
        </select>
        <button className="btn" aria-label="sort direction" onClick={() => pick("desc", !view.desc)}>
          {view.desc ? "Largest first" : "Smallest first"}
        </button>
      </div>
      {scan && listed.length > 0 && rows.length === 0 && <span>No workspace matches the filters.</span>}
      {scan && listed.length === 0 && !scanning && !scan.error && <span>{showAll ? "This project has no workspaces Kolux made." : "No workspace has gone quiet."}</span>}
      {rows.map((r) => (
        <label className="check" key={r.path} title={r.path}>
          <input type="checkbox" aria-label={`clean up ${rowLabel(r)}`} checked={ticks[r.path] === true} disabled={removing} onChange={(e) => setTicks({ ...ticks, [r.path]: e.target.checked })} />
          <span>
            <b>{rowLabel(r)}</b> <span className="hint">{[rowFacts(r), sizeText(sizes[r.path])].filter(Boolean).join(" · ")}</span>
          </span>
        </label>
      ))}
      <label className="check">
        <input
          type="checkbox"
          aria-label="show every workspace"
          checked={showAll}
          onChange={(e) => {
            setShowAll(e.target.checked);
            rememberShowAll(project.id, e.target.checked);
          }}
        />
        Show every workspace
      </label>
      {said.map((line) => (
        <span className="note warn" key={line}>
          {line}
        </span>
      ))}
      <div className="btn-row">
        <button className="btn danger" onClick={() => void remove()} disabled={removing || chosen.length === 0} title="Removes the ticked workspaces; one with changes, a lock or a running terminal is left in place and listed">
          {removing ? "Removing…" : `Remove ${chosen.length || ""} ticked`.replace("  ", " ")}
        </button>
        <button className="btn" onClick={() => void rescan()} disabled={scanning || removing}>
          Scan again
        </button>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
