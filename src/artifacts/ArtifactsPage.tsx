// The Artifacts library (SKILL-036, VIEW-012): saved HTML pages, newest first, with a viewer
// beside the list. Pages are served by the app's kolux-artifact scheme, which hands out only the
// selected entry's stored files; the viewer frame is sandboxed, and a clicked link that leaves the
// entry comes back here as a message and opens in the system browser.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type Artifact = {
  id: string;
  title: string;
  source: string;
  origin: string;
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

type Props = { onToast: (text: string) => void };

export default function ArtifactsPage({ onToast }: Props) {
  const [list, setList] = useState<Artifact[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const refresh = () => invoke<Artifact[]>("artifacts_list").then(setList, (e) => onToast(`Could not read the library: ${e}`));
  useEffect(() => {
    void refresh();
  }, []);

  // A link clicked inside the viewer: only messages from our own frame count.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data?.koluxOpen !== "string") return;
      invoke("open_external", { url: e.data.koluxOpen }).catch((err) => onToast(String(err)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const shown = useMemo(() => (list ?? []).filter((a) => matches(a.title, query)), [list, query]);
  const current = list?.find((a) => a.id === selected) ?? null;

  const add = async () => {
    const path = await open({ multiple: false, directory: false, title: "Add artifact", filters: [{ name: "Web page", extensions: ["html", "htm"] }] }).catch(() => null);
    if (typeof path !== "string") return;
    try {
      const a = await invoke<Artifact>("artifact_add", { path });
      await refresh();
      setSelected(a.id);
      setLoaded(null);
    } catch (e) {
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
          {list && list.length === 0 && <div className="menu-hint">No artifacts yet. Pages Claude publishes land here, or add one from a file.</div>}
          {list && list.length > 0 && shown.length === 0 && <div className="menu-hint">No titles hold every word of “{query.trim()}”.</div>}
          {shown.map((a) => (
            <div key={a.id} role="option" aria-selected={a.id === selected} className={`art-row${a.id === selected ? " sel" : ""}`}
              tabIndex={0}
              onClick={() => (setSelected(a.id), setLoaded(null))}
              onKeyDown={(e) => e.key === "Enter" && (setSelected(a.id), setLoaded(null))}
            >
              <div className="art-title">
                <span className="name">{a.title}</span>
                {a.state === "remote" && <span className="preview-tag">Remote</span>}
                {a.state === "unavailable" && <span className="preview-tag">Unavailable</span>}
              </div>
              <div className="art-meta">
                {[a.project ?? (a.source === "hand" ? "Added by hand" : "Claude"), a.session, new Date(a.added).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }), sizeText(a.size)].filter(Boolean).join(" · ")}
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
      </div>
      <div className="art-view">
        {!current && <div className="empty"><p>Pick an artifact to view it here.</p></div>}
        {current?.state === "remote" && <div className="empty"><h2>{current.title}</h2><p>This page is on a machine this computer cannot read (WSL or SSH).</p></div>}
        {current?.state === "unavailable" && <div className="empty"><h2>{current.title}</h2><p>This page is on a network share, which Kolux never opens.</p></div>}
        {current?.state === "ok" && !current.stored && <div className="empty"><h2>{current.title}</h2><p>Could not show this page: its stored copy is missing. Add it again to restore it.</p></div>}
        {current?.state === "ok" && current.stored && (
          <>
            {loaded !== current.id && <div className="art-loading menu-hint">Loading…</div>}
            <iframe
              key={current.id}
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
