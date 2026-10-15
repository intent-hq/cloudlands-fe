import type { QueuedMessage } from '$shared/types';
import type { WorkspaceEvent } from './types';
import type { StoreAction } from '@themislib/themis/types';
import { replaceAgentQueue } from '../../store/renderer/slices/agent-queue/agent-queue-slice';
import { chatQueueProcessingReceived } from '../../store/renderer/slices/chat-state/chat-state-slice';
import type { createSubmissionEvidence } from '../agent/submission-evidence-factory';

/** Both renderers consume the daemon queue through the same event policy. */
export function createDaemonQueueEvents({
  dispatch,
  getSessionWorkspace,
  isAgentReadWorkspaceCurrent,
  observeSubmissionEvidence,
  noteAgentQueueEventSnapshotApplied,
}: {
  dispatch(action: StoreAction<unknown>): unknown;
  getSessionWorkspace(agentId: string): string | undefined;
  isAgentReadWorkspaceCurrent(agentId: string, workspaceId?: string): boolean;
  observeSubmissionEvidence: ReturnType<
    typeof createSubmissionEvidence
  >['observeSubmissionEvidence'];
  noteAgentQueueEventSnapshotApplied(agentId: string, workspaceId?: string): void;
}) {
  /**
   * `agent:queue:updated` (§5.5 / §6.5) carries the **current** queue snapshot
   * `{ agentId, queue: QueuedMessage[] }` — self-sufficient per the §6.7
   * event-design rule — so the renderer mirrors the BE queue directly without a
   * follow-up `agent.getQueue`. The reducer's recently-removed-id tombstone
   * suppresses messages the user just deleted but the BE has not yet self-drained
   * out of the snapshot, preventing flicker. The chat-state reducer also syncs
   * still-present entries' daemon-authoritative content into their parked retry
   * records (#1011); retry-record promotion rides `agent:queue:processing`
   * instead (monorepo#1057).
   */
  function handleQueueUpdatedEvent(event: WorkspaceEvent): void {
    const data = (event as { data?: Record<string, unknown> }).data;
    if (!data) return;
    const agentId = data.agentId;
    const queue = data.queue;
    if (typeof agentId !== 'string' || !Array.isArray(queue)) return;
    const ownerWorkspace = getSessionWorkspace(agentId);
    if (event.workspaceId && ownerWorkspace && event.workspaceId !== ownerWorkspace) return;
    if (!isAgentReadWorkspaceCurrent(agentId, event.workspaceId)) return;
    observeSubmissionEvidence(agentId, event.workspaceId, 'queue', queue as QueuedMessage[]);
    dispatch(replaceAgentQueue(agentId, queue as QueuedMessage[], event.workspaceId));
    // Mark the snapshot so an in-flight hydrate fetch that started before this
    // event discards its (now stale) response instead of overwriting it.
    noteAgentQueueEventSnapshotApplied(agentId, event.workspaceId);
  }

  /**
   * Processing identifies the admitted provider turn, including persisted redrives
   * that skip a user-message echo. Optional queuedMessages contains every consumed
   * entry in order, with each entry's own identity and complete retry payload.
   * Queue snapshots and enqueue acknowledgements cannot override that authority.
   * Legacy events without the array retain turn-based best-effort promotion.
   */
  function handleQueueProcessingEvent(event: WorkspaceEvent): void {
    const data = (event as { data?: Record<string, unknown> }).data;
    if (!data) return;
    const agentId = data.agentId;
    if (typeof agentId !== 'string' || typeof data.messageId !== 'string') return;
    const ownerWorkspace = getSessionWorkspace(agentId);
    if (event.workspaceId && ownerWorkspace && event.workspaceId !== ownerWorkspace) return;
    if (!isAgentReadWorkspaceCurrent(agentId, event.workspaceId)) return;
    const turnId = typeof data.turnId === 'string' ? data.turnId : undefined;
    const rows = data.queuedMessages;
    if (rows !== undefined) {
      // Reject malformed authority instead of upgrading a partial payload to truth.
      if (
        !Array.isArray(rows) ||
        !rows.length ||
        typeof turnId !== 'string' ||
        rows.some(
          (row) =>
            !row ||
            typeof row !== 'object' ||
            typeof row.id !== 'string' ||
            typeof row.turnId !== 'string' ||
            typeof row.content !== 'string' ||
            typeof row.queuedAt !== 'string' ||
            typeof row.position !== 'number',
        ) ||
        rows[0].id !== data.messageId ||
        new Set(rows.map((row) => row.id)).size !== rows.length
      )
        return;
      observeSubmissionEvidence(agentId, event.workspaceId, 'processing', rows as QueuedMessage[]);
      dispatch(chatQueueProcessingReceived(agentId, turnId, rows as QueuedMessage[]));
    } else dispatch(chatQueueProcessingReceived(agentId, turnId));
  }

  return { handleQueueUpdatedEvent, handleQueueProcessingEvent };
}
