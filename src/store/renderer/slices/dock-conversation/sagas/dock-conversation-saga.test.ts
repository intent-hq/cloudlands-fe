import * as mediaSend from '$features/hud/composer/dock-media-send';
import {
  defaultDockMediaEdit,
  type DockSavedMedia,
  type DockMediaSource,
} from '$shared/dock-media-edit';
import { emptyDockEvidence, dockEvidenceId } from '$shared/dock-evidence';
import { dockEvidenceRestored, dockEvidenceMediaChanged, dockEvidenceAnnotationChanged } from '../dock-conversation-slice';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createWorkspaceId, createAgentId, CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
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
// Canvas compositing is browser-only; the saga contract is which pixels and marks it burns.
vi.mock('$features/hud/composer/dock-evidence-render', () => ({
  burnDockEvidenceImage: vi.fn(
    async (source: { base64: string }, image: { id: string }, marks: { n: number }[]) => ({
      base64: `burned:${source.base64}:${marks.map((row) => row.n).join(',')}`,
      mimeType: 'image/jpeg',
    }),
  ),
}));
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
  dockEvidenceMediaPasted,
} from '../dock-conversation-slice';
import {
  selectDockConversationView,
  selectDockConversationComposer,
} from '../dock-conversation-selectors';
import { dockConversationSaga } from './dock-conversation-saga';
import { configureDockEvidenceNative, evidenceOf, setDockDictationMarkSink } from './dock-evidence-saga';
import { DOCK_CAPTURE_EDITOR_CHANNELS } from '$shared/dock-capture-editor';
import {
  __resetDockRetentionProbesForTests,
  captureDockPasteOrigin,
} from '$features/hud/composer/dock-evidence-placement';
import { systemStatusSuccess } from '../../daemon-health/daemon-health-slice';
import type { SystemStatusWirePayload } from '../../daemon-health/daemon-health-types';
import {
  dockEvidenceAnnotationToggleRequested,
  dockEvidenceToolSelectRequested,
  dockEvidenceCaptureCancelled,
  dockEvidenceCaptureRequested,
  dockMediaEditorOpenRequested,
  dockEvidenceCaptureModeSet,
  dockEvidenceImageRemoveRequested,
  dockEvidenceInsertionCommitted,
  dockEvidenceInsertionQueued,
  dockEvidenceClipRemoveRequested,
  dockEvidenceRecordToggleRequested,
  dockEvidenceServerCapabilitiesObserved,
  dockEvidenceDictationChanged,
  dockEvidenceAnnotationEndRequested,
  dockEvidenceBarMediaChanged,
  dockEvidenceCaptureFailed,
} from '../dock-conversation-slice';
import { selectDockComposerEvidence } from '../dock-conversation-selectors';
import {
  DOCK_EVIDENCE_CONTEXT_HEADER,
  type DockCapturedPixels,
  type DockEvidenceNativeEvent,
  type DockEvidenceNativeService,
  type DockNativeResult,
} from '$shared/dock-evidence';
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
  configureDockEvidenceNative(null);
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

function shot(n: number): DockCapturedPixels {
  return {
    base64: btoa(`shot-${n}`),
    mimeType: 'image/png',
    width: 2880,
    height: 1800,
    displayScale: 2,
    capturedAt: `2026-10-29T18:12:0${n}Z`,
  };
}
/** Real native contract, scripted: captures succeed, sessions start, events are emitted by the test. */
function scriptedNative(
  options: {
    record?: boolean;
    start?: (
      session: Parameters<DockEvidenceNativeService['startAnnotation']>[0],
    ) => Promise<DockNativeResult<void>>;
  } = {},
) {
  let listener: ((event: DockEvidenceNativeEvent) => void) | null = null;
  let shots = 0;
  const calls = {
    started: [] as Parameters<DockEvidenceNativeService['startAnnotation']>[0][],
    clips: [] as string[],
    released: [] as string[],
    ended: [] as string[],
    synced: [] as { n: number }[][],
    acks: [] as [annotationId: string, markId: string, accepted: boolean][],
    media: [] as unknown[],
    pauses: [] as [clipId: string, paused: boolean][],
    stopped: [] as string[],
  };
  let nextCapture: (() => DockCapturedPixels) | null = null;
  const service: DockEvidenceNativeService = {
    capabilities: { capture: true, annotate: true, record: options.record === true },
    captureDisplay: async () => ({ ok: true, value: nextCapture?.() ?? shot(++shots) }),
    startAnnotation: async (session) => {
      calls.started.push(session);
      return options.start ? options.start(session) : { ok: true, value: undefined };
    },
    setAnnotationTool: async () => undefined,
    setAnnotationMedia: async (media) => {
      calls.media.push(media);
    },
    syncMarks: async (_id, marks) => {
      calls.synced.push(marks);
    },
    endAnnotation: async (id) => {
      calls.ended.push(id);
    },
    reportMarkAcceptance: async (annotationId, markId, accepted) => {
      calls.acks.push([annotationId, markId, accepted]);
      return { ok: true, value: undefined };
    },
    startClip: async (clipId) => {
      if (!options.record) return { ok: false, error: 'unavailable' };
      calls.clips.push(clipId);
      return { ok: true, value: undefined };
    },
    ...(options.record
      ? {
          releaseClip: async (clipId: string) => {
            calls.released.push(clipId);
            return { ok: true as const, value: undefined };
          },
          pauseClip: async (clipId: string, paused: boolean) => {
            calls.pauses.push([clipId, paused]);
            return { ok: true as const, value: { paused } };
          },
        }
      : {}),
    stopClip: async (clipId) => {
      calls.stopped.push(clipId);
      return options.record
        ? {
            ok: true,
            value: {
              sourcePath: '/tmp/dock-clip.webm',
              mimeType: 'video/webm',
              size: 2048,
              durationMs: 5000,
              hasMicAudio: false,
            },
          }
        : { ok: false, error: 'unavailable' };
    },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  return {
    service,
    calls,
    emit: (event: DockEvidenceNativeEvent) => listener?.(event),
    captureAs: (next: () => DockCapturedPixels) => {
      nextCapture = next;
    },
  };
}
const evidenceView = () => selectDockComposerEvidence.select(appStore.state, workspaceA, mainA);

describe('ordinary file limit at send', () => {
  it('refuses a restored draft above the ordinary file limit without admitting or clearing it', async () => {
    await open();
    const files: ContextItem[] = Array.from({ length: 11 }, (_, index) => ({
      id: `file-${index}`,
      type: 'file',
      label: `notes-${index}.pdf`,
      attachmentId: `12345678-1234-4234-8234-1234567890${String(index).padStart(2, '0')}`,
      attachmentMimeType: 'application/pdf',
      attachmentSize: 1,
    }));
    appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, files));
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'eleven files'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(view().sendError).not.toBeNull());
    expect(sent).toHaveLength(0);
    expect(view().draft).toBe('eleven files');
    expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toHaveLength(11);
    // At the limit the same draft sends normally.
    appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, files.slice(0, 10)));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload.payload.fileBlocks).toHaveLength(10);
  });
});

