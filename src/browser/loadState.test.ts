import { describe, expect, it } from "vitest";
import { DEAD_AFTER, type Event, fresh, type Health, LOADING_GRACE, MAX_RECOVERIES, overlayModel, overlayOf, step, trustLabel } from "./loadState";

// T-074 (BROW-008, BROW-009): the load-state machine, fed the events the back end can give
// (started, finished, and the answer of a location.href probe) and the user's own actions.

const run = (events: Event[], from: Health = fresh()) => {
  let h = from;
  const actions: string[] = [];
  for (const e of events) {
    const [next, action] = step(h, e);
    h = next;
    if (action !== "none") actions.push(action);
  }
  return { h, actions };
};
const loaded = (url = "https://example.com/"): Event[] => [{ t: "started", url }, { t: "finished", url }, { t: "probe", answer: "page" }];
const dead = (): Event[] => Array.from({ length: DEAD_AFTER }, () => ({ t: "probe", answer: "no-answer" }) as Event);

describe("BROW-008: a page that fails to load", () => {
  it("shows the failed overlay when the probe finds the engine's own error page", () => {
    const { h, actions } = run([{ t: "started", url: "http://localhost:9/" }, { t: "finished", url: "http://localhost:9/" }, { t: "probe", answer: "error-page" }]);
    expect(h.phase).toBe("failed");
    expect(overlayOf(h)).toEqual({ kind: "failed", url: "http://localhost:9/" });
    expect(actions).toEqual(["overlay"]);
  });

  // A certificate the engine refuses never sends started or finished. The typed navigation enters
  // loading itself and the probe's grace turns the stuck about:blank into a failed load.
  it("fails a typed navigation that never commits, after the loading grace", () => {
    const probes = Array.from({ length: LOADING_GRACE }, () => ({ t: "probe", answer: "error-page" }) as Event);
    const { h, actions } = run([{ t: "navigate", url: "https://expired.badssl.com/" }, ...probes]);
    expect(h.phase).toBe("failed");
    expect(overlayOf(h)).toEqual({ kind: "failed", url: "https://expired.badssl.com/" });
    expect(actions).toEqual(["overlay"]);
    const short = run([{ t: "navigate", url: "https://expired.badssl.com/" }, ...probes.slice(1)]);
    expect(short.h.phase).toBe("loading");
    expect(overlayOf(short.h)).toBeNull();
  });

  it("a page that commits during loading does not wait for the grace", () => {
    const { h } = run([{ t: "navigate", url: "https://example.com/" }, { t: "probe", answer: "page" }]);
    expect(h.phase).toBe("ok");
    expect(overlayOf(h)).toBeNull();
  });

  it("keeps the typed address when the engine's started event has none", () => {
    const probes = Array.from({ length: LOADING_GRACE }, () => ({ t: "probe", answer: "error-page" }) as Event);
    const { h } = run([{ t: "navigate", url: "https://expired.badssl.com/" }, { t: "started", url: "" }, ...probes]);
    expect(h.phase).toBe("failed");
    expect(overlayOf(h)).toEqual({ kind: "failed", url: "https://expired.badssl.com/" });
  });

  it("keeps the typed address when the engine reports about:blank", () => {
    const probes = Array.from({ length: LOADING_GRACE }, () => ({ t: "probe", answer: "error-page" }) as Event);
    const { h } = run([{ t: "navigate", url: "https://expired.badssl.com/" }, { t: "started", url: "about:blank" }, ...probes]);
    expect(h.phase).toBe("failed");
    expect(overlayOf(h)).toEqual({ kind: "failed", url: "https://expired.badssl.com/" });
  });

  it("a page that loaded shows no overlay and the probe keeps it that way", () => {
    const { h, actions } = run([...loaded(), { t: "probe", answer: "page" }]);
    expect(h.phase).toBe("ok");
    expect(overlayOf(h)).toBeNull();
    expect(actions).toEqual([]);
  });

  it("Retry reloads, keeps the overlay up until the new load starts, and the new start clears it", () => {
    const failed = run([{ t: "started", url: "http://localhost:9/" }, { t: "finished", url: "http://localhost:9/" }, { t: "probe", answer: "error-page" }]).h;
    const [retrying, action] = step(failed, { t: "retry" });
    expect(action).toBe("reload");
    expect(overlayOf(retrying)).not.toBeNull(); // the buttons are disabled, the overlay stays
    const [started] = step(retrying, { t: "started", url: "http://localhost:9/" });
    expect(overlayOf(started)).toBeNull();
    expect(started.phase).toBe("loading");
  });

  it("a probe answer while the overlay is up changes nothing (the page is hidden under it)", () => {
    const failed = run([{ t: "started", url: "http://a/" }, { t: "finished", url: "http://a/" }, { t: "probe", answer: "error-page" }]).h;
    expect(run(dead(), failed).h).toEqual(failed);
    expect(run([{ t: "probe", answer: "page" }], failed).h).toEqual(failed);
  });

  describe("the overlay's wording", () => {
    it("local-server advice only for this computer's addresses, never for public sites", () => {
      const local = overlayModel({ kind: "failed", url: "http://localhost:9/" }, { kind: "refused", local: true, https: null });
      expect(local.advice).toMatch(/start it/i);
      expect(local.text).toContain("localhost:9");
      expect(local.openExternally).toBe(false);
      const pub = overlayModel({ kind: "failed", url: "http://example.com/" }, { kind: "refused", local: false, https: "https://example.com/" });
      expect(pub.advice).toBeNull();
      expect(pub.switchHttps).toBe("https://example.com/");
    });
    it("certificate problems get their own wording, no local advice, and Open Externally stays", () => {
      const m = overlayModel({ kind: "failed", url: "https://expired.example/" }, { kind: "certificate", local: false, https: null });
      expect(m.text).toMatch(/certificate/i);
      expect(m.advice).toBeNull();
      expect(m.switchHttps).toBeNull();
      expect(m.openExternally).toBe(true);
    });
    it("a skipped diagnosis (a proxy is saved) says nothing was checked, gives no local advice and keeps Open Externally", () => {
      const m = overlayModel({ kind: "failed", url: "http://nas.lan/" }, { kind: "skipped", local: true, https: null });
      expect(m.text).toMatch(/proxy/i);
      expect(m.text).toContain("nas.lan");
      expect(m.advice).toBeNull();
      expect(m.openExternally).toBe(true);
    });
    it("an unknown host hides Open Externally and offers no HTTPS switch", () => {
      const m = overlayModel({ kind: "failed", url: "http://no.such.host.invalid/" }, { kind: "unknown-host", local: false, https: null });
      expect(m.text).toMatch(/could not find/i);
      expect(m.openExternally).toBe(false);
      expect(m.switchHttps).toBeNull();
    });
    it("before the diagnosis arrives the overlay already names the problem plainly with Retry only", () => {
      const m = overlayModel({ kind: "failed", url: "http://example.com/" }, null);
      expect(m.title).toMatch(/could not load/i);
      expect(m.openExternally).toBe(false);
      expect(m.switchHttps).toBeNull();
    });
    it("Open Externally also needs an outside handler: hidden when the system has none, kept when unknown", () => {
      const cert = overlayModel({ kind: "failed", url: "https://expired.example/" }, { kind: "certificate", local: false, https: null }, false);
      expect(cert.openExternally).toBe(false);
      for (const known of [true, null] as const) {
        expect(overlayModel({ kind: "failed", url: "https://expired.example/" }, { kind: "certificate", local: false, https: null }, known).openExternally).toBe(true);
      }
      expect(overlayModel({ kind: "crashed", url: "http://localhost:3000/" }, null, false).openExternally).toBe(false);
      expect(overlayModel({ kind: "crashed", url: "http://localhost:3000/" }, null, true).openExternally).toBe(true);
      // a handler never makes an unreachable address openable
      expect(overlayModel({ kind: "failed", url: "http://no.such.host.invalid/" }, { kind: "unknown-host", local: false, https: null }, true).openExternally).toBe(false);
    });
    it("a failure out of crash recovery leaves out the network troubleshooting text", () => {
      const m = overlayModel({ kind: "crashed", url: "http://localhost:3000/" }, { kind: "refused", local: true, https: null });
      expect(m.title).toMatch(/stopped responding/i);
      expect(m.advice).toBeNull();
      expect(m.switchHttps).toBeNull();
      expect(m.openExternally).toBe(true);
    });
  });
});

