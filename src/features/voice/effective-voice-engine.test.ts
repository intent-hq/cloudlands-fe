import { describe, expect, it } from "vitest";
import {
  resolveEffectiveVoiceEngine,
  type EffectiveVoiceEngineInputs,
} from "./effective-voice-engine";

function inputs(
  overrides: Partial<EffectiveVoiceEngineInputs> = {},
): EffectiveVoiceEngineInputs {
  return {
    isLoading: false,
    engine: "daemon",
    osEngineAvailable: false,
    provider: "elevenlabs",
    keyConfigured: { elevenlabs: false, openai: false },
    ...overrides,
  };
}

describe("resolveEffectiveVoiceEngine", () => {
  it("honors an explicit os selection unconditionally (no silent cloud fallback)", () => {
    expect(resolveEffectiveVoiceEngine(inputs({ engine: "os" }))).toBe("os");
    expect(
      resolveEffectiveVoiceEngine(
        inputs({ engine: "os", osEngineAvailable: true }),
      ),
    ).toBe("os");
  });

  it("resolves daemon when the selected provider's key is configured", () => {
    expect(
      resolveEffectiveVoiceEngine(
        inputs({ keyConfigured: { elevenlabs: true, openai: false } }),
      ),
    ).toBe("daemon");
  });

  it("keys on the SELECTED provider, not any configured provider", () => {
    expect(
      resolveEffectiveVoiceEngine(
        inputs({
          provider: "openai",
          keyConfigured: { elevenlabs: true, openai: false },
        }),
      ),
    ).toBe("unavailable");
  });

  it("falls back to os when the daemon key is missing and the OS engine is available", () => {
    expect(
      resolveEffectiveVoiceEngine(inputs({ osEngineAvailable: true })),
    ).toBe("os");
  });

  it("resolves os on a capable mac regardless of speech authorization (not an input)", () => {
    // osEngineAvailable is the macOS + helper-presence probe only — a
    // not-yet-authorized mac still resolves `os` so the attempt can fire
    // the permission prompt; a denial surfaces at transcribe time.
    const capableMac = inputs({ osEngineAvailable: true });
    expect(Object.keys(capableMac)).not.toContain("speechAuthorization");
    expect(resolveEffectiveVoiceEngine(capableMac)).toBe("os");
  });

  it("is unavailable only when no OS engine exists (non-mac or helper-missing mac)", () => {
    expect(resolveEffectiveVoiceEngine(inputs())).toBe("unavailable");
  });

  it("never gates on unsettled state: daemon while the initial read is loading", () => {
    expect(resolveEffectiveVoiceEngine(inputs({ isLoading: true }))).toBe(
      "daemon",
    );
  });
});
