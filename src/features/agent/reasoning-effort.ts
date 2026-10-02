/**
 * Session-level reasoning-effort writer for the chat-input effort control.
 *
 * Keeps the versioned wire mutation out of the component: a daemon whose
 * `agent.update` accepts the first-class `reasoningEffort` field gets that,
 * while older daemons use their cataloged `{model}/{effort}` variants through
 * `agent.setModel`. A rejection reverts the optimistic field and surfaces a
 * toast.
 */
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { agentClient } from './agent.client';
import { buildLegacyReasoningEffortModelId } from './utils/legacy-reasoning-effort';
import { supportsReasoningEffortProtocol } from './utils/reasoning-effort-protocol';
import { store as appStore } from '$store/renderer/store';
import { selectAgentProvider } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentModelEffortLevels } from '$store/renderer/slices/model/model-selectors';
import { reconcileReasoningEffort } from './utils/reconcile-reasoning-effort';

const logger = createLogger('ReasoningEffort');

export type ReasoningEffortWriteOptions = {
  /** Distinguish local control changes from encoder writes and daemon echoes. */
  source?: 'control' | 'encoder';
  /** An encoder can reserve ownership before coalescing its outgoing write. */
  intent?: number;
  /** Recheck device/selection ownership before a queued request reaches the wire. */
  canSend?: () => boolean;
  /** Report the accepted baseline after preceding writes have settled. */
  onConfirmedEffort?: (effort: string | null) => void;
  /** Reconcile an issued success after teardown without reviving input or feedback. */
  canReconcileAccepted?: () => boolean;
  /**
   * Re-read after the awaited RPC settles, before the failure rollback and
   * toast: when it returns `false` the caller has lost the right to mutate
   * the session (a guest lock flipped mid-flight) and the rollback is skipped.
   * The optimistic write at entry is the caller's to guard.
   */
  canMutate?: () => boolean;
};

type EffortWriteQueue = {
  confirmed: string | null;
  confirmedIntent: number;
  identity: string;
  latestIntent: number;
  pending: number;
  active: { intent: number; issued: boolean; canSend?: () => boolean }[];
  tail?: Promise<void>;
};

// Like settings-bag writes, this coordinates callers within one renderer. Each
// agent has its own queue; entries disappear when all of its writes settle.
const writeQueues = new Map<string, EffortWriteQueue>();
let nextIntent = 0;

/** Mark a local choice immediately, even while its RPC is still coalescing. */
export function markReasoningEffortIntent(agentId: string, workspaceId: string): number {
  const intent = ++nextIntent;
  const queue = writeQueues.get(JSON.stringify([workspaceId, agentId]));
  if (queue) queue.latestIntent = intent;
  return intent;
}

/** Discard unsent choices; issued writes can still settle their accepted value. */
export function releaseReasoningEffortIntent(
  agentId: string,
  workspaceId: string,
  intent: number,
): void {
  const queue = writeQueues.get(JSON.stringify([workspaceId, agentId]));
  if (!queue || queue.latestIntent !== intent) return;
  queue.latestIntent = Math.max(
    queue.confirmedIntent,
    ...queue.active
      .filter((write) => write.issued || (write.intent !== intent && write.canSend?.() !== false))
      .map((write) => write.intent),
  );
}

