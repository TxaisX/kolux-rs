// VIEW-113: the front matter block above a Markdown note and the drag handle on the contents panel's edge.
import { useRef } from "react";
import { draggedWidth, frontBlock, nudgedWidth } from "./mdView";
import { TOC_WIDTH } from "./mdPrefs";

/** The note's front matter as its own block above the text; nothing when hidden or when there is none. */
export function FrontMatterBlock({ front, hide }: { front: string; hide: boolean }) {
  const text = frontBlock(front, hide);
  if (text === null) return null;
  return (
    <pre className="note-front" aria-label="Front matter">
      {text}
    </pre>
  );
}

/** A thin handle on the contents panel's left edge. `onWidth` gets every width on the way (already inside the limits). */
export function TocResizer({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const from = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="note-toc-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize contents"
      aria-valuenow={width}
      aria-valuemin={TOC_WIDTH.min}
      aria-valuemax={TOC_WIDTH.max}
      tabIndex={0}
      onPointerDown={(e) => {
        from.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => from.current && onWidth(draggedWidth(from.current.w, from.current.x, e.clientX))}
      onPointerUp={() => (from.current = null)}
      onPointerCancel={() => (from.current = null)}
      onKeyDown={(e) => {
        const next = nudgedWidth(width, e.key, TOC_WIDTH.min, TOC_WIDTH.max);
        if (next === null) return;
        e.preventDefault();
        onWidth(next);
      }}
    />
  );
}
