// Model routing (SET-028, ACCT-034) as pure functions: which model and effort each worker tier
// means for a provider, and how a pick changes. The catalogue (providers, their models, each
// model's effort levels, the shipped ladder) comes from the back end (src-tauri/src/routing.rs),
// which also reads the same settings when a worker starts on a tier.

export type Model = { id: string; label: string; efforts: string[] };
export type Pick = { model: string; effort: string | null };
export type Provider = { id: string; name: string; models: Model[]; defaults: Pick[] };
/** What is saved per tier: an empty model is the provider's own default. */
export type Saved = { model: string; effort: string };
export type Routing = Record<string, Record<string, Saved>>;

export const TIERS = [
  { id: "major", label: "Major" },
  { id: "deep", label: "Deep" },
  { id: "build", label: "Build" },
  { id: "light", label: "Light" },
] as const;
export const ROUTING_KEY = "modelRouting";

export const routingOf = (settings: Record<string, unknown>): Routing => {
  const r = settings[ROUTING_KEY];
  return r && typeof r === "object" ? (r as Routing) : {};
};

/** The tier's pick: what was saved, else the shipped ladder. */
export function current(p: Provider, tier: string, routing: Routing): Saved {
  const saved = routing[p.id]?.[tier];
  if (saved) return { model: saved.model ?? "", effort: saved.effort ?? "" };
  const d = p.defaults[TIERS.findIndex((t) => t.id === tier)];
  return { model: d?.model ?? "", effort: d?.effort ?? "" };
}

/** The effort levels a model takes; none means the effort picker is not shown. */
export const effortsFor = (p: Provider, model: string): string[] => p.models.find((m) => m.id === model)?.efforts ?? [];

/** A new model keeps the effort while the model still offers it and resets it otherwise. */
export function chooseModel(p: Provider, now: Saved, model: string): Saved {
  return { model, effort: effortsFor(p, model).includes(now.effort) ? now.effort : "" };
}

/** The settings with one tier's pick saved. */
export function withPick(settings: Record<string, unknown>, provider: string, tier: string, pick: Saved): Record<string, unknown> {
  const routing = routingOf(settings);
  return { ...settings, [ROUTING_KEY]: { ...routing, [provider]: { ...routing[provider], [tier]: pick } } };
}

/** The model a start line asks for (`--model x`), for the pane header. */
export function modelOf(args: string[]): string | null {
  const i = args.indexOf("--model");
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
