/**
 * Chat read saga — SINGLE-TRANSFER hydration. Opening a chat transfers the
 * conversation once: the standing `chat.subscribe` subscription's seq-0
 * snapshot (which already merges the in-flight assistant message, CS-0 D5) is
 * the hydration seed. This saga no longer fetches a throwaway
 * `subscribeSnapshot` nor pages the full history on the critical path:
 *
 *  1. `transcriptHydrationStarted`, fetch the session shell (`agents.get`,
 *     counts only) and upsert it so the subscription's snapshot can apply.
 *  2. Wait for the standing subscription's snapshot — already recorded in
 *     chat-state (`transcriptSnapshot` meta) or the next
 *     `chatTranscriptSnapshotApplied` dispatch — with a timeout fallback to a
 *     direct newest-page `agent.getConversation` read (degraded path: the
 *     subscription failed to deliver, e.g. daemon hiccup mid-registration).
 *  3. Settle (`transcriptHydrationSettled`) — first paint gates on this.
 *  4. OFF the critical path: when older history exists beyond the snapshot
 *     window (`truncated`), page it in the background via the §5.5
 *     `aroundMessageId` seek anchored at the AUTHORITATIVE window's oldest
 *     row — the snapshot page's oldest (`TranscriptSnapshotMeta.
 *     oldestMessageId`) or the fallback read's oldest — NOT the store's
 *     oldest retained row: retained history can sit BELOW an interior gap
 *     (§7.1 `resumed: false` fallback, degraded direct read), and anchoring
 *     below the gap would walk strictly older and never fill it. Walking
 *     backward from the window's oldest traverses the gap first and the
 *     nothing-new stop condition halts on already-retained pages. Merged
 *     with current-wins dedup; stops early when a page contributes nothing
 *     new or the store's 500-message prune cap is reached (fetching beyond
 *     it would be discarded anyway).
 */
import {
  actionChannel,
  all,
  call,
  delay,
  flush,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentMessage, AgentSession } from '$shared/types';
import { deduplicateAgentMessages } from '$shared/utils/message-dedup';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import {
  bulkUpsertSessions,
  replaceMessages,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectAgentMessages } from '../../agent-session/agent-session-selectors';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  chatTranscriptSnapshotApplied,
  initializeChatRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import { selectTranscriptSnapshotMeta } from '../chat-state-selectors';

const logger = createLogger('ChatReadSaga');
const PAGE_LIMIT = 200;
/** Ceiling for the standing subscription's seq-0 snapshot before the direct-read fallback. */
const SNAPSHOT_WAIT_MS = 10_000;
/** Mirror of the agent-session slice's message prune cap — paging past it is discarded. */
const MAX_STORE_MESSAGES = 500;

type ChatRequest = { wsId: string; agentId: string };
type HydrationTails = Map<string, Promise<void>>;
type HydrateResult = {
  started: boolean;
  fetchOlder: boolean;
  /** Older-walk seek anchor: the authoritative window's oldest row id. */
  anchor?: string;
};

function identitySet(messages: AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (typeof message.id === 'string') ids.add(message.id);
    if (typeof message.appMessageId === 'string') ids.add(message.appMessageId);
  }
  return ids;
}

function oldestMessageId(messages: AgentMessage[]): string | undefined {
  for (const message of messages) {
    if (typeof message.id === 'string' && message.id.length > 0) return message.id;
  }
  return undefined;
}

function* hydrateAfterPrevious(
  request: ChatRequest,
  previous: Promise<void>,
): SagaGenerator<HydrateResult> {
  yield* call(() => previous);
  return yield* call(hydrateChatTranscriptSaga, request);
}

/**
 * Degraded-path direct read: the subscription's snapshot never arrived, so
 * fetch the newest `agent.getConversation` page and merge it (fetched copies
 * win for shared ids; store-only rows — optimistic sends, prior history —
 * are preserved). Returns whether older history remains beyond the page and
 * the page's oldest row id (the older-walk anchor).
 */
function* fallbackNewestPageRead(
  agentId: string,
): SagaGenerator<{ fetchOlder: boolean; anchor?: string }> {
  const page: Awaited<ReturnType<typeof appClient.agents.getConversation>> = yield* call(
    [appClient.agents, appClient.agents.getConversation],
    agentId,
    PAGE_LIMIT,
  );
  if (yield* call(isAgentDeletionPending, agentId)) return { fetchOlder: false };
  const current: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
  const pageIds = identitySet(page.messages);
  const storeOnly = current.filter(
    (message) =>
      !(typeof message.id === 'string' && pageIds.has(message.id)) &&
      !(typeof message.appMessageId === 'string' && pageIds.has(message.appMessageId)),
  );
  const merged =
    storeOnly.length === 0
      ? page.messages
      : deduplicateAgentMessages([...page.messages, ...storeOnly]);
  yield* put(replaceMessages(agentId, merged));
  return { fetchOlder: page.nextToken !== null, anchor: oldestMessageId(page.messages) };
}