function effortModelIdentity(agentId: string): string {
  const session = appStore.state?.agentSessions?.byAgentId?.[agentId];
  const levels = selectAgentModelEffortLevels.select(appStore.state, agentId);
  const protocol = appStore.state?.daemonHealth?.stats?.protocolVersion;
  const model =
    protocol && !supportsReasoningEffortProtocol(protocol)
      ? buildLegacyReasoningEffortModelId(session?.model, null, levels)
      : session?.model;
  return JSON.stringify([model, selectAgentProvider.select(appStore.state, agentId)]);
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
  const key = JSON.stringify([workspaceId, agentId]);
  const identity = effortModelIdentity(agentId);
  let queue = writeQueues.get(key);
  if (!queue) {
    queue = {
      confirmed: previousEffort,
      confirmedIntent: 0,
      identity,
      latestIntent: 0,
      pending: 0,
      active: [],
    };
    writeQueues.set(key, queue);
  } else if (queue.identity !== identity) {
    queue.identity = identity;
    queue.confirmed = previousEffort;
  }
  const writes = queue;
  const intent = options?.intent ?? markReasoningEffortIntent(agentId, workspaceId);
  writes.latestIntent = Math.max(writes.latestIntent, intent);
  writes.pending++;
  const active = { intent, issued: false, canSend: options?.canSend };
  writes.active.push(active);
  const preceding = writes.tail;
  appStore.dispatch(
    updateSession(
      agentId,
      { reasoningEffort: effort },
      { reasoningEffortSource: options?.source ?? 'control' },
    ),
  );

  const sameModel = () => effortModelIdentity(agentId) === identity;
  const ownsIntent = () =>
    writes.latestIntent === intent && sameModel() && (options?.canMutate?.() ?? true);
  const run = async () => {
    try {
      if (preceding) await preceding;
      options?.onConfirmedEffort?.(writes.confirmed);
      if (!sameModel() || options?.canSend?.() === false) {
        releaseReasoningEffortIntent(agentId, workspaceId, intent);
        return false;
      }
      if (options?.source === 'encoder' && writes.confirmed === effort) return true;

      const session = appStore.state?.agentSessions?.byAgentId?.[agentId];
      const providerId = selectAgentProvider.select(appStore.state, agentId);
      const effortLevels = selectAgentModelEffortLevels.select(appStore.state, agentId);
      const protocolVersion = appStore.state?.daemonHealth?.stats?.protocolVersion;
      let result: { success: boolean; error?: string };

      if (protocolVersion && !supportsReasoningEffortProtocol(protocolVersion)) {
        const legacyModelId = buildLegacyReasoningEffortModelId(
          session?.model,
          effort,
          effortLevels,
        );
        if (!legacyModelId) {
          result = { success: false, error: m.chat_effortPicker_updateFailed_error() };
        } else {
          active.issued = true;
          const legacyResult = await agentClient.setModel(
            agentId,
            legacyModelId,
            workspaceId,
            providerId,
          );
          result = legacyResult.ok
            ? { success: legacyResult.data.success, error: legacyResult.data.error }
            : { success: false, error: legacyResult.error };
        }
      } else {
        active.issued = true;
        result = await appClient.agents.setReasoningEffort({
          agentId,
          workspaceId,
          reasoningEffort: effort,
        });
      }

      if (result.success && writes.identity === identity) {
        writes.confirmed = effort;
        writes.confirmedIntent = intent;
      }
      options?.onConfirmedEffort?.(writes.confirmed);
      if (result.success) {
        if (writes.latestIntent === intent && sameModel() && options?.canReconcileAccepted?.()) {
          appStore.dispatch(updateSession(agentId, { reasoningEffort: effort }));
        }
        return true;
      }

      logger.error('Failed to set reasoning effort', { agentId, error: result.error });
      if (!ownsIntent()) return false;
      // The caller's previous field may have been an unsent encoder choice.
      // Roll back only our current intent, to the queue's accepted baseline.
      const current = appStore.state?.agentSessions?.byAgentId?.[agentId]?.reasoningEffort ?? null;
      if (current === effort) {
        appStore.dispatch(updateSession(agentId, { reasoningEffort: writes.confirmed }));
      }
      const { notify } = await import('$lib/components/patterns/notify');
      if (ownsIntent()) notify.error(result.error ?? m.chat_effortPicker_updateFailed_error());
      return false;
    } finally {
      writes.active.splice(writes.active.indexOf(active), 1);
      writes.pending--;
      if (writes.pending === 0 && writeQueues.get(key) === writes) writeQueues.delete(key);
    }
  };
  const write = run();
  writes.tail = write.then(
    () => {},
    () => {},
  );
  return write;
}

/** Reconcile and persist a session effort after its model changes. */
export async function reconcileAgentReasoningEffort(
  agentId: string,
  workspaceId: string,
  currentEffort: string | null | undefined,
  supportedEfforts: readonly string[] | null | undefined,
  options?: ReasoningEffortWriteOptions,
): Promise<boolean> {
  const previousEffort = currentEffort ?? null;
  const nextEffort = reconcileReasoningEffort(previousEffort, supportedEfforts);

  if (nextEffort === previousEffort) return true;
  return applyReasoningEffort(agentId, workspaceId, nextEffort, previousEffort, options);
}
