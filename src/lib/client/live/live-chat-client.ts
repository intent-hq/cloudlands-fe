/**
 * Live chat domain backed by the intentd daemon (PROTOCOL §7.1).
 *
 * `subscribe` is the STANDING `chat.subscribe` channel: it keeps the
 * registration open and reduces the block-granularity delta stream onto the
 * seq-0 message page (PROTOCOL §7.1). The seq-0 snapshot is the daemon's
 * newest `agent.getConversation` page merged with the in-flight assistant
 * message when a turn is streaming (CS-0 D5) — the emit it produces carries
 * `fromSnapshot: true` so consumers can hydrate from it directly (no
 * throwaway one-shot subscription, no follow-up conversation fetch). Each
 * delta entity carries `{ agentId, messageId, role, block }` plus
 * `messageSeq`/`timestamp`/`streamingComplete` on the terminal frame; the
 * block is the FULL current block, upserted by its stable
 * `{messageId}:{blockIndex}` id into the owning message (created on first
 * appearance). The registration opts into `deltaEncoding: "incremental"`
 * (§7.1, monorepo#2675): live `text`/`thinking` chunk deltas then carry only
 * the new fragment as `textDelta`, which the reducer APPENDS to the block's
 * text (an `added` fragment creates the block — an append onto the empty
 * string) — enabled strictly by the snapshot's `deltaEncoding: "incremental"`
 * echo, so an older daemon that ignores the param reduces full-text as
 * before. Tool blocks, row deltas, and the terminal reconcile stay full
 * blocks in both modes. `removedIds` are block ids the persisted message does
 * not contain (orphan self-heal). Sequence gaps trigger resnapshot (unsubscribe
 * + fresh `chat.subscribe`); a transport reconnect re-registers against the
 * daemon's rebuilt registry; a rejected registration or a missing seq-0
 * snapshot self-heals via a delayed re-registration with exponential backoff
 * (intent-hq/monorepo#1394) — no reconnect required; pushes that race the
 * subscribe reply are buffered pre-ack and replayed. The §6.9 invariant: the
 * seq-0 snapshot reduced with every delta — honoring `removedIds` — equals a
 * fresh `agent.getConversation` snapshot.
 */
import {
  isPlanContentBlock,
  migrateFromLegacy,
  type AgentMessage,
  type ContentBlock,
} from '$shared/types';
import type {
  ChatClient,
  ChatLiveStreamPhase,
  ChatSubscribeOptions,
  ChatTranscript,
  Unsubscribe,
} from '../app-client';
import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';
import {
  reportStreamLifecycle,
  streamTurnCorrelation,
  type StreamLifecycleDiagnostic,
} from '$lib/utils/stream-lifecycle-telemetry';

/** Shape of a `chat.subscribe` seq-0 snapshot per PROTOCOL §7.1. */
interface ChatSnapshotPayload {
  agentId?: string;
  messages?: unknown[];
  truncated?: boolean;
  totalMessages?: number;
  /** §7.1 activity-flag overlay (same fields as the `AgentLite` projection). */
  isResponding?: boolean;
  turnInFlight?: boolean;
  /**
   * Resume disposition (§7.1): present ONLY when the registration carried
   * `sinceMessageId` — `true` when `messages` is the post-anchor delta,
   * `false` when the daemon fell back to the standard newest page (unknown/
   * pruned anchor). Absent on non-resume snapshots.
   */
  resumed?: boolean;
  /**
   * Incremental-encoding echo (§7.1, monorepo#2675): `"incremental"` on every
   * snapshot an incremental subscription emits (seq-0 AND lag recovery) — the
   * only value the daemon ever stamps (full mode stamps nothing). Absent in
   * full mode and from older daemons that ignore the request param — the
   * echo, not the request, decides the reducer.
   */
  deltaEncoding?: 'incremental';
}

/** Decoded seq-0 snapshot page (mirrors `agent.getConversation` shape). */
interface ChatSnapshotResult {
  messages: AgentMessage[];
  truncated: boolean;
  totalMessages: number;
}

const EMPTY_SNAPSHOT: ChatSnapshotResult = { messages: [], truncated: false, totalMessages: 0 };

/**
 * Wall-clock ceiling for the seq-0 push after `chat.subscribe` resolves.
 * Exported so the chat-read saga's bounded hydration wait can be derived
 * from it (it must stay strictly larger than one self-heal cycle).
 */
export const SNAPSHOT_TIMEOUT_MS = 5_000;

/**
 * Initial delay before a self-heal re-registration of the standing
 * subscription (rejected `chat.subscribe` or seq-0 snapshot timeout). Each
 * consecutive failure doubles the delay up to `MAX_RETRY_DELAY_MS`; the
 * backoff resets once a snapshot hydrates the transcript (and on transport
 * reconnect). Exported for the same derivation as `SNAPSHOT_TIMEOUT_MS`.
 */
