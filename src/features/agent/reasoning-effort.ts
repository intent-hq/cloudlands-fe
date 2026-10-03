/** Compatibility for control/encoder callers. Remove when they all dispatch the
 * owning action directly. No queue, wire work or session writes live here. */
import { store as appStore } from '$store/renderer/store';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  agentEffortIntentMarked,
  agentEffortIntentReleased,
  agentModelMutationConsumed,
  agentModelMutationRequested,
} from '$store/renderer/slices/agent-model/agent-model-slice';
import type {
  AgentModelWriteOptions,
  AgentModelOperation,
} from '$store/renderer/slices/agent-model/agent-model-types';
export type ReasoningEffortWriteOptions = AgentModelWriteOptions;
let nextIntent = 0;

/** Mark a local choice immediately, even while its RPC is still coalescing. */
export function markReasoningEffortIntent(agentId: string, workspaceId: string): number {
  const intent = ++nextIntent;
  appStore.dispatch(agentEffortIntentMarked(agentId, workspaceId, intent));
  return intent;
}

/** Discard unsent choices; issued writes can still settle their accepted value. */
export function releaseReasoningEffortIntent(
  agentId: string,
  workspaceId: string,
  intent: number,
): void {
  appStore.dispatch(agentEffortIntentReleased(agentId, workspaceId, intent));
}

async function requestEffort(
  agentId: string,
  workspaceId: string,
  operation: AgentModelOperation,
  options?: ReasoningEffortWriteOptions,
): Promise<boolean> {
  const requestId = crypto.randomUUID();
  const consumerId = options?.source ?? 'control';
  try {
    const result = await appStore.dispatch(
      agentModelMutationRequested(
        {
          requestId,
          consumerId,
          agentId,
          workspaceId,
          operation,
          connection: selectPrincipalConnectionContext.select(appStore.state),
        },
        { ...options, intent: options?.intent ?? markReasoningEffortIntent(agentId, workspaceId) },
      ),
    );
    return result.status === 'success';
  } finally {
    appStore.dispatch(agentModelMutationConsumed(requestId, consumerId));
  }
}

/**
 * Apply a reasoning-effort level to a session. `effort` is the level string,
 * or `null` to clear back to the provider default. Resolves `true` when the
 * daemon accepted the change.
 */
export async function applyReasoningEffort(
  agentId: string,
  workspaceId: string,
  effort: string | null,
  previousEffort: string | null,
  options?: ReasoningEffortWriteOptions,
): Promise<boolean> {
  return requestEffort(
    agentId,
    workspaceId,
    { kind: 'effort', effort, previous: previousEffort },
    options,
  );
}

/** Reconcile and persist a session effort after its model changes. */
export async function reconcileAgentReasoningEffort(
  agentId: string,
  workspaceId: string,
  currentEffort: string | null | undefined,
  supportedEfforts: readonly string[] | null | undefined,
  options?: ReasoningEffortWriteOptions,
): Promise<boolean> {
  return requestEffort(
    agentId,
    workspaceId,
    { kind: 'reconcile', current: currentEffort ?? null, levels: supportedEfforts },
    options,
  );
}
