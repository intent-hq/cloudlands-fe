/**
 * Reusable on-demand transcript read seam used by the daemon event router
 * (reconnect / event-driven refetches). `loadChatTranscript(agentId)` fetches
 * the session (`appClient.agents.get`) AND the transcript by paging through
 * `agent.getConversation` (PROTOCOL §5.5, 50 messages per page, looping
 * on `nextToken`). Paging walks from the newest page backwards and stops once
 * `MAX_MESSAGES_PER_AGENT` messages have accumulated — the agent-session slice
 * prunes to that same cap anyway, so pages past it would be fetched only
 * to be discarded (intent-hq/monorepo#2627). The daemon's
 * AgentLite projection (from `agents.get`) returns only message COUNTS, so
 * `getConversation` is the sole source of the actual message content.
 * `bulkUpsertSessions` populates the agent-session slice (`byAgentId` + messages
 * = the conversation), and `upsertSession` registers the agent id in the
 * workspace-agents index.
 *
 * READ-ONLY: this module never invokes an agent mutation (no create/send/stop).
 *
 * Loads are coalesced per agent via an in-flight map. A request arriving while
 * a load is already in flight marks a single pending RERUN instead of silently
 * sharing the (possibly already stale) in-flight read (monorepo#1019): when the
 * current load settles, exactly one follow-up load runs. Multiple mid-flight
 * requests collapse into that one rerun, so there is no unbounded loop.
 *
 * Errors are swallowed (logged only) so a failed read leaves any prior session
 * intact rather than clobbering it with an empty transcript. If `agents.get`
 * returns null we skip entirely (do not fabricate a session).
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions (plus its shared prune-cap constant), and
 * the logger.
 */
import type { AgentMessage } from '$shared/types';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  transcriptHydrationStarted,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  MAX_MESSAGES_PER_AGENT,
  bulkUpsertSessions,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { deduplicateAgentMessages } from '$shared/utils/message-dedup';
import { createLogger } from '$lib/utils/client-logger';
import { isAgentDeletionPending } from './utils/pending-agent-deletions';
import { readAgentSession } from './agent-read-service';

const logger = createLogger('ChatReadService');

/** In-flight loads keyed by agent id; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/** Pending follow-up loads keyed by agent id; at most one rerun per in-flight load. */
const pendingRerun = new Map<string, Promise<void>>();

/** Dependency-light one-time read of the store's current transcript (no selector import). */
function readCurrentMessages(agentId: string): AgentMessage[] {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, { messages?: AgentMessage[] }> };
  };
  return state.agentSessions?.byAgentId[agentId]?.messages ?? [];
}

/**
 * Fetch a single agent's session AND its FULL transcript from the seam, then
 * hydrate the store with `{ ...session, messages }`. Pages through
 * agent.getConversation to assemble the complete transcript (50 messages per
 * page). Errors are swallowed (logged only) so
 * a failed read never clears an existing transcript. Concurrent calls for the
 * same agent share one fetch.
 */
