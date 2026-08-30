/**
 * One-shot insertion target for composer-initiated dictation: the agentId
 * of the composer whose mic button started the live recording session.
 *
 * The default transcription flow resolves its insertion target from the
 * active workspace's `activeAgentId` at recording-finish time — which can
 * point at a DIFFERENT composer by then (or at nothing). The composer mic
 * controller registers the originating composer's agentId at session start;
 * the transcription flow consumes it (one-shot) and routes the transcript
 * there instead, falling back to the store resolution when nothing is
 * registered (the hardware-PTT path never registers one).
 *
 * Hygiene mirrors prompt-dictation-target: `startPttRecording` clears any
 * dangling registration (a cancelled/too-short session's capture must never
 * route a LATER session's transcript), and the composer controller's Esc
 * cancel clears it too.
 *
 * Pure module-level registry — no store, no services, no DOM.
 */

let pendingAgentId: string | null = null;

/** Register the originating composer for the live session (replaces any). */
export function setComposerDictationTarget(agentId: string): void {
  pendingAgentId = agentId;
}

/** Take the registered agentId (one-shot: clears it), or `null`. */
export function consumeComposerDictationTarget(): string | null {
  const agentId = pendingAgentId;
  pendingAgentId = null;
  return agentId;
}

/** Drop any registered agentId without consuming it. */
export function clearComposerDictationTarget(): void {
  pendingAgentId = null;
}

/** Whether an agentId is currently registered (tests/diagnostics). */
export function hasComposerDictationTarget(): boolean {
  return pendingAgentId !== null;
}
