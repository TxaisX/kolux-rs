// Renderer choice for a terminal pane (spec TERM-103): try the GPU path, keep working on the
// plain path if it fails to load or loses its context later. Pure so it can be tested without a
// browser; the pane hands in the real addon factory.

export type RendererMode = "webgl" | "dom";

export type WebglLike = {
  dispose(): void;
  onContextLoss(listener: () => void): unknown;
};

export type RendererHost<A extends WebglLike> = {
  loadAddon(addon: A): void;
};

export type RendererChoice = {
  mode: RendererMode;
  /** Fires when a GPU pane has fallen back to the plain path after a context loss. */
  onFallback: (listener: (reason: string) => void) => void;
  dispose(): void;
};

export function attachRenderer<A extends WebglLike>(host: RendererHost<A>, makeWebgl: () => A, preferGpu = true): RendererChoice {
  const listeners: Array<(reason: string) => void> = [];
  const notify = (reason: string) => listeners.forEach((l) => l(reason));
  const onFallback = (l: (reason: string) => void) => {
    listeners.push(l);
  };
  if (!preferGpu) return { mode: "dom", onFallback, dispose() {} };

  let addon: A | undefined;
  try {
    addon = makeWebgl();
    addon.onContextLoss(() => {
      addon?.dispose();
      addon = undefined;
      notify("context lost");
    });
    host.loadAddon(addon);
  } catch {
    try {
      addon?.dispose();
    } catch {
      /* already broken */
    }
    addon = undefined;
    return { mode: "dom", onFallback, dispose() {} };
  }
  return {
    mode: "webgl",
    onFallback,
    dispose() {
      addon?.dispose();
      addon = undefined;
    },
  };
}
