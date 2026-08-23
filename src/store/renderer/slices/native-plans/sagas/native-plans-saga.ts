/**
 * Native Plans Saga
 *
 * Mirrors native ACP `plan` session updates into the `nativePlans` slice so
 * the source-priority gate for the workspace-task fallback card
 * (monorepo#3249) reads Redux state. The `planManager` singleton lives in
 * the MAIN process (only `acp-server.ts` calls `updatePlan`), so the events
 * arrive over the IPC bridge (`acp:plan-updated` / `acp:plan-cleared`,
 * forwarded by `src/features/acp-official/main/plan-broadcast.ts`) — the
 * renderer's own module instance of the singleton never fires.
 */
import { put } from 'typed-redux-saga';

import type { EnhancedPlanEntry } from '$features/acp-official/plans/plan-manager';
import { takeEveryFromElectronChannel } from '$store/renderer/utils/ipc-channel';
import { applyNativePlanCleared, applyNativePlanUpdated } from '../native-plans-slice';
import type { NativePlanEntry } from '../native-plans-types';

export interface PlanUpdatedPayload {
  sessionId: string;
  entries: EnhancedPlanEntry[];
}

export interface PlanClearedPayload {
  sessionId: string;
}

/** Keep only canonical, serializable plan facts (drop icons/colors/timings). */
export function toNativePlanEntries(entries: EnhancedPlanEntry[]): NativePlanEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    status: entry.status,
    ...(entry.children && entry.children.length > 0
      ? { children: toNativePlanEntries(entry.children) }
      : {}),
  }));
}

function* handlePlanUpdated(payload: PlanUpdatedPayload) {
  yield* put(
    applyNativePlanUpdated(String(payload.sessionId), toNativePlanEntries(payload.entries ?? [])),
  );
}

function* handlePlanCleared(payload: PlanClearedPayload) {
  yield* put(applyNativePlanCleared(String(payload.sessionId)));
}

export function* nativePlansSaga() {
  yield* takeEveryFromElectronChannel<PlanUpdatedPayload>('acp:plan-updated', handlePlanUpdated);
  yield* takeEveryFromElectronChannel<PlanClearedPayload>('acp:plan-cleared', handlePlanCleared);
}
