// VIEW-010 / GIT-043: the Tasks page, opened from the sidebar's Tasks row or the view.tasks
// shortcut: a preset or a typed GitHub search over the workspace's repository, 25 to a page.
// T-314: the default preset is a setting (GIT-044), PR filter pickers rewrite the query (GIT-054),
// and a fork may take its issues from its parent (GIT-055); T-314-c adds the Projects tab (GIT-056).
// ponytail: one repository (the workspace's); the multi-repository picker, the remembered choice,
// new issue, close / reopen / comment and start-from-item are T-231-c. Clicking an item opens its
// preview (GIT-050, TaskDialog).
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Refresh, Search } from "../chrome/icons";
import { useSettings } from "../settings/useSettings";
import { beyondWindow, defaultPreset, FILTERS, type FilterKey, filterValue, issueSource, pageButtons, pageCount, PER_PAGE, PRESETS, setFilter, type Task, type TaskLabel, type TaskPage, taskKind, taskQueries } from "./model";
import { type GhRepo, loadRepoFacts, type ParentRead, type Person, resetFacts } from "./repoFacts";
import ProjectsView from "./ProjectsView";
import TaskDialog from "./TaskDialog";
import "./tasks.css";

/** GIT-043: preset, query, page and scroll survive leaving the page and coming back (app session);
 * GIT-044: the first visit of the session opens on the saved default preset. */
const kept: { preset: string | null; query: string; page: number; scroll: number; tab: "items" | "projects" } = { preset: null, query: "", page: 1, scroll: 0, tab: "items" };

/** GIT-054: one filter picker; typing or picking a suggestion sets its part of the query on Enter or
 * on leaving the field, and the cross clears only that part. */
function FilterPicker({ k, label, query, options, onSet }: { k: FilterKey; label: string; query: string; options: string[]; onSet: (k: FilterKey, v: string) => void }) {
  const now = filterValue(query, k);
  const [text, setText] = useState(now);
  useEffect(() => setText(now), [now]);
  const commit = () => text.trim() !== now && onSet(k, text);
  return (
    <label className={`tasks-filter${now ? " set" : ""}`} data-filter={k}>
      <span>{label}</span>
      {k === "state" ? (
        <select className="field" value={now} onChange={(e) => onSet(k, e.target.value)} aria-label={label}>
          <option value="">Any</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="merged">Merged</option>
        </select>
      ) : (
        <>
          <input className="field" list={`tasks-${k}-list`} value={text} placeholder="Anyone" aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
          <datalist id={`tasks-${k}-list`}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </>
      )}
      {now && (
        <button type="button" className="ib" title={`Clear ${label.toLowerCase()}`} aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onSet(k, "")}>
          ×
        </button>
      )}
    </label>
  );
}

