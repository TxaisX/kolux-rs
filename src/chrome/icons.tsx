// Kolux RS's own line glyphs: 16-unit grid, 1.5 px strokes, drawn in the current text colour.
// None is a vendor mark (DECISIONS.md: agents get a neutral glyph or their name as text).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 14, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

/** The app mark: Txais's own six-spoke glyph (design/icon/kolux-mark.svg, 24-unit grid): rounded
 * spokes 60 degrees apart that narrow to a neck at a round centre dot, filled in the text colour. */
export const Mark = ({ size = 14, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
    <g transform="translate(12 12)">
      <g transform="rotate(30)">
        <path id="kolux-spoke" d="M1.3 -.13C2.3 -.13 2.7 -.84 3.3 -.84H5.9A.84 .84 0 0 1 5.9 .84H3.3C2.7 .84 2.3 .13 1.3 .13Z" />
        <use href="#kolux-spoke" transform="rotate(60)" />
        <use href="#kolux-spoke" transform="rotate(120)" />
        <use href="#kolux-spoke" transform="rotate(180)" />
        <use href="#kolux-spoke" transform="rotate(240)" />
        <use href="#kolux-spoke" transform="rotate(300)" />
      </g>
      <circle r="1.5" />
    </g>
  </svg>
);
export const Dots = (p: P) => (
  <Glyph {...p} fill="currentColor" stroke="none">
    <circle cx="3" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="13" cy="8" r="1.3" />
  </Glyph>
);
export const PanelLeft = (p: P) => (
  <Glyph {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
    <path d="M6 2.75v10.5" />
  </Glyph>
);
export const PanelRight = (p: P) => (
  <Glyph {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
    <path d="M10 2.75v10.5" />
  </Glyph>
);
export const ArrowLeft = (p: P) => (
  <Glyph {...p}>
    <path d="M10.5 3.5 6 8l4.5 4.5" />
  </Glyph>
);
export const ArrowRight = (p: P) => (
  <Glyph {...p}>
    <path d="m5.5 3.5 4.5 4.5-4.5 4.5" />
  </Glyph>
);
export const Search = (p: P) => (
  <Glyph {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3.5 3.5" />
  </Glyph>
);
export const Bell = (p: P) => (
  <Glyph {...p}>
    <path d="M4 11V7a4 4 0 0 1 8 0v4l1.25 1.5h-10.5L4 11ZM6.5 14a1.5 1.5 0 0 0 3 0" />
  </Glyph>
);
export const Spark = (p: P) => (
  <Glyph {...p}>
    <path d="M8 2v12M2 8h12M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" />
  </Glyph>
);
export const Minimize = (p: P) => (
  <Glyph {...p} strokeWidth={1}>
    <path d="M3 8h10" />
  </Glyph>
);
export const Maximize = (p: P) => (
  <Glyph {...p} strokeWidth={1}>
    <rect x="3.5" y="3.5" width="9" height="9" />
  </Glyph>
);
export const Restore = (p: P) => (
  <Glyph {...p} strokeWidth={1}>
    <rect x="3.5" y="5.5" width="7" height="7" />
    <path d="M5.5 5.5v-2h7v7h-2" />
  </Glyph>
);
export const Close = (p: P) => (
  <Glyph {...p} strokeWidth={1}>
    <path d="m3.5 3.5 9 9m0-9-9 9" />
  </Glyph>
);
export const List = (p: P) => (
  <Glyph {...p}>
    <path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01" />
  </Glyph>
);
export const FileCode = (p: P) => (
  <Glyph {...p}>
    <path d="M9 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.75L9 1.75Z" />
    <path d="M9 1.75v4h4M6.5 8.5 5 10l1.5 1.5m3-3L11 10l-1.5 1.5" />
  </Glyph>
);
export const Sliders = (p: P) => (
  <Glyph {...p}>
    <path d="M2 4.5h12M2 11.5h12" />
    <circle cx="6" cy="4.5" r="1.5" fill="var(--surface)" />
    <circle cx="10" cy="11.5" r="1.5" fill="var(--surface)" />
  </Glyph>
);
export const FolderPlus = (p: P) => (
  <Glyph {...p}>
    <path d="M1.75 4.25a1 1 0 0 1 1-1h3.5l1.5 1.5h5.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1v-8Z" />
    <path d="M8 7v4M6 9h4" />
  </Glyph>
);
export const Minus = (p: P) => (
  <Glyph {...p}>
    <path d="M3 8h10" />
  </Glyph>
);
export const Plus = (p: P) => (
  <Glyph {...p}>
    <path d="M8 3v10M3 8h10" />
  </Glyph>
);
export const Rocket = (p: P) => (
  <Glyph {...p}>
    <path d="M9 10.5c3-1 5-4 5-8.5-4.5 0-7.5 2-8.5 5L9 10.5ZM5.5 7 3 8l2 1M9 10.5 8 13l-1-2" />
    <path d="M4.5 11.5 2.5 13.5" />
  </Glyph>
);
export const ChevronDown = (p: P) => (
  <Glyph {...p}>
    <path d="m4 6.5 4 4 4-4" />
  </Glyph>
);
export const Gear = (p: P) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.75v1.5m0 9.5v1.5M1.75 8h1.5m9.5 0h1.5M3.6 3.6l1.05 1.05m6.7 6.7 1.05 1.05M3.6 12.4l1.05-1.05m6.7-6.7 1.05-1.05" />
  </Glyph>
);
export const Help = (p: P) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M6.25 6.25A1.75 1.75 0 1 1 8 8v1.25M8 11.5h.01" />
  </Glyph>
);
export const Refresh = (p: P) => (
  <Glyph {...p}>
    <path d="M13.5 8A5.5 5.5 0 0 1 4 11.9M2.5 8A5.5 5.5 0 0 1 12 4.1" />
    <path d="M12 1.75v2.5h-2.5M4 14.25v-2.5h2.5" />
  </Glyph>
);
export const Target = (p: P) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2" />
  </Glyph>
);
export const Rail = (p: P) => (
  <Glyph {...p}>
    <path d="M4 3v10M12 3v10M7 8h2" />
  </Glyph>
);
/** Neutral agent glyph for a plain shell: a prompt chevron in a box. */
export const Shell = (p: P) => (
  <Glyph {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
    <path d="m4.5 6 2 2-2 2M8.5 10h3" />
  </Glyph>
);
export const CheckCircle = (p: P) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="m5.25 8.25 1.75 1.75 3.75-4" />
  </Glyph>
);
export const Spinner = (p: P) => (
  <Glyph {...p} strokeWidth={2}>
    <path d="M8 2a6 6 0 0 1 6 6" />
  </Glyph>
);
export const SplitRight = (p: P) => (
  <Glyph {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M8 3v10" />
  </Glyph>
);

export const Stop = (p: P) => (
  <Glyph {...p}>
    <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
  </Glyph>
);
export const Globe = (p: P) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c-2 2.2-2 8.8 0 11M8 2.5c2 2.2 2 8.8 0 11" />
  </Glyph>
);
export const Expand = (p: P) => (
  <Glyph {...p}>
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </Glyph>
);
export const Plug = (p: P) => (
  <Glyph {...p}>
    <path d="M5.5 2v3.5M10.5 2v3.5M3.5 5.5h9v2a4.5 4.5 0 0 1-9 0v-2ZM8 12v2.25" />
  </Glyph>
);
export const Chip = (p: P) => (
  <Glyph {...p}>
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
    <rect x="6" y="6" width="4" height="4" />
    <path d="M6 1.5V3M10 1.5V3M6 13v1.5M10 13v1.5M1.5 6H3M1.5 10H3M13 6h1.5M13 10h1.5" />
  </Glyph>
);
export const Cup = (p: P) => (
  <Glyph {...p}>
    <path d="M3 5.5h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-4ZM11 7h1.5a1.5 1.5 0 0 1 0 3H11" />
  </Glyph>
);
