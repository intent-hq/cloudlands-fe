/**
 * Compatibility lock funnel for ModelPicker and existing imperative callers.
 * All execution belongs to agentModelSaga; this adapter has no queue or wire
 * writes. Retain until the public mutator callers migrate to action dispatch.
 *
 * Every method re-reads `isLocked()` at its own call time — not at
 * construction and not at the caller's entry — and no-ops while locked. That
 * is what makes a caller's stale continuation safe: after any `await`, the
 * next mutation re-evaluates the live lock inside the mutator, so a role flip
 * mid-flight (owner → guest) cannot leak a write through a per-call-site
 * re-check that was forgotten. The reasoning-effort writers also receive the
 * live lock as `canMutate`, so their own post-await failure rollback re-reads
 * it too. ModelPicker dispatches correlated model intents directly; legacy
 * writer imports remain restricted to this adapter (lint-enforced).
 */
import {
  applyReasoningEffort,
  reconcileAgentReasoningEffort,
  markReasoningEffortIntent,
} from '$features/agent/reasoning-effort';
import {
  agentModelMutationRequested,
  agentModelMutationConsumed,
} from '$store/renderer/slices/agent-model/agent-model-slice';
import type {
  AgentModelOperation,
  AgentModelOutcome,
  AgentModelResult,
} from '$store/renderer/slices/agent-model/agent-model-types';
import { store as appStore } from '$store/renderer/store';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';

export type AgentModelMutatorOptions = {
  /** Live lock predicate, evaluated on every mutator call. */
  isLocked: () => boolean;
  consumerId?: string;
};

/** Returned in place of the RPC result when the lock skipped the call. */
export type SkippedMutation = { readonly skipped: true };

export const SKIPPED_MUTATION: SkippedMutation = Object.freeze({ skipped: true });

type SetModelResult = AgentModelResult;

export type AgentModelMutator = {
  /** Atomic model acknowledgment and effort reconciliation in the shared queue. */
  selectModel(
    agentId: string,
    model: string,
    workspaceId: string,
    providerId: string,
    isCurrent?: () => boolean,
  ): Promise<AgentModelOutcome>;
  /** Accepted session selection. Returns `false` when locked. */
  setSessionModel(agentId: string, model: string, providerId?: string): boolean;
  /** `agent.setModel` RPC. Resolves `SKIPPED_MUTATION` when locked. */
  setModel(
    agentId: string,
    model: string,
    workspaceId: string,
    providerId?: string,
  ): Promise<SetModelResult | SkippedMutation>;
  /** Reconcile + persist the session effort after a model change. `false` when locked. */
  reconcileEffort(
    agentId: string,
    workspaceId: string,
    currentEffort: string | null | undefined,
    supportedEfforts: readonly string[] | null | undefined,
    isCurrent?: () => boolean,
  ): Promise<boolean>;
  /** Persist a user-picked effort level. `false` when locked. */
  applyEffort(
    agentId: string,
    workspaceId: string,
    effort: string | null,
    previousEffort: string | null,
  ): Promise<boolean>;
};

export function isSkippedMutation(value: unknown): value is SkippedMutation {
  return value === SKIPPED_MUTATION;
}

export function createAgentModelMutator({
  isLocked,
  consumerId = crypto.randomUUID(),
}: AgentModelMutatorOptions): AgentModelMutator {
  const context = () => selectPrincipalConnectionContext.select(appStore.state);
  const writeOptions = (isCurrent?: () => boolean) => {
    const started = context();
    const canWrite = () => !isLocked() && context() === started && (isCurrent?.() ?? true);
    return { canMutate: canWrite, canSend: canWrite };
  };
  async function request(
    agentId: string,
    workspaceId: string,
    operation: AgentModelOperation,
    isCurrent?: () => boolean,
  ) {
    const requestId = crypto.randomUUID();
    const options = writeOptions(isCurrent);
    try {
      return await appStore.dispatch(
        agentModelMutationRequested(
          { requestId, consumerId, agentId, workspaceId, connection: context(), operation },
          {
            ...options,
            intent: markReasoningEffortIntent(agentId, workspaceId),
          },
        ),
      );
    } finally {
      appStore.dispatch(agentModelMutationConsumed(requestId, consumerId));
    }
  }
  return {
    async selectModel(agentId, model, workspaceId, providerId, isCurrent) {
      if (isLocked() || isCurrent?.() === false) return { status: 'cancelled' };
      return request(
        agentId,
        workspaceId,
        { kind: 'model', model, providerId, commit: true },
        isCurrent,
      );
    },
    setSessionModel(agentId, model, providerId) {
      if (isLocked()) return false;
      const session = appStore.state.agentSessions?.byAgentId[agentId];
      if (!session?.workspaceId) return false;
      void request(agentId, session.workspaceId, { kind: 'session', model, providerId });
      return true;
    },

    async setModel(agentId, model, workspaceId, providerId) {
      if (isLocked()) return SKIPPED_MUTATION;
      const result = await request(agentId, workspaceId, { kind: 'model', model, providerId });
      return result.modelResult ?? SKIPPED_MUTATION;
    },

    async reconcileEffort(agentId, workspaceId, currentEffort, supportedEfforts, isCurrent) {
      if (isLocked() || isCurrent?.() === false) return false;
      return reconcileAgentReasoningEffort(
        agentId,
        workspaceId,
        currentEffort,
        supportedEfforts,
        writeOptions(isCurrent),
      );
    },

    async applyEffort(agentId, workspaceId, effort, previousEffort) {
      if (isLocked()) return false;
      return applyReasoningEffort(agentId, workspaceId, effort, previousEffort, writeOptions());
    },
  };
}
