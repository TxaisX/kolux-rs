// STAT-050 acceptance, box 2: Down with nothing selected selects the first row; Enter opens it.
// Runs the real InboxView function body with a stand-in for React's state hooks and reads the
// key handler and the selected row back from the element it returns; rows come from the real inboxItems.
import { expect, test, vi } from "vitest";

const slots: unknown[] = [];
let si = 0;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: (init: unknown) => {
    const i = si++;
    if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    return [slots[i], (v: unknown) => (slots[i] = typeof v === "function" ? (v as (o: unknown) => unknown)(slots[i]) : v)];
  },
  useRef: (v: unknown) => ({ current: v }),
  useEffect: () => {},
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
const { default: InboxView } = await import("../InboxView");
const { inboxItems } = await import("../inbox");

const MIN = 60_000;
const now = 10_000 * MIN;
const src = (key: number, state: string, extra: object = {}) => ({ key, agent: "claude", title: `Claude ${key}`, branch: "main", cwd: "G:/repo", state, interrupted: false, running: true, changed: now - key * MIN, finishedAt: null, ...extra }) as never;

test("box 2: Down with nothing selected selects the first row, Enter opens it", () => {
  const items = inboxItems([src(1, "permission"), src(2, "waiting"), src(3, "done", { finishedAt: now - 5 * MIN })], now);
  const opened: number[] = [];
  const render = () => {
    si = 0;
    return InboxView({ items, now, onOpen: (k) => opened.push(k) }) as unknown as { props: { onKeyDown: (e: object) => void; "aria-activedescendant"?: string } };
  };
  const key = (k: string) => ({ key: k, preventDefault: () => {} });
  let root = render();
  expect(root.props["aria-activedescendant"]).toBeUndefined(); // nothing selected yet
  root.props.onKeyDown(key("Enter"));
  expect(opened).toEqual([]); // Enter with nothing selected opens nothing
  root.props.onKeyDown(key("ArrowDown"));
  root = render();
  expect(items[0].key).toBe(1);
  expect(root.props["aria-activedescendant"]).toBe(`inbox-${items[0].key}`);
  root.props.onKeyDown(key("Enter"));
  expect(opened).toEqual([1]);
});
