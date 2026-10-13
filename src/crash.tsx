// APP-039: the crash report dialog. The backend keeps the reports (src-tauri/src/crash.rs); this
// offers the newest one once at startup and again from Help > Report Crash.
import { invoke } from "@tauri-apps/api/core";

export type Report = { id: string; text: string };

/** The GitHub repository crash issues go to, "owner/name". Empty until Kolux RS has a public
 *  repository of Txais's (DECISIONS OD-16), so Open on GitHub stays off. */
export const ISSUES_REPO = "";

export function issueTitle(report: Report | null): string {
  const lines = report?.text.split("\n") ?? [];
  const version = lines[0]?.match(/^Kolux RS (\S+) crashed/)?.[1];
  const what = lines.find((l) => l.startsWith("What: "))?.slice("What: ".length);
  return version && what ? `[Crash report] Kolux RS ${version}: ${what}` : "[Crash report] Kolux RS";
}

export function issueUrl(repo: string, report: Report | null): string | null {
  if (!repo) return null;
  const q = new URLSearchParams({ title: issueTitle(report), body: report ? "```\n" + report.text + "```\n" : "No crash report was captured." });
  return `https://github.com/${repo}/issues/new?${q}`;
}

export function CrashDialog({ report, onClose, onToast }: { report: Report | null; onClose: () => void; onToast: (text: string) => void }) {
  const copy = (text: Promise<string>, what: string) =>
    text
      .then((t) => invoke("clip_write", { text: t }).catch(() => navigator.clipboard.writeText(t)))
      .then(
        () => onToast(`${what} copied to the clipboard.`),
        (err) => onToast(`Could not copy the ${what.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`),
      );
  const url = issueUrl(ISSUES_REPO, report);
  return (
    <div className="ask-backdrop" onMouseDown={onClose}>
      <div
        className="ask crash"
        role="dialog"
        aria-modal="true"
        aria-label="Crash report"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="ask-title">{report ? "Kolux RS closed unexpectedly" : "No crash report"}</h2>
        <p className="ask-body">
          {report
            ? "These details were saved when it happened. Copy them, with the recent diagnostic log if you like, into a GitHub issue."
            : "No crash report was captured on this computer, so there is nothing to send."}
        </p>
        {report && <pre className="crash-text">{report.text}</pre>}
        <div className="btn-row">
          <button className="btn" onClick={() => void copy(invoke<string>("crash_logs"), "Diagnostic log")}>
            Attach recent diagnostic logs
          </button>
          {report && (
            <button className="btn" onClick={() => void copy(Promise.resolve(report.text), "Crash details")}>
              Copy Details
            </button>
          )}
          <button
            className="btn"
            disabled={!url}
            title={url ? undefined : "Kolux RS has no public repository yet; copy the details instead"}
            onClick={() => url && void invoke("open_external", { url }).catch((err) => onToast(String(err)))}
          >
            Open on GitHub
          </button>
          <button className="btn primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
