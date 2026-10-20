// ONB-025: the looping demo an Explore Kolux workflow or stop carries. It pauses while the window is hidden, shows
// the platform's own keys, and with reduced motion shows one still frame and runs no timer.
import { useEffect, useMemo, useState } from "react";
import { detectPlatform } from "../keys/keymap";
import { createLoop, demoFor, framesOf } from "./demos";

const FRAME_MS = 1800;

export default function Demo({ stop }: { stop: string }) {
  const id = demoFor(stop);
  const frames = useMemo(() => (id ? framesOf(id, detectPlatform()) : []), [id]);
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [at, setAt] = useState(0);
  useEffect(() => {
    setAt(0);
    if (!id || reduced) return;
    const loop = createLoop(frames.length, FRAME_MS);
    const t = window.setInterval(() => setAt(loop.tick(performance.now(), !document.hidden)), 150);
    return () => window.clearInterval(t);
  }, [id, reduced, frames.length]);
  if (!id) return null;
  return (
    <div className="onb-demo explore-demo" aria-hidden>
      <div className="onb-demo-row">{frames[at]}</div>
    </div>
  );
}
