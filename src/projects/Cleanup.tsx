// PROJ-080: the cleanup dialog. It shows the last scan at once and starts a new one; workspaces
// that have gone quiet are listed with plain facts, and clean, quiet ones come ticked.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { facts, kept, lastScan, listed, scanCleanup, ticked, type CleanupRow, type CleanupScan } from "./cleanupScan";
import { worktreeLabel as label, type Project } from "./model";


export default function Cleanup({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const [scan, setScan] = useState<CleanupScan | null>(lastScan);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: projects.length });
  const [, redraw] = useState(0);
  useEffect(() => {
    let open = true;
    scanCleanup(projects, (projectId) => invoke<CleanupRow[]>("workspace_cleanup_scan", { projectId }), (done, total) => open && setProgress({ done, total })).then((s) => {
      if (!open) return;
      setScan(s);
      setProgress(null);
    });
    return () => {
      open = false;
    };
  }, [projects]);
  const now = Date.now();
  const shown = (scan?.repos ?? []).map((repo) => ({ ...repo, rows: repo.rows.filter((r) => listed(r, now, kept.every)) }));
  const count = shown.reduce((n, repo) => n + repo.rows.filter((r) => ticked(r, now)).length, 0);
  const flip = (r: CleanupRow) => {
    kept.ticks.set(r.path, !ticked(r, now));
    redraw((n) => n + 1);
  };
  return (
    <div className="ask-backdrop" onMouseDown={onClose}>
      <div
        className="ask start-git cleanup"
        role="dialog"
        aria-modal="true"
        aria-label="Clean up workspaces"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="ask-title">Clean up workspaces</h2>
        <p className="ask-body" aria-live="polite">
          {progress ? `Scanning ${progress.done} of ${progress.total} repositor${progress.total === 1 ? "y" : "ies"}…${scan ? " The list below is from the last scan." : ""}` : "Workspaces with no commit for a week, or with nothing beyond the default branch. Clean, quiet ones are ticked."}
        </p>
        <label className="cleanup-every">
          <input
            type="checkbox"
            checked={kept.every}
            onChange={() => {
              kept.every = !kept.every;
              redraw((n) => n + 1);
            }}
          />
          Show every workspace
        </label>
        <ul className="first-files" aria-label="workspaces to clean up">
          {shown.map((repo) => (
            <li key={repo.project.id} className="cleanup-repo">
              <div className="cleanup-proj">{repo.project.name}</div>
              {repo.error && <div className="cleanup-error">Could not scan {repo.project.name}: {repo.error}</div>}
              {repo.rows.map((r) => (
                <label key={r.path} title={r.path}>
                  <input type="checkbox" checked={ticked(r, now)} onChange={() => flip(r)} />
                  <span className="first-path">{label(r)}</span>
                  <span className="first-secret">{facts(r, now).join(" · ")}</span>
                </label>
              ))}
            </li>
          ))}
          {scan && shown.every((repo) => repo.rows.length === 0 && !repo.error) && <li className="first-none">No workspace has gone quiet.</li>}
        </ul>
        <div className="btn-row">
          <span className="cleanup-count">{count} selected</span>
          <button className="btn" onClick={onClose} autoFocus>
            Close
          </button>
          <button className="btn danger" disabled title="Remove selected (not built yet)">
            Remove selected
          </button>
        </div>
      </div>
    </div>
  );
}
