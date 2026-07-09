/**
 * Live chat domain backed by the intentd daemon (PROTOCOL §7.1).
 *
 * Only the seq-0 snapshot fetch is live: `subscribeSnapshot` opens a
 * `chat.subscribe` on the daemon subscription fast-path, awaits the initial
 * `subscription.push { kind: "snapshot", seq: 0 }` — which the daemon merges
 * with the in-flight assistant message (CS-0 D5) when a turn is streaming —
 * then closes the subscription with `chat.unsubscribe`. This gives ChatPanel a
 * hydration path that preserves the interim response on tab-switch, replacing
 * the older `agent.getConversation` read (persisted-only, would clobber the
 * in-memory partial).
 *
 * The rest of the ChatClient surface (`history`, `tokenUsage`, `subscribe`)
 * still delegates to the in-memory mock: live deltas continue to arrive via
 * the existing `agent:stream:*` firehose, so a full §7.1 delta reconciler is
 * out of scope here.
 */
import type { AgentMessage, ContentBlock } from "$shared/types";
import type { ChatClient, SubscriptionHandler, Unsubscribe } from "../app-client";
import { backendRequest, onBackendNotification } from "./backend-transport";

/** Shape of a `chat.subscribe` seq-0 snapshot per PROTOCOL §7.1. */
interface ChatSnapshotPayload {
  agentId?: string;
  messages?: unknown[];
  truncated?: boolean;
  totalMessages?: number;
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

/** The concrete `ChatClient` used by `LiveAppClient`. */
export class LiveChatClient implements ChatClient {
  /**
   * Delegate to a mock-provided `history` implementation (still fixture-backed
   * until the flattened token history has its own daemon read).
   */
  history: (agentId: string) => Promise<ContentBlock[]>;
  tokenUsage: (agentId: string) => Promise<{ input: number; output: number }>;
  subscribe: (agentId: string, handler: SubscriptionHandler<ContentBlock[]>) => Unsubscribe;

  constructor(mockChat: ChatClient) {
    this.history = mockChat.history.bind(mockChat);
    this.tokenUsage = mockChat.tokenUsage.bind(mockChat);
    this.subscribe = mockChat.subscribe.bind(mockChat);
  }

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
}
