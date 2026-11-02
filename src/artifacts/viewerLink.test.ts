import { afterEach, describe, expect, it, vi } from "vitest";

// A page in the viewer frame runs its own script, and the frame's sandbox lets it post to the app
// (link_script needs that). The app opens a koluxOpen message in the system browser only while the
// user is acting: a click inside the frame counts for its ancestors too, a script posting on load
// or in a loop does not. Without that, any imported page could pop the browser or the mail client.
const invoke = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { openViewerLink, viewerLink } from "./ArtifactsPage";

const frame = { name: "artifact-a" } as unknown as Window;
const msg = (over: Partial<{ data: unknown; source: unknown }>) => ({ data: { koluxOpen: "https://example.com/" }, source: frame, ...over }) as MessageEvent;
const nav = (isActive: boolean | undefined) => (isActive === undefined ? {} : { userActivation: { isActive } }) as Navigator;

afterEach(() => invoke.mockClear());

describe("a link clicked inside the viewer (SKILL-036)", () => {
  it("opens only while the user is acting, and only from our own frame", () => {
    expect(viewerLink(msg({}), frame, nav(true))).toBe("https://example.com/");
    expect(viewerLink(msg({}), frame, nav(false))).toBeNull();
    expect(viewerLink(msg({}), frame, nav(undefined))).toBeNull();
    expect(viewerLink(msg({ source: {} }), frame, nav(true))).toBeNull();
    expect(viewerLink(msg({}), null, nav(true))).toBeNull();
    expect(viewerLink(msg({ data: { koluxOpen: 5 } }), frame, nav(true))).toBeNull();
    expect(viewerLink(msg({ data: null }), frame, nav(true))).toBeNull();
  });

  it("a koluxOpen posted by a page's own script, with no user gesture, never reaches open_external", async () => {
    await openViewerLink(msg({}), frame, nav(false));
    expect(invoke).not.toHaveBeenCalled();
    await openViewerLink(msg({}), frame, nav(true));
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/" });
  });
});
