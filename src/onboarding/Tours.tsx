// ONB-031 / ONB-032 / ONB-033: contextual tours. Mounted once in the window; it watches for each
// tour's surface, starts at most one tour by itself per launch on a profile that qualifies, and
// runs replays asked for through replayTour (the help menu). The rules live in tour.ts.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { markGuide, type GuideRecord } from "./guide";
import { actionWord, autoStarts, FIRST_TARGET_TRIES, FOCUSED_SPLIT, nextShown, place, prevShown, REPLAY_TOUR, stepLabel, stepWords, TOURS, type Placed, type Rect, type Tour, type TourId } from "./tour";


/** The first copy of `sel` that is really on screen (hidden copies are passed over). */
function shown(sel: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (el.checkVisibility?.() ?? true)) return el;
  }
  return null;
}

/** Another dialog (the first-run wizard, a confirmation) holds the window. */
const blocked = () => [...document.querySelectorAll("[role=dialog]")].some((d) => !d.classList.contains("tour"));

const SPLIT_KEY = (e: KeyboardEvent) => e.shiftKey && (e.ctrlKey || e.altKey) && e.key.toLowerCase() === "d";

function TourPanel({ tour, at, onAt, onEnd }: { tour: Tour; at: number; onAt: (i: number) => void; onEnd: (how: "done" | "skipped" | "lost") => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ t: Rect; p: Placed } | null>(null);
  const step = tour.steps[at];
  const present = tour.steps.map((s) => !!shown(s.target));
  const shownIdx = present.flatMap((p, i) => (p ? [i] : []));
  const next = nextShown(present, at);
  const back = prevShown(present, at);

  // Follow the target every frame (frames stop by themselves while the window is hidden); state
  // changes only when something moved. A target gone for good moves on, or ends the tour.
  useLayoutEffect(() => {
    let frame = 0;
    let key = "";
    let missing = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = shown(step.target);
      if (!el) {
        if (++missing < 10) return;
        cancelAnimationFrame(frame);
        const n = nextShown(tour.steps.map((s) => !!shown(s.target)), at);
        return n === null ? onEnd("lost") : onAt(n);
      }
      missing = 0;
      const t = el.getBoundingClientRect();
      const host = el.closest("[role=dialog]:not(.tour)")?.getBoundingClientRect();
      const b = host ?? { left: 8, top: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 };
      const p = place(t, { width: box.current?.offsetWidth ?? 320, height: box.current?.offsetHeight ?? 140 }, b, step.side);
      const k = [t.left, t.top, t.width, t.height, p.left, p.top, p.side].map(String).join();
      if (k !== key) {
        key = k;
        setGeo({ t: { left: t.left, top: t.top, width: t.width, height: t.height }, p });
      }
    };
    tick();
    const wake = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [tour, at]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape is Skip, before any page shortcut sees it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onEnd("skipped");
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onEnd]);

  // A step without Next moves on when its real control is clicked.
  useEffect(() => {
    if (!step.noNext) return;
    const click = (e: MouseEvent) => {
      const el = shown(step.target);
      if (el && e.target instanceof Node && el.contains(e.target)) (next === null ? onEnd("done") : onAt(next));
    };
    window.addEventListener("click", click, true);
    return () => window.removeEventListener("click", click, true);
  }, [step, next, onAt, onEnd]);

  const w = stepWords(step);
  const act = actionWord(step);
  const label = stepLabel(shownIdx.indexOf(at), shownIdx.length);
  const arrow = geo?.p.side ? (geo.p.side === "bottom" || geo.p.side === "top" ? { left: Math.max(14, Math.min(geo.t.left + geo.t.width / 2 - geo.p.left, (box.current?.offsetWidth ?? 320) - 14)) } : { top: Math.max(14, Math.min(geo.t.top + geo.t.height / 2 - geo.p.top, (box.current?.offsetHeight ?? 140) - 14)) }) : null;
  return (
    <>
      {tour.ring && geo && <div className="tour-ring" style={{ left: geo.t.left - 4, top: geo.t.top - 4, width: geo.t.width + 8, height: geo.t.height + 8 }} aria-hidden="true" />}
      <div ref={box} className="tour" role="dialog" aria-modal="false" aria-label={`${tour.name} tour`} data-tour={tour.id} style={geo ? { left: geo.p.left, top: geo.p.top } : { visibility: "hidden", left: 0, top: 0 }}>
        {arrow && <span className={`tour-arrow ${geo!.p.side}`} style={arrow} aria-hidden="true" />}
        <h3>{w.title}</h3>
        <p>{w.body}</p>
        <div className="tour-foot">
          {shownIdx.length > 1 && (
            <span className="tour-dots" aria-hidden="true">
              {shownIdx.map((i) => (
                <i key={i} className={i === at ? "on" : ""} />
              ))}
            </span>
          )}
          {label && <span className="tour-label">{label}</span>}
          <span className="spacer" />
          <button className="btn" onClick={() => onEnd("skipped")}>
            Skip
          </button>
          {back !== null && (
            <button className="btn" onClick={() => onAt(back)}>
              Back
            </button>
          )}
          {act ? (
            <button className="btn primary" onClick={() => shown(FOCUSED_SPLIT)?.click()}>
              {act}
            </button>
          ) : (
            !step.noNext && (
              <button className="btn primary" onClick={() => (next === null ? onEnd("done") : onAt(next))} autoFocus>
                {next === null ? "Done" : "Next"}
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}

export default function Tours() {
  const rec = useRef<GuideRecord | null>(null);
  const slot = useRef(false);
  const want = useRef<{ id: TourId; forced: boolean; tries: number } | null>(null);
  const [run, setRun] = useState<{ tour: Tour; at: number } | null>(null);
  const running = useRef(false);
  running.current = run !== null;

  useEffect(() => {
    invoke<GuideRecord>("tours_get").then((r) => (rec.current = r), () => {});
    const replay = (e: Event) => (want.current = { id: (e as CustomEvent<TourId>).detail, forced: true, tries: 0 });
    // Any split counts (ONB-033: the parallel tour is for people who never split), and a split
    // during the parallel tour carries it past its split step.
    const split = () => {
      if (rec.current && !rec.current.tried.includes("split")) {
        rec.current.tried = [...rec.current.tried, "split"];
        markGuide("tried", "split").catch(() => {});
      }
      setRun((r) => (r && r.tour.id === "parallel" && r.at === 0 ? { ...r, at: 1 } : r));
    };
    const click = (e: MouseEvent) => e.target instanceof Element && e.target.closest(".pane-head button[title^='Split right']") && split();
    const key = (e: KeyboardEvent) => SPLIT_KEY(e) && split();
    window.addEventListener(REPLAY_TOUR, replay);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    // ponytail: a quarter-second look for surfaces; an observer per tour if this ever shows in a profile.
    const timer = window.setInterval(() => {
      if (document.hidden || running.current) return;
      const r = rec.current;
      const w = want.current;
      if (w) {
        const tour = TOURS.find((t) => t.id === w.id);
        const first = tour && nextShown(tour.steps.map((s) => !!shown(s.target)), -1);
        if (tour && first !== null && first !== undefined && (w.forced || !blocked())) {
          want.current = null;
          setRun({ tour, at: first });
        } else if (++w.tries >= (w.forced ? 4 * FIRST_TARGET_TRIES : FIRST_TARGET_TRIES)) {
          // Gave up without showing: an automatic tour hands its slot back and is not marked seen.
          want.current = null;
          if (!w.forced) slot.current = false;
        }
        return;
      }
      if (!r) return;
      const auto = TOURS.find((t) => autoStarts({ id: t.id, auto: r.toursAuto, seen: r.toursSeen, slotUsed: slot.current, blocked: blocked(), tried: r.tried }) && shown(t.trigger));
      if (auto) {
        slot.current = true;
        want.current = { id: auto.id, forced: false, tries: 0 };
      }
    }, 250);
    return () => {
      window.removeEventListener(REPLAY_TOUR, replay);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      window.clearInterval(timer);
    };
  }, []);

  if (!run) return null;
  const end = (how: "done" | "skipped" | "lost") => {
    const id = run.tour.id;
    setRun(null);
    if (how === "lost") return;
    // Skipping or finishing marks it seen, once.
    if (rec.current && !rec.current.toursSeen.includes(id)) {
      rec.current.toursSeen = [...rec.current.toursSeen, id];
      markGuide("toursSeen", id).catch(() => {});
    }
  };
  return <TourPanel key={run.tour.id} tour={run.tour} at={run.at} onAt={(at) => setRun({ ...run, at })} onEnd={end} />;
}
