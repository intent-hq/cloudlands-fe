import type { LiveStreamPhase } from '$store/renderer/slices/chat-state/chat-state-types';
import { m } from '$shared/paraglide/messages.js';

/**
 * Grace period before the live-hydration indicator may render: a pre-live
 * phase must persist this long before anything shows, so a fast snapshot
 * (the common case) produces no flash at all.
 */
export const LIVE_STREAM_PHASE_GRACE_MS = 500;

/**
 * True for phases that represent a not-yet-hydrated live stream — the only
 * phases the indicator renders. `live` (hydrated) and `null` (no standing
 * subscription) hide it.
 */
export function isPreLivePhase(phase: LiveStreamPhase | null): phase is Exclude<
  LiveStreamPhase,
  'live'
> {
  return (
    phase === 'connecting' ||
    phase === 'awaiting-snapshot' ||
    phase === 'resyncing' ||
    phase === 'delayed'
  );
}

/**
 * Visibility gate for the live-hydration indicator BEFORE the grace period:
 * a pre-live phase while the agent's turn is in flight. Idle agents never
 * show it — an open subscription on an idle chat still connects/snapshots,
 * but there is nothing "pending" the user is waiting on.
 */
export function shouldShowLiveStreamPhaseIndicator(state: {
  phase: LiveStreamPhase | null;
  turnInFlight: boolean;
}): boolean {
  return state.turnInFlight && isPreLivePhase(state.phase);
}

/** Staged status copy for a pre-live phase. */
export function liveStreamPhaseMessage(phase: Exclude<LiveStreamPhase, 'live'>): string {
  switch (phase) {
    case 'connecting':
      return m.chat_liveStreamPhase_connecting_label();
    case 'awaiting-snapshot':
      return m.chat_liveStreamPhase_awaitingSnapshot_label();
    case 'resyncing':
      return m.chat_liveStreamPhase_resyncing_label();
    case 'delayed':
      return m.chat_liveStreamPhase_delayed_label();
  }
}
