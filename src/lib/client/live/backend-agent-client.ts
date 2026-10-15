import type {
  AgentDelegatedCounts,
  AgentDelegatedParentCounts,
  AgentScopeCounts,
  AgentSession,
} from '$shared/types/agent-session';
import type { AgentListOptions, AgentListResult } from '../lifecycle-read-client-types';
import type { AgentModelResult } from '../../../store/renderer/slices/agent-model/agent-model-types';
import type { Unsubscribe } from '../client-types';
import type { BackendRuntime } from './backend-transport-runtime';
import {
  createDeltaSubscriptionRuntime,
  type DeltaSubscriptionStatus,
} from './delta-subscription-runtime';
import { createRunMutation, mutationErrorMessage } from './backend-mutation';
import { normalizeAgent } from './agent-normalization';

type AgentBackend = Pick<
  BackendRuntime,
  'backendRequest' | 'onBackendNotification' | 'onBackendReconnected'
>;

/**
 * `scopeCounts` (§5.5 row scope) is presence-detected: a daemon that supports
 * `scope` serves the full `{ topLevel, delegated, background }` triple on every
 * response; an older daemon omits it (and ignored the `scope` param). Only the
 * documented shape is accepted — a partial or non-numeric object reads as
 * absent rather than being healed into zeros.
 */
function readScopeCounts(value: unknown): AgentScopeCounts | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { topLevel, delegated, background } = value as Record<string, unknown>;
  if (
    typeof topLevel !== 'number' ||
    typeof delegated !== 'number' ||
    typeof background !== 'number'
  ) {
    return undefined;
  }
  return { topLevel, delegated, background };
}

/**
 * `delegatedCounts` (§5.5) is presence-detected the same way: a daemon that
 * serves it carries `{ running, byParent }` on every response, with `byParent`
 * always an object (possibly empty). Only the documented shape is accepted —
 * a missing `byParent`, a non-numeric `running`, or a malformed entry reads
 * as absent rather than being healed. `orphaned` is presence-detected inside
 * it: carried verbatim when the daemon serves the `{ total, running }` pair,
 * left absent (never defaulted) on a daemon predating it; a malformed
 * `orphaned` reads the whole field as absent like any other malformed entry.
 */
function readDelegatedCounts(value: unknown): AgentDelegatedCounts | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { running, byParent, orphaned } = value as Record<string, unknown>;
  if (typeof running !== 'number') return undefined;
  if (!byParent || typeof byParent !== 'object' || Array.isArray(byParent)) return undefined;
  const parents: Record<string, AgentDelegatedParentCounts> = {};
  for (const [parentAgentId, entry] of Object.entries(byParent as Record<string, unknown>)) {
    const parentCounts = readParentCounts(entry);
    if (!parentCounts) return undefined;
    parents[parentAgentId] = parentCounts;
  }
  if (orphaned === undefined) return { running, byParent: parents };
  const orphanedCounts = readParentCounts(orphaned);
  if (!orphanedCounts) return undefined;
  return { running, byParent: parents, orphaned: orphanedCounts };
}

function readParentCounts(entry: unknown): AgentDelegatedParentCounts | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const { total, running } = entry as Record<string, unknown>;
  if (typeof total !== 'number' || typeof running !== 'number') return undefined;
  return { total, running };
}

