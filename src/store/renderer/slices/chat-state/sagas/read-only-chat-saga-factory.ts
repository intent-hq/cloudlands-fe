import type { createMessageBlockHydrationWorkers } from './message-block-hydration-workers';
import type { createHistoryPageWorkers } from './history-page-workers';
import type { createMessageHistorySeeker } from '../message-history-seeker';
import { buffers, eventChannel, type Task } from 'redux-saga';
import { call, cancel, cancelled, join, put, race, take, takeEvery } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelSelector } from '@themislib/themis/saga';
import { takeLatestByContext } from '../../../utils/context-saga-effects';
import type { AgentSession } from '$shared/types';
import type { ChatClient, ChatTranscript, ChatLiveStreamPhase } from '$lib/client/app-client';
import {
  bulkUpsertSessions,
  clearHistorySegment,
  replaceMessages,
  updateSession,
} from '../../agent-session/agent-session-slice';
import {
  scrollbackContinuationReset,
  messageHistoryRequested,
  messageHistoryReleased,
  retainedChatTranscriptsSet,
  chatTrackedWorkspaceSet,
  chatLiveStreamPhaseChanged,
  chatTranscriptSnapshotApplied,
  chatInitialHistoryProgressed,
  transcriptHydrationStarted,
  transcriptHydrationSettled,
  transcriptHydrationFailed,
} from '../chat-state-slice';

type Lease = { workspaceId: string; agentId: string };
type LeaseChange = { lease: Lease; active: boolean };
type ReadEvent = { transcript: ChatTranscript } | { phase: ChatLiveStreamPhase };

/**
 * Read-only renderer binding of the canonical chat client and reducers. This
 * owns retained-chat actions only in a renderer without chatSubscribeSaga.
 * No send, unread, optimistic merge or mutation watcher is started.
 */