export default function TasksPage({ repo }: { repo: { dir: string; name: string } | null }) {
  const { settings, save } = useSettings();
  const [gh, setGh] = useState<GhRepo | null | undefined>(undefined);
  const [login, setLogin] = useState<string | null>(null);
  const [preset, setPreset] = useState<string | null>(kept.preset);
  const [{ parent, failed: parentFailed }, setParent] = useState<ParentRead>({ parent: undefined, failed: false });
  const [people, setPeople] = useState<Person[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [typed, setTyped] = useState(kept.query);
  const [query, setQuery] = useState(kept.query);
  const [page, setPage] = useState(kept.page);
  const [result, setResult] = useState<TaskPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  // T-314-c: Issues and pull requests, or GitHub Projects (GIT-056).
  const [tab, setTab] = useState(kept.tab);
  const list = useRef<HTMLUListElement>(null);
  const restore = useRef(kept.scroll);
  Object.assign(kept, { preset, query, page, tab });

  useEffect(() => {
    if (preset === null && settings) setPreset(defaultPreset(settings));
  }, [settings]);

  useEffect(() => {
    const set = { gh: setGh, login: setLogin, parent: setParent, people: setPeople, labels: setLabels };
    resetFacts(set);
    if (!repo) return;
    let live = true;
    void loadRepoFacts(invoke, repo.dir, () => live, set);
    return () => {
      live = false;
    };
  }, [repo?.dir]);

  const own = gh ? `${gh.owner}/${gh.name}` : "";
  const sourceKey = gh ? `${gh.host}/${own}` : "";
  const source = issueSource(settings, sourceKey, own, parent, parentFailed);
  const savedSources = (settings?.tasksIssueSource ?? {}) as Record<string, unknown>;
  const chosenSource = savedSources[sourceKey] === "upstream" ? "upstream" : "fork";
  const load = () => {
    if (!gh || preset === null || !settings || tab !== "items") return;
    setError(null);
    invoke<TaskPage>("scm_tasks_search", { host: gh.host, queries: taskQueries(preset, query, [own], [source.repo]), page })
      .then(setResult)
      .catch((e) => setError(String(e)));
  };
  useEffect(load, [gh, preset, query, page, source.repo, settings === null, tab]);
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
  const setOne = (k: FilterKey, v: string) => {
    const next = setFilter(query, k, v);
    setTyped(next);
    setQuery(next);
    go(1);
  };
  const isDefault = preset === defaultPreset(settings);
  const whoOptions = ["@me", ...people.map((p) => p.login)];
  const tabs = (
    <div className="tasks-tabs" role="tablist">
      {([["items", "Issues & pull requests"], ["projects", "Projects"]] as const).map(([id, label]) => (
        <button key={id} role="tab" className="btn" aria-selected={tab === id} data-tab={id} onClick={() => setTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
  if (tab === "projects") {
    return (
      <div className="autos tasks" data-tasks>
        <div className="autos-bar">
          <h2>Tasks</h2>
          {tabs}
        </div>
        <ProjectsView host={gh?.host ?? "github.com"} owner={gh?.owner ?? "@me"} settings={settings} save={save} />
      </div>
    );
  }
  return (
    <div className="autos tasks" data-tasks>
      <div className="autos-bar">
        <h2>Tasks</h2>
        {tabs}
        <select
          className="field"
          aria-label="Preset"
          value={preset ?? ""}
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
        <button className="btn tasks-default" aria-pressed={isDefault} disabled={isDefault || preset === null} title="Open Tasks on this preset next time" onClick={() => preset && void save({ tasksDefaultPreset: preset })}>
          {isDefault ? "Default view" : "Make default"}
        </button>
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
        {gh && (parent || chosenSource === "upstream") && (
          <label className="tasks-source" title="Where this fork's issues come from">
            <span>Issues from</span>
            <select
              className="field"
              aria-label="Issues from"
              value={chosenSource}
              onChange={(e) => {
                const all = { ...savedSources };
                if (e.target.value === "upstream") all[sourceKey] = "upstream";
                else delete all[sourceKey];
                void save({ tasksIssueSource: all });
                go(1);
              }}
            >
              <option value="fork">this fork ({own})</option>
              <option value="upstream">{parent ? `upstream (${parent})` : "upstream"}</option>
            </select>
          </label>
        )}
        {source.split && (
          <span className="tasks-split" data-split title="Issues and pull requests come from different repositories">
            issues {source.repo} · pull requests {own}
          </span>
        )}
        {gh && (
          <span className="tasks-repo" title="Where the list comes from">
            {gh.host} · {login ? `@${login}` : "not signed in"} · {gh.owner}/{gh.name}
          </span>
        )}
        <button className="ib" title="Refresh" disabled={!gh} onClick={load}>
          <Refresh />
        </button>
      </div>
      {gh && (
        <div className="tasks-filters" data-filters>
          {FILTERS.map((f) => (
            <FilterPicker key={f.key} k={f.key} label={f.label} query={query} options={f.key === "label" ? labels : whoOptions} onSet={setOne} />
          ))}
        </div>
      )}
      {source.warning && (
        <div className="note warn" role="status" data-source-warning>
          {source.warning}
        </div>
      )}
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
          onState={(state: string) => setResult((r) => r && { ...r, items: r.items.map((x) => (x.url === open.url ? { ...x, state } : x)) })}
        />
      )}
    </div>
  );
}