describe('dock screen evidence through the canonical send', () => {
  // A workspace daemon without raw retention: composites are pre-placed, raws never uploaded.
  beforeEach(() => {
    __resetDockRetentionProbesForTests();
    let placed = 0;
    backend.onRequest('client.hello', () => ({ server: { capabilities: {} } }));
    backend.onRequest('file.placeAttachment', (params) => {
      const { fileName, mimeType } = params as { fileName: string; mimeType?: string };
      placed += 1;
      return {
        ok: true,
        path: `.intent/attachments/${fileName}`,
        fileName,
        size: 1,
        attachmentId: `placed-${placed}`,
        ...(mimeType ? { mimeType } : {}),
        uploadedAt: timestamp,
      };
    });
  });
  async function captureAndMark(native: ReturnType<typeof scriptedNative>) {
    await open();
    appStore.dispatch(dockEvidenceCaptureRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(true));
    const sessionId = native.calls.started[0].id;
    expect(native.calls.started[0]).toMatchObject({ tool: 'pick', mode: 'live' });
    // The first live mark carries the capture that becomes the session image.
    native.emit({
      type: 'mark',
      sessionId,
      tool: 'box',
      geometry: { kind: 'rect', x: 1812, y: 96, w: 148, h: 40 },
      element: null,
      capture: shot(9),
    });
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(2));
    await vi.waitFor(() =>
      expect(native.calls.synced.at(-1)).toEqual([expect.objectContaining({ n: 1 })]),
    );
    return evidenceView();
  }

  it('sends burned screenshots, chip tokens and mark metadata once, then clears only that snapshot', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    const captured = await captureAndMark(native);
    const rawItems = captured.evidenceItemIds;
    expect(
      selectComposerContextItems.select(appStore.state, workspaceA, mainA).map((i) => i.id),
    ).toEqual(rawItems);
    // Marks persist beside their screenshot in the opaque draft attachment. Draft saves are
    // debounced (CHAT_DRAFT_SAVE_DEBOUNCE_MS) after the last mark.
    await vi.waitFor(() =>
      expect(
        backend.requests
          .filter((row) => row.method === 'drafts.set')
          .some((row) =>
            (
              (row.params as { attachments?: { screen?: { marks?: unknown[] } }[] }).attachments ??
              []
            ).some((attachment) => attachment.screen?.marks?.length === 1),
          ),
      ).toBe(true),
    );
    appStore.dispatch(
      dockConversationDraftChanged(workspaceA, mainA, 'this [[mark:1]] keeps the old shadow'),
    );
    appStore.dispatch(sendDockConversationRequested());
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const payload = latestSend().payload.payload;
    // Opt-in review artifact: DOCK_PAYLOAD_ARTIFACT=<path> saves this real send payload.
    const artifact = process.env.DOCK_PAYLOAD_ARTIFACT;
    if (artifact) {
      mkdirSync(dirname(artifact), { recursive: true });
      writeFileSync(artifact, `${JSON.stringify(payload, null, 2)}\n`);
    }
    expect(payload.text).toBe('this [[mark:1]] keeps the old shadow');
    // The agent-readable copy leads the prompt context; the user's text is not duplicated.
    expect(payload.workspaceContextStr?.startsWith(DOCK_EVIDENCE_CONTEXT_HEADER)).toBe(true);
    expect(payload.workspaceContextStr).not.toContain('keeps the old shadow');
    expect(payload.contextItems).toEqual([]);
    // Burned composites were placed before admission; the send carries their references.
    const placements = backend.requests
      .filter((row) => row.method === 'file.placeAttachment')
      .map((row) => row.params as { data: string; rawScreenshot?: unknown });
    expect(placements.map((row) => row.data)).toEqual([
      `burned:${btoa('shot-1')}:`,
      `burned:${btoa('shot-9')}:1`,
    ]);
    expect(placements.some((row) => row.rawScreenshot !== undefined)).toBe(false);
    expect(payload.imageBlocks).toEqual([
      { type: 'image', attachmentId: 'placed-1', mimeType: 'image/jpeg' },
      { type: 'image', attachmentId: 'placed-2', mimeType: 'image/jpeg' },
    ]);
    expect(payload.messageMetadata).toMatchObject({
      type: 'dock_screen_evidence',
      version: 1,
      images: [
        { index: 0, attachment_id: 'placed-1', raw: null, marks: [] },
        {
          index: 1,
          id: captured.tiles[1].image.id,
          marks: [
            {
              n: 1,
              tool: 'box',
              rect: { x: 1812, y: 96, w: 148, h: 40 },
              geometry: { kind: 'rect', x: 1812, y: 96, w: 148, h: 40 },
            },
          ],
        },
      ],
      context: { workspace: workspaceA, agent: mainA },
    });
    const reference = payload.submission!;
    const entry = selectPendingSubmissionEntry.select(appStore.state, reference.scope)!;
    expect(getItem(entry.submissions, reference.id)).toMatchObject({
      imageBlocks: payload.imageBlocks,
    });
    expect(evidenceView().tiles).toEqual([]);
    expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([]);
    await vi.waitFor(() => expect(native.calls.ended).toEqual([native.calls.started[0].id]));
  });

  it('restores the exact rejected evidence with its screenshots and refuses stale chip tokens', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    const captured = await captureAndMark(native);
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'stale [[mark:2]]'));
    appStore.dispatch(sendDockConversationRequested());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(0);
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, ''));
    // Marks without text are a valid message.
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload.payload.text).toBe('');
    settle('rejected');
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(2));
    expect(evidenceView().tiles.map(({ image }) => image.id)).toEqual(
      captured.tiles.map(({ image }) => image.id),
    );
    expect(evidenceView().tiles[1].marks.map(({ n }) => n)).toEqual([1]);
    expect(
      selectComposerContextItems.select(appStore.state, workspaceA, mainA).map((i) => i.id),
    ).toEqual(captured.evidenceItemIds);
  });

  it('adopts native gesture-start mark ids once and stamps speech only for renderer-minted ids', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    const stamped: string[] = [];
    setDockDictationMarkSink((_pair, markId) => stamped.push(markId));
    try {
      await captureAndMark(native);
      const sessionId = native.calls.started[0].id;
      appStore.dispatch(
        dockEvidenceDictationChanged(workspaceA, mainA, {
          id: 'speech',
          startedAt: 1_000,
          status: 'listening',
        }),
      );
      const nativeMark = {
        type: 'mark' as const,
        sessionId,
        tool: 'pick' as const,
        geometry: { kind: 'rect' as const, x: 10, y: 10, w: 20, h: 20 },
        element: null,
        markId: 'native-mark-2',
        gestureAtEpochMs: 4_000,
      };
      native.emit(nativeMark);
      native.emit(nativeMark);
      await vi.waitFor(() =>
        expect(evidenceView().evidence?.marks.map((mark) => mark.id)).toContain('native-mark-2'),
      );
      const adopted = evidenceView().evidence!.marks.filter((mark) => mark.id === 'native-mark-2');
      expect(adopted).toHaveLength(1);
      // A duplicate delivery is answered as accepted again, never left waiting.
      await vi.waitFor(() =>
        expect(native.calls.acks.filter(([, id]) => id === 'native-mark-2')).toEqual([
          [sessionId, 'native-mark-2', true],
          [sessionId, 'native-mark-2', true],
        ]),
      );
      // Point-of-speech offset comes from the real gesture time, not event arrival.
      expect(adopted[0]).toMatchObject({ dictationOffsetMs: 3_000, createdAt: 4_000 });
      expect(stamped).toEqual([]);
      native.emit({ ...nativeMark, markId: undefined, gestureAtEpochMs: undefined });
      await vi.waitFor(() => expect(stamped).toHaveLength(1));
      expect(evidenceView().evidence!.marks.at(-1)!.id).toBe(stamped[0]);
    } finally {
      setDockDictationMarkSink(null);
    }
  });

  it('ends markup on a refused fifth capture during dictation, drops only that speech chip and still sends', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'keep this draft'));
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(true));
    const sessionId = native.calls.started[0].id;
    const mark = (n: number, capture: boolean) => ({
      type: 'mark' as const,
      sessionId,
      tool: 'box' as const,
      geometry: { kind: 'rect' as const, x: n, y: n, w: 10, h: 10 },
      element: null,
      markId: `native-${n}`,
      gestureAtEpochMs: 2_000 + n,
      ...(capture ? { capture: shot(n) } : {}),
    });
    // Four screens, each marked: every image is in use, so a fifth cannot replace one.
    for (const n of [1, 2, 3, 4]) {
      native.emit(mark(n, true));
      await vi.waitFor(() => expect(evidenceView().evidence?.marks).toHaveLength(n));
    }
    const fourthImage = evidenceView().evidence!.images[3].id;
    appStore.dispatch(
      dockEvidenceDictationChanged(workspaceA, mainA, {
        id: 'speech',
        startedAt: 1_000,
        status: 'listening',
      }),
    );
    // Native stamped native-5 into speech at the click; its words commit before the mark
    // event is processed. The chip waits for settlement instead of being dropped or shown.
    appStore.dispatch(
      dockEvidenceInsertionQueued(workspaceA, mainA, {
        id: 'speech-5',
        parts: [
          { kind: 'text', text: ' look here ' },
          { kind: 'mark', markId: 'native-5' },
          { kind: 'mark', markId: 'native-4' },
        ],
      }),
    );
    expect(evidenceView().insertionsQueued).toBe(1);
    expect(evidenceView().insertions).toEqual([]);
    // The screen changed again: native already holds new pixels the renderer refuses.
    native.emit(mark(5, true));
    await vi.waitFor(() => expect(evidenceView().captureError).toBe('limit'));
    await vi.waitFor(() => expect(native.calls.ended).toEqual([sessionId]));
    expect(evidenceView().annotating).toBe(false);
    expect(evidenceView().tiles).toHaveLength(4);
    expect(evidenceView().evidence?.marks.map((row) => row.id)).toEqual([
      'native-1',
      'native-2',
      'native-3',
      'native-4',
    ]);
    // Only the rejected reference is gone; the words and the accepted chip are editor-ready.
    expect(evidenceView().insertions).toEqual([
      {
        id: 'speech-5',
        parts: [
          { kind: 'text', text: ' look here ' },
          { kind: 'mark', markId: 'native-4' },
        ],
      },
    ]);
    // A late gesture from the ended session joins no image and settles its own late chip.
    native.emit(mark(6, false));
    await vi.waitFor(() =>
      expect(evidenceView().evidence?.retiredMarkIds).toEqual(['native-5', 'native-6']),
    );
    appStore.dispatch(
      dockEvidenceInsertionQueued(workspaceA, mainA, {
        id: 'speech-6',
        parts: [
          { kind: 'mark', markId: 'native-6' },
          { kind: 'text', text: ' and done' },
        ],
      }),
    );
    expect(evidenceView().evidence?.marks).toHaveLength(4);
    expect(
      evidenceView().evidence!.marks.filter((row) => row.imageId === fourthImage),
    ).toHaveLength(1);
    expect(evidenceView().insertions.map((row) => row.id)).toEqual(['speech-5', 'speech-6']);
    // Native got one qualified answer per gesture: accepted ids true, refused and late ids false.
    await vi.waitFor(() => expect(native.calls.acks).toHaveLength(6));
    expect(native.calls.acks).toEqual([
      [sessionId, 'native-1', true],
      [sessionId, 'native-2', true],
      [sessionId, 'native-3', true],
      [sessionId, 'native-4', true],
      [sessionId, 'native-5', false],
      [sessionId, 'native-6', false],
    ]);
    // The editor commits both; nothing dangles, and Send admits once.
    appStore.dispatch(
      dockEvidenceInsertionCommitted(
        workspaceA,
        mainA,
        'speech-5',
        'keep this draft look here [[mark:4]]',
        evidenceView().draftRevision,
      ),
    );
    appStore.dispatch(
      dockEvidenceInsertionCommitted(
        workspaceA,
        mainA,
        'speech-6',
        'keep this draft look here [[mark:4]] and done',
        evidenceView().draftRevision,
      ),
    );
    expect(evidenceView().insertionsQueued).toBe(0);
    appStore.dispatch(dockEvidenceDictationChanged(workspaceA, mainA, null));
    expect(view().draft).toBe('keep this draft look here [[mark:4]] and done');
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload.payload.text).toBe('keep this draft look here [[mark:4]] and done');
  });

  it('removes an image with its marks and never sends without a native boundary', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    const captured = await captureAndMark(native);
    appStore.dispatch(
      dockEvidenceImageRemoveRequested(workspaceA, mainA, captured.tiles[1].image.id),
    );
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    expect(evidenceView().evidence?.marks).toEqual([]);
    expect(native.calls.synced.at(-1)).toEqual([]);
    configureDockEvidenceNative(null);
    appStore.dispatch(dockEvidenceCaptureRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().captureError).toBe('unavailable'));
    expect(evidenceView().tiles).toHaveLength(1);
  });

  it('keeps native capture identity, treats a repeated native capture as one tile and reports capabilities', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    expect(evidenceView().capabilities).toEqual({ capture: true, annotate: true, record: false });
    const pixels = shot(3);
    native.captureAs(() => ({
      ...pixels,
      image: {
        id: 'native-image-1',
        contextItemId: 'native-item-1',
        width: pixels.width,
        height: pixels.height,
        displayScale: pixels.displayScale,
        capturedAt: pixels.capturedAt,
        source: 'capture',
      },
    }));
    appStore.dispatch(dockEvidenceCaptureRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().captureAccepted).toBe(1));
    appStore.dispatch(dockEvidenceCaptureRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().capturePending).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(evidenceView().tiles.map(({ image }) => [image.id, image.contextItemId])).toEqual([
      ['native-image-1', 'native-item-1'],
    ]);
    expect(evidenceView().captureAccepted).toBe(1);
    expect(
      selectComposerContextItems.select(appStore.state, workspaceA, mainA).map((i) => i.id),
    ).toEqual(['native-item-1']);
    configureDockEvidenceNative(null);
    expect(evidenceView().capabilities).toEqual({ capture: false, annotate: false, record: false });
  });

  it('captures with the chosen mode and treats a dismissed selection as no capture', async () => {
    const native = scriptedNative();
    const modes: (string | undefined)[] = [];
    let dismiss = true;
    const captureDisplay = native.service.captureDisplay;
    native.service.captureDisplay = async (mode) => {
      modes.push(mode);
      return dismiss
        ? { ok: false, error: 'unavailable', detail: 'cancelled' }
        : captureDisplay(mode);
    };
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceCaptureModeSet('region'));
    appStore.dispatch(dockEvidenceCaptureRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(modes).toEqual(['region']));
    await vi.waitFor(() => expect(evidenceView().capturePending).toBe(false));
    expect(evidenceView().captureError).toBeNull();
    expect(evidenceView().tiles).toHaveLength(0);
    dismiss = false;
    appStore.dispatch(dockEvidenceCaptureRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    expect(modes).toEqual(['region', 'region']);
    appStore.dispatch(dockEvidenceCaptureModeSet('fullscreen'));
  });

  it('holds a send while a native insertion is unconsumed, then sends the committed editor text once', async () => {
    await open();
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'typed'));
    appStore.dispatch(
      dockEvidenceInsertionQueued(workspaceA, mainA, {
        id: 'speech-1',
        parts: [{ kind: 'text', text: ' and spoken' }],
      }),
    );
    appStore.dispatch(sendDockConversationRequested());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(0);
    expect(view().draft).toBe('typed');
    const mirrored = evidenceView().draftRevision;
    appStore.dispatch(
      dockEvidenceInsertionCommitted(workspaceA, mainA, 'speech-1', 'typed and spoken', mirrored),
    );
    expect(evidenceView().insertions).toEqual([]);
    // A replayed ack from before the commit is rejected and cannot re-append narration.
    appStore.dispatch(
      dockEvidenceInsertionCommitted(
        workspaceA,
        mainA,
        'speech-1',
        'typed and spoken and spoken',
        mirrored,
      ),
    );
    expect(view().draft).toBe('typed and spoken');
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(latestSend().payload.payload.text).toBe('typed and spoken');
  });

  it('does not admit when advertised retention returns no echo, then resumes the same keys exactly once', async () => {
    // Keyed placement with an acknowledged rawScreenshotRetention capability.
    appStore.dispatch(
      systemStatusSuccess(
        {
          running: true,
          listenMode: 'uds',
          transports: ['uds'],
          port: null,
          version: '0.1.0',
          // fixture-protocol-version: keyed placement is gated on protocol >= 9.13
          protocolVersion: '9.13',
          host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
        } satisfies SystemStatusWirePayload,
        timestamp,
        appStore.state.daemonHealth.connectionGeneration,
      ),
    );
    backend.onRequest('client.hello', () => ({
      server: { capabilities: { rawScreenshotRetention: 1 } },
    }));
    let echo = false;
    const placements: {
      idempotencyKey?: string;
      rawScreenshot?: { compositeAttachmentId: string };
    }[] = [];
    backend.onRequest('file.placeAttachment', (params) => {
      const row = params as {
        fileName: string;
        mimeType?: string;
        idempotencyKey?: string;
        rawScreenshot?: { compositeAttachmentId: string };
      };
      placements.push(row);
      return {
        ok: true,
        path: row.fileName,
        fileName: row.fileName,
        size: 1,
        attachmentId: `placed-${placements.length}`,
        mimeType: row.mimeType,
        uploadedAt: timestamp,
        ...(row.rawScreenshot && echo
          ? {
              rawScreenshot: {
                compositeAttachmentId: row.rawScreenshot.compositeAttachmentId,
                expiresAt: '2099-01-01T00:00:00.000Z',
                retentionSeconds: 86400,
              },
            }
          : {}),
      };
    });
    const lookups: string[] = [];
    backend.onRequest('file.getAttachmentInfo', (params) => {
      const { idempotencyKey } = params as { idempotencyKey: string };
      lookups.push(idempotencyKey);
      const index = placements.findIndex((row) => row.idempotencyKey === idempotencyKey);
      const row = placements[index];
      return {
        attachmentId: `placed-${index + 1}`,
        fileName: 'original.png',
        size: 1,
        uploadedAt: timestamp,
        path: 'p',
        exists: true,
        ...(row?.rawScreenshot
          ? {
              rawScreenshot: {
                compositeAttachmentId: row.rawScreenshot.compositeAttachmentId,
                expiresAt: '2099-01-01T00:00:00.000Z',
                expired: false,
              },
            }
          : {}),
      };
    });
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceCaptureRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    appStore.dispatch(dockConversationDraftChanged(workspaceA, mainA, 'look at this'));
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(view().sendError).not.toBeNull());
    expect(sent).toHaveLength(0);
    // Composite placed, raw attempted under its own key; nothing claimed, nothing cleared.
    expect(placements.map((row) => [!!row.idempotencyKey, row.rawScreenshot ?? null])).toEqual([
      [true, null],
      [true, { compositeAttachmentId: 'placed-1' }],
    ]);
    const record = Object.values(evidenceView().evidence?.placements ?? {})[0];
    expect(record).toMatchObject({
      composite: { attachmentId: 'placed-1' },
      compositeKey: placements[0].idempotencyKey,
      rawKey: placements[1].idempotencyKey,
      raw: null,
    });
    expect(view().draft).toBe('look at this');
    expect(evidenceView().tiles).toHaveLength(1);
    // The next click resumes the raw by its key: no re-upload, one admission.
    echo = true;
    appStore.dispatch(sendDockConversationRequested());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(placements).toHaveLength(2);
    expect(lookups).toEqual([placements[1].idempotencyKey]);
    expect(latestSend().payload.payload.messageMetadata).toMatchObject({
      images: [
        {
          attachment_id: 'placed-1',
          raw: { attachment_id: 'placed-2', expires_at: '2099-01-01T00:00:00.000Z' },
        },
      ],
    });
    expect(latestSend().payload.payload.imageBlocks).toEqual([
      { type: 'image', attachmentId: 'placed-1', mimeType: 'image/jpeg' },
    ]);
  });
});

