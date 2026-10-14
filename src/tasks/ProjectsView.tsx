// T-314-c: GitHub Projects inside Tasks (GIT-056): pick a project (pinned, recent, browsing an owner,
// or a pasted URL / owner and number), open one of its views, and read and edit it as a table whose
// columns sort and group. Board and roadmap views are marked unsupported in the picker and in the view
// alike (GIT-057, one rule: viewSupport).
// ponytail: assignee and issue-type cells, and adding a repository that is not in Kolux, are T-314-d.
import { invoke } from "@tauri-apps/api/core";
import { Fragment, useEffect, useState } from "react";
import { Refresh } from "../chrome/icons";
import type { Project as KoluxProject } from "../projects/model";
import { cellEditable, cellText, GROUPABLE, groupItems, labelChange, openingView, parseProjectRef, type Project, type ProjectField, type ProjectItem, projectKey, type ProjectRef, pushRecent, refsFrom, type Scope, scopeItems, sortItems, togglePin, viewLabel, viewSupport, viewUrl } from "./projects";

type Settings = Record<string, unknown> | null;
type Save = (patch: Record<string, unknown>) => Promise<unknown> | void;

/** The open project and table state survive leaving the page and coming back (app session). */
const kept: { ref: ProjectRef | null; sort: { field: string; dir: 1 | -1 } | null; group: string; scope: Scope } = { ref: null, sort: null, group: "", scope: { mode: "all" } };

/** The GitHub repositories (owner/name, lower case) of the projects open in Kolux. */
async function koluxRepos(): Promise<string[]> {
  const list = await invoke<KoluxProject[]>("project_list");
  const repos = await Promise.all(list.map((p) => invoke<{ owner: string; name: string } | null>("scm_github_repo", { worktree: p.path }).catch(() => null)));
  return repos.flatMap((r) => (r ? [`${r.owner}/${r.name}`.toLowerCase()] : []));
}

function CellEditor({ item, field, onDone }: { item: ProjectItem; field: ProjectField; onDone: (value: string | null) => void }) {
  const now = field.kind === "single_select" || field.kind === "iteration" ? (item.values[field.id]?.id ?? "") : cellText(item, field);
  const [text, setText] = useState(now);
  if (field.kind === "single_select" || field.kind === "iteration") {
    return (
      <select className="field" autoFocus value={text} aria-label={field.name} onChange={(e) => onDone(e.target.value)} onBlur={() => onDone(null)} onKeyDown={(e) => e.key === "Escape" && onDone(null)}>
        <option value="">No {field.name.toLowerCase()}</option>
        {field.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.start ? ` (${o.start})` : ""}
          </option>
        ))}
      </select>
    );
  }
  const type = field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text";
  const commit = () => onDone(text === now ? null : text);
  return (
    <input
      className="field"
      autoFocus
      type={type}
      value={text}
      aria-label={field.name}
      placeholder={field.kind === "labels" ? "bug, docs" : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onDone(null);
      }}
    />
  );
}

