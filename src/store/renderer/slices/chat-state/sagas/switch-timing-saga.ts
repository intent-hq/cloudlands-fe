/**
 * Dev-only observer saga for workspace-switch timing.
 *
 * Purely observational: watches the existing t=0 triggers
 * (`initializeChatRequested` / `markAgentAsViewed`) and the reveal-gate
 * actions (hydration lifecycle, seq-0 snapshot, footer data seeds), records
 * `performance.mark` entries via the
 * switch-timing module, and finalizes ONE consolidated log line when the
 * reveal condition composes true (`shouldDeferTranscriptReveal` inputs:
 * hydration settled + the transcript snapshot gate clear). Dispatches nothing and owns
 * no state; registered as a no-op outside dev builds.
 */
import { call, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  beginAgentView,
  discardAgentView,
  finalizeAgentView,
  hasOpenAgentView,
  isSwitchTimingEnabled,
  markAgentGate,
  markWorkspaceSeed,
} from '../../../utils/switch-timing';
import {
  chatLiveStreamPhaseChanged,
  chatSwitchBackRevealTimedOut,
  chatTranscriptSnapshotApplied,
  initializeChatRequested,
  transcriptHydrationFailed,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import {
  selectAwaitingSwitchBackSnapshot,
  selectTranscriptHydration,
} from '../chat-state-selectors';
import { selectAgentSessionWorkspaceId } from '../../agent-session/agent-session-selectors';
import { markAgentAsViewed } from '../../unread-tracking/unread-tracking-slice';
import {
  setSubscriptionSnapshot,
  subscriptionSnapshotFetchFailed,
} from '../../agent-subscription-ui/agent-subscription-ui-slice';
import {
  backgroundHooksSubscribeRequested,
  backgroundHooksUpdated,
} from '../../background-hooks/background-hooks-slice';
import { prMonitorsUpdated } from '../../pr-monitor/pr-monitor-slice';

/** Finalize the open view once the reveal condition composes true. */
function* checkReveal(agentId: string): SagaGenerator<void> {
  if (!hasOpenAgentView(agentId)) return;
  const hydration = yield* selectTranscriptHydration.effect(agentId);
  if (hydration !== 'settled') return;
  const awaitingSnapshot = yield* selectAwaitingSwitchBackSnapshot.effect(agentId);
  if (awaitingSnapshot) return;
  finalizeAgentView(agentId);
}

function* initializeWorker(
  action: ReturnType<typeof initializeChatRequested>,
): SagaGenerator<void> {
  const { agentId, wsId } = action.payload;
  beginAgentView(agentId, wsId, 'initialize');
  yield* call(checkReveal, agentId);
}

function* viewedWorker(action: ReturnType<typeof markAgentAsViewed>): SagaGenerator<void> {
  const [agentId] = action.payload;
  if (!agentId) return;
  const workspaceId = yield* selectAgentSessionWorkspaceId.effect(agentId);
  beginAgentView(agentId, workspaceId, 'viewed');
  yield* call(checkReveal, agentId);
}

function hydrationFailedWorker(action: ReturnType<typeof transcriptHydrationFailed>): void {
  const [agentId] = action.payload;
  markAgentGate(agentId, 'hydrationFailed');
  finalizeAgentView(agentId);
}

/** Map each live-stream phase to its first-occurrence timing gate. */
const PHASE_GATES = {
  connecting: 'phaseConnecting',
  'awaiting-snapshot': 'phaseAwaitingSnapshot',
  live: 'phaseLive',
  resyncing: 'phaseResyncing',
  delayed: 'phaseDelayed',
} as const;

function phaseChangedWorker(action: ReturnType<typeof chatLiveStreamPhaseChanged>): void {
  const [agentId, phase] = action.payload;
  if (phase === null) {
    discardAgentView(agentId);
    return;
  }
  // Bracket the chat.subscribe lifecycle (registration ack → seq-0 snapshot)
  // so a slow reveal self-attributes: a late phaseLive with an early
  // phaseAwaitingSnapshot points at the daemon's seq-0 push. A phaseDelayed
  // mark means the retry/backoff path ran (scheduleRetry in live-chat-client:
  // either a rejected chat.subscribe registration or the SNAPSHOT_TIMEOUT_MS
  // snapshot timer) — since gates are first-occurrence-only, an earlier
  // phaseAwaitingSnapshot in the same record means the ack landed first,
  // disambiguating toward the snapshot timeout on the first cycle.
  markAgentGate(agentId, PHASE_GATES[phase]);
}

function subscriptionSnapshotWorker(action: ReturnType<typeof setSubscriptionSnapshot>): void {
  markAgentGate(action.payload.agentId, 'subscriptionsFetched');
}

function subscriptionFetchFailedWorker(
  action: ReturnType<typeof subscriptionSnapshotFetchFailed>,
): void {
  const [, agentId] = action.payload;
  markAgentGate(agentId, 'subscriptionsFetched');
}

function hydrationStartedWorker(action: ReturnType<typeof transcriptHydrationStarted>): void {
  markAgentGate(action.payload[0], 'hydrationStarted');
}

function* hydrationSettledWorker(
  action: ReturnType<typeof transcriptHydrationSettled>,
): SagaGenerator<void> {
  markAgentGate(action.payload[0], 'hydrationSettled');
  yield* call(checkReveal, action.payload[0]);
}

function* snapshotAppliedWorker(
  action: ReturnType<typeof chatTranscriptSnapshotApplied>,
): SagaGenerator<void> {
  markAgentGate(action.payload[0], 'snapshotApplied');
  yield* call(checkReveal, action.payload[0]);
}

function* revealTimedOutWorker(
  action: ReturnType<typeof chatSwitchBackRevealTimedOut>,
): SagaGenerator<void> {
  markAgentGate(action.payload[0], 'revealTimedOut');
  yield* call(checkReveal, action.payload[0]);
}

function hooksSubscribeWorker(action: ReturnType<typeof backgroundHooksSubscribeRequested>): void {
  markWorkspaceSeed(action.payload[0], 'hooksSeedStarted');
}

function hooksUpdatedWorker(action: ReturnType<typeof backgroundHooksUpdated>): void {
  markWorkspaceSeed(action.payload[0], 'hooksSeedDelivered');
}

function prMonitorsUpdatedWorker(action: ReturnType<typeof prMonitorsUpdated>): void {
  markWorkspaceSeed(action.payload[0], 'prSeedDelivered');
}

export function* switchTimingSaga(): SagaGenerator<void> {
  if (!isSwitchTimingEnabled()) return;
  yield* takeEvery(initializeChatRequested, initializeWorker);
  yield* takeEvery(markAgentAsViewed, viewedWorker);
  yield* takeEvery(transcriptHydrationStarted, hydrationStartedWorker);
  yield* takeEvery(transcriptHydrationSettled, hydrationSettledWorker);
  yield* takeEvery(transcriptHydrationFailed, hydrationFailedWorker);
  yield* takeEvery(chatTranscriptSnapshotApplied, snapshotAppliedWorker);
  yield* takeEvery(chatSwitchBackRevealTimedOut, revealTimedOutWorker);
  yield* takeEvery(chatLiveStreamPhaseChanged, phaseChangedWorker);
  yield* takeEvery(setSubscriptionSnapshot, subscriptionSnapshotWorker);
  yield* takeEvery(subscriptionSnapshotFetchFailed, subscriptionFetchFailedWorker);
  yield* takeEvery(backgroundHooksSubscribeRequested, hooksSubscribeWorker);
  yield* takeEvery(backgroundHooksUpdated, hooksUpdatedWorker);
  yield* takeEvery(prMonitorsUpdated, prMonitorsUpdatedWorker);
}