describe('assistant workspace clips follow the observed chiefAttachments capability', () => {
  const chiefAgent = createAgentId('agent-chief-dock');
  const chiefSession = () => agent(chiefAgent, CHIEF_WORKSPACE_ID);
  const chiefView = () =>
    selectDockComposerEvidence.select(appStore.state, CHIEF_WORKSPACE_ID, chiefAgent);
  let advertised: unknown;
  let placedClips: { sourcePath?: string; mimeType?: string }[];
  beforeEach(() => {
    __resetDockRetentionProbesForTests();
    advertised = 0;
    placedClips = [];
    backend.onRequest('client.hello', () => ({
      server: { capabilities: { chiefAttachments: advertised } },
    }));
    backend.onRequest('agent.list', (params) => ({
      agents:
        (params as { workspaceId: string }).workspaceId === CHIEF_WORKSPACE_ID
          ? [chiefSession()]
          : [],
    }));
    backend.onRequest('agent.get', (params) => ({
      agent:
        (params as { agentId: string }).agentId === chiefAgent
          ? chiefSession()
          : sessionFor((params as { agentId: string }).agentId),
    }));
    backend.onRequest('file.placeAttachment', (params) => {
      const row = params as { fileName: string; sourcePath?: string; mimeType?: string };
      placedClips.push(row);
      return {
        ok: true,
        path: `.intent/attachments/${row.fileName}`,
        fileName: row.fileName,
        size: 2048,
        attachmentId: `chief-clip-attachment-${placedClips.length}`,
        ...(row.mimeType ? { mimeType: row.mimeType } : {}),
        uploadedAt: timestamp,
      };
    });
    appStore.dispatch(bulkUpsertSessions([chiefSession()]));
    appStore.dispatch(transcriptHydrationSettled(chiefAgent));
  });
  async function openChief(native: ReturnType<typeof scriptedNative>) {
    configureDockEvidenceNative(native.service);
    appStore.dispatch(openDockConversationRequested(CHIEF_WORKSPACE_ID));
    await vi.waitFor(() => expect(appStore.state.dockConversation.agentId).toBe(chiefAgent));
    // The open-triggered read published this connection's capabilities.
    await vi.waitFor(() =>
      expect(appStore.state.dockConversation.serverCapabilities).not.toBeNull(),
    );
  }

  it('never starts a native recording when chiefAttachments is not advertised', async () => {
    const native = scriptedNative({ record: true });
    await openChief(native);
    expect(chiefView().capabilities.record).toBe(false);
    appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
    await vi.waitFor(() => expect(chiefView().captureError).toBe('unsupported-workspace'));
    expect(native.calls.clips).toEqual([]);
    expect(chiefView().clips).toEqual([]);
  });

  it.each(['negative', 'unobserved'] as const)(
    'does not let a held %s capability result mutate a replacement native owner',
    async (result) => {
      const native = scriptedNative({ record: true });
      await openChief(native);
      const current = appStore.state.dockConversation.serverCapabilities!;
      appStore.dispatch(
        dockEvidenceServerCapabilitiesObserved({ ...current, backendId: 'old-backend' }),
      );
      __resetDockRetentionProbesForTests();
      const gate = deferred<unknown>();
      const reads = backend.requests.filter((row) => row.method === 'client.hello').length;
      backend.onRequest('client.hello', () => gate.promise);
      appStore.dispatch(dockEvidenceAnnotationToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
      await vi.waitFor(() =>
        expect(backend.requests.filter((row) => row.method === 'client.hello')).toHaveLength(
          reads + 1,
        ),
      );
      const replacement = scriptedNative({ record: true });
      configureDockEvidenceNative(replacement.service);
      appStore.dispatch(
        dockEvidenceAnnotationChanged(CHIEF_WORKSPACE_ID, chiefAgent, {
          id: 'replacement-annotation',
          mode: 'live',
          imageId: null,
        }),
      );
      gate.resolve(
        result === 'negative' ? { server: { capabilities: { chiefAttachments: 0 } } } : null,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(replacement.calls.ended).toEqual([]);
      expect(replacement.calls.started).toEqual([]);
      expect(chiefView().evidence?.annotation?.id).toBe('replacement-annotation');
      expect(chiefView().captureError).not.toBe('unsupported-workspace');
      expect(native.calls.clips).toEqual([]);
    },
  );

  it('records several clips, each placed as its own file reference and removable on its own', async () => {
    advertised = 1;
    const native = scriptedNative({ record: true });
    await openChief(native);
    await vi.waitFor(() => expect(chiefView().capabilities.record).toBe(true));
    const recordAndStop = async (count: number) => {
      appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
      await vi.waitFor(() => expect(chiefView().recording).toBe(true));
      appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
      await vi.waitFor(() =>
        expect(chiefView().clips.filter((clip) => clip.status === 'ready')).toHaveLength(count),
      );
    };
    // A finished recording does not block the next one; each is a new clip.
    await recordAndStop(1);
    await recordAndStop(2);
    const [first, second] = chiefView().clips;
    expect(first.id).not.toBe(second.id);
    expect(native.calls.clips).toEqual([first.id, second.id]);
    expect(placedClips).toEqual([
      expect.objectContaining({ sourcePath: '/tmp/dock-clip.webm', mimeType: 'video/webm' }),
      expect.objectContaining({ sourcePath: '/tmp/dock-clip.webm', mimeType: 'video/webm' }),
    ]);
    const items = () =>
      selectComposerContextItems.select(appStore.state, CHIEF_WORKSPACE_ID, chiefAgent);
    expect(items().find((row) => row.id === first.contextItemId)).toMatchObject({
      attachmentId: 'chief-clip-attachment-1',
      placementStatus: 'placed',
    });
    expect(items().find((row) => row.id === second.contextItemId)).toMatchObject({
      attachmentId: 'chief-clip-attachment-2',
      placementStatus: 'placed',
    });
    // Playback comes from the daemon's placement path, never the native source path.
    expect(first.path).toMatch(/^\.intent\/attachments\/clip-.+\.webm$/);
    // Once the daemon holds each attachment, native's temp file is released once per clip.
    expect(native.calls.released).toEqual([first.id, second.id]);
    // Removing the first clip drops only its chip and releases it without re-stopping.
    appStore.dispatch(dockEvidenceClipRemoveRequested(CHIEF_WORKSPACE_ID, chiefAgent, first.id));
    await vi.waitFor(() => expect(native.calls.released).toEqual([first.id, second.id, first.id]));
    expect(chiefView().clips.map((clip) => clip.id)).toEqual([second.id]);
    expect(items().some((row) => row.attachmentId === 'chief-clip-attachment-1')).toBe(false);
    expect(items().some((row) => row.attachmentId === 'chief-clip-attachment-2')).toBe(true);
    expect(native.calls.clips).toHaveLength(2);
  });

  it('marks where each recording starts and stops in dictated speech, only while dictating', async () => {
    advertised = 1;
    const native = scriptedNative({ record: true });
    await openChief(native);
    await vi.waitFor(() => expect(chiefView().capabilities.record).toBe(true));
    const stamped: string[] = [];
    setDockDictationMarkSink((_pair, id) => stamped.push(id));
    const recordAndStop = async (count: number) => {
      appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
      await vi.waitFor(() => expect(chiefView().recording).toBe(true));
      appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
      await vi.waitFor(() =>
        expect(chiefView().clips.filter((clip) => clip.status === 'ready')).toHaveLength(count),
      );
    };
    try {
      appStore.dispatch(
        dockEvidenceDictationChanged(CHIEF_WORKSPACE_ID, chiefAgent, {
          id: 'speech-1',
          startedAt: 1_000,
          status: 'listening',
        }),
      );
      await recordAndStop(1);
      const [first] = chiefView().clips;
      expect(stamped).toEqual([`clip-start:${first.id}`, `clip-end:${first.id}`]);
      // Not dictating: a recording adds no chip to the text.
      appStore.dispatch(dockEvidenceDictationChanged(CHIEF_WORKSPACE_ID, chiefAgent, null));
      await recordAndStop(2);
      expect(stamped).toHaveLength(2);
    } finally {
      setDockDictationMarkSink(null);
    }
  });

  it('drops a clip stopped before its first frame and keeps a too-large clip as a failed tile', async () => {
    advertised = 1;
    const native = scriptedNative({ record: true });
    await openChief(native);
    await vi.waitFor(() => expect(chiefView().capabilities.record).toBe(true));
    const outcomes: Awaited<ReturnType<DockEvidenceNativeService['stopClip']>>[] = [
      { ok: false, error: 'failed', detail: 'cancelled' },
      { ok: false, error: 'limit', detail: 'too-large' },
    ];
    native.service.stopClip = async () => outcomes.shift()!;
    const recordAndStop = async () => {
      appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
      await vi.waitFor(() => expect(chiefView().recording).toBe(true));
      appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
      await vi.waitFor(() => expect(chiefView().recording).toBe(false));
    };
    // Cancelled: no file was written, so neither a tile nor a placement remains.
    await recordAndStop();
    expect(chiefView().clips).toEqual([]);
    // Too large to play back: a failed tile that keeps its specific cause.
    await recordAndStop();
    expect(chiefView().clips).toEqual([
      expect.objectContaining({ status: 'failed', error: 'limit' }),
    ]);
    expect(native.calls.clips).toHaveLength(2);
    expect(placedClips).toEqual([]);
  });

  it('cannot be enabled by capabilities observed on another backend connection', async () => {
    const native = scriptedNative({ record: true });
    await openChief(native);
    const current = appStore.state.dockConversation.serverCapabilities!;
    appStore.dispatch(
      dockEvidenceServerCapabilitiesObserved({
        ...current,
        backendId: 'another-backend',
        chiefAttachments: true,
      }),
    );
    expect(chiefView().capabilities.record).toBe(false);
    appStore.dispatch(
      dockEvidenceServerCapabilitiesObserved({
        ...current,
        generation: current.generation - 1,
        chiefAttachments: true,
      }),
    );
    expect(chiefView().capabilities.record).toBe(false);
    appStore.dispatch(dockEvidenceRecordToggleRequested(CHIEF_WORKSPACE_ID, chiefAgent));
    await vi.waitFor(() => expect(chiefView().captureError).toBe('unsupported-workspace'));
    expect(native.calls.clips).toEqual([]);
  });

  /** Edit on an Assistant screenshot: a stand-in editor channel records OPEN requests. */
  async function editChiefScreenshot(attachmentsAdvertised: unknown, refuseOpen = false) {
    advertised = attachmentsAdvertised;
    const opens: unknown[] = [];
    const placements: unknown[] = [];
    const bridge = window as unknown as { electronAPI?: { invoke: (channel: string, request?: unknown) => Promise<unknown> } };
    const previous = bridge.electronAPI;
    bridge.electronAPI = {
      invoke: async (channel, request) => {
        if (channel === DOCK_CAPTURE_EDITOR_CHANNELS.OPEN) {
          opens.push(request);
          return refuseOpen
            ? { ok: false, error: 'unavailable' }
            : { ok: true, openId: '00000000-0000-4000-8000-000000000001' };
        }
        return previous?.invoke(channel, request);
      },
    };
    // Like the daemon: the Assistant workspace refuses attachments it does not advertise.
    backend.onRequest('file.placeAttachment', (params) => {
      const row = params as { workspaceId: string; fileName: string; mimeType?: string };
      placements.push(row.workspaceId);
      if (row.workspaceId === CHIEF_WORKSPACE_ID && !advertised) throw new Error('chief attachments unsupported');
      return { ok: true, path: `.intent/attachments/${row.fileName}`, fileName: row.fileName, size: 2048,
        attachmentId: `chief-image-${placements.length}`, mimeType: row.mimeType ?? 'image/png', uploadedAt: timestamp };
    });
    const native = scriptedNative();
    await openChief(native);
    appStore.dispatch(dockEvidenceCaptureRequested(CHIEF_WORKSPACE_ID, chiefAgent));
    await vi.waitFor(() => expect(evidenceOf(CHIEF_WORKSPACE_ID, chiefAgent)?.images).toHaveLength(1));
    const image = evidenceOf(CHIEF_WORKSPACE_ID, chiefAgent)!.images[0];
    const before = JSON.stringify(evidenceOf(CHIEF_WORKSPACE_ID, chiefAgent)?.images);
    appStore.dispatch(dockMediaEditorOpenRequested(CHIEF_WORKSPACE_ID, chiefAgent, image.id));
    return { opens, placements, before, restore: () => { bridge.electronAPI = previous; } };
  }

  it('Edit on an Assistant screenshot without chiefAttachments uploads nothing and says why', async () => {
    const run = await editChiefScreenshot(0);
    try {
      await vi.waitFor(() => expect(notifications.warning).toHaveBeenCalledTimes(1));
      expect(run.placements).toEqual([]);
      expect(run.opens).toEqual([]);
      expect(JSON.stringify(evidenceOf(CHIEF_WORKSPACE_ID, chiefAgent)?.images)).toBe(run.before);
      expect(appStore.state.dockConversation.workspaceId).toBe(CHIEF_WORKSPACE_ID);
      expect(appStore.state.dockConversation.agentId).toBe(chiefAgent);
    } finally {
      run.restore();
    }
  });

  it('Edit on an Assistant screenshot whose editor refuses to open says so once and keeps the capture', async () => {
    const run = await editChiefScreenshot(1, true);
    try {
      await vi.waitFor(() => expect(run.opens).toHaveLength(1));
      await vi.waitFor(() => expect(notifications.warning).toHaveBeenCalledTimes(1));
      expect(evidenceOf(CHIEF_WORKSPACE_ID, chiefAgent)?.images).toHaveLength(1);
      expect(appStore.state.dockConversation.agentId).toBe(chiefAgent);
    } finally {
      run.restore();
    }
  });

  it('Edit on an Assistant screenshot with chiefAttachments places it once and opens the editor', async () => {
    const run = await editChiefScreenshot(1);
    try {
      await vi.waitFor(() => expect(run.opens).toHaveLength(1));
      expect(run.placements).toEqual([CHIEF_WORKSPACE_ID]);
      expect(notifications.warning).not.toHaveBeenCalled();
    } finally {
      run.restore();
    }
  });
});

describe('recording toolbar startup admission', () => {
  it('refuses Record when a capture-only native service omits capabilities', async () => {
    const native = scriptedNative();
    const startClip = vi.spyOn(native.service, 'startClip');
    const captureOnly = { ...native.service };
    delete captureOnly.capabilities;
    configureDockEvidenceNative(captureOnly);
    await open();
    appStore.dispatch(dockEvidenceRecordToggleRequested(workspaceA, mainA));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(evidenceView().captureError).toBe('unavailable');
    expect(native.calls.started).toEqual([]);
    expect(startClip).not.toHaveBeenCalled();
  });

  it('does not reopen Annotate when cancelled START settles before the held STOP reply', async () => {
    const native = scriptedNative({ record: true });
    const start = deferred<Awaited<ReturnType<DockEvidenceNativeService['startClip']>>>();
    const stop = deferred<Awaited<ReturnType<DockEvidenceNativeService['stopClip']>>>();
    const startClip = vi.spyOn(native.service, 'startClip').mockReturnValue(start.promise);
    const stopClip = vi.spyOn(native.service, 'stopClip').mockReturnValue(stop.promise);
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(startClip).toHaveBeenCalledTimes(1));
    appStore.dispatch(dockEvidenceRecordToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(stopClip).toHaveBeenCalledTimes(1));
    const cancelled = { ok: false, error: 'failed', detail: 'cancelled' } as const;
    try {
      start.resolve(cancelled);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(native.calls.started).toHaveLength(1);
      expect(evidenceView().annotating).toBe(false);
      expect(evidenceView().clips).toEqual([]);
      expect(evidenceView().captureError).toBeNull();
      expect(notifications.warning).not.toHaveBeenCalled();
    } finally {
      stop.resolve(cancelled);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.calls.started).toHaveLength(1);
    expect(evidenceView().recording).toBe(false);
  });

  it('refuses an unsupported Record before opening a toolbar or calling native recording', async () => {
    const native = scriptedNative();
    const startClip = vi.spyOn(native.service, 'startClip');
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceRecordToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().captureError).toBe('unavailable'));
    expect(native.calls.started).toEqual([]);
    expect(startClip).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'cancelling a pending toolbar cannot start recording or fallback annotate (record=%s)',
    async (record) => {
      const gate = deferred<DockNativeResult<void>>();
      const native = scriptedNative({ record, start: () => gate.promise });
      configureDockEvidenceNative(native.service);
      await open();
      appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
      await vi.waitFor(() => expect(native.calls.started).toHaveLength(1));
      appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
      expect(evidenceView().annotating).toBe(false);
      gate.resolve({ ok: true, value: undefined });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(native.calls.clips).toEqual([]);
      expect(native.calls.started).toHaveLength(1);
      expect(evidenceView().annotating).toBe(false);
      expect(evidenceView().recording).toBe(false);
    },
  );

  it('does not admit a second Record while the first toolbar is opening', async () => {
    const gate = deferred<DockNativeResult<void>>();
    const native = scriptedNative({ record: true, start: () => gate.promise });
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceRecordToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(native.calls.started).toHaveLength(1));
    try {
      appStore.dispatch(dockEvidenceRecordToggleRequested(workspaceA, mainA));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(native.calls.clips).toEqual([]);
    } finally {
      gate.resolve({ ok: true, value: undefined });
    }
    await vi.waitFor(() => expect(native.calls.clips).toHaveLength(1));
    expect(native.calls.started).toHaveLength(1);
  });
});

