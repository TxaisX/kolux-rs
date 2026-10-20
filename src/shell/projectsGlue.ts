// T-302-b: the rules and hooks that join the already-tested Projects pieces (headers, jump, selection,
// outsideCard, baseHint, projectIcon) to ProjectsPanel. ProjectsPanel itself is the worktrees lane's
// file, so the small wiring edits there travel as evidence/shell-T-302-b-ProjectsPanel.tsx.patch.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { fadeIfIdle, filtersToClear, IDLE_MS, nextTopButton, strongUpwardFlick, whenRowDrawn, type Scroll, type TopButton } from "../projects/jump";
import type { AutoIcon } from "../projects/projectIcon";
import { batchQuestion, clickRow, type BatchQuestion, type Checked } from "../projects/selection";
import type { Worktree } from "../projects/model";

// ---- PROJ-018: the icon found in each repository ----

/** Ids still to ask for (never asked before). */
export const idsToAsk = (ids: string[], asked: ReadonlySet<string>): string[] => ids.filter((id) => !asked.has(id));

/** One answer per project: a found picture, or null once the search found nothing. A failed ask stays unanswered (letter shown) and is tried again later. */
export function useAutoIcons(ids: string[]): Record<string, AutoIcon | null> {
  const [found, setFound] = useState<Record<string, AutoIcon | null>>({});
  const asked = useRef(new Set<string>());
  const key = ids.join("\n");
  useEffect(() => {
    for (const id of idsToAsk(ids, asked.current)) {
      asked.current.add(id);
      invoke<AutoIcon | null>("project_auto_icon", { projectId: id })
        .then((icon) => setFound((o) => ({ ...o, [id]: icon ?? null })))
        .catch(() => asked.current.delete(id));
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return found;
}

// ---- PROJ-043: the outside-worktrees card ----

export const OUTSIDE_DISMISSED_SETTING = "outsideCardDismissed";

/** The worktrees brought in from outside Kolux (plain Git or another tool). */
export const outsideOf = (list: Worktree[]): Worktree[] => list.filter((w) => w.kind === "external");

/** Project ids whose card was dismissed for good. */
export const dismissedOutside = (settings: Record<string, unknown>): string[] => {
  const v = settings[OUTSIDE_DISMISSED_SETTING];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

/** The setting value after dismissing one project's card. */
export const withDismissed = (settings: Record<string, unknown>, id: string): string[] => {
  const now = dismissedOutside(settings);
  return now.includes(id) ? now : [...now, id];
};

// ---- PROJ-054: scroll to top, and jump to the current workspace ----

export type Wheel = { start: number; dy: number };
const WHEEL_GAP = 150; // a pause this long ends the flick
const WHEEL_FLOOR = 100; // a single tick never counts as a flick on its own

/** Wheel movement added up over one flick; strong enough upward means the button may show. */
export function wheelFlick(prev: Wheel | null, deltaY: number, now: number): { wheel: Wheel; flick: boolean } {
  const wheel = prev && now - prev.start <= WHEEL_GAP * 4 && now - prev.start >= 0 ? { start: prev.start, dy: prev.dy + deltaY } : { start: now, dy: deltaY };
  return { wheel, flick: strongUpwardFlick(wheel.dy, Math.max(now - wheel.start, WHEEL_FLOOR)) };
}

export const scrollOf = (el: Scroll): Scroll => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });

/** After one scroll event: the button state, with the idle clock restarted by any scroll while it shows. */
export function afterScroll(prev: TopButton, s: Scroll, flick: boolean, now: number): TopButton {
  const n = nextTopButton(prev, s, flick, now);
  return n.shown && !flick ? { shown: true, idleSince: now } : n;
}

/** Props for the scrolling list, and the button's state. */
export function useTopButton() {
  const list = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState<TopButton>({ shown: false, idleSince: 0 });
  const wheel = useRef<Wheel | null>(null);
  const flicked = useRef(false);
  useEffect(() => {
    if (!top.shown) return;
    const t = setInterval(() => setTop((p) => fadeIfIdle(p, Date.now())), IDLE_MS / 3);
    return () => clearInterval(t);
  }, [top.shown]);
  const onWheel = useCallback((e: { deltaY: number }) => {
    const r = wheelFlick(wheel.current, e.deltaY, Date.now());
    wheel.current = r.wheel;
    flicked.current = r.flick;
  }, []);
  const onScroll = useCallback(() => {
    const el = list.current;
    if (!el) return;
    setTop((p) => afterScroll(p, scrollOf(el), flicked.current, Date.now()));
    flicked.current = false;
  }, []);
  const toTop = useCallback(() => {
    list.current?.scrollTo({ top: 0, behavior: "smooth" });
    setTop({ shown: false, idleSince: Date.now() });
  }, []);
  return { shown: top.shown, listProps: { ref: list, onWheel, onScroll }, toTop };
}

/** Jump to the current workspace: clears the filters that were hiding it (one write each), then scrolls its row into view once drawn. */
export async function jumpToCurrent(o: {
  path: string | null;
  hiddenByFilters: boolean;
  clear: () => void;
  find: (path: string) => Element | null;
  show: (row: Element) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  if (o.path === null) return false;
  if (filtersToClear(o.path, [{ key: "filters", hides: () => o.hiddenByFilters }]).length > 0) o.clear();
  const path = o.path;
  return whenRowDrawn(() => o.find(path), o.show, o.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
}

// ---- PROJ-058: Ctrl/Cmd-click selection and the one confirmation ----

/** The selection after a Ctrl/Cmd-click. The row already shown joins the selection first, so the first toggle adds to it instead of replacing it. */
export function toggleRow(picked: string[], path: string, active: string | null, same: (a: string, b: string) => boolean): string[] {
  const base = picked.length > 0 || active === null ? picked : [active];
  return clickRow(base, path, true, same);
}

export type RemovalStep = { path: string; projectId: string; force: boolean; stamp: string };

/** What to remove once the one question is agreed: every removable row; a row with changes goes with force, because the question listed them. */
export function planRemoval(q: BatchQuestion, items: (Checked & { projectId: string })[]): RemovalStep[] {
  const dirty = new Set(q.dirty.map((d) => d.path));
  return q.removable.flatMap((path) => {
    const it = items.find((i) => i.path === path);
    return it ? [{ path, projectId: it.projectId, force: dirty.has(path), stamp: it.check.stamp }] : [];
  });
}

export const questionFor = (items: Checked[]): BatchQuestion => batchQuestion(items);
