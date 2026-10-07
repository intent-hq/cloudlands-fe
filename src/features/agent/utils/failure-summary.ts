import type { AgentMessage, AgentSession, QueuedMessage } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import { isAgentRunningState } from '$shared/utils/agent-runtime-state';
import { getAttentionNotice, timestampIdentity } from '$lib/components/chat/attention-notice';

export interface FailureRecord {
  messageId: string;
  reason: string;
  timestamp: AgentMessage['timestamp'];
}

interface FailureHistoryRun {
  key: string;
  anchorMessageId: string;
  /** Adjacency is a layout convenience, never proof of the same request. */
  correlation: 'unavailable';
  records: FailureRecord[];
  /** Notices are best-effort and streak-deduplicated by the daemon: not total attempts. */
  recordedFailureCount: number;
}

interface QueueRecoveryGroup {
  key: string;
  correlation: 'turn' | 'queue-entry';
  turnId?: string;
  queueIds: string[];
  state: 'queued';
}

export interface FailureSummaryInput {
  agentId: string;
  breakBeforeMessageIds?: ReadonlySet<string>;
  /** Canonically ordered transcript; may be a partially hydrated window. */
  messages: readonly AgentMessage[];
  session?: { id: string } & Partial<
    Pick<
      AgentSession,
      | 'status'
      | 'stopReason'
      | 'stopReasonTimestamp'
      | 'turnInFlight'
      | 'isResponding'
      | 'isStreaming'
      | 'isProcessing'
    >
  >;
  /** Caller must select transient errors and confirmed queue from the same agent/workspace. */
  transientError?: string | null;
  queue: readonly QueuedMessage[];
}

/**
 * Pure display projection. Does not schedule retries, grant permissions, or change messages.
 * Persisted notices have no turn/submission ID. Keep history in place and separate from
 * current recovery: never infer request identity from text, proximity, or a nearby user row.
 */
export function deriveFailureSummary(input: FailureSummaryInput) {
  const history: FailureHistoryRun[] = [];
  const seen = new Set<string>();
  let previous: AgentMessage | undefined;
  let run: FailureHistoryRun | undefined;
  for (const message of input.messages) {
    if (message.agentId && message.agentId !== input.agentId) {
      previous = undefined;
      run = undefined;
      continue;
    }
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    if (input.breakBeforeMessageIds?.has(message.id)) {
      previous = undefined;
      run = undefined;
    }
    const notice = getAttentionNotice(message);
    if (notice?.kind !== 'turn-failure') {
      run = undefined;
    } else {
      // Missing rows may contain a request or partial work. Never bridge their gap.
      const contiguous =
        previous?.seq !== undefined &&
        message.seq !== undefined &&
        Number.isSafeInteger(previous.seq) &&
        Number.isSafeInteger(message.seq) &&
        message.seq === previous.seq + 1;
      if (!run || !contiguous) {
        run = {
          key: JSON.stringify([input.agentId, 'notice', message.id]),
          anchorMessageId: message.id,
          correlation: 'unavailable',
          records: [],
          recordedFailureCount: 0,
        };
        history.push(run);
      }
      run.records.push({
        messageId: message.id,
        reason: notice.reason,
        timestamp: message.timestamp,
      });
      run.recordedFailureCount += 1;
    }
    previous = message;
  }

  const queueGroups = new Map<string, QueueRecoveryGroup>();
  for (const message of input.queue) {
    if (!message.requeuedAfterFailure) continue;
    const turnId = message.turnId || undefined;
    const key = JSON.stringify([input.agentId, turnId ? 'turn' : 'queue', turnId ?? message.id]);
    let group = queueGroups.get(key);
    if (!group) {
      group = {
        key,
        correlation: turnId ? 'turn' : 'queue-entry',
        turnId,
        queueIds: [],
        state: 'queued',
      };
      queueGroups.set(key, group);
    }
    if (!group.queueIds.includes(message.id)) group.queueIds.push(message.id);
  }
  const queueRecovery = [...queueGroups.values()];
  const session = input.session?.id === input.agentId ? input.session : undefined;
  const sessionFailed = session?.status === AgentStatus.Error;
  const error = input.transientError || (sessionFailed ? session.stopReason || null : null);
  const needsFallbackReason = sessionFailed && !error;
  const timestamp =
    sessionFailed && (!input.transientError || input.transientError === session.stopReason)
      ? session.stopReasonTimestamp
      : undefined;
  const identity = timestamp ? timestampIdentity(timestamp) : null;
  const matching =
    identity && error && error === session?.stopReason
      ? history
          .flatMap((entry) => entry.records)
          .filter(
            (record) => record.reason === error && timestampIdentity(record.timestamp) === identity,
          )
      : [];
  // A single exact saved timestamp + reason is evidence of the same terminal event.
  // A transient error alone has no timestamp; text alone must never suppress history.
  const noticeId = matching.length === 1 ? matching[0].messageId : undefined;
  const attempting = session ? isAgentRunningState(session) : false;
  const state: 'attempting' | 'queued' | 'action-needed' | 'inactive' = attempting
    ? 'attempting'
    : queueRecovery.length
      ? 'queued'
      : error || needsFallbackReason
        ? 'action-needed'
        : 'inactive';

  return {
    history,
    queueRecovery,
    current: { state, error, needsFallbackReason, timestamp, noticeId },
  };
}