describe('dock annotate start feedback, refusals and dictation', () => {
  function deferredStart() {
    const pending: ((result: DockNativeResult<void>) => void)[] = [];
    return {
      start: () => new Promise<DockNativeResult<void>>((resolve) => pending.push(resolve)),
      settle: (result: DockNativeResult<void>) => pending.shift()?.(result),
    };
  }

  it('shows the session at once while the overlay opens, and a refusal takes it back with its reason', async () => {
    const gate = deferredStart();
    const native = scriptedNative({ start: gate.start });
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    // Visible before native answers: button citrus, header "Annotating".
    expect(evidenceView().annotating).toBe(true);
    expect(native.calls.started).toHaveLength(1);
    gate.settle({ ok: false, error: 'unavailable', detail: 'display' });
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
    expect(notifications.warning).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({ key: 'dock-evidence:annotate' }),
    );
    // A Screen Recording refusal offers its pane.
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    gate.settle({ ok: false, error: 'permission' });
    await vi.waitFor(() => expect(notifications.warning).toHaveBeenCalledTimes(2));
    expect(notifications.warning.mock.calls[1][1]).toMatchObject({
      action: { label: expect.any(String) },
    });
    expect(evidenceView().captureError).toBe('permission');
  });

  it('ending while the overlay opens is not a failure: no notice, and a late success is ended', async () => {
    const gate = deferredStart();
    const native = scriptedNative({ start: gate.start });
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    const id = native.calls.started[0].id;
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    expect(evidenceView().annotating).toBe(false);
    gate.settle({ ok: true, value: undefined });
    await vi.waitFor(() => expect(native.calls.ended.filter((row) => row === id)).toHaveLength(2));
    expect(evidenceView().annotating).toBe(false);
    expect(notifications.warning).not.toHaveBeenCalled();
  });

  it('follows tools switched on the on-screen bar and ends from its X', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    const sessionId = native.calls.started[0].id;
    native.emit({ type: 'annotation-tool', sessionId, tool: 'arrow' });
    await vi.waitFor(() => expect(evidenceView().tool).toBe('arrow'));
    native.emit({ type: 'annotation-ended', sessionId });
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
  });

  it('Screenshot and Record on the on-screen bar run the composer actions under its rules', async () => {
    const native = scriptedNative({ record: true });
    configureDockEvidenceNative(native.service);
    await open();
    await vi.waitFor(() => expect(evidenceView().capabilities.record).toBe(true));
    const button = { label: 'L', tooltip: 'T', disabled: false, pending: false, alert: false };
    const media = {
      capture: { ...button, revision: 0 },
      record: { ...button, recording: false, startedAt: null, pausedAt: null, pausedMs: 0 },
    };
    // The composer's state reaches the bar, and again before a session starts.
    appStore.dispatch(dockEvidenceBarMediaChanged(workspaceA, mainA, media));
    await vi.waitFor(() => expect(native.calls.media).toEqual([media]));
    // Selecting a drawing tool opens a standalone bar; Annotate starts recording.
    appStore.dispatch(dockEvidenceToolSelectRequested(workspaceA, mainA, 'pick'));
    await vi.waitFor(() => expect(native.calls.started).toHaveLength(1));
    expect(evidenceView().recording).toBe(false);
    expect(native.calls.clips).toEqual([]);
    expect(native.calls.media).toEqual([media, media]);
    const sessionId = native.calls.started[0].id;

    // Screenshot: one more image; the session stays open.
    native.emit({ type: 'annotation-media', sessionId, action: 'capture' });
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    expect(evidenceView().annotating).toBe(true);
    // Record starts a recording, and the next click stops it.
    native.emit({ type: 'annotation-media', sessionId, action: 'record' });
    await vi.waitFor(() => expect(evidenceView().recording).toBe(true));
    native.emit({ type: 'annotation-media', sessionId, action: 'record' });
    await vi.waitFor(() => expect(evidenceView().recording).toBe(false));
    expect(native.calls.clips).toHaveLength(1);

    // Screen Recording denied: a click opens Settings instead of starting (which
    // clears the block, as in the composer, so each blocked click is set up again).
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    appStore.dispatch(dockEvidenceCaptureFailed(workspaceA, mainA, 'permission'));
    native.emit({ type: 'annotation-media', sessionId, action: 'capture' });
    await settle();
    appStore.dispatch(dockEvidenceCaptureFailed(workspaceA, mainA, 'permission'));
    native.emit({ type: 'annotation-media', sessionId, action: 'record' });
    await settle();
    // A click from another session is ignored.
    native.emit({ type: 'annotation-media', sessionId: 'stale', action: 'capture' });
    await settle();
    expect(evidenceView().tiles).toHaveLength(1);
    expect(native.calls.clips).toHaveLength(1);
    expect(evidenceView().annotating).toBe(true);
    // Retiring the real session invalidates both controls, even after permission clears.
    appStore.dispatch(dockEvidenceAnnotationEndRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
    appStore.dispatch(dockEvidenceCaptureCancelled(workspaceA, mainA));
    native.emit({ type: 'annotation-media', sessionId, action: 'capture' });
    native.emit({ type: 'annotation-media', sessionId, action: 'record' });
    await settle();
    expect(evidenceView().tiles).toHaveLength(1);
    expect(native.calls.clips).toHaveLength(1);
    expect(evidenceView().annotating).toBe(false);
  });

  it('the recording bar pauses and resumes the clip, and Done stops, attaches and ends the session', async () => {
    const native = scriptedNative({ record: true });
    configureDockEvidenceNative(native.service);
    await open();
    await vi.waitFor(() => expect(evidenceView().capabilities.record).toBe(true));
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(native.calls.started).toHaveLength(1));
    const sessionId = native.calls.started[0].id;
    native.emit({ type: 'annotation-media', sessionId, action: 'record' });
    await vi.waitFor(() => expect(evidenceView().recording).toBe(true));
    const clipId = native.calls.clips[0];
    const live = () => evidenceView().clips.find((clip) => clip.id === clipId);

    native.emit({ type: 'annotation-media', sessionId, action: 'pause' });
    await vi.waitFor(() => expect(live()?.pausedAt).toEqual(expect.any(Number)));
    expect(native.calls.pauses).toEqual([[clipId, true]]);
    native.emit({ type: 'annotation-media', sessionId, action: 'resume' });
    await vi.waitFor(() => expect(live()?.pausedAt).toBeNull());
    expect(native.calls.pauses).toEqual([
      [clipId, true],
      [clipId, false],
    ]);
    expect(live()?.pausedMs).toBeGreaterThanOrEqual(0);

    native.emit({ type: 'annotation-media', sessionId, action: 'done' });
    await vi.waitFor(() => expect(evidenceView().recording).toBe(false));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
    expect(native.calls.stopped).toEqual([clipId]);
    expect(native.calls.ended).toContain(sessionId);
    // The stopped clip is kept: it becomes the composer's attachment.
    await vi.waitFor(() => expect(evidenceView().clips.map((clip) => clip.id)).toEqual([clipId]));
  });

  it('discard pauses at once; undo keeps the clip, and confirm deletes it and ends the session', async () => {
    const native = scriptedNative({ record: true });
    configureDockEvidenceNative(native.service);
    await open();
    await vi.waitFor(() => expect(evidenceView().capabilities.record).toBe(true));
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(native.calls.started).toHaveLength(1));
    const sessionId = native.calls.started[0].id;
    native.emit({ type: 'annotation-media', sessionId, action: 'record' });
    await vi.waitFor(() => expect(evidenceView().recording).toBe(true));
    const clipId = native.calls.clips[0];

    native.emit({ type: 'annotation-media', sessionId, action: 'discard' });
    await vi.waitFor(() => expect(native.calls.pauses).toEqual([[clipId, true]]));
    native.emit({ type: 'annotation-media', sessionId, action: 'discard-undo' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(evidenceView().recording).toBe(true);
    expect(evidenceView().annotating).toBe(true);
    expect(native.calls.stopped).toEqual([]);

    native.emit({ type: 'annotation-media', sessionId, action: 'discard-confirm' });
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
    await vi.waitFor(() => expect(evidenceView().clips).toEqual([]));
    expect(native.calls.stopped).toEqual([clipId]);
  });

  it('pasting a copied screenshot recreates it here with its marks editable, under new ids', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    const marks = [
      {
        tool: 'box' as const,
        geometry: { kind: 'rect' as const, x: 10, y: 10, w: 50, h: 40 },
        bounds: { x: 10, y: 10, w: 50, h: 40 },
        element: null,
      },
      {
        tool: 'arrow' as const,
        geometry: { kind: 'arrow' as const, from: { x: 1, y: 1 }, to: { x: 20, y: 20 } },
        bounds: { x: 1, y: 1, w: 19, h: 19 },
        element: null,
      },
    ];
    appStore.dispatch(
      dockEvidenceMediaPasted(
        workspaceA,
        mainA,
        {
          kind: 'image',
          name: 'screenshot.png',
          size: 8,
          sha256: '0'.repeat(64),
          pixels: {
            base64: 'iVBORw0KGgo=',
            mimeType: 'image/png',
            width: 800,
            height: 600,
            displayScale: 2,
            capturedAt: '2026-11-03T12:00:00.000Z',
          },
          marks,
        },
        captureDockPasteOrigin(workspaceA, mainA),
      ),
    );
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    const tile = evidenceView().tiles[0]!;
    expect(tile.marks.map(({ n, mark }) => [n, mark.tool, mark.geometry])).toEqual([
      [1, 'box', marks[0]!.geometry],
      [2, 'arrow', marks[1]!.geometry],
    ]);
    // Fresh identities: the image and every mark are new to this draft.
    expect(new Set(tile.marks.map(({ mark }) => mark.id)).size).toBe(2);
    expect(tile.marks.every(({ mark }) => mark.imageId === tile.image.id)).toBe(true);
  });

  it('pasting a copied recording places the clipboard file into this workspace as a new clip', async () => {
    const native = scriptedNative({ record: true });
    configureDockEvidenceNative(native.service);
    const placed: { fileName: string; sourcePath?: string; mimeType?: string }[] = [];
    backend.onRequest('file.placeAttachment', (params) => {
      const row = params as { fileName: string; sourcePath?: string; mimeType?: string };
      placed.push(row);
      return {
        ok: true,
        path: `.intent/attachments/${row.fileName}`,
        fileName: row.fileName,
        size: 4096,
        attachmentId: `pasted-clip-${placed.length}`,
        mimeType: row.mimeType ?? 'video/mp4',
        uploadedAt: '2026-11-03T12:00:00.000Z',
      };
    });
    await open();
    await vi.waitFor(() => expect(evidenceView().capabilities.record).toBe(true));
    appStore.dispatch(
      dockEvidenceMediaPasted(
        workspaceA,
        mainA,
        {
          kind: 'clip',
          name: 'clip-1234abcd.mp4',
          mimeType: 'video/mp4',
          sourcePath: '/userData/dock-clipboard/entry/clip-1234abcd.mp4',
          size: 4096,
          sha256: '0'.repeat(64),
          durationMs: 42_000,
          hasMicAudio: true,
        },
        captureDockPasteOrigin(workspaceA, mainA),
      ),
    );
    await vi.waitFor(() => expect(evidenceView().clips[0]?.status).toBe('ready'));
    const clip = evidenceView().clips[0]!;
    expect(clip).toMatchObject({ durationMs: 42_000, hasMicAudio: true });
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({
      sourcePath: '/userData/dock-clipboard/entry/clip-1234abcd.mp4',
      mimeType: 'video/mp4',
    });
    // Nothing was recorded natively: the clip came from the clipboard's own file.
    expect(native.calls.clips).toEqual([]);
  });

  it('an annotate session captures the whole screen whatever the composer mode is', async () => {
    const native = scriptedNative();
    Object.assign(native.service.capabilities!, { captureModes: true });
    const modes: (string | undefined)[] = [];
    const captureDisplay = native.service.captureDisplay;
    native.service.captureDisplay = async (mode) => {
      modes.push(mode);
      return captureDisplay(mode);
    };
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceCaptureModeSet('window'));
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(native.calls.started).toHaveLength(1));
    const sessionId = native.calls.started[0].id;
    native.emit({ type: 'annotation-media', sessionId, action: 'capture' });
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    expect(modes).toEqual(['fullscreen']);
    expect(evidenceView().captureMode).toBe('window');
    appStore.dispatch(dockEvidenceCaptureModeSet('fullscreen'));
  });

  it('dictating leaves the screen usable: annotate is explicit and ending it opens nothing', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(
      dockEvidenceDictationChanged(workspaceA, mainA, {
        id: 'speech',
        startedAt: 1_000,
        status: 'listening',
      }),
    );
    // No overlay while the mic is live: clicks and scrolling reach other apps.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.calls.started).toEqual([]);
    expect(evidenceView().annotating).toBe(false);
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(true));
    expect(native.calls.started.map((row) => row.mode)).toEqual(['live']);
    appStore.dispatch(dockEvidenceAnnotationEndRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
    expect(native.calls.started.map((row) => row.mode)).toEqual(['live']);
    expect(evidenceView().evidence?.annotation ?? null).toBeNull();
  });
});

