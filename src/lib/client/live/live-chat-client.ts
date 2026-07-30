/**
 * Live chat domain backed by the intentd daemon (PROTOCOL §7.1).
 *
 * `subscribeSnapshot` opens a `chat.subscribe` on the daemon subscription
 * fast-path, awaits the initial `subscription.push { kind: "snapshot", seq: 0 }`
 * — which the daemon merges with the in-flight assistant message when a turn is
 * streaming — then closes the subscription with `chat.unsubscribe`. This gives
 * ChatPanel a hydration path that preserves the interim response on tab-switch,
 * replacing the older `agent.getConversation` read (persisted-only, would
 * clobber the in-memory partial). Live deltas continue to arrive via the
 * existing `agent:stream:*` firehose.
 *
 * `subscribe` is the STANDING form of the same channel: it keeps the
 * registration open and reduces the block-granularity delta stream onto the
 * seq-0 message page (PROTOCOL §7.1). Each delta entity carries
 * `{ agentId, messageId, role, block }` plus `messageSeq`/`timestamp`/
 * `streamingComplete` on the terminal frame; the block is the FULL current
 * block, upserted by its stable `{messageId}:{blockIndex}` id into the owning
 * message (created on first appearance). `removedIds` are block ids the
 * persisted message does not contain (orphan self-heal). Sequence gaps
 * trigger resnapshot (unsubscribe + fresh `chat.subscribe`); a transport
 * reconnect re-registers against the daemon's rebuilt registry; pushes that
 * race the subscribe reply are buffered pre-ack and replayed (the same
 * buffering `subscribeSnapshot` uses). The §6.9 invariant: the seq-0
 * snapshot reduced with every delta — honoring `removedIds` — equals a fresh
 * `agent.getConversation` snapshot.
 */
import type { AgentMessage, ContentBlock } from "$shared/types";
import type { ChatClient, ChatTranscript, Unsubscribe } from "../app-client";
import { backendRequest, onBackendNotification, onBackendReconnected } from "./backend-transport";

/** Shape of a `chat.subscribe` seq-0 snapshot per PROTOCOL §7.1. */
interface ChatSnapshotPayload {
  agentId?: string;
  messages?: unknown[];
  truncated?: boolean;
  totalMessages?: number;
  /** §7.1 activity-flag overlay (same fields as the `AgentLite` projection). */
  isResponding?: boolean;
  turnInFlight?: boolean;
}

/** Hydration result surfaced to callers (mirrors `agent.getConversation` shape). */
export interface ChatSnapshotResult {
  messages: AgentMessage[];
  truncated: boolean;
  totalMessages: number;
}

const EMPTY_SNAPSHOT: ChatSnapshotResult = { messages: [], truncated: false, totalMessages: 0 };

/** Wall-clock ceiling for the seq-0 push after `chat.subscribe` resolves. */
const SNAPSHOT_TIMEOUT_MS = 5_000;

/**
 * Bound for the standing subscription's pre-ack push buffer: pushes whose
 * subscriptionId matches no known registration are held (instead of dropped)
 * and replayed when the subscribe reply resolves — the same buffering
 * `subscribeSnapshot` and delta-subscription.ts use.
 */
const MAX_BUFFERED_PUSHES = 32;

function extractSnapshot(raw: unknown): ChatSnapshotResult {
  if (!raw || typeof raw !== "object") return EMPTY_SNAPSHOT;
  const p = raw as ChatSnapshotPayload;
  const messages = Array.isArray(p.messages) ? (p.messages as AgentMessage[]) : [];
  return {
    messages,
    truncated: Boolean(p.truncated),
    totalMessages: typeof p.totalMessages === "number" ? p.totalMessages : 0,
  };
}

