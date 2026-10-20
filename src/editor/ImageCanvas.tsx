// EDIT-029 (T-235-b): the picture area of the image viewer. A small picture opens at its real size, a big one fits the
// window; Ctrl or Cmd with the wheel and a two-finger pinch zoom toward the pointer between fixed limits (imageFiles.ts),
// a plain wheel and dragging move the picture, and a picture that cannot be drawn says why instead of showing a blank.
import { useCallback, useEffect, useRef, useState } from "react";
import { apart, centred, clampZoom, describe, fitScale, pinchFactor, startScale, whyNotLoaded, wheelFactor, zoomToward, type Size, type View } from "./imageFiles";

type Props = { src: string | null; error?: string | null; name: string; bytes?: number; hidden?: boolean };

export default function ImageCanvas({ src, error = null, name, bytes, hidden = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [broken, setBroken] = useState(false);
  const fitted = useRef(false);
  const size = () => ({ w: box.current?.clientWidth ?? 0, h: box.current?.clientHeight ?? 0 });

  // A new picture starts afresh: real size when small, fitted when big.
  useEffect(() => {
    setNatural(null);
    setBroken(false);
    fitted.current = false;
  }, [src]);
  const start = useCallback(
    (n: Size) => {
      const b = size();
      setView(centred(n, b, startScale(n, b)));
      fitted.current = true;
    },
    [],
  );
  const reset = (mode: "real" | "fit") => {
    if (!natural) return;
    const b = size();
    setView(centred(natural, b, mode === "real" ? 1 : fitScale(natural, b)));
  };
  const zoom = (f: number, px?: number, py?: number) => {
    const b = size();
    setView((v) => zoomToward(v, f, px ?? b.w / 2, py ?? b.h / 2));
  };

  // The wheel needs a listener that may cancel the page's own zoom, which React's wheel prop cannot.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) setView((v) => zoomToward(v, wheelFactor(e.deltaY, e.deltaMode), e.clientX - r.left, e.clientY - r.top));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [src, error, hidden]);

  // Dragging moves the picture; two fingers pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastGap = useRef(0);
  const down = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      lastGap.current = apart(a, b);
    }
  };
  const move = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const gap = apart(a, b);
      const r = box.current?.getBoundingClientRect();
      if (r) zoom(pinchFactor(lastGap.current, gap), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      lastGap.current = gap;
    } else setView((v) => ({ ...v, x: v.x + now.x - p.x, y: v.y + now.y - p.y }));
  };
  const up = (e: React.PointerEvent) => void pointers.current.delete(e.pointerId);

  const why = error ? whyNotLoaded(error, name) : broken ? whyNotLoaded("decode", name) : null;
  const pct = `${Math.round(view.scale * 1000) / 10}%`;
  return (
    <div className="image-view pane-body" hidden={hidden} role="region" aria-label={`${name}, picture`}>
      {why ? (
        <p className="image-why" role="alert">
          {why}
        </p>
      ) : (
        <>
          <div className="image-bar">
            <button className="ib" title="Zoom out" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}>
              -
            </button>
            <span className="image-zoom" aria-live="polite" title="Hold Ctrl or Cmd and use the wheel to zoom toward the pointer">
              {pct}
            </span>
            <button className="ib" title="Zoom in" aria-label="Zoom in" onClick={() => zoom(1.25)}>
              +
            </button>
            <button className="ib" title="Show at real size" onClick={() => reset("real")} disabled={!natural}>
              100%
            </button>
            <button className="ib" title="Fit to the window" onClick={() => reset("fit")} disabled={!natural}>
              Fit
            </button>
            {natural && bytes !== undefined && <span className="image-facts">{describe(natural, bytes)}</span>}
          </div>
          <div ref={box} className="image-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {src === null ? (
              <p className="image-wait">Loading {name}</p>
            ) : (
              <img
                src={src}
                alt={name}
                draggable={false}
                referrerPolicy="no-referrer"
                onLoad={(e) => {
                  const n = { w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 };
                  setNatural(n);
                  if (!fitted.current) start(n);
                }}
                onError={() => setBroken(true)}
                style={{ width: natural?.w, height: natural?.h, transform: `translate(${view.x}px, ${view.y}px) scale(${clampZoom(view.scale)})`, visibility: natural ? "visible" : "hidden" }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