describe('dock annotate Done on the on-screen bar', () => {
  it('keeps the marked image, clears the screen, and the next mark starts a new image', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(true));
    const sessionId = native.calls.started[0].id;
    native.emit({
      type: 'mark',
      sessionId,
      tool: 'box',
      geometry: { kind: 'rect', x: 10, y: 10, w: 40, h: 40 },
      element: null,
      capture: shot(1),
    });
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    native.emit({ type: 'annotation-commit', sessionId });
    await vi.waitFor(() => expect(evidenceView().evidence?.annotation?.imageId).toBeNull());
    // The session stays open; the tile keeps its mark; native is told the screen is clear.
    expect(evidenceView().annotating).toBe(true);
    expect(evidenceView().tiles[0].marks).toHaveLength(1);
    await vi.waitFor(() => expect(native.calls.synced.at(-1)).toEqual([]));
    native.emit({
      type: 'mark',
      sessionId,
      tool: 'box',
      geometry: { kind: 'rect', x: 20, y: 20, w: 40, h: 40 },
      element: null,
      capture: shot(2),
    });
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(2));
    expect(evidenceView().tiles[1].marks.map(({ n }) => n)).toEqual([2]);
  });

  it('Clear drops the marks on screen without attaching anything; an attached image stays', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(true));
    const sessionId = native.calls.started[0].id;
    const mark = (n: number) =>
      native.emit({
        type: 'mark',
        sessionId,
        tool: 'box',
        geometry: { kind: 'rect', x: 10 * n, y: 10, w: 40, h: 40 },
        element: null,
        capture: shot(n),
      });
    // One image attached with Done, then two new marks on a second image.
    mark(1);
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    native.emit({ type: 'annotation-commit', sessionId });
    await vi.waitFor(() => expect(evidenceView().evidence?.annotation?.imageId).toBeNull());
    mark(2);
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(2));
    const tool = evidenceView().tool;
    native.emit({ type: 'annotation-clear', sessionId });
    // The second image goes with its marks; the attached one stays; the session and tool stay.
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    expect(evidenceView().tiles[0].marks).toHaveLength(1);
    expect(evidenceView().evidence?.annotation?.imageId).toBeNull();
    expect(evidenceView().annotating).toBe(true);
    expect(evidenceView().tool).toBe(tool);
    // A stale session's Clear does nothing.
    native.emit({ type: 'annotation-clear', sessionId: 'stale' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(evidenceView().tiles).toHaveLength(1);
  });

  it('an empty attachment request captures nothing; Done ends feedback', async () => {
    const native = scriptedNative();
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(true));
    const capture = vi.spyOn(native.service, 'captureDisplay');
    const sessionId = native.calls.started[0].id;
    native.emit({ type: 'annotation-commit', sessionId });
    native.emit({ type: 'annotation-ended', sessionId });
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
    expect(capture).not.toHaveBeenCalled();
    expect(evidenceView().tiles).toEqual([]);
  });

  it('Ending annotation preserves an in-flight screenshot, recording and queued editor evidence', async () => {
    const native = scriptedNative({ record: true });
    let finishCapture: (result: DockNativeResult<DockCapturedPixels>) => void = () => {
      throw new Error('Capture is not waiting');
    };
    const heldCapture = new Promise<DockNativeResult<DockCapturedPixels>>((resolve) => {
      finishCapture = resolve;
    });
    vi.spyOn(native.service, 'captureDisplay').mockReturnValue(heldCapture);
    configureDockEvidenceNative(native.service);
    await open();
    appStore.dispatch(dockEvidenceAnnotationToggleRequested(workspaceA, mainA));
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(true));
    // Annotate already owns a recording; this is annotation-ended, not toolbar Done.
    await vi.waitFor(() => expect(evidenceView().recording).toBe(true));
    const sessionId = native.calls.started[0].id;
    native.emit({ type: 'annotation-media', sessionId, action: 'capture' });
    await vi.waitFor(() => expect(evidenceView().capturePending).toBe(true));
    appStore.dispatch(
      dockEvidenceInsertionQueued(workspaceA, mainA, {
        id: 'queued-before-done',
        parts: [{ kind: 'text', text: 'Keep this narration' }],
      }),
    );
    const queued = structuredClone(evidenceView().evidence?.insertions);
    const clips = structuredClone(evidenceView().evidence?.clips);
    native.emit({ type: 'annotation-ended', sessionId });
    await vi.waitFor(() => expect(evidenceView().annotating).toBe(false));
    expect(evidenceView().recording).toBe(true);
    expect(evidenceView().capturePending).toBe(true);
    expect(evidenceView().evidence?.insertions).toEqual(queued);
    expect(evidenceView().evidence?.clips).toEqual(clips);
    finishCapture({ ok: true, value: shot(9) });
    await vi.waitFor(() => expect(evidenceView().tiles).toHaveLength(1));
    expect(evidenceView().capturePending).toBe(false);
    expect(evidenceView().captureAccepted).toBe(1);
    expect(evidenceView().evidence?.insertions).toEqual(queued);
    expect(evidenceView().evidence?.clips).toEqual(clips);
  });
});