function isSnapshotPush(
  method: string,
  params: unknown,
): { subscriptionId: string; seq: number; snapshot: unknown } | null {
  if (method !== "subscription.push" || !params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  if (p.kind !== "snapshot") return null;
  const subscriptionId = typeof p.subscriptionId === "string" ? p.subscriptionId : null;
  const seq = typeof p.seq === "number" ? p.seq : null;
  if (!subscriptionId || seq === null) return null;
  return { subscriptionId, seq, snapshot: p.snapshot };
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
  kind: "snapshot" | "delta";
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
  if (method !== "subscription.push" || !params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  const subscriptionId = typeof p.subscriptionId === "string" ? p.subscriptionId : null;
  const seq = typeof p.seq === "number" ? p.seq : null;
  if (!subscriptionId || seq === null) return null;
  if (p.kind === "snapshot") {
    return { subscriptionId, kind: "snapshot", seq, snapshot: p.snapshot };
  }
  if (p.kind === "delta") {
    const raw = (p.delta && typeof p.delta === "object" ? p.delta : {}) as Record<string, unknown>;
    return {
      subscriptionId,
      kind: "delta",
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

/** One delta entity: the message pointer plus the FULL current block (§7.1). */
interface ChatDeltaEntity {
  messageId: string;
  role?: string;
  block: ContentBlock & { id?: string };
  messageSeq?: number;
  timestamp?: string;
  streamingComplete?: boolean;
  /**
   * Persisted row metadata lifted onto non-assistant row deltas (§7.1) — e.g.
   * the `agent_message` sender attribution the chip renders live.
   */
  metadata?: AgentMessage["metadata"];
}

function parseDeltaEntity(raw: unknown): ChatDeltaEntity | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const messageId = typeof e.messageId === "string" ? e.messageId : null;
  const block =
    e.block && typeof e.block === "object" ? (e.block as ChatDeltaEntity["block"]) : null;
  if (!messageId || !block || typeof block.id !== "string") return null;
  return {
    messageId,
    ...(typeof e.role === "string" ? { role: e.role } : {}),
    block,
    ...(typeof e.messageSeq === "number" ? { messageSeq: e.messageSeq } : {}),
    ...(typeof e.timestamp === "string" ? { timestamp: e.timestamp } : {}),
    ...(e.streamingComplete === true ? { streamingComplete: true } : {}),
    ...(e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
      ? { metadata: e.metadata as AgentMessage["metadata"] }
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
  const incomingName = incoming.name ?? incoming.toolName ?? "";
  if (
    incoming.type !== "tool_use" ||
    prior.type !== "tool_use" ||
    !incoming.toolCallId ||
    incoming.toolCallId !== prior.toolCallId ||
    incomingName.length > 0
  ) {
    return incoming;
  }
  const priorKind = prior.metadata?.toolKind as string | undefined;
  return {
    ...incoming,
    name: prior.name ?? prior.toolName ?? "",
    input: prior.input,
    metadata: {
      ...(incoming.metadata ?? {}),
      ...(priorKind !== undefined ? { toolKind: priorKind } : {}),
    },
  };
}

/**
 * Reduces `chat.subscribe` snapshot/delta pushes onto a message-keyed
 * transcript (PROTOCOL §7.1). A snapshot rebuilds the message list; a
 * contiguous delta upserts each entity's FULL block by `block.id` into its
 * owning message — created on first appearance for a new in-flight message —
 * and strips `removedIds` from every message (orphan self-heal). Mutated
 * messages are replaced with shallow copies so emitted transcripts are
 * referentially fresh where they changed.
 */
export class ChatTranscriptReconciler {
  private messages: AgentMessage[] = [];
  private truncated = false;
  private totalMessages = 0;
  private streaming = false;
  private expectedSeq = 0;
  private seeded = false;

  /** Forget all state so the next snapshot rebuilds from scratch. */
  reset(): void {
    this.messages = [];
    this.truncated = false;
    this.totalMessages = 0;
    this.streaming = false;
    this.expectedSeq = 0;
    this.seeded = false;
  }

  /**
   * Seed from a snapshot push (a full rebuild). Returns `false` for a stale
   * re-delivery on an already-seeded transcript that would rewind
   * `expectedSeq` (deltas past it have been applied) — applying it would roll
   * the transcript back and make the next live delta read as a gap.
   */
  applySnapshot(seq: number, raw: unknown): boolean {
    if (this.seeded && seq + 1 < this.expectedSeq) return false;
    const snap = extractSnapshot(raw);
    this.messages = snap.messages;
    this.truncated = snap.truncated;
    this.totalMessages = snap.totalMessages;
    // Mid-turn hydration: streaming is on when the snapshot carries a
    // synthetic in-flight assistant message or the §7.1 activity-flag overlay
    // says a turn is in flight. The snapshot is authoritative both ways.
    const p = (raw && typeof raw === "object" ? raw : {}) as ChatSnapshotPayload;
    this.streaming =
      this.messages.some((m) => m.isStreaming === true) ||
      p.isResponding === true ||
      p.turnInFlight === true;
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
  applyDelta(seq: number, delta: ChatDeltaPayload): "applied" | "stale" | "gap" {
    if (!this.seeded || seq > this.expectedSeq) return "gap";
    if (seq < this.expectedSeq) return "stale";
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
    return "applied";
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

  /** Upsert one delta entity's full block into its owning message. */
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
          role: (entity.role ?? "assistant") as AgentMessage["role"],
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
    if (blockIndex >= 0) blocks[blockIndex] = mergeToolUseBlock(blocks[blockIndex], entity.block);
    else blocks.push(entity.block);
    const next: AgentMessage = {
      ...message,
      contentBlocks: blocks,
      isStreaming: !streamingComplete,
      ...(streamingComplete ? { streamingComplete: true } : {}),
    };
    // Adopt the authoritative terminal-frame fields when carried (§7.1).
    if (entity.timestamp) next.timestamp = entity.timestamp;
    if (entity.messageSeq !== undefined) {
      (next as AgentMessage & { seq?: number }).seq = entity.messageSeq;
    }
    if (entity.metadata) next.metadata = entity.metadata;
    this.messages = [...this.messages.slice(0, index), next, ...this.messages.slice(index + 1)];
  }
}

/** The concrete `ChatClient` used by `LiveAppClient`. */
export class LiveChatClient implements ChatClient {
  async subscribeSnapshot(agentId: string): Promise<ChatSnapshotResult> {
    // Register the notification listener BEFORE calling `chat.subscribe` so a
    // synchronously-broadcast seq-0 push cannot race the subscribe reply.
    // Until the reply lands we don't yet know our subscriptionId, so any
    // arriving push is buffered and matched afterwards.
    return new Promise<ChatSnapshotResult>((resolve) => {
      let subscriptionId: string | undefined;
      let settled = false;
      const buffered: Array<{ subscriptionId: string; seq: number; snapshot: unknown }> = [];
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: ChatSnapshotResult): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        off();
        if (subscriptionId) {
          void backendRequest("chat.unsubscribe", { subscriptionId }).catch(() => {
            // Unsubscribe is best-effort.
          });
        }
        resolve(result);
      };

      const off = onBackendNotification((n) => {
        const push = isSnapshotPush(n.method, n.params);
        if (!push) return;
        if (!subscriptionId) {
          buffered.push(push);
          return;
        }
        if (push.subscriptionId !== subscriptionId || push.seq !== 0) return;
        finish(extractSnapshot(push.snapshot));
      });

      backendRequest<{ subscriptionId?: string }>("chat.subscribe", { agentId })
        .then((result) => {
          subscriptionId = result?.subscriptionId;
          if (!subscriptionId) return finish(EMPTY_SNAPSHOT);
          const match = buffered.find(
            (b) => b.subscriptionId === subscriptionId && b.seq === 0,
          );
          if (match) return finish(extractSnapshot(match.snapshot));
          timer = setTimeout(() => finish(EMPTY_SNAPSHOT), SNAPSHOT_TIMEOUT_MS);
        })
        .catch(() => finish(EMPTY_SNAPSHOT));
    });
  }

  subscribe(agentId: string, handler: (transcript: ChatTranscript) => void): Unsubscribe {
    const reconciler = new ChatTranscriptReconciler();
    let disposed = false;
    let subscriptionId: string | undefined;
    // Registration-generation token: bumped whenever a newer registration or
    // a teardown (resnapshot, reconnect, dispose) supersedes prior in-flight
    // `chat.subscribe` requests, so an out-of-order subscribe reply is
    // discarded and best-effort unsubscribed (the delta-subscription pattern).
    let generation = 0;
    // Gap seen: deltas are ignored until the recovery snapshot lands.
    let awaitingResnapshot = false;
    // Pre-ack buffer: pushes that raced the subscribe reply are held and
    // replayed once the registration resolves to their id.
    let buffered: ChatPush[] = [];

    const emit = (): void => {
      if (!disposed) handler(reconciler.transcript());
    };

    const processPush = (push: ChatPush): void => {
      if (disposed) return;
      if (subscriptionId === undefined) {
        buffered.push(push);
        if (buffered.length > MAX_BUFFERED_PUSHES) buffered.shift();
        return;
      }
      if (push.subscriptionId !== subscriptionId) return;
      if (push.kind === "snapshot") {
        awaitingResnapshot = false;
        if (reconciler.applySnapshot(push.seq, push.snapshot)) emit();
      } else if (!awaitingResnapshot) {
        const outcome = reconciler.applyDelta(
          push.seq,
          push.delta ?? { added: [], updated: [], removedIds: [] },
        );
        if (outcome === "applied") emit();
        // Sequence gap (or a delta before any snapshot): self-heal via a
        // fresh registration whose seq-0 snapshot rebuilds the transcript.
        // Stale duplicates are ignored silently.
        else if (outcome === "gap") resnapshot();
      }
    };

    const register = (): void => {
      generation += 1;
      const thisGeneration = generation;
      backendRequest<{ subscriptionId?: string }>("chat.subscribe", { agentId })
        .then((result) => {
          const id = result?.subscriptionId;
          if (generation !== thisGeneration || disposed) {
            // Stale resolve: a newer registration or a teardown superseded
            // this attempt while it was in flight. Never store the id and
            // best-effort release the daemon-side subscription it created.
            if (id) {
              void backendRequest("chat.unsubscribe", { subscriptionId: id }).catch(() => {
                // Unsubscribe is best-effort.
              });
            }
            return;
          }
          subscriptionId = id;
          const matched = buffered.filter((p) => p.subscriptionId === id);
          buffered = [];
          for (const p of matched) processPush(p);
        })
        .catch(() => {
          // Registration failure: the reconnect handler retries on the next
          // transport recovery; the transcript keeps its last emitted state.
        });
    };

    const unregister = (): void => {
      // Invalidate any in-flight registration so its late resolve cleans up
      // after itself instead of resurrecting a subscription past teardown.
      generation += 1;
      if (!subscriptionId) return;
      const id = subscriptionId;
      subscriptionId = undefined;
      void backendRequest("chat.unsubscribe", { subscriptionId: id }).catch(() => {
        // Unsubscribe is best-effort.
      });
    };

    const resnapshot = (): void => {
      if (awaitingResnapshot) return;
      awaitingResnapshot = true;
      reconciler.reset();
      unregister();
      register();
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
      generation += 1;
      subscriptionId = undefined;
      awaitingResnapshot = false;
      buffered = [];
      reconciler.reset();
      register();
    });

    register();

    return () => {
      disposed = true;
      off();
      offReconnect();
      unregister();
    };
  }
}
