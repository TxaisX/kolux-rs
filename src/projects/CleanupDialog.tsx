// PROJ-080: the workspace cleanup dialog. It scans one project (a repeated open joins the scan
// that is already running), lists the workspaces that have gone quiet with the clean, inactive
// ones ticked, and removes the ticked ones without forcing anything. Only workspaces Kolux made
// are ever listed (T-113-b).
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
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
};

export default function CleanupDialog({ project, onClose, onRemoved, onKept }: Props) {
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

  const rows = scan ? shownRows(scan, showAll) : [];
  const chosen = scan ? tickedPaths(ticks, scan, showAll) : [];
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
      {scan && rows.length === 0 && !scanning && !scan.error && <span>{showAll ? "This project has no workspaces Kolux made." : "No workspace has gone quiet."}</span>}
      {rows.map((r) => (
        <label className="check" key={r.path} title={r.path}>
          <input type="checkbox" aria-label={`clean up ${rowLabel(r)}`} checked={ticks[r.path] === true} disabled={removing} onChange={(e) => setTicks({ ...ticks, [r.path]: e.target.checked })} />
          <span>
            <b>{rowLabel(r)}</b> <span className="hint">{rowFacts(r)}</span>
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