export const INITIAL_RETRY_DELAY_MS = 1_000;

/** Ceiling for the self-heal retry backoff. */
const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Bound for the standing subscription's pre-ack push buffer: pushes whose
 * subscriptionId matches no known registration are held (instead of dropped)
 * and replayed when the subscribe reply resolves — the same buffering
 * delta-subscription.ts uses.
 */
const MAX_BUFFERED_PUSHES = 32;

const SNAPSHOT_MESSAGE_ROLES = new Set(['user', 'assistant', 'tool', 'system', 'error']);

const STRICT_SNAPSHOT_BLOCK_TYPES = new Set([
  'text',
  'code',
  'tool_use',
  'tool_result',
  'thinking',
  'image',
  'audio',
  'file',
  'nav-link',
  'proposal',
  'plan',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize one snapshot block without allowing one bad sibling to erase the
 * rest of the message. Canonical and supported structural legacy blocks use
 * the shared strict migration boundary. A malformed known block is dropped;
 * an object with an unknown non-plan type is retained so newer block kinds
 * keep the protocol's forward-compatible ignore behavior.
 */
function normalizeSnapshotBlock(raw: unknown): ContentBlock | null {
  if (!isRecord(raw)) return null;
  try {
    return migrateFromLegacy(raw);
  } catch {
    if (
      typeof raw.type !== 'string' ||
      raw.type.length === 0 ||
      STRICT_SNAPSHOT_BLOCK_TYPES.has(raw.type)
    ) {
      return null;
    }
    return { ...raw } as unknown as ContentBlock;
  }
}

/**
 * Snapshot message envelope policy:
 * - id, role, and timestamp are required by the persisted-message contract;
 * - agentId may be inherited from the agent-scoped snapshot/subscription;
 * - seq may be omitted, but a present value must be a non-negative safe integer.
 * Missing sequence is never inferred from array position.
 */
function normalizeSnapshotMessage(raw: unknown, snapshotAgentId?: string): AgentMessage | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    raw.id.length === 0 ||
    typeof raw.role !== 'string' ||
    !SNAPSHOT_MESSAGE_ROLES.has(raw.role) ||
    typeof raw.timestamp !== 'string' ||
    raw.timestamp.length === 0
  ) {
    return null;
  }

  const messageAgentId = raw.agentId === undefined ? snapshotAgentId : raw.agentId;
  if (
    (messageAgentId !== undefined &&
      (typeof messageAgentId !== 'string' || messageAgentId.length === 0)) ||
    (snapshotAgentId !== undefined &&
      messageAgentId !== undefined &&
      messageAgentId !== snapshotAgentId) ||
    (raw.seq !== undefined &&
      (typeof raw.seq !== 'number' || !Number.isSafeInteger(raw.seq) || raw.seq < 0))
  ) {
    return null;
  }

  const contentBlocks = Array.isArray(raw.contentBlocks)
    ? raw.contentBlocks
        .map(normalizeSnapshotBlock)
        .filter((block): block is ContentBlock => block !== null)
    : [];
  return {
    ...raw,
    ...(messageAgentId === undefined ? {} : { agentId: messageAgentId }),
    contentBlocks,
  } as unknown as AgentMessage;
}

function extractSnapshot(raw: unknown, expectedAgentId?: string): ChatSnapshotResult {
  if (!isRecord(raw)) return EMPTY_SNAPSHOT;
  const snapshotAgentId = raw.agentId === undefined ? expectedAgentId : raw.agentId;
  const validSnapshotAgent =
    snapshotAgentId === undefined ||
    (typeof snapshotAgentId === 'string' &&
      snapshotAgentId.length > 0 &&
      (expectedAgentId === undefined || snapshotAgentId === expectedAgentId));
  const messages = Array.isArray(raw.messages)
    ? validSnapshotAgent
      ? raw.messages
          .map((message) => normalizeSnapshotMessage(message, snapshotAgentId))
          .filter((message): message is AgentMessage => message !== null)
      : []
    : [];
  return {
    messages,
    truncated: Boolean(raw.truncated),
    totalMessages: typeof raw.totalMessages === 'number' ? raw.totalMessages : 0,
  };
}

/**
 * The §7.1 resume disposition carried on a resume-requesting registration's
 * seq-0 snapshot, or `undefined` when the snapshot does not carry one (the
 * registration sent no `sinceMessageId`).
 */
function extractResumedFlag(raw: unknown): boolean | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const resumed = (raw as ChatSnapshotPayload).resumed;
  return typeof resumed === 'boolean' ? resumed : undefined;
}

/** Block-granularity delta of a `chat.subscribe` push (PROTOCOL §7.1). */
interface ChatDeltaPayload {
  added: unknown[];
  updated: unknown[];
  removedIds: string[];
}

