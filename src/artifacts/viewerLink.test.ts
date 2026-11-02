import { afterEach, describe, expect, it, vi } from "vitest";

// A page in the viewer frame runs its own script, and the frame's sandbox lets it post to the app
// (link_script needs that). The app opens a koluxOpen message in the system browser only for a click
// made inside the frame: the user's activation has to be live, the frame has to hold the focus, and
// it has to have taken it after the user's last click or key press in Kolux itself. A row click in
// the list gives Kolux's own window activation for a few seconds, so activation alone would let a
// page that posts on load open the browser just by being picked.
const invoke = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { openViewerLink, viewerLink } from "./ArtifactsPage";

const frame = { name: "artifact-a" } as unknown as Window;
const msg = (over: Partial<{ data: unknown; source: unknown }>) => ({ data: { koluxOpen: "https://example.com/" }, source: frame, ...over }) as MessageEvent;
const nav = (isActive: boolean | undefined) => (isActive === undefined ? {} : { userActivation: { isActive } }) as Navigator;
/** The user clicked into the frame after their last input in Kolux. */
const inFrame = { frameFocused: true, frameFocusedAt: 200, ownInputAt: 100 };

afterEach(() => invoke.mockClear());

describe("a link clicked inside the viewer (SKILL-036)", () => {
  it("opens only while the user is acting, and only from our own frame", () => {
    expect(viewerLink(msg({}), frame, inFrame, nav(true))).toBe("https://example.com/");
    expect(viewerLink(msg({}), frame, inFrame, nav(false))).toBeNull();
    expect(viewerLink(msg({}), frame, inFrame, nav(undefined))).toBeNull();
    expect(viewerLink(msg({ source: {} }), frame, inFrame, nav(true))).toBeNull();
    expect(viewerLink(msg({}), null, inFrame, nav(true))).toBeNull();
    expect(viewerLink(msg({ data: { koluxOpen: 5 } }), frame, inFrame, nav(true))).toBeNull();
    expect(viewerLink(msg({ data: null }), frame, inFrame, nav(true))).toBeNull();
  });

  it("a row click in Kolux gives activation but is not a click on the page's link", () => {
    // The user just clicked the row (Kolux's own input, now) and the page posted on load: the focus
    // is on the row, not the frame.
    expect(viewerLink(msg({}), frame, { frameFocused: false, frameFocusedAt: 0, ownInputAt: 300 }, nav(true))).toBeNull();
    // The frame kept the focus from an earlier click, but the user has since clicked or typed in Kolux.
    expect(viewerLink(msg({}), frame, { frameFocused: true, frameFocusedAt: 200, ownInputAt: 300 }, nav(true))).toBeNull();
    // The user clicked into the frame after their last input in Kolux.
    expect(viewerLink(msg({}), frame, { frameFocused: true, frameFocusedAt: 400, ownInputAt: 300 }, nav(true))).toBe("https://example.com/");
  });

  it("a koluxOpen posted by a page's own script, with no click inside the frame, never reaches open_external", async () => {
    await openViewerLink(msg({}), frame, inFrame, nav(false));
    await openViewerLink(msg({}), frame, { frameFocused: false, frameFocusedAt: 0, ownInputAt: 300 }, nav(true));
    expect(invoke).not.toHaveBeenCalled();
    await openViewerLink(msg({}), frame, inFrame, nav(true));
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/" });
  });
});
