// The 40 px layout strip (DESIGN.md section 6): "Layout" and the 1 / 2 / 4 / 6 group. A button
// sets how many panes the workspace in front holds (TERM-001); the pressed one is the current
// count, so none is pressed at 3, 5 or above 6.
const choices = [1, 2, 4, 6];

export default function LayoutStrip({ count, onLayout }: { count: number; onLayout: (n: number) => void }) {
  return (
    <div className="strip">
      <span>Layout</span>
      <div className="layouts" role="group" aria-label="Panes per screen">
        {choices.map((n) => (
          <button key={n} aria-pressed={count === n} onClick={() => onLayout(n)} title={n === 1 ? "One pane" : `${n} panes: empty panes are added, unstarted ones removed`}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
