/**
 * One-shot dictation insertion target for non-agent prompt surfaces (the
 * workspace-creation prompts: New Space modal and the home page prompt).
 *
 * The default dictation flow inserts the transcript into the active agent's
 * chat composer (transcription-service resolves the target agent from store
 * state). A prompt surface that starts its own dictation session registers a
 * target here at stop time; the transcription flow consumes it (one-shot)
 * and routes the insertion to the target's editor instead — focusing it via
 * `focus()` so the existing focused-editable caret insertion lands there.
 *
 * Registration happens at stop time (not start) to minimize the window in
 * which a stale target could linger; the registering surface still clears a
 * leftover target when its stopped session produces no transcription (audio
 * discarded as too short, recorder error) — see prompt-mic-controller's
 * component wiring.
 *
 * Pure module-level registry — no store, no services, no DOM.
 */

/** A prompt surface's editor the transcript should land in. */
export interface PromptDictationTarget {
  /** Focus the prompt's editor so the caret insertion lands in it. */
  focus: () => void;
}

let pendingTarget: PromptDictationTarget | null = null;

/** Register the target for the next finished dictation (replaces any). */
export function setPromptDictationTarget(target: PromptDictationTarget): void {
  pendingTarget = target;
}

/** Take the registered target (one-shot: clears it), or `null`. */
export function consumePromptDictationTarget(): PromptDictationTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

/** Drop any registered target without consuming it. */
export function clearPromptDictationTarget(): void {
  pendingTarget = null;
}

/** Whether a target is currently registered (tests/diagnostics). */
export function hasPromptDictationTarget(): boolean {
  return pendingTarget !== null;
}
