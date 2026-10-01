import { describe, expect, it } from "vitest";
import { DEFAULT_MEDIA_PREFS, mediaPrefsSchema } from "./prefs";

describe("mediaPrefsSchema", () => {
  it("aplica os defaults", () => {
    const prefs = mediaPrefsSchema.parse({});

    expect(prefs.autoSelectKinds).toEqual(["video"]);
    expect(prefs.minSizeInBytes).toBe(0);
    expect(prefs.onlyCurrentTab).toBe(true);
    expect(prefs.includeStreams).toBe(true);
    expect(prefs.streamVariantPolicy).toBe("best");
  });

  it("DEFAULT_MEDIA_PREFS reflete o parse vazio", () => {
    expect(DEFAULT_MEDIA_PREFS).toEqual(mediaPrefsSchema.parse({}));
  });
});
