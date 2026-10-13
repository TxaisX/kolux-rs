// VIEW-010 / GIT-043: the Tasks page, opened from the sidebar's Tasks row or the view.tasks
// shortcut: a preset or a typed GitHub search over the workspace's repository, 25 to a page.
// ponytail: one repository (the workspace's); the multi-repository picker, the remembered choice,
// new issue, close / reopen / comment and start-from-item are T-231-c. Clicking an item opens its
// preview (GIT-050, TaskDialog).
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Refresh, Search } from "../chrome/icons";
import { beyondWindow, pageButtons, pageCount, PER_PAGE, PRESETS, type Task, type TaskLabel, type TaskPage, taskKind, taskQueries } from "./model";
import TaskDialog from "./TaskDialog";

type GhRepo = { host: string; owner: string; name: string };
/** GIT-043: preset, query, page and scroll survive leaving the page and coming back (app session). */
const kept = { preset: "all", query: "", page: 1, scroll: 0 };

export default function TasksPage({ repo }: { repo: { dir: string; name: string } | null }) {
  const [gh, setGh] = useState<GhRepo | null | undefined>(undefined);
  const [login, setLogin] = useState<string | null>(null);
  const [preset, setPreset] = useState(kept.preset);
  const [typed, setTyped] = useState(kept.query);
  const [query, setQuery] = useState(kept.query);
  const [page, setPage] = useState(kept.page);
  const [result, setResult] = useState<TaskPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const restore = useRef(kept.scroll);
  Object.assign(kept, { preset, query, page });

  useEffect(() => {
    setGh(undefined);
    if (!repo) return;
    invoke<GhRepo | null>("scm_github_repo", { worktree: repo.dir })
      .then((g) => {
        setGh(g);
        if (g) void invoke<string | null>("scm_gh_account", { host: g.host }).then(setLogin);
      })
      .catch(() => setGh(null));
  }, [repo?.dir]);

  const load = () => {
    if (!gh) return;
    setError(null);
    invoke<TaskPage>("scm_tasks_search", { host: gh.host, queries: taskQueries(preset, query, [`${gh.owner}/${gh.name}`]), page })
      .then(setResult)
      .catch((e) => setError(String(e)));
  };
  useEffect(load, [gh, preset, query, page]);
  useLayoutEffect(() => {
    if (result && list.current && restore.current) {
      list.current.scrollTop = restore.current;
      restore.current = 0;
    }
  }, [result]);

  const pages = result ? pageCount(result.deepest) : 1;
  const go = (n: number) => {
    kept.scroll = 0;
    setPage(n);
  };
  return (
    <div className="autos tasks" data-tasks>
      <div className="autos-bar">
        <h2>Tasks</h2>
        <select
          className="field"
          aria-label="Preset"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            go(1);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <form
          className="autos-search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(typed.trim());
            go(1);
          }}
        >
          <Search />
          <input className="field" placeholder="GitHub search, such as is:pr label:bug" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search issues and pull requests" />
        </form>
        <span className="autos-gap" />
        {gh && (
          <span className="tasks-repo" title="Where the list comes from">
            {gh.host} · {login ? `@${login}` : "not signed in"} · {gh.owner}/{gh.name}
          </span>
        )}
        <button className="ib" title="Refresh" disabled={!gh} onClick={load}>
          <Refresh />
        </button>
      </div>
      {!repo ? (
        <div className="autos-none tasks-none">Add a project to see its GitHub issues and pull requests.</div>
      ) : gh === null ? (
        <div className="autos-none tasks-none">{repo.name} has no GitHub remote, so there are no issues or pull requests to list.</div>
      ) : error !== null ? (
        <div className="note warn" role="status">
          {error}
        </div>
      ) : result === null ? (
        <div className="autos-none tasks-none">Loading…</div>
      ) : result.items.length === 0 ? (
        <div className="autos-none tasks-none">Nothing matches.</div>
      ) : (
        <ul className="tasks-list" ref={list} onScroll={(e) => (kept.scroll = e.currentTarget.scrollTop)}>
          {result.items.map((t) => (
            <li key={t.url} title={t.url} data-task={`${t.kind}-${t.number}`} tabIndex={0} onClick={() => setOpen(t)} onKeyDown={(e) => e.key === "Enter" && setOpen(t)}>
              <span className={`dot ${t.kind} ${t.state}${t.draft ? " draft" : ""}`} title={t.draft ? "draft" : t.state} />
              <span className="tasks-title">{t.title}</span>
              {t.labels.map((l) => (
                <span key={l.name} className="tasks-label" style={l.color ? { borderColor: `#${l.color}` } : undefined}>
                  {l.color && <i style={{ background: `#${l.color}` }} />}
                  {l.name}
                </span>
              ))}
              {t.assignees.length > 0 && <span className="tasks-who">{t.assignees.map((a) => `@${a}`).join(", ")}</span>}
              {t.checks && <span className={`tasks-checks ${t.checks}`}>{t.checks}</span>}
              <span className="tasks-kind">{taskKind(t)}</span>
              <span className="tasks-when">{t.updated.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
      {result && result.items.length > 0 && error === null && (
        <div className="tasks-foot">
          <span className="tasks-count">{result.total === 1 ? "1 result" : `${result.total.toLocaleString()} results`}</span>
          <span className="autos-gap" />
          {pageButtons(page, pages).map((n, i) =>
            n === null ? (
              <span key={`gap${i}`} className="tasks-gap">
                …
              </span>
            ) : (
              <button key={n} className="btn" aria-current={n === page ? "page" : undefined} onClick={() => go(n)}>
                {n}
              </button>
            ),
          )}
          {beyondWindow(result.deepest) && <span className="tasks-count tasks-window">Results past {pages * PER_PAGE} are beyond GitHub search and cannot be reached; narrow the search.</span>}
        </div>
      )}
      {open && gh && (
        <TaskDialog
          task={open}
          host={gh.host}
          onClose={() => setOpen(null)}
          onLabels={(labels: TaskLabel[]) => setResult((r) => r && { ...r, items: r.items.map((x) => (x.url === open.url ? { ...x, labels } : x)) })}
        />
      )}
    </div>
  );
}
