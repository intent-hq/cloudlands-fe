/**
 * Stale runtime-flag convergence for authoritative hydration upserts
 * (monorepo#1250).
 *
 * A daemon crash mid-turn leaves the agent-session slice with the both-true
 * `isStreaming`/`isProcessing` pair and no stream-end event will ever arrive
 * to clear it. The slice's upsert pair-guard then re-asserts the stale flags
 * over every hydration snapshot's explicit `false`, so the UI keeps showing a
 * streaming/responding agent forever. Hydration paths that fetch a FRESH
 * daemon session (chat-read-service, agent-read-service,
 * lifecycle-read-service) use these helpers to let the daemon's authoritative
 * idle state win — mirroring how cloudlands-fe#600 gated message preservation
 * on daemon-reported liveness.
 *
 * The guard's designed race case is preserved: the clear only applies when
 * the both-true pair already existed BEFORE the fetch began. A pair set
 * during the fetch (a snapshot racing `chatSendStarted` for a genuinely live
 * turn) keeps the default preservation semantics, and a pre-existing pair
 * whose turn is genuinely live is reported in flight by the fresh session,
 * which also suppresses the clear.
 *
 * Dependency-light (per feature utils conventions): pure functions over the
 * session payload — no stores, services, or side effects.
 */
import type { AgentSession } from "$shared/types";
import type { BulkUpsertSessionsOptions } from "$store/renderer/slices/agent-session/agent-session-slice";

/**
 * Daemon-reported turn liveness on a freshly fetched session (PROTOCOL §5.5
 * AgentLite): `turnInFlight` / `isResponding` / `isStreaming` — the same
 * derivation as live-chat-client's snapshot overlay and chat-read-service's
 * message-preservation gate. `turnInFlight` is a §5.5 additive field not
 * declared on the TS type, so it is read defensively off the raw session.
 */
export function daemonReportsTurnInFlight(session: AgentSession): boolean {
  return (
    (session as { turnInFlight?: unknown }).turnInFlight === true ||
    session.isResponding === true ||
    session.isStreaming === true
  );
}

/** Upsert options that let an authoritative snapshot's explicit-false flags win. */
export const STALE_RUNTIME_FLAG_CLEAR_OPTIONS: BulkUpsertSessionsOptions = Object.freeze({
  preserveExplicitRuntimeFlags: false,
  allowActiveTurnRuntimeFlagClear: true,
});

/**
 * Options for a hydration `bulkUpsertSessions` dispatch carrying a freshly
 * fetched daemon session. Returns the stale-clear options when the in-flight
 * pair predates the fetch AND the daemon reports the session idle (a crash
 * leftover no event will ever clear); returns `undefined` (default
 * preservation semantics) otherwise.
 */
export function staleRuntimeFlagClearUpsertOptions(
  hadInFlightPairBeforeFetch: boolean,
  freshSession: AgentSession,
): BulkUpsertSessionsOptions | undefined {
  if (!hadInFlightPairBeforeFetch || daemonReportsTurnInFlight(freshSession)) {
    return undefined;
  }
  return STALE_RUNTIME_FLAG_CLEAR_OPTIONS;
}
