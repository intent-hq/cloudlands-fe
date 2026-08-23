/**
 * Native Plans Saga
 *
 * Mirrors the acp-official `planManager` singleton (`plan:updated` /
 * `plan:cleared`) into the `nativePlans` slice so the source-priority gate
 * for the workspace-task fallback card (monorepo#3249) reads Redux state,
 * never the manager directly.
 */
import { eventChannel, type EventChannel } from 'redux-saga';
import { call, put, take } from 'typed-redux-saga';

import {
  planManager,
  type EnhancedPlanEntry,
  type SessionPlan,
} from '$features/acp-official/plans/plan-manager';
import { applyNativePlanCleared, applyNativePlanUpdated } from '../native-plans-slice';
import type { NativePlanEntry } from '../native-plans-types';

type NativePlanEvent =
  | { kind: 'updated'; sessionId: string; entries: NativePlanEntry[] }
  | { kind: 'cleared'; sessionId: string };

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

function createPlanChannel(): EventChannel<NativePlanEvent> {
  return eventChannel((emit) => {
    const onUpdated = (plan: SessionPlan) =>
      emit({
        kind: 'updated',
        sessionId: String(plan.sessionId),
        entries: toNativePlanEntries(plan.entries),
      });
    const onCleared = (sessionId: unknown) => emit({ kind: 'cleared', sessionId: String(sessionId) });
    planManager.on('plan:updated', onUpdated);
    planManager.on('plan:cleared', onCleared);
    return () => {
      planManager.off('plan:updated', onUpdated);
      planManager.off('plan:cleared', onCleared);
    };
  });
}

export function* nativePlansSaga() {
  const channel = yield* call(createPlanChannel);
  try {
    while (true) {
      const event = yield* take(channel);
      if (event.kind === 'updated') {
        yield* put(applyNativePlanUpdated(event.sessionId, event.entries));
      } else {
        yield* put(applyNativePlanCleared(event.sessionId));
      }
    }
  } finally {
    channel.close();
  }
}
