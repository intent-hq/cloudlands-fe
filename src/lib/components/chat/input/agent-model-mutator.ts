/**
 * The single lock-checking funnel for every agent-session mutation the
 * ModelPicker issues: the session `model` field, `agent.setModel`, and the
 * two reasoning-effort writers.
 *
 * Every method re-reads `isLocked()` at its own call time — not at
 * construction and not at the caller's entry — and no-ops while locked. That
 * is what makes a caller's stale continuation safe: after any `await`, the
 * next mutation re-evaluates the live lock inside the mutator, so a role flip
 * mid-flight (owner → guest) cannot leak a write through a per-call-site
 * re-check that was forgotten. The reasoning-effort writers also receive the
 * live lock as `canMutate`, so their own post-await failure rollback re-reads
 * it too. ModelPicker must reach these APIs only through this module
 * (lint-enforced).
 */
import { agentClient } from '$features/agent/agent.client';
import {
  applyReasoningEffort,
  reconcileAgentReasoningEffort,
} from '$features/agent/reasoning-effort';
import { getAgentProvider } from '$shared/types/agent-session';
import {
  selectEffectiveDefaultProviderId,
  selectNormalizedProviderId,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { store as appStore } from '$store/renderer/store';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';

export type AgentModelMutatorOptions = {
  /** Live lock predicate, evaluated on every mutator call. */
  isLocked: () => boolean;
};

/** Returned in place of the RPC result when the lock skipped the call. */
export type SkippedMutation = { readonly skipped: true };

export const SKIPPED_MUTATION: SkippedMutation = Object.freeze({ skipped: true });

type SetModelResult = Awaited<ReturnType<typeof agentClient.setModel>>;

export type AgentModelMutator = {
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

export function createAgentModelMutator({ isLocked }: AgentModelMutatorOptions): AgentModelMutator {
  const context = () => selectPrincipalConnectionContext.select(appStore.state);
  const writeOptions = (isCurrent?: () => boolean) => {
    const started = context();
    const canWrite = () => !isLocked() && context() === started && (isCurrent?.() ?? true);
    return { canMutate: canWrite, canSend: canWrite };
  };
  return {
    setSessionModel(agentId, model, providerId) {
      if (isLocked()) return false;
      const session = appStore.state.agentSessions?.byAgentId[agentId];
      const previousProvider = session
        ? getAgentProvider(session, selectEffectiveDefaultProviderId.select(appStore.state))
        : undefined;
      appStore.dispatch(
        updateSession(agentId, {
          model,
          ...(providerId
            ? {
                provider: providerId,
                metadata: { ...session?.metadata, provider: providerId },
                // A provider's session-discovered effort vocabulary cannot follow
                // the session to a different provider.
                ...(selectNormalizedProviderId.select(appStore.state, previousProvider ?? '') !==
                providerId
                  ? { effortLevels: undefined }
                  : {}),
              }
            : {}),
        }),
      );
      return true;
    },

    async setModel(agentId, model, workspaceId, providerId) {
      if (isLocked()) return SKIPPED_MUTATION;
      const options = writeOptions();
      const result = await agentClient.setModel(agentId, model, workspaceId, providerId);
      return options.canMutate() ? result : SKIPPED_MUTATION;
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
