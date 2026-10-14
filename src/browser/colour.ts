// BROW-011: the page's loading surface takes the pane's colour so a dark theme never flashes
// white. The colour is read from computed style, which comes back as rgb()/rgba() whatever the
// theme wrote; a transparent value means "look further up".
export type Rgb = [number, number, number];

export function rgbOf(computed: string): Rgb | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(computed.trim());
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The first painted background behind `el`: its own, else the nearest ancestor's. */
export function backgroundBehind(el: Element | null): Rgb | null {
  for (let e = el; e; e = e.parentElement) {
    const rgb = rgbOf(getComputedStyle(e).backgroundColor);
    if (rgb) return rgb;
  }
  return null;
}
