// SET-034: Settings > Notifications. Which kinds of event may raise a notification, which sound it
// plays and how loud. The desktop notifications themselves come with the status hooks (T-026),
// which read these choices; the test button here works today.

/** The kinds of notification, their settings keys and what they are when nothing is saved. */
export const KINDS = [
  { key: "notifyTaskComplete", label: "An agent finishes its task", on: true },
  { key: "notifyBell", label: "A terminal rings its bell", on: false },
  { key: "notifyAgentStopped", label: "An agent stops or needs permission", on: true },
  { key: "notifyUsage", label: "Usage alerts", on: true },
] as const;
export type KindKey = (typeof KINDS)[number]["key"];
export const SUPPRESS_FOCUSED_FIELD = "notifySuppressFocused";
export const SOUND_FIELD = "notificationSound";
export const VOLUME_FIELD = "notificationVolume";

/** Kolux's own tones, made for Kolux RS (DECISIONS section 5): short note sequences, in hertz. */
export const TONES = { chime: [880, 1320], ping: [1568], pulse: [523, 523] } as const;
export type Tone = keyof typeof TONES;
export type Sound = "system" | Tone;
export const SOUNDS: Array<{ id: Sound; label: string }> = [
  { id: "system", label: "System default" },
  { id: "chime", label: "Chime" },
  { id: "ping", label: "Ping" },
  { id: "pulse", label: "Pulse" },
];

export function readNotifications(s: Record<string, unknown>) {
  const kinds = Object.fromEntries(KINDS.map((k) => [k.key, typeof s[k.key] === "boolean" ? (s[k.key] as boolean) : k.on])) as Record<KindKey, boolean>;
  const v = s[VOLUME_FIELD];
  const volume = typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v) : 100;
  const sound = SOUNDS.some((o) => o.id === s[SOUND_FIELD]) ? (s[SOUND_FIELD] as Sound) : "system";
  return { kinds, suppressFocused: s[SUPPRESS_FOCUSED_FIELD] !== false, sound, volume };
}

/** What a notification plays: Kolux's tone over a silent toast, or the system's own sound; only
 * ever one of them, and nothing at volume 0. */
export function testPlan({ sound, volume }: { sound: Sound; volume: number }) {
  const gain = volume / 100;
  if (gain === 0) return { toastSound: false, tone: null, gain };
  return sound === "system" ? { toastSound: true, tone: null, gain } : { toastSound: false, tone: sound, gain };
}

/** Plays one of Kolux's tones at `gain` (0 to 1): each note a short sine with a soft fade. */
export function playTone(tone: Tone, gain: number): void {
  const ctx = new AudioContext();
  TONES[tone].forEach((hz, i) => {
    const at = ctx.currentTime + i * 0.16;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.value = hz;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.5 * gain), at + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.32);
  });
  window.setTimeout(() => void ctx.close(), 1000);
}
