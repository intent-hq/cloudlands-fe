import type { SubmissionCorrelation } from '$shared/types/agent-message';
import type { QueuedMessage } from '$shared/types/agent-session';

/** Disposer returned by every `subscribe()` call. */
export type Unsubscribe = () => void;

/** Reactive subscription callback invoked with the latest snapshot. */
export type SubscriptionHandler<T> = (snapshot: T) => void;

/** Uniform result for mutation methods. */
export interface MutationResult extends SubmissionCorrelation {
  success: boolean;
  error?: string;
  /** Current-index commits retain uncertainty until explicit inspection; never replay them. */
  commitOutcome?: { state: 'confirmed'; hash: string; files: string[] } | { state: 'unknown' };
  /**
   * Canonical id of the entity the mutation created/affected, surfaced when the
   * daemon returns one (e.g. `task.createPrerequisite` returns a WorkspaceTask
   * per Rev 2 §7.9). Additive and optional: call sites that ignore it are
   * unaffected, so it stays backward-compatible across all domains.
   */
  id?: string;
  /**
   * Authoritative note revision echoed by the daemon after a mutation that
   * rewrites a note's content (e.g. `comment.add`'s anchor insertion, #638).
   * When present, callers MUST prefer it over inferring `rev + 1` locally.
   * Additive and optional: older daemons omit it and callers fall back to the
   * inference, so merge order across FE/BE does not matter.
   */
  noteRev?: number;
  /**
   * Authoritative post-write note content echoed by `note.setContent`
   * (`newContent`). The daemon merges a full-content write against concurrent
   * edits, so the persisted text can differ from what the caller sent; when
   * present, callers MUST apply it as the local content. Additive and optional.
   */
  newContent?: string;
  /**
   * Optimistic-concurrency conflict outcome (§11.4-D): present ONLY when the
   * daemon rejected the mutation with the conflict error (numeric `-32005` AND
   * `data.code === "conflict"`). Carries the authoritative server entity
   * (`data.current`, including its advanced `rev`) so the caller can
   * reload-to-latest. Additive: success and non-conflict error paths never set
   * it, so existing call sites are unaffected. The live clients normalize
   * `current` into the domain entity (`Note` / `WorkspaceTask`) before returning.
   */
  conflict?: { current: unknown };
  /**
   * Queued-message surface returned by `agents.queue` (`agent.queueMessage`,
   * §5.5). Surfaced on the uniform mutation result so the queue-on-send caller
   * can seed the local `agent-queue` slice from the server snapshot without an
   * extra `agent.getQueue` round-trip. Additive and optional: other mutation
   * paths never set it.
   */
  queuedMessage?: QueuedMessage;
  /** sendQueuedMessageNow may restore the entry instead of delivering it (§5.5). */
  queued?: boolean;
  quarantined?: boolean;
  /** IDs acknowledged by an explicit queued batch send. */
  messageIds?: string[];
  /**
   * Turn-correlation id (PROTOCOL §5.5/§6.6, monorepo#1022) surfaced when the
   * daemon returns one by the seam mutations that extract it: `queueMessage`
   * (top-level result `turnId`, falling back to the echoed
   * `queuedMessage.turnId`) and `sendQueuedMessageNow` (top-level field of
   * the delivered arm ONLY — no `queuedMessage` fallback, a slot-race restore
   * is not a delivery). `agent.retry` surfaces the same id on its own
   * `{ ok, redriven?, turnId? }` result, and the chat send flow bypasses the
   * `send()` seam, so `sendMessage` does not set it. Callers key retry
   * records by it for exact lifecycle-event attribution (monorepo#1057).
   * Additive and optional: older daemons omit it and other mutation paths
   * never set it.
   */
  turnId?: string;
}