describe('held capture preparation local-admission content CAS', () => {
  it.each(['recognition', 'saved-edit', 'source-replacement'] as const)(
    'handles %s arriving during preparation without duplicate delivery or wrong cleanup',
    async (change) => {
      await open();
      const source: DockMediaSource = {
        id: 'generated-source',
        revision: 0,
        kind: 'recording',
        attachmentId: 'generated-original',
        path: '.intent/attachments/generated.mp4',
        durationMs: 1000,
        width: 320,
        height: 180,
        audio: 'available',
        visuals: 'clean',
        batches: [{ id: 'b', atMs: 0, clearAtMs: null }],
        capturedMarks: [],
      };
      const transcript = { status: 'pending' as const, revision: 1, words: [] };
      const media: DockSavedMedia = {
        source,
        saved: { ...defaultDockMediaEdit(source, [], transcript), revision: 1, voice: 'off' },
        transcript,
      };
      const evidence = emptyDockEvidence(dockEvidenceId(workspaceA, mainA));
      evidence.clips = [
        {
          id: 'generated-clip',
          status: 'ready',
          startedAt: 1,
          durationMs: 1000,
          hasMicAudio: true,
          contextItemId: 'generated-item',
          path: source.path,
          media,
        },
      ];
      appStore.dispatch(dockEvidenceRestored(workspaceA, mainA, evidence));
      const item: ContextItem = {
        id: 'generated-item',
        type: 'file',
        label: 'Synthetic recording',
        attachmentId: source.attachmentId,
        path: source.path,
        attachmentMimeType: 'video/mp4',
      };
      appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, [item]));
      appStore.dispatch(
        dockConversationDraftChanged(workspaceA, mainA, 'Synthetic capture prompt'),
      );
      const started = deferred<void>(),
        gate = deferred<void>();
      const spy = vi.spyOn(mediaSend, 'prepareDockMediaSend').mockImplementationOnce(async () => {
        started.resolve();
        await gate.promise;
        return {
          images: {},
          files: [
            {
              type: 'file',
              attachmentId: 'generated-output',
              fileName: 'generated.mp4',
              mimeType: 'video/mp4',
              size: 100,
            },
          ],
          frames: [],
          framePromptBytes: [],
          metadata: [],
        } satisfies Awaited<ReturnType<typeof mediaSend.prepareDockMediaSend>>;
      });
      try {
        appStore.dispatch(sendDockConversationRequested());
        await started.promise;
        expect(view().sending).toBe(true);
        appStore.dispatch(sendDockConversationRequested());
        const next = structuredClone(media);
        if (change === 'recognition') next.transcript = { status: 'ready', revision: 2, words: [] };
        if (change === 'saved-edit')
          next.saved = {
            ...next.saved!,
            revision: 2,
            wordEdits: { 'generated-word': 'Synthetic correction' },
          };
        if (change === 'source-replacement') {
          next.source = {
            ...next.source,
            id: 'replacement-source',
            revision: 1,
            attachmentId: 'replacement-file',
            path: '.intent/attachments/replacement.mp4',
          };
          next.saved = { ...next.saved!, sourceId: next.source.id, sourceRevision: 1 };
        }
        appStore.dispatch(
          dockEvidenceMediaChanged(workspaceA, mainA, 'generated-clip', media, next),
        );
        gate.resolve();
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        if (change === 'recognition') {
          await vi.waitFor(() => expect(view().draft).toBe(''));
          expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([]);
          expect(
            selectDockComposerEvidence.select(appStore.state, workspaceA, mainA).evidence?.clips ??
              [],
          ).toHaveLength(0);
        } else {
          expect(view().draft).toBe('Synthetic capture prompt');
          expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([
            item,
          ]);
          expect(
            selectDockComposerEvidence.select(appStore.state, workspaceA, mainA).evidence?.clips[0]
              .media,
          ).toEqual(next);
        }
        expect(spy).toHaveBeenCalledTimes(1);
        // The test has not emitted a daemon acceptance yet: cleanup is local admission.
      } finally {
        gate.resolve();
        spy.mockRestore();
      }
    },
  );
});


