// The one dialog that creates or edits an automation (AUTO-005) and sets its timetable (AUTO-001):
// a roomy prompt editor with a find bar on the left, the settings in a column on the right, and a
// live preview of the timetable that shows the checker's message when the line will not do. The
// back end checks everything again on save; one request id per opening means a double click or a
// repeated save leaves one automation. Create and edit on the command line (CLI-029) are T-197.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "../launch/PlusMenu";
import { folderName, type Project, type Worktree } from "../projects/model";
import { defaultForm, findNext, preselect, type Automation, type Preset, type ScheduleForm } from "./model";

type Props = {
  projects: Project[];
  agents: AgentInfo[];
  /** The latest saved copy when editing (the page fetches it first), or null for a new one. */
  editing: Automation | null;
  onClose: () => void;
  onSaved: (a: Automation) => void;
};

const providers = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "gemini", name: "Gemini" },
];
const presets: Array<{ value: Preset; label: string }> = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Monday to Friday" },
  { value: "weekly", label: "Once a week" },
  { value: "custom", label: "Custom (cron or RRULE)" },
];
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export default function AutomationDialog({ projects, agents, editing, onClose, onSaved }: Props) {
  const [requestId] = useState(() => `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [name, setName] = useState(editing?.name ?? "");
  const [prompt, setPrompt] = useState(editing?.prompt ?? "");
  const [provider, setProvider] = useState(editing?.provider ?? "claude");
  const [projectId, setProjectId] = useState(editing?.projectId ?? projects[0]?.id ?? "");
  const [mode, setMode] = useState<"existing" | "new-per-run">(editing?.workspaceMode ?? "existing");
  const [workspace, setWorkspace] = useState(editing?.workspace ?? "");
  const [base, setBase] = useState(editing?.baseBranch ?? "");
  const [form, setForm] = useState<ScheduleForm>(editing?.form ?? defaultForm);
  const [zone, setZone] = useState((editing?.trigger?.kind === "schedule" && editing.trigger.timezone) || localZone());
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ timetable: string; nextRunLabel: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const find = useRef<HTMLInputElement>(null);
  const project = projects.find((p) => p.id === projectId);
  const schedule = { ...form, timezone: zone };

  // AUTO-005: the project's worktrees; saving waits until Kolux has read them.
  useEffect(() => {
    setWorktrees(null);
    setSetupError(null);
    if (!projectId) return;
    let live = true;
    invoke<Worktree[]>("workspace_list", { projectId })
      .then((list) => {
        if (!live) return;
        setWorktrees(list);
        setWorkspace((w) => (list.some((t) => t.path === w) ? w : preselect(list)));
      })
      .catch((e) => {
        if (live) setSetupError(String(e));
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  useEffect(() => {
    let live = true;
    invoke<{ timetable: string; nextRunLabel: string }>("automation_preview", { input: schedule })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setPreviewError(null);
      })
      .catch((e) => {
        if (!live) return;
        setPreview(null);
        setPreviewError(String(e));
      });
    return () => {
      live = false;
    };
  }, [form.preset, form.time, form.day, form.custom, zone]);

  const findFrom = (from: number) => {
    const at = findNext(prompt, findQuery, from);
    const box = editor.current;
    if (at < 0 || !box) return;
    box.focus();
    box.setSelectionRange(at, at + findQuery.length);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // Escape shuts the find bar before it shuts the dialog.
      if (findOpen) {
        setFindOpen(false);
        editor.current?.focus();
      } else onClose();
    } else if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setFindOpen(true);
      window.setTimeout(() => find.current?.select(), 0);
    }
  };

  const ready = worktrees !== null && setupError === null;
  const save = () => {
    if (saving || !ready) return;
    setSaving(true);
    setSaveError(null);
    const input = { id: editing?.id, requestId, name, prompt, provider, projectId, workspaceMode: mode, workspace: mode === "existing" ? workspace : null, baseBranch: mode === "new-per-run" ? base : "", schedule };
    invoke<Automation>("automation_save", { input })
      .then((a) => {
        onSaved(a);
        onClose();
      })
      .catch((e) => {
        setSaveError(String(e));
        setSaving(false);
      });
  };
  const hits = findQuery ? prompt.toLowerCase().split(findQuery.toLowerCase()).length - 1 : 0;
  const choices = providers.map((p) => ({ ...p, name: agents.find((a) => a.id === p.id)?.name ?? p.name }));

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="auto-dialog" role="dialog" aria-modal="true" aria-label={editing ? `Edit ${editing.name}` : "New Automation"} onKeyDown={keys}>
        <h2>{editing ? "Edit automation" : "New Automation"}</h2>
        <div className="auto-dialog-body">
          <div className="auto-dialog-main">
            <label className="auto-label">
              Name
              <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning checks" />
            </label>
            <div className="auto-label grow">
              <span>Prompt</span>
              {findOpen && (
                <div className="auto-find" role="search">
                  <input
                    ref={find}
                    className="field"
                    aria-label="Find in prompt"
                    placeholder="Find"
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        findFrom(editor.current?.selectionEnd ?? 0);
                      }
                    }}
                  />
                  <span className="muted">{findQuery ? `${hits} found` : ""}</span>
                  <button className="btn" onClick={() => findFrom(editor.current?.selectionEnd ?? 0)}>
                    Next
                  </button>
                </div>
              )}
              <textarea ref={editor} className="field auto-prompt" aria-label="Prompt" spellCheck={false} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What the agent starts with. Ctrl+F finds text in it." />
            </div>
          </div>
          <div className="auto-dialog-side">
            <label className="auto-label">
              Agent
              <select className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="auto-label">
              Project
              <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="auto-label">
              <legend>Workspace</legend>
              <label className="auto-radio">
                <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> An existing worktree
              </label>
              {mode === "existing" && (
                <select className="field" aria-label="Worktree" value={workspace} disabled={!worktrees} onChange={(e) => setWorkspace(e.target.value)}>
                  {(worktrees ?? []).map((w) => (
                    <option key={w.path} value={w.path}>
                      {w.isMain ? `${folderName(w.path)} (main)` : (w.name ?? folderName(w.path))}
                    </option>
                  ))}
                </select>
              )}
              <label className="auto-radio">
                <input type="radio" checked={mode === "new-per-run"} onChange={() => setMode("new-per-run")} /> A new worktree for every run
              </label>
              {mode === "new-per-run" && <input className="field" aria-label="Base branch" value={base} onChange={(e) => setBase(e.target.value)} placeholder={`From ${project?.base || "the default branch"}`} />}
            </fieldset>
            <label className="auto-label">
              Timetable
              <select className="field" value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value as Preset })}>
                {presets.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {form.preset === "hourly" && (
              <label className="auto-label">
                Minutes past the hour
                <input className="field" type="number" min={0} max={59} value={Number(form.time.split(":")[1] ?? 0)} onChange={(e) => setForm({ ...form, time: `00:${e.target.value.padStart(2, "0")}` })} />
              </label>
            )}
            {form.preset === "weekly" && (
              <label className="auto-label">
                Day
                <select className="field" value={form.day ?? 1} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
                  {days.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(form.preset === "daily" || form.preset === "weekdays" || form.preset === "weekly") && (
              <label className="auto-label">
                Time
                <input className="field" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </label>
            )}
            {form.preset === "custom" && (
              <label className="auto-label">
                Cron line or RRULE
                <input className="field mono" value={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.value })} placeholder="0 9 * * 1-5" />
              </label>
            )}
            <label className="auto-label">
              Time zone
              <input className="field" value={zone} onChange={(e) => setZone(e.target.value)} />
            </label>
            {previewError ? (
              <div className="note error" role="alert">
                {previewError}
              </div>
            ) : (
              preview && (
                <div className="auto-preview">
                  {preview.timetable}
                  <br />
                  Next run: {preview.nextRunLabel}
                </div>
              )
            )}
          </div>
        </div>
        {setupError && <div className="note error">Kolux cannot read this project's worktrees yet, so it will not save: {setupError}</div>}
        {saveError && (
          <div className="note error" role="alert">
            {saveError}
          </div>
        )}
        <div className="auto-dialog-foot">
          <span className="muted">Once saved, it keeps running on this timetable until you pause it.</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || !ready || previewError !== null} onClick={save} title={ready ? undefined : "Waiting for the project's worktrees"}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
