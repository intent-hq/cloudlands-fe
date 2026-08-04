/**
 * Cancellation registry for the in-flight transcription session.
 *
 * The transcription flow (transcription-service) registers each run here
 * before awaiting the transcribe call, pairing an identity token with the
 * flow's idempotent settle callback. The mic buttons' cancel affordance
 * calls {@link cancelActiveTranscription} while the spinner is showing:
 * the settle runs immediately (HUD hidden, `voiceTranscribing` cleared, a
 * new recording can start) and the session stops being current, so when
 * the underlying request eventually resolves or rejects — the daemon
 * `voice.transcribe` RPC has no abort seam, and the OS helper may hang —
 * the flow sees a stale token and DISCARDS the result instead of
 * inserting it (fire-and-forget abandonment).
 *
 * At most one transcription session is current at a time; beginning a new
 * session supersedes the previous one, so a superseded flow's late result
 * is discarded by the same token check. Dependency-free by design (no
 * store, no services) — safe to import from components and middleware.
 */

/** Opaque identity token for one transcription flow run. */
export type TranscriptionSessionToken = object;

let activeSession: { token: TranscriptionSessionToken; onCancel: () => void } | null = null;

/**
 * Register a starting transcription flow. `onCancel` must be idempotent
 * (the flow's own settle) — it runs synchronously if the user cancels.
 * Returns the token the flow checks before applying its result.
 */
export function beginTranscriptionSession(onCancel: () => void): TranscriptionSessionToken {
  const token: TranscriptionSessionToken = {};
  activeSession = { token, onCancel };
  return token;
}

/** Whether `token`'s flow is still current (not cancelled or superseded). */
export function isTranscriptionSessionCurrent(token: TranscriptionSessionToken): boolean {
  return activeSession?.token === token;
}

/** Deregister a settled flow (no-op when cancelled/superseded already). */
export function endTranscriptionSession(token: TranscriptionSessionToken): void {
  if (activeSession?.token === token) activeSession = null;
}

/** Whether a transcription session is currently in flight (cancellable). */
export function hasActiveTranscriptionSession(): boolean {
  return activeSession !== null;
}

/**
 * Cancel the in-flight transcription session, if any: runs its settle
 * (clears the transcribing state immediately) and abandons the session so
 * a late-arriving result is discarded. Returns whether one was cancelled.
 */
export function cancelActiveTranscription(): boolean {
  if (activeSession === null) return false;
  const { onCancel } = activeSession;
  activeSession = null;
  onCancel();
  return true;
}

/** Drop any registered session without running its settle (test isolation). */
export function resetTranscriptionCancellation(): void {
  activeSession = null;
}
