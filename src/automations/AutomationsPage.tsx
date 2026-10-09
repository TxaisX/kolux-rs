// The Automations page (AUTO-016, AUTO-019): a table of every automation with sorting, filters
// and search, a quick-actions menu on each row (Run now, pause / resume, Edit, Delete), and the
// selected automation's prompt and numbered runs below. The page reloads itself whenever the
// back end says an automation or a run changed, so a run's status moves without a refresh.
// New Automation and Edit open the dialog of AUTO-005 (T-085); Runs opens the dashboard of
// AUTO-015 (T-130); until then those buttons are present and disabled.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Dots, Plus, Refresh, Search } from "../chrome/icons";
import type { AgentInfo } from "../launch/PlusMenu";
import type { Project } from "../projects/model";
import { ago, CONFIRM_DELETE_KEY, confirmDelete, lastRun, matches, noFilters, normalizeQuery, passes, sortRows, statusWord, triggerLabel, upcoming, type Automation, type Filters, type Names, type Run, type SortKey } from "./model";

export type Data = { automations: Automation[]; runs: Run[] };

type Props = {
  projects: Project[];
  agents: AgentInfo[];
  settings: Record<string, unknown>;
  onSettings: (next: Record<string, unknown>) => void;
  /** Seeds the page without asking the back end (tests render it to HTML). */
  initial?: { data?: Data; error?: string };
};

const columns: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "trigger", label: "Timetable or trigger" },
  { key: "agent", label: "Agent" },
  { key: "project", label: "Project" },
  { key: "lastRun", label: "Last run" },
  { key: "nextRun", label: "Upcoming" },
];