describe('bound editor capture removal', () => {
  it.each(['screenshot', 'recording'] as const)('removes only the current %s and refuses a later stale Save', async (kind) => {
    await open();
    const source: DockMediaSource = {
      id: 'delete-source', revision: 0, kind, attachmentId: 'delete-file',
      path: '.intent/attachments/delete.' + (kind === 'screenshot' ? 'png' : 'mp4'),
      durationMs: kind === 'recording' ? 1000 : 0, width: 320, height: 180,
      audio: 'none', visuals: 'clean', batches: [],
    };
    const media: DockSavedMedia = { source, saved: defaultDockMediaEdit(source, [], null), transcript: null };
    const evidence = emptyDockEvidence(dockEvidenceId(workspaceA, mainA));
    if (kind === 'screenshot') evidence.images = [{ id: 'current-capture', contextItemId: 'current-item', width: 320, height: 180, displayScale: 1, capturedAt: timestamp, source: 'capture', media }];
    else evidence.clips = [{ id: 'current-capture', contextItemId: 'current-item', status: 'ready', startedAt: 1, durationMs: 1000, hasMicAudio: false, path: source.path, media }];
    appStore.dispatch(dockEvidenceRestored(workspaceA, mainA, evidence));
    const other: ContextItem = { id: 'other', type: 'file', label: 'Keep this', attachmentId: 'other-file', path: '.intent/attachments/other.png' };
    appStore.dispatch(dockConversationContextItemsChanged(workspaceA, mainA, [other, { id: 'current-item', type: kind === 'screenshot' ? 'image' : 'file', label: 'Synthetic', attachmentId: source.attachmentId, path: source.path }]));
    const bridge = window as unknown as { electronAPI?: { invoke: (...args: unknown[]) => Promise<unknown> } };
    const previous = bridge.electronAPI;
    const replies: unknown[] = [];
    bridge.electronAPI = { invoke: async (...args) => { replies.push(args); return true; } };
    try {
      const { deleteEditorCapture } = await import('./dock-media-edit-saga');
      const request = { requestId: crypto.randomUUID(), openId: crypto.randomUUID(), pair: { workspaceId: workspaceA, agentId: mainA }, kind, attachmentId: source.attachmentId, sourceId: source.id, sourceRevision: 0, expectedEditRevision: 0 };
      cleanups.push(appStore.runSaga(function* () { yield* deleteEditorCapture({ ...request, sourceId: 'wrong-source' }); }));
      await vi.waitFor(() => expect(replies).toContainEqual([DOCK_CAPTURE_EDITOR_CHANNELS.DELETE_RESULT, { requestId: request.requestId, result: 'stale-source' }]));
      expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toHaveLength(2);
      replies.length = 0;
      cleanups.push(appStore.runSaga(function* () { yield* deleteEditorCapture(request); }));
      await vi.waitFor(() => expect(replies).toContainEqual([DOCK_CAPTURE_EDITOR_CHANNELS.DELETE_RESULT, { requestId: request.requestId, result: 'deleted' }]));
      expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([other]);
      expect(evidenceOf(workspaceA, mainA)?.images).toEqual([]);
      expect(evidenceOf(workspaceA, mainA)?.clips).toEqual([]);
      const { dockMediaEditSaveRequested, dockMediaEditSaveSettled } = await import('../dock-conversation-slice');
      const { getPrincipalActionContext } = await import('../../principal/principal-context');
      const results: unknown[] = [];
      cleanups.push(appStore.runSaga(function* () { results.push(yield* take(dockMediaEditSaveSettled)); }));
      const saveId = crypto.randomUUID();
      appStore.dispatch(dockMediaEditSaveRequested(saveId, { openId: request.openId, pair: request.pair, sourceId: source.id, sourceRevision: 0, expectedEditRevision: 0, edit: media.saved! }, getPrincipalActionContext(appStore.state)!));
      await vi.waitFor(() => expect(results).toContainEqual(dockMediaEditSaveSettled(saveId, { requestId: saveId, result: 'stale-source' })));
      expect(selectComposerContextItems.select(appStore.state, workspaceA, mainA)).toEqual([other]);
      expect([...evidenceOf(workspaceA, mainA)!.images, ...evidenceOf(workspaceA, mainA)!.clips]).toEqual([]);
    } finally { bridge.electronAPI = previous; }
  });
});