/** Parsed `subscription.push` envelope for the chat channel (snapshot OR delta). */
interface ChatPush {
  subscriptionId: string;
  kind: 'snapshot' | 'delta';
  seq: number;
  snapshot?: unknown;
  delta?: ChatDeltaPayload;
}

/**
 * Parse a daemon notification into a `ChatPush`, or `null` if it isn't one.
 * Unlike `parseSubscriptionPush` (delta-subscription.ts, collection channels)
 * the chat snapshot is an OBJECT (`{ agentId, messages, ... }`), so `snapshot`
 * rides through unshaped here and `extractSnapshot` decodes it.
 */
function parseChatPush(method: string, params: unknown): ChatPush | null {
  if (method !== 'subscription.push' || !params || typeof params !== 'object') return null;
  const p = params as Record<string, unknown>;
  const subscriptionId = typeof p.subscriptionId === 'string' ? p.subscriptionId : null;
  const seq = typeof p.seq === 'number' ? p.seq : null;
  if (!subscriptionId || seq === null) return null;
  if (p.kind === 'snapshot') {
    return { subscriptionId, kind: 'snapshot', seq, snapshot: p.snapshot };
  }
  if (p.kind === 'delta') {
    const raw = (p.delta && typeof p.delta === 'object' ? p.delta : {}) as Record<string, unknown>;
    return {
      subscriptionId,
      kind: 'delta',
      seq,
      delta: {
        added: Array.isArray(raw.added) ? raw.added : [],
        updated: Array.isArray(raw.updated) ? raw.updated : [],
        removedIds: Array.isArray(raw.removedIds) ? raw.removedIds.map((id) => String(id)) : [],
      },
    };
  }
  return null;
}

/** Assistant message id carried by this content push, never returned raw to diagnostics. */
function pushTurnCorrelation(push: ChatPush): string | undefined {
  if (push.kind === 'snapshot') {
    const messages = extractSnapshot(push.snapshot).messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === 'assistant') return streamTurnCorrelation(message.id);
    }
    return undefined;
  }
  const entities = [...(push.delta?.updated ?? []), ...(push.delta?.added ?? [])];
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = parseDeltaEntity(entities[index]);
    if (entity && (entity.role === undefined || entity.role === 'assistant')) {
      return streamTurnCorrelation(entity.messageId);
    }
  }
  return undefined;
}

/**
 * One delta entity: the message pointer plus the current block (§7.1) — the
 * FULL block, except on an incremental subscription where a live `text`/
 * `thinking` chunk block carries only the new fragment as `textDelta`
 * (`{ type, id, textDelta }`, monorepo#2675).
 */
interface ChatDeltaEntity {
  messageId: string;
  role?: string;
  block: ContentBlock & { id?: string; textDelta?: string };
  messageSeq?: number;
  timestamp?: string;
  streamingComplete?: boolean;
  /**
   * Persisted row metadata lifted onto non-assistant row deltas (§7.1) — e.g.
   * the `agent_message` sender attribution the chip renders live.
   */
  metadata?: AgentMessage['metadata'];
  /**
   * The client-minted logical id lifted onto user-row deltas (§7.1,
   * intentd#781) — present only when the persisted row carries a
   * `userAppMessageId` (§5.5); older daemons omit it entirely. Stamped onto
   * the materialized message so optimistic-insert dedup matches by exact
   * appMessageId on the delta path.
   */
  appMessageId?: string;
}

function parseDeltaEntity(raw: unknown): ChatDeltaEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const messageId = typeof e.messageId === 'string' ? e.messageId : null;
  const block =
    e.block && typeof e.block === 'object' ? (e.block as ChatDeltaEntity['block']) : null;
  if (!messageId || !block || typeof block.id !== 'string') return null;
  if (block.type === 'plan' && !isPlanContentBlock(block)) return null;
  return {
    messageId,
    ...(typeof e.role === 'string' ? { role: e.role } : {}),
    block,
    ...(typeof e.messageSeq === 'number' ? { messageSeq: e.messageSeq } : {}),
    ...(typeof e.timestamp === 'string' ? { timestamp: e.timestamp } : {}),
    ...(e.streamingComplete === true ? { streamingComplete: true } : {}),
    ...(e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata)
      ? { metadata: e.metadata as AgentMessage['metadata'] }
      : {}),
    ...(typeof e.appMessageId === 'string' && e.appMessageId.length > 0
      ? { appMessageId: e.appMessageId }
      : {}),
  };
}