function* hydrateChatTranscriptSaga(request: ChatRequest): SagaGenerator<HydrateResult> {
  const { wsId, agentId } = request;
  if (yield* call(isAgentDeletionPending, agentId)) return { started: false, fetchOlder: false };
  let started = false;
  let fetchOlder = false;
  let anchor: string | undefined;
  try {
    yield* put(transcriptHydrationStarted(agentId));
    started = true;
    const session: AgentSession | null = yield* call(
      [appClient.agents, appClient.agents.get],
      agentId,
    );
    if (!session || String(session.workspaceId) !== wsId) return { started, fetchOlder };
    // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
    // §5.5 `pendingDeleteAt`, v6.7+) — a deletion scheduled by another
    // window/client (or before an FE restart) is not in the local registry.
    if (session.pendingDeleteAt) return { started, fetchOlder };
    if (yield* call(isAgentDeletionPending, agentId)) return { started, fetchOlder };

    // Register/refresh the session shell WITHOUT touching the transcript:
    // the standing subscription's snapshot (applyTranscript) needs a stored
    // session to apply against, and its rows must never be clobbered by the
    // shell's empty message list.
    const preserved: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const hydrated = { ...session, messages: preserved };
    yield* put(bulkUpsertSessions([hydrated]));
    yield* put(upsertSession(hydrated));

    // SINGLE-TRANSFER WAIT: the standing subscription (opened by the
    // chat-subscribe saga off the same trigger action) delivers the seq-0
    // snapshot; its metadata in chat-state doubles as the arrived signal.
    // The channel is opened BEFORE the state read so a dispatch landing
    // between the two cannot be missed.
    const isSnapshotForAgent = (action: { type: string; payload?: unknown }) =>
      action.type === chatTranscriptSnapshotApplied.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === agentId;
    const snapshotChannel = yield* actionChannel(isSnapshotForAgent);
    try {
      let meta = yield* selectTranscriptSnapshotMeta.effect(agentId);
      if (!meta) {
        const { applied } = yield* race({
          applied: take(snapshotChannel),
          timedOut: delay(SNAPSHOT_WAIT_MS),
        });
        if (applied) meta = yield* selectTranscriptSnapshotMeta.effect(agentId);
      }
      if (meta) {
        fetchOlder = meta.truncated === true;
        anchor = meta.oldestMessageId;
      } else {
        // Snapshot never arrived (subscription rejected/looping): direct read
        // so the panel still settles with the newest page.
        ({ fetchOlder, anchor } = yield* call(fallbackNewestPageRead, agentId));
      }
    } finally {
      yield* flush(snapshotChannel);
      snapshotChannel.close();
    }
  } catch (error) {
    logger.error('Failed to hydrate chat transcript', error);
  }
  return { started, fetchOlder, anchor };
}

/**
 * Background older-history fetch (OFF the hydration critical path). Anchors a
 * §5.5 `aroundMessageId` seek at the AUTHORITATIVE window's oldest row (the
 * snapshot page's / fallback page's oldest — falling back to the store's
 * oldest when none was recorded), then walks `nextToken` backward,
 * accumulating rows the store does not hold. Anchoring at the window rather
 * than the store's oldest retained row matters when retained history sits
 * BELOW an interior gap (§7.1 `resumed: false` fallback, degraded direct
 * read): the backward walk traverses the gap first, and the nothing-new stop
 * condition halts once it reaches already-retained pages. Each page merges
 * as `[...older, ...current]` with current-wins dedup so live rows that
 * arrived meanwhile are never clobbered. Stops when: no token remains, a
 * page contributes nothing new (already-present history), or the store's
 * prune cap is reached. Errors are swallowed — the snapshot window already
 * rendered.
 */