/** Shared wire implementation; callers supply their renderer's real transport. */
export function createBackendAgentClient(backend: AgentBackend) {
  const { backendRequest } = backend;
  const runMutation = createRunMutation(backendRequest);
  return {
    async list(workspaceId: string, options?: AgentListOptions): Promise<AgentSession[]> {
      const { agents } = await this.listWithMeta(workspaceId, options);
      return agents;
    },
    async listWithMeta(workspaceId: string, options?: AgentListOptions): Promise<AgentListResult> {
      // `retiredOnly` (§5.5 soft retire) rides the wire only when true —
      // the daemon treats absent and `false` identically, so the default read
      // carries no flags (retired rows excluded daemon-side) even for an
      // explicit `retiredOnly: false` caller. `scope` (§5.5 row scope) rides
      // only when it names a bin — `all` is the default read and stays off the
      // wire. `retiredCount` is served on every read variant; the FE assumes a
      // daemon that serves it and defaults to 0 only if the field is somehow
      // absent. `scopeCounts` is deliberately NOT defaulted: its absence is the
      // old-daemon signal the hydration saga branches on.
      const params: Record<string, unknown> = { workspaceId };
      if (options?.retiredOnly) params.retiredOnly = true;
      if (options?.scope && options.scope !== 'all') params.scope = options.scope;
      // `parentAgentId` narrows a delegated read to one parent's direct children
      // and rides only when supplied (the daemon rejects it on any other scope).
      if (options?.parentAgentId) params.parentAgentId = options.parentAgentId;
      // `orphanedOnly` narrows a delegated read to the orphaned rows and rides
      // only when true (the daemon rejects it on any other scope or with
      // `parentAgentId`; older daemons ignore it).
      if (options?.orphanedOnly) params.orphanedOnly = true;
      const result = await backendRequest<{
        agents?: unknown[];
        retiredCount?: number;
        scopeCounts?: unknown;
        delegatedCounts?: unknown;
      }>('agent.list', params);
      const agents = Array.isArray(result?.agents) ? result.agents : [];
      const scopeCounts = readScopeCounts(result?.scopeCounts);
      const delegatedCounts = readDelegatedCounts(result?.delegatedCounts);
      return {
        agents: agents.map((a) => normalizeAgent(a as Record<string, unknown>)),
        retiredCount: typeof result?.retiredCount === 'number' ? result.retiredCount : 0,
        ...(scopeCounts ? { scopeCounts } : {}),
        ...(delegatedCounts ? { delegatedCounts } : {}),
      };
    },
    async get(agentId: string, workspaceId?: string): Promise<AgentSession | null> {
      const result = await backendRequest<{ agent?: unknown } | unknown>('agent.get', {
        agentId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
      const raw =
        result && typeof result === 'object' && 'agent' in result
          ? (result as { agent?: unknown }).agent
          : result;
      if (!raw || typeof raw !== 'object') return null;
      return normalizeAgent(raw as Record<string, unknown>);
    },
    subscribeWorkspaces(
      subscribeIds: (handler: (ids: readonly string[]) => void) => Unsubscribe,
      handler: (snapshot: AgentSession[], readyWorkspaceIds?: readonly string[]) => void,
      options?: {
        onStatus?: (workspaceId: string, status: DeltaSubscriptionStatus) => void;
        subscribeRetry?: (listener: (workspaceId: string) => void) => Unsubscribe;
      },
    ): Unsubscribe {
      return createDeltaSubscriptionRuntime(
        {
          channel: {
            subscribeMethod: 'agent.subscribe',
            unsubscribeMethod: 'events.unsubscribe',
            dynamic: {
              subscribeIds,
              paramsForId: (workspaceId) => ({ workspaceId }),
              subscribeRetry: options?.subscribeRetry,
            },
          },
          getId: (raw) => String(raw.id ?? ''),
          normalize: normalizeAgent,
          handler,
          onStatus: options?.onStatus,
        },
        backend,
      );
    },
    async setModel(
      agentId: string,
      modelId: string,
      workspaceId: string,
      providerId?: string,
    ): Promise<AgentModelResult> {
      try {
        const data = await backendRequest<{ success: boolean; modelId?: string; error?: string }>(
          'agent.setModel',
          {
            agentId,
            modelId,
            workspaceId,
            ...(providerId ? { providerId } : {}),
          },
        );
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: mutationErrorMessage(error) };
      }
    },
    async setReasoningEffort(params: {
      agentId: string;
      workspaceId: string;
      reasoningEffort: string | null;
    }) {
      return runMutation('agent.update', {
        agentId: params.agentId,
        workspaceId: params.workspaceId,
        changes: { reasoningEffort: params.reasoningEffort },
      });
    },
  };
}