/**
 * Merge a `tool_use` upsert onto the prior block. The daemon's `tool_delta`
 * synthesizes the FULL block from each `agent:tool:call` event, but a sparse
 * ACP `tool_call_update` (progress/completion tick) maps every unset field to
 * its default (`name: ""`, `input: {}`, `toolKind: "other"`), so upserting it
 * verbatim clobbers the titled block from first sight. An empty incoming name
 * marks such a progress-only tick (mirrors the firehose bridge's merge policy
 * in daemon-events-bridge.client.ts and the iOS `mergedToolUseBlock`): keep
 * the prior block's name/input/toolKind, adopt only the new status.
 */
function mergeToolUseBlock(prior: ContentBlock, incoming: ContentBlock): ContentBlock {
  const incomingName = incoming.name ?? incoming.toolName ?? '';
  if (
    incoming.type !== 'tool_use' ||
    prior.type !== 'tool_use' ||
    !incoming.toolCallId ||
    incoming.toolCallId !== prior.toolCallId ||
    incomingName.length > 0
  ) {
    return incoming;
  }
  const priorKind = prior.metadata?.toolKind as string | undefined;
  return {
    ...incoming,
    name: prior.name ?? prior.toolName ?? '',
    input: prior.input,
    metadata: {
      ...(incoming.metadata ?? {}),
      ...(priorKind !== undefined ? { toolKind: priorKind } : {}),
    },
  };
}

/**
 * 32-bit FNV-1a hash of the serialized snapshot payload. Duplicate detection
 * only: an exact re-delivery of the same wire push serializes identically, a
 * divergent restart re-emit does not. A spurious mismatch (it is not a
 * canonical serialization) just repeats an idempotent rebuild; a collision
 * falls back to the pre-#2716 ignore, which self-heals at the next gap
 * resnapshot.
 */