export default function ProjectsView({ host, owner, settings, save }: { host: string; owner: string; settings: Settings; save: Save }) {
  const pinned = refsFrom(settings?.tasksProjectsPinned);
  const recent = refsFrom(settings?.tasksProjectsRecent);
  const lastViews = (settings?.tasksProjectsLastView ?? {}) as Record<string, unknown>;
  const [ref, setRef] = useState<ProjectRef | null>(kept.ref);
  const [project, setProject] = useState<Project | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [browseOwner, setBrowseOwner] = useState(owner);
  const [browsed, setBrowsed] = useState<{ owner: string; number: number; title: string; closed: boolean }[] | null>(null);
  const [sort, setSort] = useState(kept.sort);
  const [group, setGroup] = useState(kept.group);
  const [scope, setScope] = useState<Scope>(kept.scope);
  const [inKolux, setInKolux] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ item: string; field: string } | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  Object.assign(kept, { ref, sort, group, scope });

  useEffect(() => setBrowseOwner(owner), [owner]);
  useEffect(() => {
    let live = true;
    koluxRepos()
      .then((r) => live && setInKolux(r))
      .catch(() => live && setInKolux([]));
    return () => {
      live = false;
    };
  }, []);

  const load = (r: ProjectRef | null = ref, wantView: number | null = null) => {
    setProject(null);
    setError(null);
    setEditing(null);
    if (!r) return () => {};
    let live = true;
    invoke<Project>("github_project", { host: r.host, owner: r.owner, number: r.number })
      .then((p) => {
        if (!live) return;
        setProject(p);
        const remembered = lastViews[projectKey(r)];
        setView(openingView(p, wantView ?? (typeof remembered === "number" ? remembered : null)));
        const named = { ...r, title: p.title };
        void save({ tasksProjectsRecent: pushRecent(recent, named) });
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  };
  useEffect(() => load(), [ref ? projectKey(ref) : ""]);

  const open = (text: string) => {
    const p = parseProjectRef(text, host);
    if (!p) return setError("Paste a project address (…/orgs/<owner>/projects/<number>) or an owner and a number, such as acme 3.");
    const r = { host: p.host, owner: p.owner, number: p.number, title: "" };
    if (ref && projectKey(ref) === projectKey(r)) load(r, p.view);
    else {
      if (p.view !== null) void save({ tasksProjectsLastView: { ...lastViews, [projectKey(r)]: p.view } });
      setRef(r);
    }
  };
  const pickView = (n: number) => {
    setView(n);
    if (ref) void save({ tasksProjectsLastView: { ...lastViews, [projectKey(ref)]: n } });
  };
  const browse = () => {
    setBrowsed(null);
    setError(null);
    invoke<{ owner: string; number: number; title: string; closed: boolean }[]>("github_projects", { host, owner: browseOwner.trim() || "@me" })
      .then(setBrowsed)
      .catch((e) => setError(String(e)));
  };

  const edit = (item: ProjectItem, field: ProjectField, value: string | null) => {
    setEditing(null);
    if (value === null || !project || !ref) return;
    setCellError(null);
    const put = (patch: Partial<ProjectItem>) => setProject((p) => p && { ...p, items: p.items.map((x) => (x.id === item.id ? { ...x, ...patch } : x)) });
    if (field.kind === "labels") {
      const { add, remove } = labelChange(item.labels, value);
      if (add.length + remove.length === 0) return;
      invoke<{ name: string }[]>("scm_task_labels", { host: ref.host, repo: item.repo, number: item.number, add, remove })
        .then((l) => put({ labels: l.map((x) => x.name) }))
        .catch((e) => setCellError(`${item.title}: ${String(e)}`));
      return;
    }
    invoke("github_project_set", { host: ref.host, project: project.id, item: item.id, field: field.id, kind: field.kind, value })
      .then(() => {
        const option = field.options.find((o) => o.id === value);
        const cell = value.trim() === "" ? null : option ? { text: option.name, id: option.id, start: option.start, days: option.days } : { text: value.trim(), id: "", start: field.kind === "date" ? value.trim() : "", days: 0 };
        const values = { ...item.values };
        if (cell) values[field.id] = cell;
        else delete values[field.id];
        put({ values });
      })
      .catch((e) => setCellError(`${item.title}: ${String(e)}`));
  };

  const current = project?.views.find((v) => v.number === view) ?? null;
  const columns = project ? [...project.fields.filter((f) => f.kind === "title"), ...project.fields.filter((f) => f.kind !== "title")] : [];
  const sortField = columns.find((f) => f.id === sort?.field);
  const groupField = columns.find((f) => f.id === group && GROUPABLE.has(f.kind));
  const rows = project ? scopeItems(sortField && sort ? sortItems(project.items, sortField, sort.dir) : project.items, scope, inKolux) : [];
  const repos = project ? [...new Set(project.items.map((i) => i.repo).filter(Boolean))].sort() : [];
  const isPinned = !!ref && pinned.some((p) => projectKey(p) === projectKey(ref));
  const link = project ? viewUrl(project, view) : null;
  const tableView = project?.views.find((v) => viewSupport(v.layout) === "table");

  const row = (it: ProjectItem) => (
    <tr key={it.id} data-item={it.id} className={it.kind === "restricted" ? "restricted" : undefined}>
      {columns.map((f) => {
        const isEditing = editing?.item === it.id && editing.field === f.id;
        const can = cellEditable(it, f);
        if (f.kind === "title") {
          return (
            <td key={f.id} className="projects-title">
              {it.kind === "restricted" ? (
                <em title="You do not have access to this item">Restricted item</em>
              ) : (
                <>
                  <span className={`dot ${it.kind === "pr" ? "pr" : "issue"} ${it.state}`} />
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noreferrer">
                      {it.title}
                    </a>
                  ) : (
                    it.title
                  )}
                  {it.number !== null && <span className="tasks-kind"> #{it.number}</span>}
                  {it.repo && scope.mode === "all" && inKolux.length > 0 && !inKolux.includes(it.repo.toLowerCase()) && <span className="projects-away" title="This repository is not open in Kolux">not in Kolux</span>}
                </>
              )}
            </td>
          );
        }
        return (
          <td key={f.id} data-kind={f.kind} className={can ? "editable" : undefined} tabIndex={can ? 0 : undefined} onClick={() => can && setEditing({ item: it.id, field: f.id })} onKeyDown={(e) => can && e.key === "Enter" && setEditing({ item: it.id, field: f.id })}>
            {isEditing ? <CellEditor item={it} field={f} onDone={(v) => edit(it, f, v)} /> : cellText(it, f)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="projects" data-projects>
      <div className="projects-pick">
        <form
          className="autos-search"
          onSubmit={(e) => {
            e.preventDefault();
            open(typed);
          }}
        >
          <input className="field" placeholder="Paste a project URL, or owner and number (acme 3)" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Project address" />
          <button className="btn">Open</button>
        </form>
        <form
          className="projects-browse"
          onSubmit={(e) => {
            e.preventDefault();
            browse();
          }}
        >
          <input className="field" value={browseOwner} placeholder="@me" onChange={(e) => setBrowseOwner(e.target.value)} aria-label="Browse projects of" />
          <button className="btn">Browse</button>
        </form>
        {[...pinned.map((p) => ({ p, pin: true })), ...recent.filter((r) => !pinned.some((p) => projectKey(p) === projectKey(r))).map((p) => ({ p, pin: false }))].map(({ p, pin }) => (
          <button key={projectKey(p)} className="btn projects-chip" data-pinned={pin || undefined} aria-current={ref && projectKey(ref) === projectKey(p) ? "true" : undefined} title={`${p.owner} project ${p.number} on ${p.host}`} onClick={() => setRef(p)}>
            {pin ? "★ " : ""}
            {p.title || `${p.owner} #${p.number}`}
          </button>
        ))}
      </div>
      {browsed && (
        <ul className="projects-browsed" data-browsed>
          {browsed.length === 0 && <li className="autos-none">No projects.</li>}
          {browsed.map((b) => (
            <li key={`${b.owner}/${b.number}`}>
              <button
                className="btn"
                onClick={() => {
                  setBrowsed(null);
                  setRef({ host, owner: b.owner, number: b.number, title: b.title });
                }}
              >
                {b.title || `#${b.number}`} <span className="tasks-kind">{b.owner} #{b.number}{b.closed ? " · closed" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="note warn" role="status">
          {error}
        </div>
      )}
      {cellError && (
        <div className="note warn" role="status" data-cell-error>
          {cellError}
        </div>
      )}
      {!ref ? (
        <div className="autos-none tasks-none">Open a GitHub project to see it as a table: paste its address, browse an owner's projects, or pick a recent one.</div>
      ) : !project ? (
        !error && <div className="autos-none tasks-none">Loading…</div>
      ) : (
        <>
          <div className="projects-bar">
            <strong>{project.title}</strong>
            <select className="field" aria-label="View" value={view ?? ""} onChange={(e) => pickView(Number(e.target.value))}>
              {project.views.map((v) => (
                <option key={v.number} value={v.number}>
                  {viewLabel(v)}
                </option>
              ))}
            </select>
            {current && viewSupport(current.layout) === "table" && (
              <>
                <select className="field" aria-label="Group by" value={groupField?.id ?? ""} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">No grouping</option>
                  {columns
                    .filter((f) => GROUPABLE.has(f.kind))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        Group by {f.name}
                      </option>
                    ))}
                </select>
                <select
                  className="field"
                  aria-label="Repositories"
                  value={scope.mode}
                  onChange={(e) => setScope(e.target.value === "chosen" ? { mode: "chosen", repos: [] } : { mode: e.target.value as "all" | "kolux" })}
                >
                  <option value="all">All repositories</option>
                  <option value="kolux">Repositories open in Kolux</option>
                  <option value="chosen">Chosen repositories</option>
                </select>
              </>
            )}
            <span className="autos-gap" />
            <button className="btn" aria-pressed={isPinned} onClick={() => ref && void save({ tasksProjectsPinned: togglePin(pinned, { ...ref, title: project.title }) })}>
              {isPinned ? "Unpin" : "Pin"}
            </button>
            {link && (
              <a className="btn" href={link} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            )}
            <button className="ib" title="Refresh" onClick={() => load()}>
              <Refresh />
            </button>
          </div>
          {scope.mode === "chosen" && (
            <div className="tasks-filters" data-chosen>
              {repos.map((r) => (
                <label key={r} className="tasks-filter">
                  <input
                    type="checkbox"
                    checked={scope.repos.includes(r)}
                    onChange={(e) => setScope({ mode: "chosen", repos: e.target.checked ? [...scope.repos, r] : scope.repos.filter((x) => x !== r) })}
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          )}
          {current && viewSupport(current.layout) !== "table" ? (
            <div className="note" role="status" data-unsupported>
              {current.name} is a {current.layout} view, which Kolux does not show yet. {tableView ? "Switch to a table view to see and edit this project's items." : "This project has no table view; add one on GitHub to see it here."}
              {tableView && (
                <button className="btn" onClick={() => pickView(tableView.number)}>
                  Switch to {tableView.name}
                </button>
              )}
            </div>
          ) : (
            <div className="projects-table">
              <table>
                <thead>
                  <tr>
                    {columns.map((f) => (
                      <th key={f.id} aria-sort={sort?.field === f.id ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                        <button className="projects-sort" onClick={() => setSort(sort?.field === f.id ? (sort.dir === 1 ? { field: f.id, dir: -1 } : null) : { field: f.id, dir: 1 })}>
                          {f.name}
                          {sort?.field === f.id ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupField
                    ? groupItems(rows, groupField).map((g) => (
                        <Fragment key={g.key || "none"}>
                          <tr className="projects-group">
                            <th colSpan={columns.length}>
                              {g.label} <span className="tasks-kind">{g.items.length}</span>
                            </th>
                          </tr>
                          {g.items.map(row)}
                        </Fragment>
                      ))
                    : rows.map(row)}
                </tbody>
              </table>
              {rows.length === 0 && <div className="autos-none tasks-none">No items{scope.mode !== "all" ? " in these repositories" : ""}.</div>}
              {project.more && <div className="tasks-count tasks-window">This project has more items than Kolux reads (the first 500 are shown).</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
