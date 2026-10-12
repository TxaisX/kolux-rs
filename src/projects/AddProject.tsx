// PROJ-002: the Add Project dialog. Its first step is the same with or without projects:
// cloning from a URL is the main choice, and opening a folder (Browse) and starting a new project
// sit beside it. Arrow keys move between the three, Enter takes the focused one, Escape closes.
// Cloning and creating themselves come with T-214 (PROJ-003, PROJ-004); until then their steps
// say so and lead back.
import { useEffect, useRef, useState } from "react";
import { FolderPlus, Plus } from "../chrome/icons";

export type Step = "choose" | "clone" | "new";
const CHOICES = 3;

/** Where an arrow key moves focus among the choices (wrapping), or null for any other key. */
export function nextChoice(key: string, at: number): number | null {
  if (key === "ArrowDown" || key === "ArrowRight") return (at + 1) % CHOICES;
  if (key === "ArrowUp" || key === "ArrowLeft") return (at + CHOICES - 1) % CHOICES;
  return null;
}

type ViewProps = { step: Step; onStep: (s: Step) => void; onBrowse: () => void; onClose: () => void };

export function AddProjectView({ step, onStep, onBrowse, onClose }: ViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const [url, setUrl] = useState("");
  useEffect(() => {
    // Focus stays inside the dialog on every step, so Escape always reaches it.
    if (step === "choose") choices.current[0]?.focus();
    else if (!box.current?.contains(document.activeElement)) box.current?.focus();
  }, [step]);
  const later = (what: string) => (
    <p className="ask-body">
      {what} is not built yet in this version. Open a folder works today for a repository already on this computer.
    </p>
  );
  return (
    <div className="ask-backdrop" onMouseDown={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        className="ask add-project"
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (step !== "choose") return;
          const at = choices.current.findIndex((b) => b === e.target);
          const next = at < 0 ? null : nextChoice(e.key, at);
          if (next !== null) {
            e.preventDefault();
            choices.current[next]?.focus();
          }
        }}
      >
        <h2 className="ask-title">{step === "clone" ? "Clone from a URL" : step === "new" ? "New project" : "Add project"}</h2>
        {step === "choose" && (
          <>
            <button ref={(b) => { choices.current[0] = b; }} className="add-choice primary" onClick={() => onStep("clone")}>
              <span className="add-choice-name">Clone from a URL</span>
              <span className="add-choice-hint">Copy a repository from GitHub or another Git host</span>
            </button>
            <div className="add-more">
              <button ref={(b) => { choices.current[1] = b; }} className="add-choice" onClick={onBrowse}>
                <FolderPlus size={13} />
                <span className="add-choice-name">Open a folder…</span>
              </button>
              <button ref={(b) => { choices.current[2] = b; }} className="add-choice" onClick={() => onStep("new")}>
                <Plus size={13} />
                <span className="add-choice-name">New project</span>
              </button>
            </div>
          </>
        )}
        {step === "clone" && (
          <>
            <input aria-label="repository URL" className="field" placeholder="https://github.com/owner/repo.git" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            {later("Cloning")}
          </>
        )}
        {step === "new" && later("Starting a new project")}
        {step !== "choose" && (
          <div className="btn-row">
            <button className="btn" onClick={() => onStep("choose")}>
              Back
            </button>
            <button className="btn" onClick={onBrowse}>
              Open a folder…
            </button>
            {step === "clone" && (
              <button className="btn primary" disabled>
                Clone
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The dialog with its own step; `onBrowse` runs the folder picker after the dialog closes. */
export default function AddProject({ onBrowse, onClose }: { onBrowse: () => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>("choose");
  return (
    <AddProjectView
      step={step}
      onStep={setStep}
      onBrowse={() => {
        onClose();
        onBrowse();
      }}
      onClose={onClose}
    />
  );
}
