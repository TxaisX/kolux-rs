// SKILL-017: the Skills page. Every skill the AIs on this computer can see, with search, a Filter
// by agent menu, source chips with counts, Refresh, Clear filters and a Skill folders popover.
// Close (or Escape outside a text field) goes back to whichever view was open before.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close, Dots, Funnel, Refresh } from "../chrome/icons";
import { locale } from "../language";
import { AGENT_FILTERS, NO_DESCRIPTION, NO_FILTERS, QUERY_LIMIT, SOURCES, dateText, escapeCloses, filtersOn, rootState, shortPath, sourceCounts, viewOf, visible, type Filters, type Scan } from "./skills";

type Props = { workspace: string | null; onClose: () => void };

export default function SkillsPage({ workspace, onClose }: Props) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [tooLong, setTooLong] = useState(false);
  const [open, setOpen] = useState<"agent" | "folders" | "more" | null>(null);
  const run = useRef(0);

  const load = (refresh: boolean) => {
    const n = ++run.current;
    setScanning(true);
    setFailed(null);
    invoke<Scan>("skills_scan", { workspace, refresh }).then(
      (s) => n === run.current && (setScan(s), setScanning(false)),
      (e) => n === run.current && (setFailed(String(e)), setScanning(false)),
    );
  };
  useEffect(() => load(false), [workspace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (open) {
        setOpen(null);
        return;
      }
      if (escapeCloses(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const skills = scan?.skills ?? [];
  const shown = useMemo(() => visible(skills, f), [skills, f]);
  const counts = useMemo(() => sourceCounts(skills, f), [skills, f]);
  const view = viewOf(scan, failed, scanning, shown.length);
  const errors = scan?.roots.filter((r) => r.state === "error") ?? [];
  const agentLabel = AGENT_FILTERS.find((a) => a.id === f.agent)!.label;
  const clear = () => {
    setF(NO_FILTERS);
    setTooLong(false);
  };

  return (
    <section className="skills" aria-label="Skills">
      <header className="skills-head">
        <button className="ib" title="Close (Escape)" aria-label="Close Skills" onClick={onClose}>
          <Close size={14} />
        </button>
        <h2>Skills</h2>
        <span className="skills-sub">{scan ? `${skills.length} skill${skills.length === 1 ? "" : "s"}` : ""}</span>
        <span className="spacer" />
        <button className="ib" title="More actions" aria-haspopup="menu" aria-expanded={open === "more"} onClick={() => setOpen(open === "more" ? null : "more")}>
          <Dots size={14} />
        </button>
        {open === "more" && (
          <>
            <div className="menu-backdrop" onClick={() => setOpen(null)} />
            <div className="menu skills-pop right" role="menu">
              {/* SKILL-022's safe delete (T-180) opens from here. */}
              <button className="menu-item" role="menuitem" disabled title="Safe delete comes with a later update (T-180)">
                <span className="name">Delete skills</span>
              </button>
            </div>
          </>
        )}
      </header>

      <div className="skills-bar">
        <input
          className="picker-input skills-search"
          placeholder="Search skills"
          aria-label="Search skills"
          value={f.query}
          onChange={(e) => {
            const q = e.target.value;
            if (q.length > QUERY_LIMIT) {
              setTooLong(true);
              return;
            }
            setTooLong(false);
            setF({ ...f, query: q });
          }}
        />
        <div className="skills-anchor">
          <button className={`btn${f.agent !== "all" ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open === "agent"} onClick={() => setOpen(open === "agent" ? null : "agent")}>
            <Funnel size={12} /> {f.agent === "all" ? "Filter by agent" : agentLabel}
          </button>
          {open === "agent" && (
            <>
              <div className="menu-backdrop" onClick={() => setOpen(null)} />
              <div className="menu skills-pop" role="menu">
                {AGENT_FILTERS.map((a) => (
                  <button
                    key={a.id}
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={f.agent === a.id}
                    onClick={() => {
                      setF({ ...f, agent: a.id });
                      setOpen(null);
                    }}
                  >
                    <span className="tick">{f.agent === a.id ? "✓" : ""}</span>
                    <span className="name">{a.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="skills-chips" role="group" aria-label="Where skills come from">
          {SOURCES.map((s) => {
            const on = f.sources.includes(s.id);
            return (
              <button key={s.id} className={`skills-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setF({ ...f, sources: on ? f.sources.filter((x) => x !== s.id) : [...f.sources, s.id] })}>
                {s.label} <span className="n">{counts[s.id]}</span>
              </button>
            );
          })}
        </div>
        <span className="spacer" />
        {filtersOn(f) && (
          <button className="btn" onClick={clear}>
            Clear filters
          </button>
        )}
        <div className="skills-anchor">
          <button className="btn" aria-haspopup="dialog" aria-expanded={open === "folders"} onClick={() => setOpen(open === "folders" ? null : "folders")}>
            Skill folders
          </button>
          {open === "folders" && (
            <>
              <div className="menu-backdrop" onClick={() => setOpen(null)} />
              <div className="menu skills-pop right skills-folders" role="dialog" aria-label="Skill folders">
                <div className="menu-title">Folders scanned</div>
                {(scan?.roots ?? []).map((r, i) => (
                  <div key={i} className={`skills-root ${r.state}`}>
                    <div className="label">
                      <span className="name">{r.label}</span>
                      <span className="state">{rootState(r)}</span>
                    </div>
                    {r.path && r.source !== "bundled" && (
                      <div className="path" title={r.path}>
                        {shortPath(r.path, 56)}
                      </div>
                    )}
                  </div>
                ))}
                {!scan && <div className="menu-hint">Not scanned yet.</div>}
              </div>
            </>
          )}
        </div>
        <button className="btn" title="Scan every folder again" onClick={() => load(true)} disabled={scanning}>
          <Refresh size={12} /> Refresh
        </button>
      </div>
      {tooLong && <div className="skills-note" role="status">That search is too long; searches are at most {QUERY_LIMIT} characters.</div>}

      <div className="skills-body">
        {view === "scanning" && <div className="empty"><p>Scanning skill folders…</p></div>}
        {view === "failed" && (
          <div className="empty" role="alert">
            <h2>Scan failed</h2>
            {failed && <p>{failed}</p>}
            {errors.map((r, i) => (
              <p key={i} className="skills-err">
                {r.label}: {r.note ?? "could not be read"}
              </p>
            ))}
            <p>A folder that cannot be read is never shown as fewer skills.</p>
            <button className="btn" onClick={() => load(true)} disabled={scanning}>
              Retry
            </button>
          </div>
        )}
        {view === "empty" && (
          <div className="empty">
            <h2>No skills found</h2>
            <p>None of the skill folders holds a skill yet.</p>
            <button className="btn" onClick={() => load(true)}>
              Refresh
            </button>
          </div>
        )}
        {view === "no-matches" && (
          <div className="empty">
            <h2>No matches</h2>
            <p>No skill fits the search and filters.</p>
            <button className="btn" onClick={clear}>
              Clear filters
            </button>
          </div>
        )}
        {view === "list" && (
          <div className="skills-list" role="list">
            {shown.map((s) => (
              <div key={s.path} className="skills-row" role="listitem">
                <div className="top">
                  <span className="name">{s.name}</span>
                  <span className={`skills-tag ${s.source}`}>{s.plugin ? `Plugin: ${s.plugin}` : SOURCES.find((x) => x.id === s.source)!.label}</span>
                  <span className="spacer" />
                  <span className={`date${s.updated == null ? " none" : ""}`}>{s.source === "bundled" ? "Built into Kolux" : dateText(s.updated, locale())}</span>
                </div>
                <div className={`desc${s.description ? "" : " none"}`}>{s.description ?? NO_DESCRIPTION}</div>
                {s.source !== "bundled" && (
                  <div className="path" title={s.path}>
                    {shortPath(s.path)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
