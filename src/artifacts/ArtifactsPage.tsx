// The Artifacts library (SKILL-036, VIEW-012): the pages Claude publishes and the files an agent
// creates, kept newest first and cut into one section per project, with a viewer beside the list.
// A page is served by the app's kolux-artifact scheme, which hands out only the selected entry's
// stored files; the viewer frame is sandboxed, and a clicked link that leaves the entry comes back
// here as a message and opens in the system browser. An image or a text file is shown straight from
// the same scheme; a PDF or a document the viewer cannot render is handed to its own app.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { locale } from "../language";

export type Artifact = {
  id: string;
  title: string;
  source: string;
  origin: string;
  kind: string;
  project: string | null;
  session: string | null;
  added: number;
  size: number;
  page: string;
  state: "ok" | "unavailable" | "remote";
  stored: boolean;
};

/** Titles only, ignoring case; every typed word has to appear. */
export function matches(title: string, query: string): boolean {
  const t = title.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

/** What a section is called: the project it came from, or how it got here. */
export function section(a: Pick<Artifact, "project" | "source">): string {
  return a.project ?? (a.source === "hand" ? "Added by hand" : "Other");
}

/** The list cut into one section per project, the section holding the newest artifact first. */
export function group(list: Artifact[]): { project: string; items: Artifact[] }[] {
  const by = new Map<string, Artifact[]>();
  for (const a of list) {
    const k = section(a);
    const items = by.get(k);
    if (items) items.push(a);
    else by.set(k, [a]);
  }
  return [...by].map(([project, items]) => ({ project, items })).sort((x, y) => y.items[0].added - x.items[0].added);
}

/** How the viewer shows an entry: in the frame, as a picture, or not at all. */
export function view(kind: string | undefined): "frame" | "image" | "app" {
  if (kind === "image") return "image";
  if (kind === undefined || kind === "page" || kind === "text") return "frame";
  return "app";
}

/** The file's own type, for the small tag beside its title. */
export function extText(page: string): string {
  const dot = page.lastIndexOf(".");
  return dot > 0 ? page.slice(dot + 1).toUpperCase().slice(0, 5) : "";
}

/** B, KB or MB with one decimal. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The scheme's address on this platform: Windows web views reach custom schemes over http. */
export function viewerUrl(a: Pick<Artifact, "id" | "page">, windows = navigator.userAgent.includes("Windows")): string {
  const base = windows ? "http://kolux-artifact.localhost" : "kolux-artifact://localhost";
  return `${base}/${a.id}/${a.page.split("/").map(encodeURIComponent).join("/")}`;
}

type Props = {
  onToast: (text: string) => void;
  /** The workspace whose `artifacts/` folder is imported automatically; none when no folder is open. */
  workspace?: string | null;
  /** The project the workspace belongs to, so imports sit under that heading rather than the folder name. */
  project?: string | null;
};

export default function ArtifactsPage({ onToast, workspace, project }: Props) {
  const [list, setList] = useState<Artifact[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const refresh = useCallback(
    () => invoke<Artifact[]>("artifacts_list").then(setList, (e) => onToast(`Could not read the library: ${e}`)),
    [onToast],
  );
  useEffect(() => {
    void refresh();
    // A Claude session published a page (SKILL-035), or the workspace scan imported one.
    const off = listen("artifacts-changed", () => void refresh());
    return () => void off.then((f) => f());
  }, [refresh]);

  // SKILL-036: a workspace keeps its finished files in `artifacts/`. Import that folder when the
  // page opens and watch it while it is up, so an agent's new page is already in the tab without
  // Add artifact. The Rust scan remembers unchanged files and only re-imports a changed one.
  useEffect(() => {
    if (!workspace) return;
    let live = true;
    const scan = () =>
      invoke<number>("artifacts_scan", { path: workspace, project })
        .then((n) => {
          if (live && n > 0) void refresh();
        })
        .catch(() => {});
    void scan();
    const timer = window.setInterval(scan, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [workspace, project, refresh]);

  // A link clicked inside the viewer: only messages from our own frame count.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data?.koluxOpen !== "string") return;
      invoke("open_external", { url: e.data.koluxOpen }).catch((err) => onToast(String(err)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const shown = useMemo(() => group((list ?? []).filter((a) => matches(a.title, query))), [list, query]);
  const current = list?.find((a) => a.id === selected) ?? null;

  const add = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      title: "Add artifact",
      filters: [
        { name: "Pages and pictures", extensions: ["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf"] },
        { name: "Documents", extensions: ["md", "txt", "csv", "docx", "xlsx", "pptx"] },
        { name: "All files", extensions: ["*"] },
      ],
    }).catch(() => null);
    if (typeof path !== "string") return;
    try {
      const a = await invoke<Artifact>("artifact_add", { path });
      await refresh();
      setSelected(a.id);
      setLoaded(null);
    } catch (e) {
      // SKILL-036's card fixes this wording; it covers a page or any other file added by hand.
      onToast(`Could not add that page: ${e}`);
    }
  };
  const remove = async (a: Artifact) => {
    try {
      await invoke("artifact_remove", { id: a.id });
      if (selected === a.id) setSelected(null);
      await refresh();
    } catch (e) {
      onToast(`Could not remove ${a.title}: ${e}`);
    }
  };
  const openFile = (a: Artifact) => invoke("open_path", { path: a.origin }).catch((e) => onToast(`Could not open ${a.title}: ${e}`));

  return (
    <div className="artifacts">
      <div className="art-side">
        <div className="art-head">
          <h2>Artifacts</h2>
          <button className="btn" onClick={() => void add()}>
            Add artifact
          </button>
        </div>
        <input className="picker-input" placeholder="Search titles" aria-label="Search artifacts" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="art-list" role="listbox" aria-label="Saved artifacts">
          {list && list.length === 0 && <div className="menu-hint">No artifacts yet. Files in this workspace's artifacts folder land here automatically, or add one yourself.</div>}
          {list && list.length > 0 && shown.length === 0 && <div className="menu-hint">No titles hold every word of “{query.trim()}”.</div>}
          {shown.map((s) => (
            <div key={s.project} className="art-group">
              <div className="art-group-head" title={s.project}>{s.project}</div>
              {s.items.map((a) => (
                <div key={a.id} role="option" aria-selected={a.id === selected} className={`art-row${a.id === selected ? " sel" : ""}`}
                  tabIndex={0}
                  onClick={() => (setSelected(a.id), setLoaded(null))}
                  onKeyDown={(e) => e.key === "Enter" && (setSelected(a.id), setLoaded(null))}
                >
                  <div className="art-title">
                    <span className="name">{a.title}</span>
                    {a.kind !== "page" && <span className="preview-tag">{extText(a.page)}</span>}
                    {a.state === "remote" && <span className="preview-tag">Remote</span>}
                    {a.state === "unavailable" && <span className="preview-tag">Unavailable</span>}
                  </div>
                  <div className="art-meta">
                    {[a.project ?? (a.source === "hand" ? "Added by hand" : "An agent"), a.session && "session " + a.session.slice(0, 8), new Date(a.added).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }), sizeText(a.size)].filter(Boolean).join(" · ")}
                  </div>
                  <button
                    className="ib art-remove"
                    title="Remove from library"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(a);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="art-view">
        {!current && <div className="empty"><p>Pick an artifact to view it here.</p></div>}
        {current?.state === "remote" && <div className="empty"><h2>{current.title}</h2><p>This page is on a machine this computer cannot read (WSL or SSH).</p></div>}
        {current?.state === "unavailable" && <div className="empty"><h2>{current.title}</h2><p>This page is on a network share, which Kolux never opens.</p></div>}
        {current?.state === "ok" && !current.stored && <div className="empty"><h2>{current.title}</h2><p>Could not show this file: its stored copy is missing. Add it again to restore it.</p></div>}
        {current?.state === "ok" && current.stored && view(current.kind) === "image" && <img className="art-image" src={viewerUrl(current)} alt={current.title} />}
        {current?.state === "ok" && current.stored && view(current.kind) === "app" && (
          <div className="empty">
            <h2>{current.title}</h2>
            <p>A {extText(current.page) || "file"} file opens in its own app.</p>
            <button className="btn" onClick={() => void openFile(current)}>Open {extText(current.page) || "file"}</button>
          </div>
        )}
        {current?.state === "ok" && current.stored && view(current.kind) === "frame" && (
          <>
            {loaded !== current.id && <div className="art-loading menu-hint">Loading…</div>}
            <iframe
              // A republished page has a newer time: show the new version.
              key={`${current.id}-${current.added}`}
              ref={frame}
              name={`artifact-${current.id}`}
              title={current.title}
              className="art-frame"
              sandbox="allow-scripts allow-forms"
              src={viewerUrl(current)}
              onLoad={() => setLoaded(current.id)}
            />
          </>
        )}
      </div>
    </div>
  );
}