function* fetchOlderHistorySaga(request: ChatRequest, windowAnchor?: string): SagaGenerator<void> {
  const { agentId } = request;
  try {
    if (yield* call(isAgentDeletionPending, agentId)) return;
    const current: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const anchor = windowAnchor ?? oldestMessageId(current);
    if (!anchor || current.length >= MAX_STORE_MESSAGES) return;

    const older: AgentMessage[] = [];
    const knownIds = identitySet(current);
    // Seek to the page CONTAINING the anchor: rows older than it are new
    // history; the anchor and newer rows are already in the store (dropped
    // by the knownIds filter below).
    let page: Awaited<ReturnType<typeof appClient.agents.getConversation>> = yield* call(
      [appClient.agents, appClient.agents.getConversation],
      agentId,
      PAGE_LIMIT,
      undefined,
      anchor,
    );
    for (;;) {
      const fresh = page.messages.filter(
        (message) =>
          !(typeof message.id === 'string' && knownIds.has(message.id)) &&
          !(typeof message.appMessageId === 'string' && knownIds.has(message.appMessageId)),
      );
      for (const message of fresh) {
        if (typeof message.id === 'string') knownIds.add(message.id);
        if (typeof message.appMessageId === 'string') knownIds.add(message.appMessageId);
      }
      older.unshift(...fresh);
      if (page.nextToken === null) break;
      // Nothing new on a non-seek page means this history is already present
      // (e.g. resume onto retained rows) — stop paging.
      if (fresh.length === 0 && older.length > 0) break;
      if (older.length + current.length >= MAX_STORE_MESSAGES) break;
      page = yield* call(
        [appClient.agents, appClient.agents.getConversation],
        agentId,
        PAGE_LIMIT,
        page.nextToken,
      );
    }
    if (older.length === 0) return;
    if (yield* call(isAgentDeletionPending, agentId)) return;

    // Merge against the store AT WRITE TIME (live rows may have landed since
    // the fetch began); current copies win identity in the dedup.
    const latest: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const latestIds = identitySet(latest);
    const prepend = older.filter(
      (message) =>
        !(typeof message.id === 'string' && latestIds.has(message.id)) &&
        !(typeof message.appMessageId === 'string' && latestIds.has(message.appMessageId)),
    );
    if (prepend.length === 0) return;
    yield* put(replaceMessages(agentId, deduplicateAgentMessages([...prepend, ...latest])));
  } catch (error) {
    logger.error('Failed to fetch older chat history', error);
  }
}

function matchesChatCleanup({ wsId, agentId }: ChatRequest) {
  return (action: { type: string; payload?: unknown }) => {
    if (action.type !== workspaceDeleted.type && action.type !== workspaceUnmounted.type)
      return false;
    if (!Array.isArray(action.payload)) return false;
    const [cleanupWorkspaceId, deletedAgentIds = []] = action.payload;
    return (
      cleanupWorkspaceId === wsId ||
      (Array.isArray(deletedAgentIds) && deletedAgentIds.includes(agentId))
    );
  };
}

function* hydrateChatWorker(
  request: ChatRequest,
  hydrationTails: HydrationTails,
): SagaGenerator<void> {
  if (!request.wsId || !request.agentId) return;

  const previous = hydrationTails.get(request.agentId) ?? Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => completion);
  hydrationTails.set(request.agentId, tail);
  void tail.then(() => {
    if (hydrationTails.get(request.agentId) === tail) hydrationTails.delete(request.agentId);
  });

  try {
    const { read } = yield* race({
      read: call(hydrateAfterPrevious, request, previous),
      cleanup: take(matchesChatCleanup(request)),
    });
    if (read?.started && hydrationTails.get(request.agentId) === tail) {
      // Settle FIRST — first paint gates on this; the older-history fetch
      // runs after, still inside the per-agent tail (serialized against a
      // follow-up hydration) and raced against cleanup.
      yield* put(transcriptHydrationSettled(request.agentId));
      if (read.fetchOlder) {
        yield* race({
          fetch: call(fetchOlderHistorySaga, request, read.anchor),
          cleanup: take(matchesChatCleanup(request)),
        });
      }
    }
  } finally {
    release();
  }
}

function* initializeChatWorker(
  hydrationTails: HydrationTails,
  action: ReturnType<typeof initializeChatRequested>,
) {
  yield* hydrateChatWorker(action.payload, hydrationTails);
}

function* refreshChatWorker(
  hydrationTails: HydrationTails,
  action: ReturnType<typeof refreshChatTranscriptRequested>,
) {
  const [wsId, agentId] = action.payload;
  yield* hydrateChatWorker({ wsId, agentId }, hydrationTails);
}

export function* chatReadSaga() {
  const hydrationTails: HydrationTails = new Map();
  try {
    yield* all([
      takeEvery(initializeChatRequested, initializeChatWorker, hydrationTails),
      takeEvery(refreshChatTranscriptRequested, refreshChatWorker, hydrationTails),
    ]);
  } finally {
    hydrationTails.clear();
  }
}