const results: Array<{ value: Filters["result"]; label: string }> = [
  { value: "all", label: "Any result" },
  { value: "never", label: "Never ran" },
  { value: "completed", label: "Completed" },
  { value: "dispatched", label: "Running" },
  { value: "pending", label: "Queued" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed to start" },
];

export default function AutomationsPage({ projects, agents, settings, onSettings, initial }: Props) {
  const [data, setData] = useState<Data | null>(initial?.data ?? null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null); // the automation whose delete waits for a yes
  const [dontAsk, setDontAsk] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const search = useRef<HTMLInputElement>(null);

  const load = () =>
    invoke<Data>("automations_list")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    if (initial) return;
    void load();
    search.current?.focus(); // the search box has focus when the page opens
    const off = listen("automations-changed", () => void load());
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.clearInterval(tick);
      void off.then((u) => u());
    };
  }, []);

  const names: Names = useMemo(
    () => ({ project: (id) => projects.find((p) => p.id === id)?.name ?? "Project gone", agent: (id) => agents.find((a) => a.id === id)?.name ?? id }),
    [projects, agents],
  );
  const q = normalizeQuery(query);
  const all = data?.automations ?? [];
  const runs = data?.runs ?? [];
  const rows = q === null ? [] : sortRows(all.filter((a) => passes(a, filters, runs) && matches(a, q, names)), runs, sort.key, sort.desc, names);
  // Opening the page selects the first automation; a selection that left the list moves on.
  const current = rows.find((a) => a.id === selected) ?? rows[0] ?? null;
  const agentIds = [...new Set(all.map((a) => a.provider))];

  const act = (p: Promise<unknown>) => p.then(() => load()).catch((e) => setNote(String(e)));
  const runNow = (a: Automation) => {
    setMenu(null);
    setNote(`Run now: ${a.name} is queued`);
    void act(invoke("automation_run_now", { id: a.id }));
  };
  const toggle = (a: Automation) => {
    setMenu(null);
    void act(invoke("automation_set_enabled", { id: a.id, enabled: !a.enabled }));
  };
  const remove = (a: Automation) => {
    setMenu(null);
    if (confirmDelete(settings)) setAsking(a.id);
    else void act(invoke("automation_delete", { id: a.id }));
  };
  const confirmRemove = (id: string) => {
    setAsking(null);
    if (dontAsk) onSettings({ ...settings, [CONFIRM_DELETE_KEY]: false });
    void act(invoke("automation_delete", { id }));
  };
  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }));
  const filtered = filters.state !== "all" || filters.result !== "all" || filters.agents.length > 0 || (q ?? "") !== "";

  return (
    <div className="autos">
      <div className="autos-bar">
        <h2>Automations</h2>
        <label className="autos-search">
          <Search />
          <input ref={search} className="field" placeholder="Search name, project, agent, prompt" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search automations" />
        </label>
        <select className="field" aria-label="On or paused" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value as Filters["state"] })}>
          <option value="all">On and paused</option>
          <option value="on">On</option>
          <option value="paused">Paused</option>
        </select>
        <select className="field" aria-label="Last run result" value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value as Filters["result"] })}>
          {results.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {agentIds.length > 1 && (
          <span className="autos-agents" role="group" aria-label="Agents">
            {agentIds.map((id) => (
              <button key={id} className="btn" aria-pressed={filters.agents.includes(id)} onClick={() => setFilters({ ...filters, agents: filters.agents.includes(id) ? filters.agents.filter((x) => x !== id) : [...filters.agents, id] })}>
                {names.agent(id)}
              </button>
            ))}
          </span>
        )}
        <span className="autos-gap" />
        <button className="ib" title="Refresh" onClick={() => void load()}>
          <Refresh />
        </button>
        <button className="btn" disabled title="The runs dashboard comes with T-130">
          Runs
        </button>
        <button className="btn primary" disabled title="The new automation dialog comes with T-085">
          <Plus size={12} />
          New Automation
        </button>
      </div>
      {q === null && <div className="note warn">That search is too long; shorten it.</div>}
      {note && (
        <div className="note ok" role="status">
          {note}
        </div>
      )}
      {asking && (
        <div className="autos-confirm" role="alertdialog" aria-label="Delete automation">
          <span>Delete {all.find((a) => a.id === asking)?.name ?? "this automation"} and its run history?</span>
          <label>
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} /> Don't ask again
          </label>
          <button className="btn danger" onClick={() => confirmRemove(asking)}>
            Delete
          </button>
          <button className="btn" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </div>
      )}
      {error !== null ? (
        <div className="empty" role="alert">
          <h2>Automations could not be loaded</h2>
          <p>{error}</p>
          <button className="btn" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : data === null ? (
        <div className="empty">
          <p>Loading…</p>
        </div>
      ) : all.length === 0 ? (
        <div className="empty">
          <h2>No automations yet</h2>
          <p>An automation starts an agent with a saved prompt on a timetable or when something happens in a project.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <h2>Nothing matches</h2>
          <p>No automation fits this search and these filters.</p>
          {filtered && (
            <button
              className="btn"
              onClick={() => {
                setQuery("");
                setFilters(noFilters);
              }}
            >
              Clear search and filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="autos-table-wrap">
            <table className="autos-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                      <button onClick={() => sortBy(c.key)}>
                        {c.label}
                        {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const last = lastRun(a.id, runs);
                  return (
                    <tr key={a.id} aria-selected={current?.id === a.id} onClick={() => setSelected(a.id)}>
                      <td>
                        <span className={`dot${a.enabled ? " live" : ""}`} title={a.enabled ? "On" : "Paused"} />
                        {a.name}
                      </td>
                      <td>{triggerLabel(a)}</td>
                      <td>{names.agent(a.provider)}</td>
                      <td>{names.project(a.projectId)}</td>
                      <td>{last ? `${statusWord(last)} · ${ago(last.at, now)}` : "Never"}</td>
                      <td>{upcoming(a, now)}</td>
                      <td className="autos-act">
                        <button
                          className="ib"
                          title="Quick actions"
                          aria-haspopup="menu"
                          onClick={(e) => {
                            e.stopPropagation(); // opening the menu does not select the row
                            setMenu(menu === a.id ? null : a.id);
                          }}
                        >
                          <Dots />
                        </button>
                        {menu === a.id && (
                          <div className="menu autos-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                            <button className="menu-item" role="menuitem" onClick={() => runNow(a)}>
                              <span className="name">Run now</span>
                            </button>
                            <button className="menu-item" role="menuitem" onClick={() => toggle(a)}>
                              <span className="name">{a.enabled ? "Pause" : "Resume"}</span>
                            </button>
                            <button className="menu-item" role="menuitem" disabled title="The edit dialog comes with T-085">
                              <span className="name">Edit</span>
                            </button>
                            <button className="menu-item" role="menuitem" onClick={() => remove(a)}>
                              <span className="name">Delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {current && <Detail a={current} runs={runs} now={now} onRun={() => runNow(current)} onToggle={() => toggle(current)} />}
        </>
      )}
    </div>
  );
}

function Detail({ a, runs, now, onRun, onToggle }: { a: Automation; runs: Run[]; now: number; onRun: () => void; onToggle: () => void }) {
  const mine = runs.filter((r) => r.automationId === a.id).sort((x, y) => y.number - x.number);
  return (
    <section className="autos-detail" aria-label={`${a.name} overview`}>
      <div className="autos-detail-head">
        <h3>{a.name}</h3>
        <label className="autos-switch">
          <input type="checkbox" role="switch" checked={a.enabled} onChange={onToggle} /> {a.enabled ? "On" : "Paused"}
        </label>
        <button className="btn" onClick={onRun}>
          Run now
        </button>
      </div>
      <pre className="autos-prompt">{a.prompt}</pre>
      <h4>Runs</h4>
      {mine.length === 0 ? (
        <p className="autos-none">No runs yet.</p>
      ) : (
        <ol className="autos-runs">
          {mine.map((r) => (
            <li key={r.id}>
              <span className="num">#{r.number}</span>
              <span>{statusWord(r)}</span>
              <span className="muted">{r.trigger === "manual" ? "by hand" : r.trigger === "event" ? "by an event" : "by the timetable"}</span>
              <span className="muted">{ago(r.at, now)}</span>
              {r.worktreeName && <span className="chip">{r.worktreeName}</span>}
              {r.detail && <span className="muted">{r.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