export async function loadChatTranscript(agentId: string): Promise<void> {
  // A soft-hidden deletion is pending (undo window still open): the daemon
  // still returns the agent, so hydrating would re-upsert the deleted
  // session. Skip entirely.
  if (isAgentDeletionPending(agentId)) return;
  const pending = inFlight.get(agentId);
  if (pending) {
    // A request arriving mid-load means the in-flight read may already be
    // stale (e.g. the turn finalized after paging began). Returning the
    // pending promise as-is swallowed the refetch (monorepo#1019); instead,
    // schedule exactly ONE follow-up load after the current one settles.
    // Further mid-flight requests coalesce into that same rerun. The rerun
    // clears its map entry before starting, so a request arriving DURING the
    // rerun schedules at most one more — reruns only run when requested,
    // never in an unbounded loop.
    const scheduledRerun = pendingRerun.get(agentId);
    if (scheduledRerun) return scheduledRerun;
    const rerun = pending.then(() => {
      pendingRerun.delete(agentId);
      return loadChatTranscript(agentId);
    });
    pendingRerun.set(agentId, rerun);
    return rerun;
  }

  // Create a placeholder promise that we'll resolve once the actual work is done
  let resolveRun!: () => void;
  const runPromise = new Promise<void>((resolve) => {
    resolveRun = resolve;
  });

  // Register in inFlight BEFORE dispatching to prevent re-entrant calls
  inFlight.set(agentId, runPromise);

  // BASELINE snapshot (monorepo#1019): identity set (id + appMessageId) of the
  // store's messages at the moment this read begins. The merge guard below
  // retains only store-only messages ABSENT from this baseline — i.e. exactly
  // the ones the live stream appended DURING the read. Pre-read rows the fetch
  // dropped (BE truncation via edit/regenerate or agent.replaceMessages, from
  // this or any other client) converge to BE state instead of becoming ghosts.
  const baselineIds = new Set<string>();
  for (const message of readCurrentMessages(agentId)) {
    if (typeof message.id === 'string') baselineIds.add(message.id);
    if (typeof message.appMessageId === 'string') baselineIds.add(message.appMessageId);
  }

  // Dispatch loading status synchronously now that we're registered
  // Wrap in try/catch to ensure cleanup if dispatch throws
  try {
    appStore.dispatch(transcriptHydrationStarted(agentId));
  } catch (error) {
    // If dispatch throws, clean up inFlight but do NOT resolve the promise
    // (coalesced callers should see the failure, not a fake success)
    inFlight.delete(agentId);
    throw error;
  }

  // Actually perform the work
  (async () => {
    try {
      const session = await readAgentSession(agentId);
      if (!session) return;
      // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
      // §5.5 `pendingDeleteAt`, v6.7+) — a deletion scheduled by another
      // window/client (or before an FE restart) is not in the local registry.
      if (session.pendingDeleteAt) return;
      // Re-check after the fetch: a deletion may have become pending while
      // `agent.get` was in flight; hydrating now would resurrect the
      // soft-hidden session (and paging the transcript would be wasted work).
      if (isAgentDeletionPending(agentId)) return;

      // Fetch the transcript by paging through agent.getConversation.
      // Request 50 messages per page and loop on nextToken.
      // Paging walks newest→oldest, so stopping at MAX_MESSAGES_PER_AGENT keeps
      // exactly the newest messages the store's prune cap would retain —
      // older pages would be fetched only to be sliced off by the
      // agent-session slice (intent-hq/monorepo#2627).
      const allMessages: AgentMessage[] = [];
      let nextToken: string | null = null;
      const pageLimit = 50;

      do {
        const page = await appClient.agents.getConversation(
          agentId,
          pageLimit,
          nextToken || undefined,
        );
        // getConversation returns oldest→newest within each page and pages
        // walk newest→oldest, so prepend each page to keep the accumulated
        // list in overall oldest→newest order.
        allMessages.unshift(...page.messages);
        nextToken = page.nextToken;
      } while (nextToken !== null && allMessages.length < MAX_MESSAGES_PER_AGENT);

      // Final re-check before any side effects: the deletion may have become
      // pending during transcript paging above.
      if (isAgentDeletionPending(agentId)) return;

      // NOTE: no in-flight assistant merge here — the standing
      // `chat.subscribe` subscription (chat-subscribe saga) is the sole
      // source of the live-turn slot: its seq-0 snapshot carries the CS-0 D5
      // merged in-flight message, it seeds the bridge stream accumulator,
      // and its transcriptHydrationSettled re-apply restores the in-flight
      // row immediately after this hydration settles. Event-router callers
      // (agent:message self-heal, reconnect refresh) don't dispatch that
      // action, so a mid-stream refetch on those paths can drop the
      // in-flight partial until the next delta emit re-applies it — an
      // ACCEPTED flicker window bounded by chunk cadence (and the reconnect
      // path re-registers the subscription, serving a fresh snapshot).
      const finalMessages = allMessages;

      // STALE-HYDRATION MERGE GUARD (monorepo#1019): a store message absent
      // from the fetched set AND from the pre-read baseline was appended by
      // the live stream AFTER this hydration read began; replacing the list
      // wholesale would wipe it. Merge those post-baseline messages with the
      // fetched set by message id (fetched copies win for shared ids).
      // Baseline messages missing from the fetch are deliberately DROPPED so
      // BE-side truncations (edit/regenerate refetch convergence, iOS
      // editAndRegenerate, daemon agent.replaceMessages) still shrink the
      // transcript instead of leaving permanent ghost rows.
      const appendedDuringRead = readCurrentMessages(agentId).filter(
        (m) =>
          !(
            (typeof m.id === 'string' && baselineIds.has(m.id)) ||
            (typeof m.appMessageId === 'string' && baselineIds.has(m.appMessageId))
          ),
      );
      const mergedMessages =
        appendedDuringRead.length === 0
          ? finalMessages
          : deduplicateAgentMessages([...finalMessages, ...appendedDuringRead]);

      // Render BE state as-is: the daemon is the single source of truth for
      // streaming/responding flags. If a chat opens with "Thinking", that is
      // because the daemon snapshot actually reports a turn is in-flight;
      // any orphan/stale healing belongs in the daemon, not the renderer.
      const sessionWithMessages = { ...session, messages: mergedMessages };
      appStore.dispatch(bulkUpsertSessions([sessionWithMessages]));
      appStore.dispatch(upsertSession(sessionWithMessages));
    } catch (error) {
      logger.error('Failed to load agent conversation transcript', error);
      // Errors are swallowed (don't reject the promise)
    } finally {
      // Always mark as settled, whether success or error (errors are swallowed)
      // Wrap cleanup in try/finally to ensure inFlight.delete and resolveRun
      // run even if the dispatch throws
      try {
        appStore.dispatch(transcriptHydrationSettled(agentId));
      } finally {
        inFlight.delete(agentId);
        resolveRun();
      }
    }
  })();

  return runPromise;
}