function fingerprintSnapshot(raw: unknown): number {
  const s = JSON.stringify(raw) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Reduces `chat.subscribe` snapshot/delta pushes onto a message-keyed
 * transcript (PROTOCOL §7.1). A snapshot rebuilds the message list; a
 * contiguous delta upserts each entity's FULL block by `block.id` into its
 * owning message — created on first appearance for a new in-flight message —
 * and strips `removedIds` from every message (orphan self-heal). When the
 * snapshot echoed `deltaEncoding: "incremental"` (§7.1, monorepo#2675), a
 * `textDelta`-bearing `text`/`thinking` entity APPENDS its fragment to the
 * identified block's text instead of replacing it — an `added` fragment
 * creates the block with text equal to the fragment (append onto the empty
 * string). Without the echo (full mode, older daemons) every block reduces
 * full-text as before. Mutated messages are replaced with shallow copies so
 * emitted transcripts are referentially fresh where they changed.
 */
export class ChatTranscriptReconciler {
  private messages: AgentMessage[] = [];
  private truncated = false;
  private totalMessages = 0;
  private streaming = false;
  private expectedSeq = 0;
  private seeded = false;
  private snapshotFingerprint = 0;
  private incremental = false;

  constructor(private readonly expectedAgentId?: string) {}

  /** Forget all state so the next snapshot rebuilds from scratch. */
  reset(): void {
    this.messages = [];
    this.truncated = false;
    this.totalMessages = 0;
    this.streaming = false;
    this.expectedSeq = 0;
    this.seeded = false;
    this.snapshotFingerprint = 0;
    this.incremental = false;
  }

  /**
   * Seed from a snapshot push (a full rebuild). Returns `false` only for an
   * exact duplicate re-delivery on an already-seeded transcript (reapplying
   * the same seq would repeat the hydration edge). A snapshot BEHIND the
   * expected seq is a daemon-side stream restart on the same subscription
   * (the daemon re-emits seq-0 and restarts deltas at 1 after a harness
   * restart) — it must rebuild, or every restarted delta is stale-dropped
   * and the transcript freezes (intent-hq/monorepo#2627). Seq alone cannot
   * tell that restart apart from a duplicate when it races an idle stream
   * (expectedSeq still 1, pre-first-delta), so the duplicate arm also
   * compares payload fingerprints: a divergent re-emit carries rows
   * persisted while the stream was down and must rebuild too, or they stay
   * hidden until the next gap resnapshot (intent-hq/monorepo#2716).
   */
  applySnapshot(seq: number, raw: unknown): boolean {
    const fingerprint = fingerprintSnapshot(raw);
    if (this.seeded && seq + 1 === this.expectedSeq && fingerprint === this.snapshotFingerprint) {
      return false;
    }
    this.snapshotFingerprint = fingerprint;
    const snap = extractSnapshot(raw, this.expectedAgentId);
    this.messages = snap.messages;
    this.truncated = snap.truncated;
    this.totalMessages = snap.totalMessages;
    // Mid-turn hydration: streaming is on when the snapshot carries a
    // synthetic in-flight assistant message or the §7.1 activity-flag overlay
    // says a turn is in flight. The snapshot is authoritative both ways.
    const p = (raw && typeof raw === 'object' ? raw : {}) as ChatSnapshotPayload;
    this.streaming =
      this.messages.some((m) => m.isStreaming === true) ||
      p.isResponding === true ||
      p.turnInFlight === true;
    // §7.1 encoding echo (monorepo#2675): every snapshot an incremental
    // subscription emits carries `deltaEncoding: "incremental"`. The echo —
    // never the request — arms the append reducer, so a daemon that ignored
    // the param (older, or full mode) keeps the full-text reduction.
    this.incremental = p.deltaEncoding === 'incremental';
    this.expectedSeq = seq + 1;
    this.seeded = true;
    return true;
  }

  /**
   * Apply one delta push. `"applied"` advanced the transcript; `"stale"` is a
   * duplicate re-delivery already applied (ignore silently — not a gap);
   * `"gap"` means seq jumped ahead or a delta arrived before any snapshot →
   * the caller should resnapshot.
   */
  applyDelta(seq: number, delta: ChatDeltaPayload): 'applied' | 'stale' | 'gap' {
    if (!this.seeded || seq > this.expectedSeq) return 'gap';
    if (seq < this.expectedSeq) return 'stale';
    let sawTerminal = false;
    let sawUpsert = false;
    for (const raw of [...delta.added, ...delta.updated]) {
      const entity = parseDeltaEntity(raw);
      if (!entity) continue;
      this.upsertBlock(entity);
      sawUpsert = true;
      if (entity.streamingComplete) sawTerminal = true;
    }
    if (delta.removedIds.length > 0) {
      const removed = new Set(delta.removedIds);
      this.messages = this.messages.map((m) => {
        const blocks = m.contentBlocks;
        if (!blocks || !blocks.some((b) => b.id !== undefined && removed.has(b.id))) return m;
        return {
          ...m,
          contentBlocks: blocks.filter((b) => b.id === undefined || !removed.has(b.id)),
        };
      });
    }
    // Terminal frame: the turn is done; a live (non-terminal) upsert always
    // means a turn is in flight. Terminal-wins assumes a §7.1 delta batch
    // never mixes one turn's terminal frame with another turn's live blocks:
    // deltas are emitted per agent-event, and each event belongs to exactly
    // one in-flight turn (an agent runs at most one turn at a time).
    if (sawTerminal) this.streaming = false;
    else if (sawUpsert) this.streaming = true;
    this.expectedSeq = seq + 1;
    return 'applied';
  }

  /** Current transcript state. */
  transcript(): ChatTranscript {
    return {
      messages: this.messages,
      truncated: this.truncated,
      totalMessages: this.totalMessages,
      isStreaming: this.streaming,
    };
  }

  /**
   * Materialize the entity's block for the upsert. In incremental mode a
   * live `text`/`thinking` chunk block carries only the new `textDelta`
   * fragment (§7.1, monorepo#2675): append it to the prior block's text —
   * or the empty string when no block exists yet (the `added` first chunk)
   * — mirroring the daemon-side gate on the mapper-owned block types, so a
   * non-text block carrying its own `textDelta` field stays latest-wins.
   * Everything else (full mode, tool blocks, terminal reconcile) is the
   * FULL block, upserted verbatim.
   */
  private materializeBlock(entity: ChatDeltaEntity, prior: ContentBlock | undefined): ContentBlock {
    const { textDelta, ...block } = entity.block;
    if (
      !this.incremental ||
      typeof textDelta !== 'string' ||
      (block.type !== 'text' && block.type !== 'thinking')
    ) {
      return entity.block;
    }
    return { ...block, text: (prior?.text ?? '') + textDelta };
  }

  /** Upsert one delta entity's block into its owning message. */
  private upsertBlock(entity: ChatDeltaEntity): void {
    const streamingComplete = entity.streamingComplete === true;
    let index = this.messages.findIndex((m) => m.id === entity.messageId);
    if (index < 0) {
      // First block of a new (in-flight) message — create it. Fall back to
      // the current time when the entity carries no timestamp; the terminal
      // frame's server timestamp is adopted below when it arrives.
      this.messages = [
        ...this.messages,
        {
          id: entity.messageId,
          role: (entity.role ?? 'assistant') as AgentMessage['role'],
          contentBlocks: [],
          timestamp: entity.timestamp ?? new Date().toISOString(),
          isStreaming: !streamingComplete,
        },
      ];
      index = this.messages.length - 1;
      // Display-count metadata only: never consumed by the delta path
      // (reconciliation keys on `messages`), and the next snapshot resets it
      // authoritatively — an all-blocks-removed message shell may leave it
      // one high until then, which is acceptable drift.
      this.totalMessages += 1;
    }
    const message = this.messages[index];
    const blocks = [...(message.contentBlocks ?? [])];
    const blockIndex = blocks.findIndex((b) => b.id === entity.block.id);
    const incoming = this.materializeBlock(
      entity,
      blockIndex >= 0 ? blocks[blockIndex] : undefined,
    );
    if (blockIndex >= 0) blocks[blockIndex] = mergeToolUseBlock(blocks[blockIndex], incoming);
    else blocks.push(incoming);
    const next: AgentMessage = {
      ...message,
      contentBlocks: blocks,
      isStreaming: !streamingComplete,
      ...(streamingComplete ? { streamingComplete: true } : {}),
    };
    // Adopt the authoritative terminal-frame fields when carried (§7.1).
    if (entity.timestamp) next.timestamp = entity.timestamp;
    if (entity.messageSeq !== undefined) next.seq = entity.messageSeq;
    if (entity.metadata) next.metadata = entity.metadata;
    if (entity.appMessageId) next.appMessageId = entity.appMessageId;
    this.messages = [...this.messages.slice(0, index), next, ...this.messages.slice(index + 1)];
  }
}

/** The concrete `ChatClient` used by `LiveAppClient`. */
export class LiveChatClient implements ChatClient {
  subscribe(
    agentId: string,
    handler: (transcript: ChatTranscript) => void,
    onPhase?: (phase: ChatLiveStreamPhase) => void,
    options?: ChatSubscribeOptions,
  ): Unsubscribe {
    const reconciler = new ChatTranscriptReconciler(agentId);
    let disposed = false;
    let subscriptionId: string | undefined;
    // Resume anchor (§7.1 `sinceMessageId`): sent on every registration until
    // the FIRST snapshot applies, then cleared — the reconciler then holds
    // daemon-served state, so internal re-registrations (gap resnapshot,
    // reconnect, backoff retry) need the full newest page, not a delta from
    // an anchor the reconciler no longer represents.
    let resumeAnchor = options?.sinceMessageId;
    // Observational lifecycle phase (deduped). Reporting NEVER alters the
    // subscription's behavior — registration, retry, and gap semantics are
    // unchanged whether or not a listener is attached.
    let phase: ChatLiveStreamPhase | undefined;
    // seq-0 ceiling after the subscribe ack: on timeout it reports `delayed`
    // and schedules a self-heal resubscribe (unsubscribe the stale
    // registration + fresh `chat.subscribe`) on the retry backoff schedule.
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;

    const setPhase = (next: ChatLiveStreamPhase): void => {
      if (disposed || next === phase) return;
      phase = next;
      onPhase?.(next);
    };

    const clearSnapshotTimer = (): void => {
      if (snapshotTimer !== undefined) {
        clearTimeout(snapshotTimer);
        snapshotTimer = undefined;
      }
    };
    // Self-heal retry (intent-hq/monorepo#1394): a rejected registration or a
    // missing seq-0 snapshot schedules exactly ONE delayed re-registration,
    // doubling the delay per consecutive failure up to the cap, so the
    // transcript recovers without waiting for a transport reconnect. The
    // timer is cancelled when a snapshot arrives, on reconnect (the handler
    // re-registers anyway), and on dispose.
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = INITIAL_RETRY_DELAY_MS;
    // True while a backoff recovery is pending or in flight: the phase keeps
    // reporting `delayed` (no connecting/awaiting-snapshot flap) until a
    // snapshot hydrates the transcript.
    let retrying = false;

    const clearRetryTimer = (): void => {
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };

    const resetBackoff = (): void => {
      clearRetryTimer();
      retrying = false;
      retryDelayMs = INITIAL_RETRY_DELAY_MS;
    };

    const scheduleRetry = (): void => {
      if (disposed) return;
      setPhase('delayed');
      retrying = true;
      clearRetryTimer();
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (disposed) return;
        // Reset like the other re-registration paths so the fresh
        // registration's seq-0 snapshot can never be stale-rejected
        // (hardening — hydration cancels the retry, so the reconciler is
        // never seeded here on any known path).
        reconciler.reset();
        // Best-effort release of a stale acked registration (its seq-0 never
        // arrived) before the fresh `chat.subscribe`; after a rejected
        // registration there is no id and this only bumps the generation.
        unregister();
        register();
      }, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    };
    // Registration-generation token: bumped whenever a newer registration or
    // a teardown (resnapshot, reconnect, dispose) supersedes prior in-flight
    // `chat.subscribe` requests, so an out-of-order subscribe reply is
    // discarded and best-effort unsubscribed (the delta-subscription pattern).
    let generation = 0;
    // Connection generation is separate from registration churn: only an
    // observed transport reconnect advances it.
    let transportGeneration = 0;
    let sawSnapshot = false;
    // Gap seen: deltas are ignored until the recovery snapshot lands.
    let awaitingResnapshot = false;
    // Pre-ack buffer: pushes that raced the subscribe reply are held and
    // replayed once the registration resolves to their id.
    let buffered: ChatPush[] = [];

    const emit = (diagnostic: StreamLifecycleDiagnostic): void => {
      if (disposed) return;
      try {
        handler(reconciler.transcript());
        reportStreamLifecycle({ ...diagnostic, callbackResult: 'delivered' });
      } catch (error) {
        reportStreamLifecycle({ ...diagnostic, callbackResult: 'threw' });
        throw error;
      }
    };

    // Snapshot-apply emits carry `fromSnapshot: true` (plus the §7.1 resume
    // disposition when the registration requested one) so consumers can seed
    // hydration from the authoritative newest page.
    const emitSnapshot = (
      resumed: boolean | undefined,
      diagnostic: StreamLifecycleDiagnostic,
    ): void => {
      if (disposed) return;
      const transcript = reconciler.transcript();
      try {
        handler({
          ...transcript,
          fromSnapshot: true,
          ...(resumed === undefined ? {} : { resumed }),
        });
        reportStreamLifecycle({ ...diagnostic, callbackResult: 'delivered' });
      } catch (error) {
        reportStreamLifecycle({ ...diagnostic, callbackResult: 'threw' });
        throw error;
      }
    };

    const processPush = (push: ChatPush): void => {
      if (disposed) return;
      const diagnostic = {
        stage: 'subscription' as const,
        event: 'push',
        turnCorrelation: pushTurnCorrelation(push),
        subscriptionGeneration: generation,
        transportGeneration,
        pushKind: push.kind,
        pushSeq: push.seq,
      };
      if (subscriptionId === undefined) {
        buffered.push(push);
        if (buffered.length > MAX_BUFFERED_PUSHES) buffered.shift();
        reportStreamLifecycle({ ...diagnostic, callbackResult: 'buffered' });
        return;
      }
      if (push.subscriptionId !== subscriptionId) {
        reportStreamLifecycle({ ...diagnostic, callbackResult: 'ignored' });
        return;
      }
      if (push.kind === 'snapshot') {
        awaitingResnapshot = false;
        clearSnapshotTimer();
        // Hydration cancels any pending self-heal retry and resets its
        // backoff to the initial delay.
        resetBackoff();
        // A snapshot push (applied or a stale re-delivery on an already-live
        // transcript) means the stream is hydrated either way.
        setPhase('live');
        // §7.1 resume: the anchor rides only until the first snapshot lands
        // — after that the reconciler holds daemon-served state, and every
        // internal re-registration must take the full newest page.
        const resumed = resumeAnchor === undefined ? undefined : extractResumedFlag(push.snapshot);
        resumeAnchor = undefined;
        if (reconciler.applySnapshot(push.seq, push.snapshot)) {
          const reconcilerResult = sawSnapshot ? 'reset' : 'applied';
          sawSnapshot = true;
          emitSnapshot(resumed, { ...diagnostic, reconcilerResult });
        } else {
          reportStreamLifecycle({
            ...diagnostic,
            reconcilerResult: 'duplicate',
            callbackResult: 'not-invoked',
          });
        }
      } else if (!awaitingResnapshot) {
        const outcome = reconciler.applyDelta(
          push.seq,
          push.delta ?? { added: [], updated: [], removedIds: [] },
        );
        if (outcome === 'applied') emit({ ...diagnostic, reconcilerResult: 'applied' });
        // Sequence gap (or a delta before any snapshot): self-heal via a
        // fresh registration whose seq-0 snapshot rebuilds the transcript.
        // Stale duplicates are ignored silently.
        else if (outcome === 'gap') {
          reportStreamLifecycle({
            ...diagnostic,
            reconcilerResult: 'gap',
            callbackResult: 'not-invoked',
          });
          resnapshot();
        } else {
          reportStreamLifecycle({
            ...diagnostic,
            reconcilerResult: 'stale',
            callbackResult: 'not-invoked',
          });
        }
      } else {
        reportStreamLifecycle({ ...diagnostic, callbackResult: 'ignored' });
      }
    };

    const register = (): void => {
      clearRetryTimer();
      generation += 1;
      const thisGeneration = generation;
      reportStreamLifecycle({
        stage: 'subscription',
        event: 'registration-start',
        subscriptionGeneration: thisGeneration,
        transportGeneration,
        callbackResult: 'not-invoked',
      });
      // A recovery registration (gap) reports `resyncing`; a first/reconnect
      // registration reports `connecting`; a backoff retry keeps reporting
      // `delayed` until a snapshot hydrates.
      if (!retrying) setPhase(awaitingResnapshot ? 'resyncing' : 'connecting');
      // Opt into fragment deltas (§7.1 `deltaEncoding`, monorepo#2675): an
      // older daemon ignores the unknown param and echoes nothing, so the
      // reducer stays full-text there — the snapshot echo decides the mode.
      // Also opt into the slim projection (§7.1 `projection: "slim"`, additive
      // within v7.1): oversized tool/image block bodies in the seq-0 snapshot
      // AND live deltas arrive as bounded previews with `*Truncated`/`*Bytes`
      // flags — fixed for the subscription's lifetime so snapshots and deltas
      // agree; an older daemon ignores the unknown param and serves full
      // blocks.
      backendRequest<{ subscriptionId?: string }>('chat.subscribe', {
        agentId,
        deltaEncoding: 'incremental',
        projection: 'slim',
        ...(resumeAnchor === undefined ? {} : { sinceMessageId: resumeAnchor }),
      })
        .then((result) => {
          const id = result?.subscriptionId;
          if (generation !== thisGeneration || disposed) {
            reportStreamLifecycle({
              stage: 'subscription',
              event: 'registration-stale',
              subscriptionGeneration: thisGeneration,
              transportGeneration,
              callbackResult: 'ignored',
            });
            // Stale resolve: a newer registration or a teardown superseded
            // this attempt while it was in flight. Never store the id and
            // best-effort release the daemon-side subscription it created.
            if (id) {
              void backendRequest('chat.unsubscribe', { subscriptionId: id }).catch(() => {
                // Unsubscribe is best-effort.
              });
            }
            return;
          }
          subscriptionId = id;
          reportStreamLifecycle({
            stage: 'subscription',
            event: 'registration-ack',
            subscriptionGeneration: thisGeneration,
            transportGeneration,
            callbackResult: 'not-invoked',
          });
          // Ack received: awaiting the seq-0 snapshot (a recovery snapshot
          // keeps reporting `resyncing`; a backoff retry keeps `delayed`).
          if (!awaitingResnapshot && !retrying) setPhase('awaiting-snapshot');
          clearSnapshotTimer();
          snapshotTimer = setTimeout(() => {
            snapshotTimer = undefined;
            // Ack without seq-0: report `delayed` and self-heal by
            // unsubscribing the stale registration and re-registering on the
            // backoff schedule (intent-hq/monorepo#1394).
            scheduleRetry();
          }, SNAPSHOT_TIMEOUT_MS);
          const matched = buffered.filter((p) => p.subscriptionId === id);
          buffered = [];
          for (const p of matched) processPush(p);
        })
        .catch(() => {
          // Registration failure: report `delayed` and schedule a backoff
          // retry so the stream recovers without a transport reconnect
          // (intent-hq/monorepo#1394); the transcript keeps its last state.
          if (generation === thisGeneration) {
            reportStreamLifecycle({
              stage: 'subscription',
              event: 'registration-failed',
              subscriptionGeneration: thisGeneration,
              transportGeneration,
              callbackResult: 'not-invoked',
            });
            scheduleRetry();
          }
        });
    };

    const unregister = (): void => {
      // Invalidate any in-flight registration so its late resolve cleans up
      // after itself instead of resurrecting a subscription past teardown.
      generation += 1;
      if (!subscriptionId) return;
      const id = subscriptionId;
      subscriptionId = undefined;
      void backendRequest('chat.unsubscribe', { subscriptionId: id }).catch(() => {
        // Unsubscribe is best-effort.
      });
    };

    const restartRegistration = (): void => {
      awaitingResnapshot = true;
      // The gap registration IS the recovery: drop any pending self-heal
      // retry — and the prior ack's seq-0 ceiling, which could otherwise
      // still fire scheduleRetry() mid-recovery — so neither causes a
      // redundant unsubscribe/subscribe cycle on top of this one (the
      // backoff level is kept — hydration resets it).
      clearRetryTimer();
      clearSnapshotTimer();
      reconciler.reset();
      unregister();
      register();
    };

    const resnapshot = (): void => {
      if (awaitingResnapshot) return;
      restartRegistration();
    };

    const off = onBackendNotification((n) => {
      const push = parseChatPush(n.method, n.params);
      if (push) processPush(push);
    });

    // Reconnect: the daemon dropped its subscription registry on restart, so
    // the stashed id points at nothing — no unsubscribe frame; just reset and
    // re-register for a fresh seq-0 snapshot.
    const offReconnect = onBackendReconnected(() => {
      if (disposed) return;
      transportGeneration += 1;
      generation += 1;
      reportStreamLifecycle({
        stage: 'subscription',
        event: 'transport-reconnected',
        subscriptionGeneration: generation,
        transportGeneration,
        callbackResult: 'not-invoked',
      });
      subscriptionId = undefined;
      awaitingResnapshot = false;
      buffered = [];
      clearSnapshotTimer();
      // The reconnect registration IS the recovery: drop any pending retry
      // and start the backoff schedule fresh.
      resetBackoff();
      reconciler.reset();
      register();
    });

    register();

    return () => {
      disposed = true;
      clearSnapshotTimer();
      clearRetryTimer();
      off();
      offReconnect();
      unregister();
    };
  }
}
