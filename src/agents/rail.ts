// The Agents screen's rail (VIEW-015, VIEW-021) and the Board's card list (VIEW-024): which panes
// are sessions, which saved agent each sits under, which one is shown first. Pure.
import { folderName } from "../projects/model";

export type Session = { key: number; agentId?: string; program: string | null; cwd: string | null; kind?: string; seats?: { agent: string | null }[]; title?: string };
export type Group<S extends Session> = { id: string; name: string; sessions: S[] };

export const OTHER = "other";

/** The saved agent a pane belongs to: the one it was started as, or the one its not-started preset picked. */
const agentOf = (p: Session): string | undefined => p.agentId ?? p.seats?.[0]?.agent ?? undefined;

/** VIEW-015: a rail row is an AI session or a preset waiting to start; plain shells, choosers with
 *  no agent picked, and editor / browser tabs are never listed. */
export const listed = (p: Session): boolean => !p.kind && (p.seats ? agentOf(p) !== undefined : p.program !== null);

/** The rail: one group per saved agent in saved order (empty ones too, so + can add to them), then
 *  Other sessions for AI sessions that match no saved agent, only when there are any. */
export function railGroups<S extends Session>(panes: S[], saved: { id: string; name: string }[]): Group<S>[] {
  const groups: Group<S>[] = saved.map((a) => ({ id: a.id, name: a.name, sessions: [] }));
  const other: Group<S> = { id: OTHER, name: "Other sessions", sessions: [] };
  for (const p of panes.filter(listed)) (groups.find((g) => g.id === agentOf(p)) ?? other).sessions.push(p);
  return other.sessions.length ? [...groups, other] : groups;
}

/** The session shown: the remembered one while it is still listed, else the first agent with
 *  sessions on its newest (last added) one, else none. */
export function pickSession<S extends Session>(groups: Group<S>[], current: number | null): number | null {
  if (current !== null && groups.some((g) => g.sessions.some((p) => p.key === current))) return current;
  const first = groups.find((g) => g.sessions.length > 0);
  return first ? first.sessions[first.sessions.length - 1].key : null;
}

/** A row's text: the task's display name or title the launcher gave it, else the folder it works in, else its number. */
export const sessionLabel = (p: Pick<Session, "key" | "title" | "cwd">): string => p.title || (p.cwd ? folderName(p.cwd) : "") || `Session ${p.key}`;

/** VIEW-024: the Board's cards, one per terminal pane in tab-group order; editor and browser tabs get none. */
export const cardPanes = <P extends { key: number; kind?: string }>(panes: P[]): P[] => panes.filter((p) => !p.kind);