describe("BROW-009: a crashed page", () => {
  it("is reloaded once by itself after the probe goes unanswered DEAD_AFTER times in a row", () => {
    const ok = run(loaded()).h;
    const short = run(dead().slice(0, DEAD_AFTER - 1), ok);
    expect(short.actions).toEqual([]); // one or two misses are a busy page, not a dead one
    const { h, actions } = run(dead(), ok);
    expect(actions).toEqual(["reload"]);
    expect(h.phase).toBe("recovering");
    expect(h.recoveries).toBe(1);
    expect(overlayOf(h)).toBeNull(); // the user sees the tab reload in place, no overlay
  });

  it("an answer in between resets the count, so a slow page is never reloaded", () => {
    const ok = run(loaded()).h;
    const { h, actions } = run([...dead().slice(0, DEAD_AFTER - 1), { t: "probe", answer: "page" }, ...dead().slice(0, DEAD_AFTER - 1)], ok);
    expect(actions).toEqual([]);
    expect(h.phase).toBe("ok");
  });

  it("a page that is still loading is waited for, never counted dead", () => {
    const { h, actions } = run([{ t: "started", url: "http://slow/" }, ...dead(), ...dead()]);
    expect(actions).toEqual([]);
    expect(h.phase).toBe("loading");
  });

  it("the automatic reload that comes back is the page again, with no overlay", () => {
    const recovering = run(dead(), run(loaded()).h).h;
    const { h, actions } = run(loaded(), recovering);
    expect(actions).toEqual([]);
    expect(h.phase).toBe("ok");
    expect(overlayOf(h)).toBeNull();
  });

  it("no reload loop: a second death gives the crashed overlay, never another automatic reload", () => {
    const recovering = run(dead(), run(loaded()).h).h;
    const again = run([...loaded(), ...dead()], recovering);
    expect(again.actions).toEqual(["overlay"]);
    expect(again.h.phase).toBe("crashed");
    expect(overlayOf(again.h)).toEqual({ kind: "crashed", url: "https://example.com/" });
    // and the recovery never comes back on its own: more silence changes nothing
    expect(run(dead(), again.h).actions).toEqual([]);
    expect(MAX_RECOVERIES).toBe(1);
  });

  it("a reload that never answers goes straight to the crashed overlay", () => {
    const recovering = run(dead(), run(loaded()).h).h;
    const { h, actions } = run(dead(), recovering);
    expect(actions).toEqual(["overlay"]);
    expect(h.phase).toBe("crashed");
  });

  it("a reload that lands on the engine's error page is a crash failure, not a network one", () => {
    const recovering = run(dead(), run(loaded()).h).h;
    const { h } = run([{ t: "started", url: "https://example.com/" }, { t: "finished", url: "https://example.com/" }, { t: "probe", answer: "error-page" }], recovering);
    expect(overlayOf(h)).toEqual({ kind: "crashed", url: "https://example.com/" });
  });

  it("the user's own Retry or a typed address gives the page its one automatic recovery back", () => {
    const crashed = run([...loaded(), ...dead()], run(dead(), run(loaded()).h).h).h;
    const [afterRetry, action] = step(crashed, { t: "retry" });
    expect(action).toBe("rebuild"); // the dead page cannot reload; BROW-009 builds it again
    expect(afterRetry.recoveries).toBe(0);
    const [afterNav] = step(crashed, { t: "navigate" });
    expect(afterNav.recoveries).toBe(0);
    // ...so once that page is back, a later death is reloaded automatically once more
    const { actions } = run([...loaded(), ...dead()], afterRetry);
    expect(actions).toEqual(["reload"]);
  });
});

