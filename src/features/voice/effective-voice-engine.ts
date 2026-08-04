/**
 * Effective transcription engine resolution — the single source of truth
 * for "which engine will actually transcribe right now", shared by every
 * dictation trigger (hardware push-to-talk, composer mic button) and the
 * transcription routing itself.
 *
 * The selected engine (voice-settings slice) is a *preference*; this
 * resolves it against configuration reality:
 *
 * - `os` selected → `os`. The explicit choice is always honored — never a
 *   silent fallback to the cloud path — so an unavailable OS engine fails
 *   clearly at transcribe time (os-transcription-service's error toasts).
 * - `daemon` selected with the provider's API key configured → `daemon`.
 * - `daemon` selected, key missing, OS engine available → `os` (graceful
 *   fallback: dictation keeps working locally instead of failing).
 * - `daemon` selected, key missing, no OS engine → `unavailable` (triggers
 *   gate the gesture and surface an actionable setup hint).
 *
 * `unavailable` therefore only exists on hosts with no OS dictation at all:
 * Windows/Linux, or a mac whose speech helper is missing (the
 * `osEngineAvailable` probe is macOS + helper presence — voice-local.ipc.ts).
 * A mac with the helper resolves to `os` even before speech authorization
 * has been granted: the OS path is attempted so the permission prompt can
 * fire, and a denial surfaces at transcribe time as an actionable failure
 * toast — never a blocked entry point.
 *
 * While the initial daemon read is still loading, `daemon` resolves to
 * `daemon` (key presence unknown — never gate a press on unsettled state).
 *
 * Dependency-light utility per src/lib AGENTS.md — no stores or services.
 */

import type { VoiceProvider } from "./voice-settings-service";
import type { VoiceEngine } from "./voice-engine-preference";

/** What a dictation trigger will actually use: an engine, or nothing. */
export type EffectiveVoiceEngine = VoiceEngine | "unavailable";

/** The slice of voice-settings state the resolution reads (structurally
 *  satisfied by `VoiceSettingsSliceState`). */
export interface EffectiveVoiceEngineInputs {
  /** True until the initial daemon read settles. */
  isLoading: boolean;
  engine: VoiceEngine;
  osEngineAvailable: boolean;
  provider: VoiceProvider;
  keyConfigured: Record<VoiceProvider, boolean>;
}

/** Resolve the engine preference against configuration reality. */
export function resolveEffectiveVoiceEngine(
  inputs: EffectiveVoiceEngineInputs,
): EffectiveVoiceEngine {
  if (inputs.engine === "os") return "os";
  if (inputs.isLoading) return "daemon";
  if (inputs.keyConfigured[inputs.provider] === true) return "daemon";
  return inputs.osEngineAvailable ? "os" : "unavailable";
}
