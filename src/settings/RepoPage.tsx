// SET-033: one repository's page in Settings: its display name, base branch and workspaces folder
// (each showing the inherited value until the user overrides it), and whether workspaces made outside
// Kolux show. Drafts save only when changed.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { projectLabel, type Project } from "../projects/model";
import RepoSetupSection from "./RepoSetup";

/** What a field's draft saves: null when it says what is saved already (viewing writes nothing). */
export function draftSave(saved: string | null | undefined, draft: string): string | null {
  const next = draft.trim();
  return next === (saved ?? "").trim() ? null : next;
}

type Field = "base" | "workspacesDir" | "displayName";

/** The repository's own choice about workspaces made outside Kolux (visibility source "other"). */
export type Outside = { global: boolean; own: boolean | null };
export type OutsideChoice = "global" | "show" | "hide";

export function outsideChoice(o: Outside): OutsideChoice {
  return o.own === null ? "global" : o.own ? "show" : "hide";
}

/** What a choice saves: null clears the repository's own choice, so the global one applies again. */
export function outsideSave(choice: OutsideChoice): boolean | null {
  return choice === "global" ? null : choice === "show";
}

function OutsideField({ outside, onChoose }: { outside: Outside; onChoose: (own: boolean | null) => void }) {
  return (
    <label className="look-select">
      <span>Workspaces made outside Kolux</span>
      <select aria-label="Workspaces made outside Kolux" className="field" value={outsideChoice(outside)} onChange={(e) => onChoose(outsideSave(e.target.value as OutsideChoice))}>
        <option value="global">{`Use the global choice (${outside.global ? "shown" : "hidden"})`}</option>
        <option value="show">Show them</option>
        <option value="hide">Hide them</option>
      </select>
    </label>
  );
}

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

export function RepoView({ project, globalDir, onSave, outside, onOutside }: { project: Project; globalDir: string; onSave: (field: Field, value: string) => void; outside?: Outside | null; onOutside?: (own: boolean | null) => void }) {
  return (
    <section className="conn-card" data-section="repo">
      <h2 className="conn-name">{projectLabel(project)}</h2>
      <p className="conn-detail">Folder: {project.path}</p>
      <DraftField label="Display name" saved={project.displayName} inherited={project.name} onSave={(v) => onSave("displayName", v)} />
      <DraftField label="New workspaces start from" saved={project.base} inherited="the default branch" onSave={(v) => onSave("base", v)} />
      <DraftField label="Workspaces folder" saved={project.workspacesDir} inherited={globalDir ? `${globalDir} (the global folder)` : "the global folder (Git & worktrees)"} onSave={(v) => onSave("workspacesDir", v)} />
      {outside && onOutside && <OutsideField outside={outside} onChoose={onOutside} />}
      <p className="conn-detail">Empty uses the value shown in grey. The icon is chosen from the project's own row in the sidebar.</p>
    </section>
  );
}

export default function RepoPage({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [globalDir, setGlobalDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outside, setOutside] = useState<Outside | null>(null);
  useEffect(() => {
    invoke<{ dir: string }>("workspaces_place_get")
      .then((p) => setGlobalDir(p.dir))
      .catch(() => setGlobalDir(""));
  }, []);
  useEffect(() => {
    invoke<{ key: string; global: boolean; own: boolean | null }[]>("visibility_get", { projectId: project.id })
      .then((list) => {
        const other = list.find((s) => s.key === "other");
        setOutside(other ? { global: other.global, own: other.own } : null);
      })
      .catch(() => setOutside(null));
  }, [project.id]);
  const chooseOutside = (own: boolean | null) => {
    invoke("visibility_set", { projectId: project.id, source: "other", show: own })
      .then(() => {
        setError(null);
        setOutside((o) => (o ? { ...o, own } : o));
      })
      .catch((e) => setError(String(e)));
  };
  const save = (field: Field, value: string) => {
    const done = (p: Project) => {
      setError(null);
      onSaved(p);
    };
    if (field === "displayName") {
      invoke<Project>("project_display_name_set", { projectId: project.id, name: value }).then(done).catch((e) => setError(String(e)));
      return;
    }
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
      <RepoView project={project} globalDir={globalDir} onSave={save} outside={outside} onOutside={chooseOutside} />
      <RepoSetupSection path={project.path} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
