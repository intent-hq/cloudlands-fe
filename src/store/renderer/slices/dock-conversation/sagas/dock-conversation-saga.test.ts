import { createWorkspaceId, createAgentId } from '$shared/types/branded-ids';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fork, take } from 'typed-redux-saga';

// Real LiveAppClient domains, store, companion saga, draft persistence, admission
// and retry helper. Only the external daemon and notification UI are replaced.
// The canonical send action is observed here; the browser integration owns the
// downstream chat-send/stream lifecycle rather than pretending an action is a
// successful agent.sendMessage response.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});
const notifications = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { warning: notifications.warning } }));
vi.mock('svelte', async (original) => ({
  ...(await original<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../../test/mocks/backend-transport.mock';
import { createAdmittedLegacyPrincipal } from '../../../../../test/fixtures/admitted-legacy-principal';
import type { AgentSession } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { clearDraftCacheForTests } from '$lib/components/chat/chat-draft-cache';
import { __resetAgentQueueReadServiceForTests } from '$features/agent/agent-queue-read-service';
import {
  chatInterestLeaseCount,
  clearAllChatInterestLeases,
} from '$features/agent/utils/chat-interest-leases';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { chatDraftsSaga } from '../../chat-drafts/sagas/chat-drafts-saga';
import {
  initializeChatRequested,
  sendMessage,
  transcriptHydrationSettled,
  chatLastAttemptedMessageSet,
} from '../../chat-state/chat-state-slice';
import { pendingSubmissionSettled } from '../../pending-submissions/pending-submissions-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  openDockConversationRequested,
  closeDockConversationRequested,
  selectDockConversationAgentRequested,
  dockConversationDraftChanged,
  dockConversationContextItemsChanged,
  sendDockConversationRequested,
  retryDockConversationSendRequested,
} from '../dock-conversation-slice';
import {
  selectDockConversationView,
  selectDockConversationComposer,
} from '../dock-conversation-selectors';
import { dockConversationSaga } from './dock-conversation-saga';
import { replaceAgentQueue } from '../../agent-queue/agent-queue-slice';
import { selectAgentMessages } from '../../agent-session/agent-session-selectors';
import { selectComposerContextItems } from '../../transient-ui/transient-ui-selectors';
import { selectPendingSubmissionEntry } from '../../pending-submissions/pending-submissions-selectors';
import type { ContextItem } from '$lib/components/chat/input/context-api';

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const timestamp = '2026-10-22T01:00:00.000Z';
let workspaceA: string;
let workspaceB: string;
let mainA: string;
let delegatedA: string;
let mainB: string;
let backend: MockBackendHandle;
let cleanups: (() => void)[];
let sent: ReturnType<typeof sendMessage>[];
let initialized: ReturnType<typeof initializeChatRequested>[];

function agent(id: string, workspaceId: string, main = true): AgentSession {
  return {
    id,
    workspaceId,
    name: id,
    status: 'runtime_idle',
    provider: 'auggie',
    model: 'opus4.7',
    messages: [],
    backendSessionId: id,
    createdAt: timestamp,
    updatedAt: timestamp,
    isInitialAgent: main,
    metadata: main ? { isInitialAgent: true } : {},
    ...(main ? {} : { parentSessionId: mainA }),
  } as AgentSession;
}
function sessionFor(id: string) {
  return agent(id, id === mainB ? workspaceB : workspaceA, id !== delegatedA);
}
const view = () => selectDockConversationView.select(appStore.state);
async function open(workspaceId = workspaceA) {
  appStore.dispatch(openDockConversationRequested(workspaceId));
  await vi.waitFor(() => expect(view().blocked).toBe(false));
}
function latestSend() {
  const result = sent.at(-1);
  if (!result?.payload.payload.submission) throw new Error('Expected admitted canonical send');
  return result;
}
function settle(outcome: 'accepted' | 'rejected' | 'uncertain') {
  const submission = latestSend().payload.payload.submission;
  if (!submission) throw new Error('Missing admission');
  appStore.dispatch(pendingSubmissionSettled(submission.scope, submission.id, outcome, Date.now()));
}

beforeEach(() => {
  workspaceA = createWorkspaceId(crypto.randomUUID());
  workspaceB = createWorkspaceId(crypto.randomUUID());
  mainA = createAgentId(`agent-main-${workspaceA}`);
  delegatedA = createAgentId(`agent-delegate-${workspaceA}`);
  mainB = createAgentId(`agent-main-${workspaceB}`);
  backend = installMockBackend();
  notifications.warning.mockReset();
  sent = [];
  initialized = [];
  const initial = createAdmittedLegacyPrincipal();
  if (!initial.principal.snapshot) throw new Error('Principal fixture must be admitted');
  initial.principal.snapshot.capabilities.submissionCorrelation = 1;
  cleanups = [appStore.init(initial)];
  backend.onRequest('workspace.get', (params) => ({
    workspace: {
      id: (params as { workspaceId: string }).workspaceId,
      title: 'Workspace',
      status: 'active',
      myRole: 'owner',
      canManage: true,
      path: '/fake-workspace',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }));
  backend.onRequest('agent.list', (params) => {
    const { workspaceId, scope } = params as { workspaceId: string; scope: string };
    const primary = workspaceId === workspaceA ? mainA : mainB;
    // Deliberately return a delegated row first: list order cannot choose main.
    return {
      agents:
        scope === 'topLevel'
          ? [agent(delegatedA, workspaceId, false), agent(primary, workspaceId)]
          : scope === 'delegated' && workspaceId === workspaceA
            ? [agent(delegatedA, workspaceId, false)]
            : [],
    };
  });
  backend.onRequest('agent.get', (params) => ({
    agent: sessionFor((params as { agentId: string }).agentId),
  }));
  backend.onRequest('agent.getQueue', () => ({ queue: [] }));
  backend.onRequest('agent.getConversation', () => ({
    messages: [],
    totalMessages: 0,
    truncated: false,
  }));
  backend.onRequest('drafts.get', () => null);
  backend.onRequest('drafts.set', () => ({ ok: true, updatedAt: timestamp }));
  backend.onRequest('drafts.clear', () => ({ ok: true }));
  appStore.dispatch(
    bulkUpsertSessions([sessionFor(mainA), sessionFor(delegatedA), sessionFor(mainB)]),
  );
  for (const id of [mainA, delegatedA, mainB]) appStore.dispatch(transcriptHydrationSettled(id));
  cleanups.push(
    appStore.runSaga(function* observeCanonicalActions() {
      yield* fork(function* () {
        while (true) sent.push(yield* take(sendMessage));
      });
      yield* fork(function* () {
        while (true) initialized.push(yield* take(initializeChatRequested));
      });
    }),
  );
  cleanups.push(appStore.runSaga(chatDraftsSaga));
  cleanups.push(appStore.runSaga(dockConversationSaga));
});
afterEach(() => {
  appStore.dispatch(closeDockConversationRequested());
  cleanups.reverse().forEach((dispose) => dispose());
  clearAllChatInterestLeases();
  clearDraftCacheForTests();
  __resetAgentQueueReadServiceForTests();
  resetMockBackend();
});

describe('companion production saga at fake daemon boundaries', () => {
  // Failure inventory: image-only accepted history must remain visible without a
  // hydration request; canonical blocks must remain intact for production renderers.
  it('retains original image-only and structured media rows without hydration', async () => {
    await open();
    const before = backend.requests.length;
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...sessionFor(mainA),
          messages: [
            {
              id: 'image-only',
              role: 'user',
              timestamp,
              contentBlocks: [
                {
                  type: 'image',
                  attachmentId: '12345678-1234-4234-8234-123456789012',
                  mimeType: 'image/png',
                },
              ],
            },
            {
              id: 'mixed-media',
              role: 'assistant',
              timestamp,
              contentBlocks: [
                {
                  type: 'file',
                  attachmentId: '12345678-1234-4234-8234-123456789013',
                  fileName: 'notes.pdf',
                  mimeType: 'application/pdf',
                  size: 42,
                },
                { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png', dataIsThumbnail: true },
                { type: 'image', data: 'x'.repeat(300_000), mimeType: 'image/png' },
              ],
            },
          ],
        },
      ]),
    );
    const imageRow = view().messages.find((row) => row.id === 'image-only');
    expect(imageRow).toMatchObject({
      role: 'user',
      contentBlocks: [
        {
          type: 'image',
          attachmentId: '12345678-1234-4234-8234-123456789012',
          mimeType: 'image/png',
        },
      ],
    });
    const mediaRow = view().messages.find((row) => row.id === 'mixed-media');
    const media = mediaRow?.contentBlocks;
    expect(mediaRow).toBe(
      selectAgentMessages.select(appStore.state, mainA).find((row) => row.id === 'mixed-media'),
    );
    expect(media).toHaveLength(3);
    expect(media?.[0]).toMatchObject({ type: 'file', fileName: 'notes.pdf', size: 42 });
    expect(media?.[1].data).toBe('aGVsbG8=');
    expect(media?.[2].data).toHaveLength(300_000);
    expect(backend.requests).toHaveLength(before);
  });

  it('preserves bounded canonical notices and filters the human queue without fabricating transcript rows', async () => {
    await open();
    const before = backend.requests.length;
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...sessionFor(mainA),
          messages: [
            ...Array.from({ length: 61 }, (_, index) => ({
              id: `row-${index}`,
              role: 'assistant' as const,
              timestamp,
              seq: index + 1,
              contentBlocks: [{ type: 'text' as const, text: `reply ${index}` }],
            })),
            {
              id: 'automated-notice',
              role: 'user',
              timestamp,
              seq: 62,
              metadata: { type: 'hook_wake', source: 'system' },
              contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS] private wake body' }],
            },
            {
              id: 'structured-notice',
              role: 'system',
              timestamp,
              seq: 63,
              contentBlocks: [
                { type: 'text', text: 'Decision required', meta: { kind: 'discussion-request' } },
              ],
            },
          ],
        },
      ]),
    );
    appStore.dispatch(
      replaceAgentQueue(
        mainA,
        [
          { id: 'human-queue', content: 'human question', queuedAt: timestamp, position: 0 },
          {
            id: 'automatic-queue',
            content: 'raw script output',
            queuedAt: timestamp,
            position: 1,
            messageMetadata: { type: 'event_notification', source: 'system' },
          },
        ],
        workspaceA,
      ),
    );
    const result = view();
    expect(result.messages).toHaveLength(60);
    expect(result.messages[0].id).toBe('row-3');
    expect(result.messages.at(-2)).toMatchObject({
      id: 'automated-notice',
      role: 'user',
      metadata: { type: 'hook_wake', source: 'system' },
    });
    expect(result.messages.at(-1)?.contentBlocks?.[0].meta).toEqual({ kind: 'discussion-request' });
    expect(result.queuedMessages.map((row) => row.id)).toEqual(['human-queue']);
    expect(result.queueRows.map((row) => row.confirmedId)).toEqual(['human-queue']);
    expect(result.messages.some((row) => row.id.startsWith('queued:'))).toBe(false);
    expect(backend.requests).toHaveLength(before);
  });

  it('projects pending admission separately and removes its duplicate when canonical app-message evidence appears', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'pending reply'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const appMessageId = latestSend().payload.payload.userAppMessageId;
    expect(view().pendingMessages).toHaveLength(1);
    expect(view().pendingMessages[0]).toMatchObject({
      appMessageId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'pending reply' }],
    });
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...sessionFor(mainA),
          messages: [
            {
              id: 'confirmed',
              appMessageId,
              role: 'user',
              timestamp,
              contentBlocks: [{ type: 'text', text: 'pending reply' }],
            },
          ],
        },
      ]),
    );
    expect(view().pendingMessages).toHaveLength(0);
    expect(view().messages.map((row) => row.id)).toEqual(['confirmed']);
  });

  it('admits attachment-only input with identical image and file blocks in admission and canonical send', async () => {
    await open();
    const items: ContextItem[] = [
      {
        id: 'image',
        type: 'file',
        label: 'image.png',
        imageData: 'aGVsbG8=',
        imageMimeType: 'image/png',
      },
      {
        id: 'file',
        type: 'file',
        label: 'notes.pdf',
        attachmentId: '12345678-1234-4234-8234-123456789012',
        attachmentMimeType: 'application/pdf',
        attachmentSize: 42,
      },
    ];
    appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, items));
    appStore.dispatch(
      sendDockConversationRequested({
        workspaceId: workspaceA,
        agentId: mainA,
        text: '',
        contextItems: items,
        submissionId: 'clicked-image',
      }),
    );
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const payload = latestSend().payload.payload;
    expect(payload).toMatchObject({
      wsId: workspaceA,
      text: '',
      contextItems: items,
      imageBlocks: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      fileBlocks: [
        {
          type: 'file',
          attachmentId: items[1].attachmentId,
          fileName: 'notes.pdf',
          mimeType: 'application/pdf',
          size: 42,
        },
      ],
    });
    const reference = payload.submission!;
    const entry = selectPendingSubmissionEntry.select(appStore.state, reference.scope)!;
    expect(getItem(entry.submissions, reference.id)).toMatchObject({
      imageBlocks: payload.imageBlocks,
      fileBlocks: payload.fileBlocks,
    });
    // The actual prompt is empty while the admitted send still awaits the daemon.
    expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([]);
    const cleared = selectDockConversationComposer.select(appStore.state);
    expect(cleared.clearSubmissionId).toBe('clicked-image');
    expect(cleared.clearRevision).toBeGreaterThan(0);
    expect(cleared.recoverRevision).toBe(0);
    settle('rejected');
    await vi.waitFor(() =>
      expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual(items),
    );
    const recovered = selectDockConversationComposer.select(appStore.state);
    expect(recovered.clearSubmissionId).toBe('clicked-image');
    expect(recovered.recoverRevision).toBeGreaterThan(cleared.clearRevision);
  });

  it('keeps the clicked attachment snapshot and preserves newer attachment edits after acceptance', async () => {
    await open();
    const held = deferred<{ agent: AgentSession }>();
    backend.onRequest('agent.get', () => held.promise);
    const original: ContextItem = {
      id: 'original',
      type: 'file',
      label: 'old.png',
      imageData: 'b2xk',
      imageMimeType: 'image/png',
    };
    const newer: ContextItem = {
      id: 'newer',
      type: 'file',
      label: 'new.png',
      imageData: 'bmV3',
      imageMimeType: 'image/png',
    };
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'clicked'));
    appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, [original]));
    appStore.dispatch(sendDockConversationRequested());
    appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, [newer]));
    held.resolve({ agent: sessionFor(mainA) });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload.payload.contextItems).toEqual([original]);
    expect(latestSend().payload.payload.imageBlocks).toEqual([
      { type: 'image', data: 'b2xk', mimeType: 'image/png' },
    ]);
    settle('accepted');
    await vi.waitFor(() =>
      expect(
        getItem(appStore.state.dockConversation.drafts, JSON.stringify([workspaceA, mainA]))
          ?.delivery?.settled,
      ).toBe(true),
    );
    expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([newer]);
    expect(view().draft).toBe('clicked');
    expect(backend.requests.filter((row) => row.method === 'drafts.clear')).toHaveLength(0);
  });

  it('restores attached drafts, isolates workspace switches, and persists attached edits on close', async () => {
    const restored: ContextItem = {
      id: 'restored',
      type: 'file',
      label: 'saved.png',
      imageData: 'c2F2ZWQ=',
      imageMimeType: 'image/png',
    };
    backend.onRequest('drafts.get', (params) =>
      (params as { workspaceId: string }).workspaceId === workspaceA
        ? { text: 'saved draft', attachments: [restored], updatedAt: timestamp }
        : null,
    );
    await open();
    expect(view().attention).toBeNull();
    expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([
      restored,
    ]);
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'edited draft'));
    await open(workspaceB);
    expect(selectComposerContextItems.select(appStore.state, workspaceB, mainB)).toEqual([]);
    await open(workspaceA);
    expect(view().draft).toBe('edited draft');
    expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([
      restored,
    ]);
    appStore.dispatch(closeDockConversationRequested());
    await vi.waitFor(() =>
      expect(backend.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'drafts.set',
            params: expect.objectContaining({
              workspaceId: workspaceA,
              agentId: mainA,
              text: 'edited draft',
              attachments: [restored],
            }),
          }),
        ]),
      ),
    );
  });

  it('blocks placing or failed attachments and distinguishes ordinary from interrupt submissions', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'reply'));
    for (const placementStatus of ['placing', 'failed'] as const) {
      appStore.dispatch(
        dockConversationContextItemsChanged(workspaceA, mainA, [
          {
            id: 'pending',
            type: 'file',
            label: 'file.pdf',
            sourcePath: '/fake/file.pdf',
            placementStatus,
          },
        ]),
      );
      appStore.dispatch(sendDockConversationRequested());
      expect(sent).toHaveLength(0);
    }
    appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, []));
    appStore.dispatch(
      sendDockConversationRequested({
        workspaceId: workspaceA,
        agentId: mainA,
        text: 'reply',
        contextItems: [],
        forceSubmit: true,
      }),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload.payload.forceSubmit).toBe(true);
    settle('accepted');
    await vi.waitFor(() => expect(view().draft).toBe(''));
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'ordinary'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(latestSend().payload.payload.forceSubmit).not.toBe(true);
  });

  it('rejects a stale composer submission for A while B is selected', async () => {
    await open();
    await open(workspaceB);
    appStore.dispatch(dockConversationDraftChanged(workspaceB, mainB, 'B draft'));
    const before = backend.requests.length;
    appStore.dispatch(
      sendDockConversationRequested({
        workspaceId: workspaceA,
        agentId: mainA,
        text: 'A late click',
        contextItems: [],
      }),
    );
    expect(sent).toHaveLength(0);
    expect(backend.requests).toHaveLength(before);
    expect(view().draft).toBe('B draft');
  });

  it('hands a pending structured question to the full conversation before ordinary replies', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'Keep this reply'));
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...sessionFor(mainA),
          metadata: { isInitialAgent: true, pendingQuestionsMessageId: 'pending-question' },
        },
      ]),
    );
    expect(view().attention).toBeTruthy();
    expect(view().blocked).toBe(true);
    const beforeSend = backend.requests.length;
    appStore.dispatch(sendDockConversationRequested());
    await Promise.resolve();
    expect(sent).toHaveLength(0);
    expect(backend.requests).toHaveLength(beforeSend);
    expect(view().draft).toBe('Keep this reply');

    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...sessionFor(mainA),
          metadata: { isInitialAgent: true, pendingQuestionsMessageId: '' },
        },
      ]),
    );
    expect(view().attention).toBeNull();
    expect(view().blocked).toBe(false);
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload.payload.text).toBe('Keep this reply');
  });

  it('reads exact workspace/scoped agents, chooses authoritative main, and initializes a delegated override exactly', async () => {
    await open();
    expect(backend.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'workspace.get', params: { workspaceId: workspaceA } }),
        expect.objectContaining({
          method: 'agent.get',
          params: { workspaceId: workspaceA, agentId: mainA },
        }),
        ...['topLevel', 'delegated', 'background'].map((scope) =>
          expect.objectContaining({
            method: 'agent.list',
            params: { workspaceId: workspaceA, scope },
          }),
        ),
      ]),
    );
    expect(view().agentId).toBe(mainA);
    expect(initialized.at(-1)?.payload).toEqual({ agentId: mainA, wsId: workspaceA });
    expect(chatInterestLeaseCount(mainA)).toBe(1);
    appStore.dispatch(selectDockConversationAgentRequested(delegatedA));
    await vi.waitFor(() => expect(view().agentId).toBe(delegatedA));
    await vi.waitFor(() =>
      expect(initialized.at(-1)?.payload).toEqual({ agentId: delegatedA, wsId: workspaceA }),
    );
    expect(chatInterestLeaseCount(mainA)).toBe(0);
    expect(chatInterestLeaseCount(delegatedA)).toBe(1);
    expect(sent).toHaveLength(0);
    expect(backend.requests.some((row) => row.method === 'agent.create')).toBe(false);
  });

  it('rejects an exact agent response belonging to another workspace without initializing or sending', async () => {
    backend.onRequest('agent.get', () => ({ agent: agent(mainA, workspaceB) }));
    appStore.dispatch(openDockConversationRequested(workspaceA));
    await vi.waitFor(() => expect(appStore.state.dockConversation.error).not.toBeNull());
    expect(initialized).toHaveLength(0);
    expect(chatInterestLeaseCount(mainA)).toBe(0);
    appStore.dispatch(sendDockConversationRequested());
    expect(sent).toHaveLength(0);
    expect(backend.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'agent.get',
          params: { workspaceId: workspaceA, agentId: mainA },
        }),
      ]),
    );
  });

  it('ignores a held A response after B opens and releases B interest on close', async () => {
    const held = deferred<{ agent: AgentSession }>();
    backend.onRequest('agent.get', (params) => {
      const id = (params as { agentId: string }).agentId;
      return id === mainA ? held.promise : { agent: sessionFor(id) };
    });
    appStore.dispatch(openDockConversationRequested(workspaceA));
    await vi.waitFor(() =>
      expect(
        backend.requests.some(
          (row) =>
            row.method === 'agent.get' && (row.params as { agentId: string }).agentId === mainA,
        ),
      ).toBe(true),
    );
    await open(workspaceB);
    held.resolve({ agent: sessionFor(mainA) });
    await Promise.resolve();
    expect(view().workspaceId).toBe(workspaceB);
    expect(view().agentId).toBe(mainB);
    expect(initialized.map((row) => row.payload.agentId)).toEqual([mainB]);
    expect(chatInterestLeaseCount(mainA)).toBe(0);
    appStore.dispatch(closeDockConversationRequested());
    await vi.waitFor(() => expect(chatInterestLeaseCount(mainB)).toBe(0));
  });

  it('clears on local admission before acknowledgement and recovers rejection without erasing newer edits', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'first reply'));
    appStore.dispatch(sendDockConversationRequested());
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload).toMatchObject({
      agentId: mainA,
      payload: {
        wsId: workspaceA,
        text: 'first reply',
        userAppMessageId: expect.any(String),
        submission: { id: expect.any(String), scope: { workspaceId: workspaceA, agentId: mainA } },
      },
    });
    expect(view().draft).toBe('');
    settle('rejected');
    await vi.waitFor(() => expect(view().draft).toBe('first reply'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'new unsent reply'));
    settle('accepted');
    expect(view().draft).toBe('new unsent reply');
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    settle('accepted');
    await vi.waitFor(() => expect(view().draft).toBe(''));
    expect(
      backend.requests.filter((row) => row.method === 'drafts.clear').map((row) => row.params),
    ).toEqual(Array.from({ length: 3 }, () => ({ workspaceId: workspaceA, agentId: mainA })));
  });

  it.each(['rejected', 'uncertain'] as const)(
    'does not restore a %s snapshot over a newer draft and attachments',
    async (outcome) => {
      await open();
      const original: ContextItem = {
        id: 'original',
        type: 'file',
        label: 'original.png',
        imageData: 'aGVsbG8=',
        imageMimeType: 'image/png',
      };
      appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'sent text'));
      appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, [original]));
      appStore.dispatch(sendDockConversationRequested());
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(view().draft).toBe('');
      expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([]);
      const newer: ContextItem = { ...original, id: 'newer', label: 'newer.png' };
      appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'next draft'));
      appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, [newer]));
      settle(outcome);
      // Each callback settles its own operation once. Uncertainty can only be
      // reconciled by delivery evidence, not a second contradictory callback.
      await vi.waitFor(() => {
        if (outcome === 'uncertain') expect(view().blocked).toBe(true);
        else expect(view().attention).toBeNull();
      });
      expect(view().draft).toBe('next draft');
      expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([newer]);
    },
  );

  it('sends the clicked snapshot while typing during held target validation remains unsent', async () => {
    await open();
    const held = deferred<{ agent: AgentSession }>();
    backend.onRequest('agent.get', () => held.promise);
    const beforeGet = backend.requests.filter((row) => row.method === 'agent.get').length;
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'clicked text'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() =>
      expect(backend.requests.filter((row) => row.method === 'agent.get')).toHaveLength(
        beforeGet + 1,
      ),
    );
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'newer unsent typing'));
    held.resolve({ agent: sessionFor(mainA) });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload).toMatchObject({
      agentId: mainA,
      payload: { wsId: workspaceA, text: 'clicked text' },
    });
    settle('accepted');
    await vi.waitFor(() =>
      expect(
        getItem(appStore.state.dockConversation.drafts, JSON.stringify([workspaceA, mainA]))
          ?.delivery?.settled,
      ).toBe(true),
    );
    expect(view().draft).toBe('newer unsent typing');
    expect(backend.requests.filter((row) => row.method === 'drafts.clear')).toHaveLength(0);
  });

  it('sends B once while A validation is held and discards A after the switch', async () => {
    await open(workspaceA);
    const heldA = deferred<{ agent: AgentSession }>();
    backend.onRequest('agent.get', (params) => {
      const id = (params as { agentId: string }).agentId;
      return id === mainA ? heldA.promise : { agent: sessionFor(id) };
    });
    const beforeAGet = backend.requests.filter(
      (row) => row.method === 'agent.get' && (row.params as { agentId: string }).agentId === mainA,
    ).length;
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'A clicked reply'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() =>
      expect(
        backend.requests.filter(
          (row) =>
            row.method === 'agent.get' && (row.params as { agentId: string }).agentId === mainA,
        ),
      ).toHaveLength(beforeAGet + 1),
    );

    await open(workspaceB);
    appStore.dispatch(dockConversationDraftChanged(workspaceB, mainB, 'B clicked reply'));
    appStore.dispatch(sendDockConversationRequested());
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload).toMatchObject({
      agentId: mainB,
      payload: { wsId: workspaceB, text: 'B clicked reply' },
    });
    expect(view().draft).toBe('');

    heldA.resolve({ agent: sessionFor(mainA) });
    // Drain the held transport/normalizer continuation before asserting no A send.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sent.map((action) => action.payload.agentId)).toEqual([mainB]);
    expect(view().workspaceId).toBe(workspaceB);
    expect(view().draft).toBe('');
    settle('accepted');
    await vi.waitFor(() => expect(view().draft).toBe(''));
    expect(
      getItem(appStore.state.dockConversation.drafts, JSON.stringify([workspaceA, mainA]))?.text,
    ).toBe('A clicked reply');
    expect(
      backend.requests.filter((row) => row.method === 'drafts.clear').map((row) => row.params),
    ).toEqual([{ workspaceId: workspaceB, agentId: mainB }]);
    expect(sent).toHaveLength(1);
  });

  it('retains another agent draft while an earlier agent acknowledgement arrives', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'A reply'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    appStore.dispatch(selectDockConversationAgentRequested(delegatedA));
    await vi.waitFor(() => expect(view().agentId).toBe(delegatedA));
    appStore.dispatch(dockConversationDraftChanged(workspaceA, delegatedA, 'B draft'));
    settle('accepted');
    expect(view().draft).toBe('B draft');
    expect(view().agentId).toBe(delegatedA);
  });

  it('uses canonical retry admission for a known rejection under current authority', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'rejected reply'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const submission = latestSend().payload.payload.submission;
    if (!submission) throw new Error('Expected submission');
    settle('rejected');
    appStore.dispatch(
      chatLastAttemptedMessageSet(mainA, {
        text: 'rejected reply',
        submission: { reference: submission, outcome: 'rejected' },
      }),
    );
    appStore.dispatch(retryDockConversationSendRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(latestSend().payload).toMatchObject({
      agentId: mainA,
      payload: {
        wsId: workspaceA,
        text: 'rejected reply',
        submission: { scope: { agentId: mainA, workspaceId: workspaceA } },
      },
    });
    expect(latestSend().payload.payload.submission?.id).not.toBe(submission.id);
    expect(notifications.warning).not.toHaveBeenCalled();
    settle('accepted');
    await vi.waitFor(() => expect(view().draft).toBe(''));
  });

  it('hands uncertain delivery to the full conversation without reads, notifications or resend and refuses mutation after authority loss', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'uncertain reply'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const submission = latestSend().payload.payload.submission;
    if (!submission) throw new Error('Expected submission');
    settle('uncertain');
    appStore.dispatch(
      chatLastAttemptedMessageSet(mainA, {
        text: 'uncertain reply',
        submission: { reference: submission, outcome: 'uncertain' },
      }),
    );
    expect(view().canRetry).toBe(false);
    expect(view().attention).toBeTruthy();
    expect(view().blocked).toBe(true);
    const beforeReads = backend.requests.length;
    appStore.dispatch(retryDockConversationSendRequested());
    await Promise.resolve();
    expect(notifications.warning).not.toHaveBeenCalled();
    expect(backend.requests).toHaveLength(beforeReads);
    expect(sent).toHaveLength(1);
    expect(view().draft).toBe('uncertain reply');
    appStore.dispatch(connectionStatusChanged('disconnected'));
    const beforeRetry = backend.requests.length;
    appStore.dispatch(retryDockConversationSendRequested());
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(
      backend.requests.slice(beforeRetry).filter((row) => row.method === 'agent.get'),
    ).toHaveLength(0);
  });
});
