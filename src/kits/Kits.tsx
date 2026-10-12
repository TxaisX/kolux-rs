// SKILL-002: the starter-kit gallery, and SKILL-004 / SKILL-005: a kit's setup dialog. Both float
// over the app (App owns them, so leaving a screen does not close them). Any part of the app opens
// the gallery with the `kolux-open-kits` window event.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Book, Box, Close, Funnel, Megaphone, Merge, Pulse, Table } from "../chrome/icons";
import { CATEGORY_NAME, KITS, RESULTS_FOLDER, VENDOR_NAME, assignRoles, extOf, fillEmpty, firstDropped, isWorkbook, recalled, sampleValues, unquote, type Kit, type Vendor } from "./catalog";
import { sameDir } from "../workspaces";

export const OPEN_KITS = "kolux-open-kits";
export const openKits = () => window.dispatchEvent(new CustomEvent(OPEN_KITS));

const ICONS: Record<string, (p: { size?: number }) => ReactElement> = { spreadsheet: Table, "tidy-merge": Merge, marketing: Megaphone, research: Book, sales: Funnel, weekly: Pulse };
export const KitIcon = ({ id, size = 18 }: { id: string; size?: number }) => {
  const I = ICONS[id] ?? Box;
  return <I size={size} />;
};

function RoleList({ kit, connected }: { kit: Kit; connected: Vendor[] }) {
  const who = assignRoles(kit, connected);
  return (
    <ul className="kit-roles">
      {kit.roles.map((r, i) => (
        <li key={r.id}>
          <span>{r.title}</span>
          <span className={who[i] ? "kit-ai" : "kit-ai off"}>{who[i] ? VENDOR_NAME[who[i]!] : "not connected"}</span>
        </li>
      ))}
    </ul>
  );
}

