import { describe, expect, it } from "vitest";
import { CUSTOM_FIELD, readNotifications, SOUND_FIELD, VOLUME_FIELD } from "../settings/notifications";

// What the settings file does between runs: a patch is merged into the stored object, written as JSON and read back at the next start.
const restart = (stored: Record<string, unknown>, ...patches: Record<string, unknown>[]) => JSON.parse(JSON.stringify(Object.assign({}, stored, ...patches))) as Record<string, unknown>;
// The patch the Notifications page saves when a file is picked.
const pick = (file: string) => ({ [CUSTOM_FIELD]: file, [SOUND_FIELD]: "custom" });

describe("custom notification sound keeps its location across a restart", () => {
  it("the picked file and the choice come back as left", () => {
    const n = readNotifications(restart({}, pick("C:\Sounds\ding.wav")));
    expect([n.sound, n.customFile]).toEqual(["custom", "C:\Sounds\ding.wav"]);
  });
  it("another sound is chosen and later the custom one again: the location is still there", () => {
    const stored = restart({}, pick("C:/s/ding.ogg"), { [SOUND_FIELD]: "glow" });
    expect(readNotifications(stored)).toMatchObject({ sound: "glow", customFile: "C:/s/ding.ogg" });
    expect(readNotifications(restart(stored, { [SOUND_FIELD]: "custom" }))).toMatchObject({ sound: "custom", customFile: "C:/s/ding.ogg" });
  });
  it("changing the volume leaves it alone, and a fresh profile has none", () => {
    expect(readNotifications(restart(restart({}, pick("C:/s/a.mp3")), { [VOLUME_FIELD]: 40 }))).toMatchObject({ volume: 40, customFile: "C:/s/a.mp3" });
    expect(readNotifications(restart({})).customFile).toBeNull();
  });
});