export function createReadOnlyChatSaga<State>({
  chat,
  readAgentSession,
  contextSelector,
  readAdmission,
  historyPages,
  seekMessage,
  messageBlocks,
}: {
  messageBlocks?: ReturnType<typeof createMessageBlockHydrationWorkers>;
  seekMessage?: ReturnType<typeof createMessageHistorySeeker>;
  historyPages?: ReturnType<typeof createHistoryPageWorkers>;
  chat: ChatClient;
  readAgentSession: (agentId: string, workspaceId: string) => Promise<AgentSession | null>;
  contextSelector: SelectorChannelSelector<string | null, [], State>;
  readAdmission: (workspaceId: string) => string | null;
}) {
  return function* readOnlyChatSaga() {
    const leases = new Map<string, Lease[]>();
    const readers = new Map<string, object>();
    let notify: (() => void) | undefined;
    yield* takeEvery(
      retainedChatTranscriptsSet,
      function* ({ payload: [owner, workspaceId, ids] }) {
        if (ids.length)
          leases.set(
            owner,
            [...new Set(ids)].map((agentId) => ({ workspaceId, agentId })),
          );
        else leases.delete(owner);
        notify?.();
      },
    );

    yield* takeEvery(messageHistoryRequested, function* (action) {
      const [owner, workspaceId, agentId, messageId, requestId] = action.payload;
      const key = `${workspaceId}\u0000${agentId}`;
      const reader = readers.get(key);
      const lease = leases
        .get(owner)
        ?.find((item) => item.workspaceId === workspaceId && item.agentId === agentId);
      const authority = readAdmission(workspaceId);
      const current = () =>
        Boolean(
          authority &&
          reader &&
          lease &&
          readers.get(key) === reader &&
          leases.get(owner)?.includes(lease) &&
          readAdmission(workspaceId) === authority,
        );
      if (!seekMessage || !current()) {
        yield* put(action.failure(new Error('Conversation reader is no longer admitted')));
        return;
      }
      const controller = new AbortController();
      try {
        const outcome = yield* race({
          found: call(seekMessage, agentId, messageId, workspaceId, {
            isCurrent: current,
            signal: controller.signal,
          }),
          released: call(function* waitForRelease() {
            while (true) {
              const {
                payload: [id],
              } = yield* take(messageHistoryReleased);
              if (id === requestId) return;
            }
          }),
          ownerChanged: call(function* waitForOwnerChange() {
            while (true) {
              const {
                payload: [id],
              } = yield* take(retainedChatTranscriptsSet);
              if (id === owner) return;
            }
          }),
          readerStopped: call(function* waitForReaderStop() {
            while (true) {
              const {
                payload: [id, workspace],
              } = yield* take(chatTrackedWorkspaceSet);
              if (id === agentId && workspace === null) return;
            }
          }),
        });
        if (typeof outcome.found === 'boolean' && current())
          yield* put(action.success(outcome.found));
        else yield* put(action.failure(new Error('Message navigation cancelled')));
      } catch (error) {
        yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
      } finally {
        controller.abort();
        if (yield* cancelled())
          yield* put(action.failure(new Error('Conversation reader stopped')));
      }
    });

    function* read({ workspaceId, agentId }: Lease) {
      const authority = readAdmission(workspaceId);
      if (!authority) return;
      const current = () => readAdmission(workspaceId) === authority;
      const key = `${workspaceId}\u0000${agentId}`;
      const reader = {};
      const pageWatchers: Task[] = [];
      let events: ReturnType<typeof eventChannel<ReadEvent>> | undefined;
      try {
        yield* put(clearHistorySegment(agentId));
        yield* put(scrollbackContinuationReset(agentId));
        yield* put(chatTrackedWorkspaceSet(agentId, workspaceId));
        yield* put(transcriptHydrationStarted(agentId));
        const session = yield* call(readAgentSession, agentId, workspaceId);
        if (!current()) return;
        if (!session || session.workspaceId !== workspaceId || session.pendingDeleteAt) {
          yield* put(transcriptHydrationFailed(agentId));
          return;
        }
        yield* put(bulkUpsertSessions([session]));
        events = eventChannel<ReadEvent>(
          (emit) =>
            chat.subscribe(
              agentId,
              (transcript) => emit({ transcript }),
              (phase) => emit({ phase }),
              { workspaceId },
            ),
          buffers.expanding(),
        );
        readers.set(key, reader);
        if (messageBlocks)
          pageWatchers.push(yield* messageBlocks.watch((id) => current() && id === agentId, true));
        if (historyPages) {
          pageWatchers.push(
            ...(yield* historyPages.watch(
              (wsId, id) => current() && wsId === workspaceId && id === agentId,
            )),
          );
        }
        while (true) {
          const event = yield* take(events);
          if (!current()) return;
          if ('phase' in event) {
            yield* put(chatLiveStreamPhaseChanged(agentId, event.phase));
            continue;
          }
          const transcript = event.transcript;
          // The shared reconciler owns the tail; canonical history stays in
          // its separate bounded segment and survives ordinary tail updates.
          yield* put(replaceMessages(agentId, transcript.messages));
          yield* put(updateSession(agentId, { isStreaming: transcript.isStreaming }));
          if (transcript.initialHistory?.complete === false && !transcript.fromSnapshot) {
            yield* put(chatInitialHistoryProgressed(agentId, transcript.initialHistory));
          }
          if (
            transcript.fromSnapshot ||
            (transcript.fromHistory && transcript.initialHistory?.complete)
          ) {
            yield* put(
              chatTranscriptSnapshotApplied(agentId, {
                truncated: transcript.truncated,
                totalMessages: transcript.totalMessages,
                nextToken: transcript.nextToken,
                initialHistory: transcript.initialHistory,
                resumed: transcript.resetCachedTranscript === true ? false : transcript.resumed,
              }),
            );
            yield* put(transcriptHydrationSettled(agentId));
          }
        }
      } catch {
        if (current()) yield* put(transcriptHydrationFailed(agentId));
      } finally {
        if (readers.get(key) === reader) readers.delete(key);
        yield* cancel(pageWatchers);
        events?.close();
        yield* put(clearHistorySegment(agentId));
        yield* put(scrollbackContinuationReset(agentId));
        yield* put(chatLiveStreamPhaseChanged(agentId, null));
        yield* put(chatTrackedWorkspaceSet(agentId, null));
      }
    }

    const observer = yield* takeLatestFromSelector(
      contextSelector,
      function* ({ payload: context }) {
        if (!context) return;
        const changes = eventChannel<LeaseChange>((emit) => {
          let previous = new Map<string, Lease>();
          const refresh = () => {
            const wanted = new Map(
              [...leases.values()].flat().map((lease) => [JSON.stringify(lease), lease]),
            );
            for (const [key, lease] of previous) {
              if (!wanted.has(key)) emit({ lease, active: false });
            }
            for (const lease of wanted.values()) emit({ lease, active: true });
            previous = wanted;
          };
          notify = refresh;
          refresh();
          return () => {
            if (notify === refresh) notify = undefined;
          };
        }, buffers.expanding());
        try {
          // The shared watcher deduplicates an active lease, cancels it on
          // removal, and permits retry once a failed read has finished.
          const subscriptions = yield* takeLatestByContext(
            changes,
            ({ lease, active }) => ({ context: JSON.stringify(lease), generation: active ? 0 : 1 }),
            function* ({ lease, active }) {
              if (active) yield* call(read, lease);
            },
          );
          yield* join(subscriptions);
        } finally {
          changes.close();
        }
      },
    );
    yield* join(observer);
  };
}