describe("BROW-010: pages after the computer wakes", () => {
  // Three tabs at sleep: one fine, one that already used its automatic reload, one showing the
  // overlay. One wake signal reaches all three.
  it("rechecks every page, and a page that cannot recover does not stop the others", () => {
    const fine = run(loaded()).h;
    const spent = run([...loaded(), ...dead(), { t: "started", url: "https://example.com/" }, { t: "finished", url: "https://example.com/" }, { t: "probe", answer: "page" }]).h;
    expect(spent.recoveries).toBe(1);
    const failed = run([{ t: "started", url: "https://example.com/" }, { t: "finished", url: "https://example.com/" }, { t: "probe", answer: "error-page" }]).h;
    expect(failed.phase).toBe("failed");
    const woke = [fine, spent, failed].map((h) => step(h, { t: "woke" }));
    expect(woke.map(([, a]) => a)).toEqual(["none", "none", "reload"]);
    // Sleep took the second page: it gets a fresh automatic reload instead of the overlay.
    expect(run(dead(), woke[1][0]).actions).toEqual(["reload"]);
    // The third still cannot load: its overlay comes back, and the other two are untouched.
    const again = run([{ t: "started", url: "https://example.com/" }, { t: "finished", url: "https://example.com/" }, { t: "probe", answer: "error-page" }], woke[2][0]);
    expect(again.actions).toEqual(["overlay"]);
    expect(run([{ t: "probe", answer: "page" }], woke[0][0]).h.phase).toBe("ok");
  });

  it("leaves a blank tab blank", () => {
    expect(step(fresh(), { t: "woke" })).toEqual([fresh(), "none"]);
  });
});

