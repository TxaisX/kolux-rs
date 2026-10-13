// SET-033: one repository's page in Settings: its base branch and workspaces folder, each showing
// the inherited value until the user overrides it. Drafts save only when changed.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../projects/model";

/** What a field's draft saves: null when it says what is saved already (viewing writes nothing). */
export function draftSave(saved: string | null | undefined, draft: string): string | null {
  const next = draft.trim();
  return next === (saved ?? "").trim() ? null : next;
}

type Field = "base" | "workspacesDir";

function DraftField({ label, saved, inherited, onSave }: { label: string; saved: string | null | undefined; inherited: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(saved ?? "");
  useEffect(() => setDraft(saved ?? ""), [saved]);
  const commit = () => {
    const v = draftSave(saved, draft);
    if (v !== null) onSave(v);
  };
  return (
    <div className="look-select">
      <span>{label}</span>
      <input
        aria-label={label}
        className="field"
        placeholder={inherited}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        // an input method still composing (Hangul typed slowly, say) owns Enter
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && e.currentTarget.blur()}
      />
    </div>
  );
}

export function RepoView({ project, globalDir, onSave }: { project: Project; globalDir: string; onSave: (field: Field, value: string) => void }) {
  return (
    <section className="conn-card" data-section="repo">
      <h2 className="conn-name">{project.name}</h2>
      <p className="conn-detail">Folder: {project.path}</p>
      <DraftField label="New workspaces start from" saved={project.base} inherited="the default branch" onSave={(v) => onSave("base", v)} />
      <DraftField label="Workspaces folder" saved={project.workspacesDir} inherited={globalDir ? `${globalDir} (the global folder)` : "the global folder (Git & worktrees)"} onSave={(v) => onSave("workspacesDir", v)} />
      <p className="conn-detail">Empty uses the value shown in grey. Setup scripts, the display name and the icon come later.</p>
    </section>
  );
}

export default function RepoPage({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [globalDir, setGlobalDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<{ dir: string }>("workspaces_place_get")
      .then((p) => setGlobalDir(p.dir))
      .catch(() => setGlobalDir(""));
  }, []);
  const save = (field: Field, value: string) => {
    const next = { workspacesDir: project.workspacesDir ?? "", base: project.base ?? "", [field]: value };
    invoke<Project>("project_set", { projectId: project.id, ...next })
      .then((p) => {
        setError(null);
        onSaved(p);
      })
      .catch((e) => setError(String(e)));
  };
  return (
    <>
      <RepoView project={project} globalDir={globalDir} onSave={save} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
