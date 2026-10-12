// The Inbox view (STAT-050): three groups of rows on the left, the selected item's detail on the
// right. Up and Down walk the rows, Enter opens the selected one in its terminal pane. The rows
// come from `inboxItems` in inbox.ts; the detail reads the pane's history and the worktree's
// source-control status through the commands the window already has.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GROUPS, moveSelection, settle, type Item } from "./inbox";
import { VOCAB } from "../terminal/status";
import { StatusGlyph } from "../chrome/icons";
import type { Agent } from "../chrome/VendorMark";
import { programWord } from "../launch/PlusMenu";
import { folderName } from "../projects/model";
import { emptyStatus, type Status } from "../scm/model";

type Entry = { state: string; prompt?: string; started: number; interrupted: boolean };
type Props = { items: Item[]; now: number; onOpen: (key: number) => void };

/** "just now", "3m ago", "1h ago". */
function ago(when: number, now: number): string {
  if (when <= 0) return "";
  const m = Math.floor((now - when) / 60_000);
  if (m < 1) return "just now";
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export default function InboxView({ items, now, onOpen }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const keys = items.map((i) => i.key);
  const current = settle(keys, selected);
  const item = items.find((i) => i.key === current) ?? null;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus(), []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") setSelected(moveSelection(keys, current, e.key === "ArrowDown" ? 1 : -1));
    else if (e.key === "Enter" && current !== null) onOpen(current);
    else return;
    e.preventDefault();
  };

  const needs = items.filter((i) => i.group === "needs");
  return (
    <div className="inbox" ref={root} tabIndex={0} role="listbox" aria-label="Inbox" aria-activedescendant={current === null ? undefined : `inbox-${current}`} onKeyDown={onKeyDown}>
      <div className="list">
        {needs.length === 0 && (
          <div className="clear" role="status">
            <StatusGlyph glyph="check" size={14} />
            All clear. Nothing needs you.
          </div>
        )}
        {GROUPS.map((g) => {
          const rows = items.filter((i) => i.group === g.id);
          if (rows.length === 0) return null;
          return (
            <section key={g.id} aria-label={g.title}>
              <h3>{g.title}</h3>
              {rows.map((i) => (
                <div key={i.key} id={`inbox-${i.key}`} role="option" aria-selected={i.key === current} className={`row ${VOCAB[i.state].tone}`} onClick={() => setSelected(i.key)} onDoubleClick={() => onOpen(i.key)}>
                  <span className="st" data-tip={VOCAB[i.state].explain}>
                    <StatusGlyph glyph={VOCAB[i.state].glyph} size={12} />
                  </span>
                  <span className="name">{i.title}</span>
                  <span className="lbl">{i.label}</span>
                  <span className="when">{ago(i.when, now)}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {item ? <Detail item={item} onOpen={() => onOpen(item.key)} /> : <div className="detail empty">{items.length === 0 ? "Sessions show up here as they ask, run and finish." : "Pick a row, or press Down."}</div>}
    </div>
  );
}

function Detail({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const [scm, setScm] = useState<Status | null>(null);
  const [last, setLast] = useState<Entry | null>(null);
  useEffect(() => {
    setScm(null);
    setLast(null);
    if (item.cwd) invoke<Status>("scm_status", { worktree: item.cwd }).then(setScm).catch(() => setScm(emptyStatus));
    invoke<Entry[]>("agent_history", { paneKey: item.key })
      .then((h) => setLast([...h].reverse().find((e) => e.prompt) ?? null))
      .catch(() => setLast(null));
  }, [item.key, item.cwd, item.state]);
  const changed = scm ? scm.staged.length + scm.changed.length + scm.untracked.length + scm.conflicts.length : null;
  const v = VOCAB[item.state];
  return (
    <div className="detail">
      <h2>
        {item.title}
        <span className={`status ${v.tone}`}>{item.label === "Done" ? v.word : item.label}</span>
      </h2>
      <dl>
        <dt>Agent</dt>
        <dd>{programWord(item.agent as Agent)}</dd>
        <dt>Branch</dt>
        <dd>{item.branch ?? scm?.branch ?? "—"}</dd>
        <dt>Workspace</dt>
        <dd>{item.cwd ? folderName(item.cwd) : "—"}</dd>
        <dt>Changes</dt>
        <dd>{changed === null ? (item.cwd ? "…" : "—") : changed === 0 ? "No files changed" : `${changed} file${changed === 1 ? "" : "s"} changed${scm && scm.staged.length ? `, ${scm.staged.length} staged` : ""}`}</dd>
        {last?.prompt && (
          <>
            <dt>Prompt</dt>
            <dd className="prompt">{last.prompt}</dd>
          </>
        )}
      </dl>
      <div className="actions">
        <button className="btn primary" onClick={onOpen}>
          {item.group === "needs" ? "Answer" : "Open"}
        </button>
      </div>
    </div>
  );
}
