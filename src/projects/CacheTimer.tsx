// SET-059: the countdown on a worktree's sidebar card; it ticks on its own each second.
import { useEffect, useState } from "react";
import { Clock } from "../chrome/icons";
import { CACHE_GONE, cacheShown } from "./cache";

export function CacheTimerView({ left }: { left: number }) {
  const { text, phase } = cacheShown(left);
  if (phase === "gone")
    return (
      <span className="cache-timer gone" role="img" aria-label="Prompt cache run out" title={CACHE_GONE}>
        <Clock size={11} />
      </span>
    );
  return (
    <span className={phase === "last" ? "cache-timer last" : "cache-timer"} title="Prompt cache: time left before the next message has to send the whole conversation again">
      {text}
    </span>
  );
}

export default function CacheTimer({ due }: { due: number }) {
  const [now, setNow] = useState(Date.now());
  const done = now >= due;
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done, due]);
  return <CacheTimerView left={due - now} />;
}