describe("BROW-024 trusting a local dev server's certificate", () => {
  it("the overlay offers Trust only while the back end has this tab's local challenge waiting", () => {
    expect(trustLabel(null)).toBeNull();
    expect(trustLabel({ offer: false, trusted: false, site: null })).toBeNull();
    expect(trustLabel({ offer: false, trusted: true, site: "localhost:8443" })).toBeNull();
    expect(trustLabel({ offer: true, trusted: false, site: null })).toBeNull();
    expect(trustLabel({ offer: true, trusted: false, site: "localhost:8443" })).toBe("Trust This Certificate On localhost:8443 For This Run");
  });
});

describe("BROW-009: Retry rebuilds a page a reload cannot bring back", () => {
  const url = "https://example.com/";

  it("a first-time Retry (a page that only failed to load) still just reloads", () => {
    const failed = run([{ t: "started", url }, { t: "finished", url }, { t: "probe", answer: "error-page" }]).h;
    expect(failed.phase).toBe("failed");
    expect(step(failed, { t: "retry" })[1]).toBe("reload");
  });

  it("Retry on a page that stayed dead after its one automatic reload rebuilds it", () => {
    const afterReload = run(dead(), run(loaded()).h).h;
    expect(afterReload.phase).toBe("recovering");
    const crashed = run(dead(), afterReload).h;
    expect(crashed.phase).toBe("crashed");
    expect(step(crashed, { t: "retry" })[1]).toBe("rebuild");
  });

  it("an automatic reload that lands on the error page is a crash too, and Retry rebuilds", () => {
    const h = run([{ t: "probe", answer: "error-page" }], run(dead(), run(loaded()).h).h).h;
    expect(h.phase).toBe("crashed");
    expect(step(h, { t: "retry" })[1]).toBe("rebuild");
  });
});

// Row 954 (b): a page destroyed its own tab (a popup's opener.close(), a frame's top.close()).
describe("row 954b: a tab that closed itself", () => {
  const url = "https://example.com/app";

  it("is rebuilt at once at its last address, and no 'stopped responding' overlay ever shows", () => {
    const ok = run(loaded(url)).h;
    const [h, action] = step(ok, { t: "selfclosed", reopen: true });
    expect(action).toBe("rebuild");
    expect(h.url).toBe(url);
    expect(overlayOf(h)).toBeNull();
    // The destroyed page answers no probe while the new one loads; the dead-page count must not run.
    const waiting = run(dead(), h);
    expect(waiting.h.phase).toBe("loading");
    expect(waiting.actions).toEqual([]);
    expect(overlayOf(waiting.h)).toBeNull();
  });

  it("the rebuilt page's own load brings the tab back to ok", () => {
    const h = step(run(loaded(url)).h, { t: "selfclosed", reopen: true })[0];
    expect(run([{ t: "started", url }, { t: "finished", url }, { t: "probe", answer: "page" }], h).h.phase).toBe("ok");
  });

  it("left closed: the closed overlay goes up, probes are ignored, Retry rebuilds", () => {
    const ok = run(loaded(url)).h;
    const [h, action] = step(ok, { t: "selfclosed", reopen: false });
    expect(action).toBe("overlay");
    expect(overlayOf(h)).toEqual({ kind: "closed", url });
    expect(run(dead(), h).actions).toEqual([]);
    expect(step(h, { t: "retry" })[1]).toBe("rebuild");
    expect(step(h, { t: "woke" })[1]).toBe("none");
  });

  it("the closed overlay says the page closed itself, not that it stopped responding", () => {
    const m = overlayModel({ kind: "closed", url }, null, null);
    expect(m.title).toBe("This page closed itself");
    expect(m.text).toContain("keeps closing itself");
    expect(m.advice).toBeNull();
    expect(m.openExternally).toBe(true);
  });
});