export function KitGallery({ connected, onPick, onClose }: { connected: Vendor[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="ask-backdrop" onMouseDown={onClose}>
      <div className="kits" role="dialog" aria-modal="true" aria-label="Starter kits" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="kits-head">
          <h2 className="ask-title">Starter kits</h2>
          <button className="ib" title="Close" onClick={onClose} autoFocus>
            <Close />
          </button>
        </div>
        <p className="ask-body">A ready-made job for three AIs, each in its own role, on your own files.</p>
        <div className="kit-grid">
          {KITS.map((k) => (
            <button key={k.id} className="kit-card" aria-label={k.title} onClick={() => onPick(k.id)}>
              <span className="kit-top">
                <span className="kit-icon">
                  <KitIcon id={k.id} />
                </span>
                <span className="kit-badge">{CATEGORY_NAME[k.category]}</span>
                <span className="kit-time">about {k.minutes} min</span>
              </span>
              <span className="kit-title">{k.title}</span>
              <span className="kit-sum">{k.summary}</span>
              <RoleList kit={k} connected={connected} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type Check = "checking" | "file" | "dir" | "missing";

/** SKILL-004: whether Start kit can go, from what is typed and what the disk said. */
export function canStart(kit: Kit, values: Record<string, string>, checks: Record<string, Check>, connected: Vendor[], dir: string | null): boolean {
  if (connected.length === 0 || !dir) return false;
  return kit.inputs.every((i) => {
    const v = (values[i.id] ?? "").trim();
    if (!v) return !i.required;
    if (i.kind === "text") return true;
    return !isWorkbook(v) && checks[i.id] === "file";
  });
}

export type SetupProps = {
  kit: Kit;
  connected: Vendor[];
  /** The workspace the kit runs in, or null with none open. */
  dir: string | null;
  sampleDir: string | null;
  settings: Record<string, unknown>;
  onSamples: () => void;
  samplesBusy: boolean;
  onStart: (values: Record<string, string>, assigned: (Vendor | null)[]) => void;
  /** SKILL-006: the folder holds another kit's run; Start kit becomes Start anyway. */
  conflict?: string | null;
  onBack: () => void;
  onClose: () => void;
};

/** What the fields start with: sample values in the kit's own sample workspace, then remembered ones. */
export function startValues(kit: Kit, dir: string | null, sampleDir: string | null, settings: Record<string, unknown>): Record<string, string> {
  if (!dir) return {};
  const base = sameDir(dir, sampleDir) ? sampleValues(kit, dir) : {};
  return fillEmpty(base, recalled(settings, dir, kit));
}

export function KitSetup({ kit, connected, dir, sampleDir, settings, onSamples, samplesBusy, onStart, onBack, onClose, conflict = null }: SetupProps) {
  const [values, setValues] = useState<Record<string, string>>(() => startValues(kit, dir, sampleDir, settings));
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  // A workspace opened by Try with sample data fills the fields; another workspace clears them.
  const shownDir = useRef(dir);
  useEffect(() => {
    if (sameDir(shownDir.current, dir)) return;
    shownDir.current = dir;
    setValues(startValues(kit, dir, sampleDir, settings));
    setTouched(new Set());
  }, [dir, sampleDir, kit, settings]);
  const set = (id: string, v: string) => setValues((s) => ({ ...s, [id]: v }));

  // A file path is looked up on disk after a short pause; text is never checked.
  const files = kit.inputs.filter((i) => i.kind === "file").map((i) => `${i.id}\n${(values[i.id] ?? "").trim()}`).join("\n");
  useEffect(() => {
    const todo = kit.inputs.filter((i) => i.kind === "file" && (values[i.id] ?? "").trim() && !isWorkbook(values[i.id]));
    setChecks(Object.fromEntries(todo.map((i) => [i.id, "checking"])) as Record<string, Check>);
    let live = true;
    const t = window.setTimeout(() => {
      for (const i of todo)
        invoke<"file" | "dir" | "missing">("path_kind", { path: values[i.id].trim() })
          .then((k) => live && setChecks((c) => ({ ...c, [i.id]: k })))
          .catch(() => live && setChecks((c) => ({ ...c, [i.id]: "missing" })));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [files]);

  // A file dropped onto a field fills it: the first file, never a folder, only the field under it.
  const live = useRef({ set });
  live.current = { set };
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload: p }) => {
        if (p.type !== "drop") return;
        const ratio = window.devicePixelRatio || 1;
        const at = document.elementFromPoint(p.position.x / ratio, p.position.y / ratio)?.closest<HTMLElement>("[data-kit-input]");
        if (!at || !box.current?.contains(at)) return;
        const id = at.dataset.kitInput!;
        Promise.all(p.paths.map((path) => invoke<string>("path_kind", { path }).then((k) => ({ path, dir: k === "dir" }))))
          .then((ds) => {
            const f = firstDropped(ds);
            if (f) live.current.set(id, f);
          })
          .catch(() => {});
      })
      .then((u) => (gone ? u() : (off = u)), () => {});
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  const browse = async (id: string, accept: string[] | undefined) => {
    const picked = await open({ multiple: false, directory: false, defaultPath: dir ?? undefined, filters: accept?.length ? [{ name: accept.map((a) => a.toUpperCase()).join(", "), extensions: accept.flatMap((a) => [a, a.toUpperCase()]) }] : undefined }).catch(() => null);
    if (typeof picked === "string") set(id, picked);
  };

  const assigned = assignRoles(kit, connected);
  const ready = canStart(kit, values, checks, connected, dir);
  return (
    <div className="ask-backdrop" onMouseDown={onClose}>
      <div ref={box} className="kits kit-setup" role="dialog" aria-modal="true" aria-label={kit.title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="kits-head">
          <span className="kit-icon">
            <KitIcon id={kit.id} />
          </span>
          <h2 className="ask-title">{kit.title}</h2>
          <button className="ib" title="Close" onClick={onClose}>
            <Close />
          </button>
        </div>
        <RoleList kit={kit} connected={connected} />
        {connected.length === 0 && (
          <p className="kit-note warn" role="alert">
            Connect Claude, Codex or Grok first: a kit needs at least one AI to work on it.
          </p>
        )}
        {kit.inputs.map((i) => {
          const v = values[i.id] ?? "";
          const empty = !v.trim();
          const bad = !empty && i.kind === "file" && isWorkbook(v);
          const missing = !empty && !bad && i.kind === "file" && (checks[i.id] === "missing" || checks[i.id] === "dir");
          const wrongType = !empty && !bad && i.kind === "file" && i.accept?.length && !i.accept.includes(extOf(v));
          return (
            <div key={i.id} className="kit-field" data-kit-input={i.id}>
              <label htmlFor={`kit-${i.id}`}>
                {i.label}
                {!i.required && !i.label.includes("optional") && <span className="kit-opt"> (optional)</span>}
              </label>
              <div className="kit-row">
                <input
                  id={`kit-${i.id}`}
                  className="field"
                  value={v}
                  placeholder={i.kind === "file" ? "Path to the file, or drop it here" : ""}
                  onChange={(e) => set(i.id, i.kind === "file" ? unquote(e.target.value) : e.target.value)}
                  onBlur={() => setTouched((t) => new Set(t).add(i.id))}
                />
                {i.kind === "file" && (
                  <button className="btn" onClick={() => void browse(i.id, i.accept)}>
                    Browse…
                  </button>
                )}
              </div>
              <span className="kit-hint">{i.hint}</span>
              {i.required && empty && touched.has(i.id) && <span className="kit-note warn">This one is needed.</span>}
              {bad && (
                <p className="kit-note warn" role="alert">
                  This is an Excel workbook. The kit needs a CSV: in Excel choose File, Save As, then CSV, and use that file here.
                </p>
              )}
              {missing && <span className="kit-note warn">{checks[i.id] === "dir" ? "That is a folder; choose a file." : "No file is at that path."}</span>}
              {wrongType && !missing && <span className="kit-hint">The kit expects {i.accept!.join(" or ")}; this file is used as it is.</span>}
            </div>
          );
        })}
        <p className="kit-hint">{dir ? `Results go to ${dir.replace(/[\\/]+$/, "")}\\${RESULTS_FOLDER}, one folder per role.` : "Open a project first, or try the kit with sample data."}</p>
        {conflict && (
          <p className="kit-note warn" role="alert">
            {conflict}
          </p>
        )}
        <div className="btn-row">
          <button className="btn link" onClick={onBack}>
            All kits
          </button>
          <span className="kit-gap" />
          <button className="btn" onClick={onSamples} disabled={samplesBusy}>
            {samplesBusy ? "Copying samples…" : "Try with sample data"}
          </button>
          <button className="btn primary" disabled={!ready} onClick={() => onStart(Object.fromEntries(Object.entries(values).map(([k, x]) => [k, x.trim()])), assigned)}>
            {conflict ? "Start anyway" : "Start kit"}
          </button>
        </div>
      </div>
    </div>
  );
}
