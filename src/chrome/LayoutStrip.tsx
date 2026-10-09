// The 40 px layout strip (DESIGN.md section 6): "Layout" and the 1 / 2 / 4 / 6 group. Only 1
// does anything until the grid task (T-009); the others are drawn but inert.
export type Layout = 1 | 2 | 4 | 6;
const choices: Layout[] = [1, 2, 4, 6];

export default function LayoutStrip({ layout, onLayout }: { layout: Layout; onLayout: (l: Layout) => void }) {
  return (
    <div className="strip">
      <span>Layout</span>
      <div className="layouts" role="group" aria-label="Panes per screen">
        {choices.map((n) => (
          <button key={n} aria-pressed={layout === n} onClick={() => n === 1 && onLayout(n)} title={n === 1 ? "One pane" : `${n} panes (comes with the grid task)`}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
