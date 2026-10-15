import type { ComboboxProps } from '@/components/ui/combobox';
import {
  replaceAgentQueue,
  setAgentQueueHydrating,
  setAgentQueueError,
} from '../../../../../src/store/renderer/slices/agent-queue/agent-queue-slice';
import { NoteId } from '$shared/types/branded-ids';
import { ContentType, type Note } from '$shared/types';
import { setWorkspaceHasLoaded } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import {
  loadWorkspaceNotesSucceeded,
  applyNoteDeleted,
} from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  selectComposerContextItems,
  selectChatDraft,
} from '@/store/chat-drafts/chat-drafts-selectors';
import { setComposerContextItems } from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-slice';
import {
  agentModelMutationRequested,
  agentModelMutationConsumed,
} from '../../../../../src/store/renderer/slices/agent-model/agent-model-slice';
import { createAgentModelSaga } from '../../../../../src/store/renderer/slices/agent-model/sagas/agent-model-saga-factory';
import { selectAgentModelWriteSnapshot } from '@/store/agent-model/agent-model-selectors';
import { selectProviderModelsCacheEntry } from '@/store/provider-models/provider-models-selectors';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceConversationComposer } from './workspace-conversation-composer';
import { MessageComposer, type MessageComposerProps } from '@/components/ui/message-composer';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { pendingSubmissionSettled } from '../../../../../src/store/renderer/slices/pending-submissions/pending-submissions-slice';
import { chatSendFailed } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { runChatDrafts } from '../../../../../src/store/renderer/slices/chat-drafts/sagas/chat-drafts-worker';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { DraftsClient } from '$lib/client/app-client';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';

const ui = vi.hoisted(() => ({
  real: false,
  props: undefined as MessageComposerProps | undefined,
  picker: undefined as ComboboxProps | undefined,
}));
vi.mock('@/components/ui/combobox', () => ({
  Combobox: (props: ComboboxProps) => {
    ui.picker = props;
    return <div />;
  },
}));
vi.mock('@/components/ui/message-composer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/ui/message-composer')>();
  return {
    ...original,
    MessageComposer: (props: MessageComposerProps) => {
      ui.props = props;
      return ui.real ? <original.MessageComposer {...props} /> : <div />;
    },
  };
});
vi.mock('@/features/agent/chat-runtime', async () => {
  const { createChatSubmission } =
    await import('../../../../../src/features/agent/chat-submission-factory');
  const { createAgentSubmissionAdmitter } =
    await import('../../../../../src/store/renderer/slices/pending-submissions/pending-submissions-admission-factory');
  return {
    chatSubmission: createChatSubmission(
      createAgentSubmissionAdmitter(() => ({ key: 'test-owner', isCurrent: () => true })),
    ),
    submissionRetry: { requestChatMessageRetry: vi.fn() },
  };
});
let dispose: () => void;
let stop: () => void;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let drafts: Pick<DraftsClient, 'get' | 'set' | 'clear'>;
const ws = WorkspaceId('composer-test');
const agent = AgentId('composer-agent');
async function settle() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}
beforeEach(() => {
  ui.real = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initial = createAdmittedLegacyPrincipal();
  initial.principal.snapshot!.capabilities.submissionCorrelation = 1;
  dispose = store.init(initial);
  store.dispatch(setWorkspaceEntity({ id: ws, myRole: 'owner' } as Workspace));
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agent,
        workspaceId: ws,
        status: AgentStatus.RuntimeIdle,
        messages: [],
        name: 'Test',
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
        backendSessionId: AgentId('test-session'),
      } as AgentSession,
    ]),
  );
  drafts = {
    get: vi.fn(async () => ({ text: 'saved draft', attachments: [], updatedAt: '' })),
    set: vi.fn(async () => ({ ok: true as const, updatedAt: '' })),
    clear: vi.fn(async () => ({ ok: true as const })),
  };
  stop = store.runSaga(function* () {
    yield* runChatDrafts(drafts, () => () => true);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stop();
  dispose();
  vi.unstubAllGlobals();
});
async function mount(expectedText = 'saved draft') {
  await act(async () =>
    root.render(
      <StrictMode>
        <WorkspaceConversationComposer workspaceId={ws} agentId={agent} />
      </StrictMode>,
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.value).toBe(expectedText);
  });
}
function entry() {
  return store.state.pendingSubmissions.byAgentId[agent];
}
it('does not claim an empty queue while its read is pending or failed', async () => {
  await mount();
  await act(async () => {
    store.dispatch(replaceAgentQueue(agent, [], ws));
    store.dispatch(setAgentQueueHydrating(agent, true));
  });
  await settle();
  const queue = () => container.querySelector('[data-testid="conversation-queue"]')!;
  expect(queue().textContent).not.toContain('No messages are queued.');
  await act(async () => {
    store.dispatch(setAgentQueueHydrating(agent, false));
    store.dispatch(setAgentQueueError(agent, 'Queue unavailable'));
  });
  await settle();
  expect(queue().textContent).toContain('Queue unavailable');
  expect(queue().textContent).not.toContain('No messages are queued.');
  await act(async () => {
    store.dispatch(setAgentQueueError(agent, null));
    store.dispatch(replaceAgentQueue(agent, [], ws));
  });
  await settle();
  expect(queue().textContent).toContain('No messages are queued.');
});
it('restores through the draft saga and flushes the final edit when leaving', async () => {
  await mount();
  expect(ui.props?.value).toBe('saved draft');
  await act(async () => ui.props?.onValueChange?.('last keystrokes'));
  await act(async () => root.unmount());
  await settle();
  expect(drafts.set).toHaveBeenCalledWith(ws, agent, 'last keystrokes', undefined);
  expect(store.state.chatDrafts.owners.ids).toEqual([]);
});
it('admits one send for two immediate activations, retains rejected text, and clears only after accepted delivery', async () => {
  await mount();
  const send = ui.props!.onSend!;
  await act(async () => {
    send('saved draft', []);
    send('saved draft', []);
  });
  expect(getItems(entry().submissions)).toHaveLength(1);
  const first = getItems(entry().submissions)[0];
  expect(ui.props?.value).toBe('saved draft');
  expect(drafts.clear).not.toHaveBeenCalled();
  await act(async () => {
    store.dispatch(pendingSubmissionSettled(entry().scope, first.id, 'rejected', Date.now()));
    store.dispatch(chatSendFailed(agent, 'rejected'));
  });
  await settle();
  expect(ui.props?.value).toBe('saved draft');
  await act(async () => ui.props!.onSend!('saved draft', []));
  const next = getItems(entry().submissions)[0];
  expect(next.id).not.toBe(first.id);
  await act(async () =>
    store.dispatch(pendingSubmissionSettled(entry().scope, next.id, 'accepted', Date.now())),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.value).toBe('');
  });
  expect(drafts.clear).toHaveBeenCalledOnce();
});
it('does not clear a newer edit when an earlier send is accepted', async () => {
  await mount();
  await act(async () => ui.props!.onSend!('saved draft', []));
  const sent = getItems(entry().submissions)[0];
  await act(async () => ui.props!.onValueChange!('next draft'));
  await act(async () =>
    store.dispatch(pendingSubmissionSettled(entry().scope, sent.id, 'accepted', Date.now())),
  );
  await settle();
  expect(ui.props?.value).toBe('next draft');
  expect(drafts.clear).not.toHaveBeenCalled();
});
it('keeps unsupported attachment drafts intact without sending or rewriting them', async () => {
  vi.mocked(drafts.get).mockResolvedValue({
    text: 'with attachment',
    attachments: [{ id: 'file', type: 'file', label: 'file.txt', path: 'file.txt' }],
    updatedAt: '',
  } as Awaited<ReturnType<DraftsClient['get']>>);
  await mount('with attachment');
  expect(ui.props?.sendDisabled).toBe(true);
  expect(ui.props?.disabled).toBe(true);
  expect(ui.props?.value).toBe('with attachment');
  await act(async () => ui.props!.onSend!('with attachment', []));
  expect(entry()).toBeUndefined();
  expect(drafts.set).not.toHaveBeenCalled();
  expect(drafts.clear).not.toHaveBeenCalled();
});

it('retains submission correlation while the canonical reader refreshes hydration', async () => {
  await mount();
  await act(async () => ui.props!.onSend!('saved draft', []));
  const sent = getItems(entry().submissions)[0];
  await act(async () =>
    root.render(
      <StrictMode>
        <WorkspaceConversationComposer workspaceId={ws} agentId={agent} transcriptReady={false} />
      </StrictMode>,
    ),
  );
  expect(ui.props?.disabled).toBe(true);
  await act(async () =>
    store.dispatch(pendingSubmissionSettled(entry().scope, sent.id, 'accepted', Date.now())),
  );
  await settle();
  await act(async () =>
    root.render(
      <StrictMode>
        <WorkspaceConversationComposer workspaceId={ws} agentId={agent} transcriptReady />
      </StrictMode>,
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.value).toBe('');
  });
  expect(drafts.clear).toHaveBeenCalledOnce();
});

it.each(['keep unsaved edit', ''])(
  'retains the unsaved draft %j through a failed save and owner remount',
  async (text) => {
    await mount();
    vi.mocked(drafts.set).mockRejectedValue(new Error('owned transport disconnected'));
    await act(async () => ui.props!.onValueChange!(text));
    await act(async () => root.unmount());
    await vi.waitFor(() => expect(drafts.set).toHaveBeenCalled());
    root = createRoot(container);
    await mount(text);
    await vi.waitFor(() =>
      expect(
        getItems(store.state.chatDrafts.owners).every(
          (owner) => owner.restore?.status === 'restored',
        ),
      ).toBe(true),
    );
    await settle();
    expect(ui.props?.value).toBe(text);
    expect(drafts.clear).not.toHaveBeenCalled();
  },
);

it.each(['retained edit', ''])(
  'persists the recovered local draft %j before a later reload',
  async (text) => {
    await mount();
    vi.mocked(drafts.set).mockRejectedValue(new Error('owned transport disconnected'));
    await act(async () => ui.props!.onValueChange!(text));
    await act(async () => root.unmount());
    await vi.waitFor(() => expect(drafts.set).toHaveBeenCalled());
    vi.mocked(drafts.set).mockClear().mockResolvedValue({ ok: true, updatedAt: '' });
    root = createRoot(container);
    await mount(text);
    await vi.waitFor(() => expect(drafts.set).toHaveBeenCalledWith(ws, agent, text, undefined));
  },
);

it('restores registered image and file drafts and admits their canonical wire blocks', async () => {
  vi.mocked(drafts.get).mockResolvedValue({
    text: '',
    attachments: [
      {
        id: 'image',
        type: 'file',
        label: 'shapes.png',
        attachmentId: 'image-id',
        attachmentMimeType: 'image/png',
        imageMimeType: 'image/png',
        attachmentSize: 30,
      },
      {
        id: 'file',
        type: 'file',
        label: 'notes.txt',
        attachmentId: 'file-id',
        attachmentMimeType: 'text/plain',
        attachmentSize: 12,
      },
    ],
    updatedAt: '',
  });
  await mount('');
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.hasAttachments).toBe(true);
  });
  expect(ui.props?.sendDisabled).toBe(false);
  await act(async () => ui.props!.onSend!('', []));
  const sent = getItems(entry().submissions)[0];
  expect(sent).toBeTruthy();
  expect(JSON.stringify(sent)).toContain('image-id');
  expect(JSON.stringify(sent)).toContain('file-id');
  await act(async () =>
    store.dispatch(pendingSubmissionSettled(entry().scope, sent.id, 'accepted', Date.now())),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.hasAttachments).toBe(false);
  });
  expect(drafts.clear).toHaveBeenCalledOnce();
});

it('retains a newer attachment when an earlier submission is accepted', async () => {
  const { setComposerContextItems } =
    await import('../../../../../src/store/renderer/slices/transient-ui/transient-ui-slice');
  await mount();
  await act(async () => ui.props!.onSend!('saved draft', []));
  const sent = getItems(entry().submissions)[0];
  await act(async () =>
    store.dispatch(
      setComposerContextItems(
        ws,
        agent,
        [{ id: 'new-file', type: 'file', label: 'new.txt', attachmentId: 'new-id' }],
        true,
      ),
    ),
  );
  await act(async () =>
    store.dispatch(pendingSubmissionSettled(entry().scope, sent.id, 'accepted', Date.now())),
  );
  await settle();
  expect(ui.props?.hasAttachments).toBe(true);
  expect(ui.props?.value).toBe('saved draft');
  expect(drafts.clear).not.toHaveBeenCalled();
});

it('restores an interrupted local upload visibly without sending or silently losing it on edit', async () => {
  vi.mocked(drafts.get).mockResolvedValue({
    text: 'draft',
    attachments: [
      {
        id: 'lost-file',
        type: 'file',
        label: 'lost.txt',
        attachmentMimeType: 'text/plain',
        attachmentSize: 5,
        placementStatus: 'failed',
      },
    ],
    updatedAt: '',
  });
  await mount('draft');
  expect(ui.props?.sendDisabled).toBe(true);
  expect(container.textContent).toContain('lost.txt');
  await act(async () => ui.props!.onSend!('draft', []));
  expect(entry()).toBeUndefined();
  await act(async () => ui.props!.onValueChange!('new text'));
  await act(async () => root.unmount());
  await vi.waitFor(() =>
    expect(drafts.set).toHaveBeenCalledWith(ws, agent, 'new text', [
      expect.objectContaining({ id: 'lost-file', placementStatus: 'failed' }),
    ]),
  );
});

it('clears the matching attachment draft after a rejected send is retried from a remounted composer', async () => {
  const { chatSubmission, submissionRetry } = await import('@/features/agent/chat-runtime');
  const { chatLastAttemptedMessageSet } =
    await import('../../../../../src/store/renderer/slices/chat-state/chat-state-slice');
  const file = {
    id: 'file',
    type: 'file',
    label: 'notes.txt',
    attachmentId: 'file-id',
    attachmentMimeType: 'text/plain',
    attachmentSize: 12,
  };
  vi.mocked(drafts.get).mockResolvedValue({
    text: 'saved draft',
    attachments: [file],
    updatedAt: '',
  });
  await mount();
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.hasAttachments).toBe(true);
  });
  await act(async () => ui.props!.onSend!('saved draft', []));
  const first = getItems(entry().submissions)[0];
  await act(async () => {
    store.dispatch(pendingSubmissionSettled(entry().scope, first.id, 'rejected', Date.now()));
    store.dispatch(
      chatLastAttemptedMessageSet(agent, {
        text: 'saved draft',
        options: { fileBlocks: [{ type: 'file', attachmentId: 'file-id', fileName: 'notes.txt' }] },
        submission: { reference: { scope: entry().scope, id: first.id }, outcome: 'rejected' },
      }),
    );
    store.dispatch(chatSendFailed(agent, 'send rejected'));
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  vi.mocked(submissionRetry.requestChatMessageRetry).mockImplementation(
    async (_agent, _workspace, _model, onAdmitted) => {
      const admitted = chatSubmission.admitChatMessage(store, agent, {
        wsId: ws,
        text: 'saved draft',
        fileBlocks: [{ type: 'file', attachmentId: 'file-id', fileName: 'notes.txt' }],
      });
      expect(admitted).toBeTruthy();
      onAdmitted!(admitted!.submission.id);
    },
  );
  const retry = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Retry'),
  );
  expect(retry).toBeTruthy();
  await act(async () => retry!.click());
  const next = getItems(entry().submissions)[0];
  expect(next.id).not.toBe(first.id);
  await act(async () =>
    store.dispatch(pendingSubmissionSettled(entry().scope, next.id, 'accepted', Date.now())),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.hasAttachments).toBe(false);
    expect(ui.props?.value).toBe('');
  });
  expect(drafts.clear).toHaveBeenCalledOnce();
});

it('holds the next send until this agent model mutation settles, without blocking another agent', async () => {
  await mount();
  const action = agentModelMutationRequested({
    requestId: 'model-request',
    consumerId: 'picker',
    workspaceId: ws,
    agentId: agent,
    connection: selectPrincipalConnectionContext.select(store.state),
    operation: { kind: 'model', model: 'next', commit: true },
  });
  await act(async () => {
    store.dispatch(action);
  });
  await settle();
  expect(ui.props?.sendDisabled).toBe(true);
  await act(async () => ui.props?.onSend?.('blocked', []));
  expect(entry()?.submissions?.ids ?? []).toEqual([]);
  await act(async () => {
    store.dispatch(action.success({ status: 'success' }));
  });
  await settle();
  expect(ui.props?.sendDisabled).toBe(false);
  const other = agentModelMutationRequested({
    requestId: 'other-model',
    consumerId: 'other',
    workspaceId: ws,
    agentId: 'other-agent',
    connection: selectPrincipalConnectionContext.select(store.state),
    operation: { kind: 'effort', effort: 'low', previous: null },
  });
  await act(async () => {
    store.dispatch(other);
  });
  await settle();
  expect(ui.props?.sendDisabled).toBe(false);
  await act(async () => {
    store.dispatch(other.success({ status: 'cancelled' }));
  });
});

it.each([
  ['model', false],
  ['effort', false],
  ['model', true],
  ['effort', true],
] as const)(
  'holds Send through the actual %s write (retired picker: %s)',
  async (kind, retired) => {
    await mount();
    let release!: () => void;
    const pendingWire = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setModel = vi.fn(async () => {
      await pendingWire;
      return { ok: true as const, data: { success: true } };
    });
    const setReasoningEffort = vi.fn(async () => {
      await pendingWire;
      return { success: true };
    });
    const stopModel = store.runSaga(
      createAgentModelSaga({
        snapshotEffect: selectAgentModelWriteSnapshot.effect,
        catalogEffect: selectProviderModelsCacheEntry.effect,
        setModel,
        setReasoningEffort,
        notifyError: vi.fn(),
      }),
    );
    const action = agentModelMutationRequested({
      requestId: 'pending-model-choice',
      consumerId: 'picker',
      agentId: agent,
      workspaceId: ws,
      connection: selectAgentModelWriteSnapshot.select(store.state, agent, ws).connection,
      operation:
        kind === 'model'
          ? { kind: 'model', model: 'new-model', providerId: 'codex', commit: true }
          : { kind: 'effort', effort: 'high', previous: null },
    });
    try {
      await act(async () => {
        void store.dispatch(action).catch(() => {});
      });
      await settle();
      expect(kind === 'model' ? setModel : setReasoningEffort).toHaveBeenCalledOnce();
      if (retired) {
        await act(async () => {
          store.dispatch(agentModelMutationConsumed(action.payload[0].requestId, 'picker'));
        });
        await act(async () => root.unmount());
        root = createRoot(container);
        await mount();
      }
      await settle();
      expect(ui.props!.sendDisabled).toBe(true);
      await act(async () => ui.props!.onSend!('saved draft', []));
      expect(entry()?.submissions?.ids ?? []).toEqual([]);
      release();
      await act(async () => {
        await action.promise;
      });
      await vi.waitFor(async () => {
        await settle();
        expect(ui.props!.sendDisabled).toBe(false);
      });
      if (retired) expect(getItems(store.state.agentModel.mutations)).toEqual([]);
    } finally {
      release();
      await act(async () => {
        await action.promise;
      });
      stopModel();
    }
  },
);

function seedContextNotes() {
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(
    loadWorkspaceNotesSucceeded([ws], {
      [ws]: ['note-one', 'note-two'].map(
        (id) =>
          ({
            id: NoteId(id),
            workspaceId: ws,
            title: 'Duplicate title',
            content: '',
            contentLength: 300,
            contentType: ContentType.Markdown,
            isArchived: false,
          }) as Note,
      ),
    }),
  );
}
it('persists exact selected note identities without copying their content, deduplicates, and submits the context snapshot', async () => {
  seedContextNotes();
  await mount();
  expect(ui.picker?.options?.map((item) => item.value)).toEqual(['note-one', 'note-two']);
  await act(async () => {
    ui.picker!.onChange!('note-two');
    ui.picker!.onChange!('note-two');
  });
  const items = selectComposerContextItems.select(store.state, ws, agent);
  expect(items).toEqual([
    expect.objectContaining({ type: 'note', noteId: 'note-two', workspaceId: ws }),
  ]);
  expect(items[0]).not.toHaveProperty('content');
  await vi.waitFor(() =>
    expect(drafts.set).toHaveBeenCalledWith(ws, agent, 'saved draft', [
      expect.objectContaining({ noteId: 'note-two', workspaceId: ws }),
    ]),
  );
  await act(async () => ui.props!.onSend!('saved draft', []));
  expect(JSON.stringify(getItems(entry().submissions)[0])).toContain('note-two');
  expect(JSON.stringify(getItems(entry().submissions)[0])).not.toContain('note-one');
});
it('rejects a deleted reference synchronously even before its disabled presentation renders', async () => {
  seedContextNotes();
  await mount();
  await act(async () => ui.picker!.onChange!('note-one'));
  const send = ui.props!.onSend!;
  await act(async () => {
    store.dispatch(applyNoteDeleted(ws, 'note-one'));
    send('saved draft', []);
  });
  expect(entry()).toBeUndefined();
  expect(selectComposerContextItems.select(store.state, ws, agent)[0].noteId).toBe('note-one');
  await settle();
  expect(ui.props?.sendDisabled).toBe(true);
});
it.each(['missing', 'cross-workspace', 'malformed'])(
  'retains a restored %s note as a removable blocker without sending',
  async (kind) => {
    seedContextNotes();
    vi.mocked(drafts.get).mockResolvedValue({
      text: 'saved draft',
      attachments: [
        {
          id: 'ref',
          type: 'note',
          label: 'Plan',
          noteId: kind === 'missing' ? 'absent' : 'note-one',
          workspaceId:
            kind === 'cross-workspace' ? 'elsewhere' : kind === 'malformed' ? undefined : ws,
        },
      ],
      updatedAt: '',
    });
    await mount();
    await settle();
    expect(ui.props?.sendDisabled).toBe(true);
    await act(async () => ui.props!.onSend!('saved draft', []));
    expect(entry()).toBeUndefined();
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove"]');
    expect(remove).toBeTruthy();
    await act(async () => remove!.click());
    expect(selectComposerContextItems.select(store.state, ws, agent)).toEqual([]);
  },
);
it('retired picker and send callbacks cannot mutate or send after same-context reentry', async () => {
  seedContextNotes();
  await mount();
  const pick = ui.picker!.onChange!,
    send = ui.props!.onSend!;
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  await act(async () => {
    pick('note-one');
    send('saved draft', []);
  });
  expect(selectComposerContextItems.select(store.state, ws, agent)).toEqual([]);
  expect(entry()).toBeUndefined();
});
it.each(['new note', 'new whitespace'])(
  'older acceptance preserves %s in the canonical draft',
  async (kind) => {
    seedContextNotes();
    await mount();
    await act(async () => ui.picker!.onChange!('note-one'));
    await act(async () => ui.props!.onSend!('saved draft', []));
    const first = getItems(entry().submissions)[0];
    await act(async () => {
      if (kind === 'new note')
        store.dispatch(
          setComposerContextItems(
            ws,
            agent,
            [
              {
                id: 'new',
                type: 'note',
                workspaceId: ws,
                noteId: 'note-two',
                label: 'Duplicate title',
              },
            ],
            true,
          ),
        );
      else ui.props!.onValueChange!('saved draft\n');
      store.dispatch(pendingSubmissionSettled(entry().scope, first.id, 'accepted', Date.now()));
    });
    await settle();
    expect(drafts.clear).not.toHaveBeenCalled();
    expect(selectComposerContextItems.select(store.state, ws, agent)).toHaveLength(1);
  },
);

it.each(['saved draft', '  saved draft\n'])(
  'real composer clears exact unchanged accepted note draft %j',
  async (authored) => {
    ui.real = true;
    seedContextNotes();
    vi.mocked(drafts.get).mockResolvedValue({ text: authored, attachments: [], updatedAt: '' });
    await mount(authored);
    await act(async () => ui.picker!.onChange!('note-one'));
    await settle();
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea!.value).toBe(authored);
    await act(async () => {
      textarea!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      );
    });
    expect(getItems(entry().submissions)).toHaveLength(1);
    const first = getItems(entry().submissions)[0];
    await act(async () =>
      store.dispatch(pendingSubmissionSettled(entry().scope, first.id, 'accepted', Date.now())),
    );
    await settle();
    await vi.waitFor(async () => {
      await settle();
      expect(ui.props?.value).toBe('');
    });
    expect(selectComposerContextItems.select(store.state, ws, agent)).toEqual([]);
    expect(drafts.clear).toHaveBeenCalledWith(ws, agent);
  },
);

it('real composer preserves a newer edit removing surrounding whitespace on old acknowledgement', async () => {
  ui.real = true;
  const authored = '  saved draft\n';
  seedContextNotes();
  vi.mocked(drafts.get).mockResolvedValue({ text: authored, attachments: [], updatedAt: '' });
  await mount(authored);
  await act(async () => ui.picker!.onChange!('note-one'));
  await settle();
  const textarea = container.querySelector('textarea')!;
  await act(async () =>
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    ),
  );
  expect(getItems(entry().submissions)).toHaveLength(1);
  const first = getItems(entry().submissions)[0];
  await act(async () => ui.props!.onValueChange!('saved draft'));
  expect(selectChatDraft.select(store.state, ws, agent)).toBe('saved draft');
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.value).toBe('saved draft');
  });
  await act(async () =>
    store.dispatch(pendingSubmissionSettled(entry().scope, first.id, 'accepted', Date.now())),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.disabled).toBe(false);
  });
  await settle();
  expect(ui.props?.value).toBe('saved draft');
  expect(drafts.clear).not.toHaveBeenCalled();
});

it('explicit enqueue admits once, preserves a newer draft, and never auto-sends when idle', async () => {
  const { updateSession } =
    await import('../../../../../src/store/renderer/slices/agent-session/agent-session-slice');
  await mount();
  await act(async () => store.dispatch(updateSession(agent, { isStreaming: true })));
  await settle();
  const enqueue = ui.props!.onEnqueue!;
  await act(async () => {
    enqueue('saved draft');
    enqueue('saved draft');
  });
  const submissions = getItems(entry().submissions);
  expect(submissions).toHaveLength(1);
  expect(submissions[0].destination).toBe('queue');
  expect(ui.props?.value).toBe('saved draft');
  await act(async () => ui.props!.onValueChange!('newer unsent draft'));
  await act(async () =>
    store.dispatch(
      pendingSubmissionSettled(entry().scope, submissions[0].id, 'accepted', Date.now()),
    ),
  );
  await settle();
  expect(ui.props?.value).toBe('newer unsent draft');
  await act(async () => store.dispatch(updateSession(agent, { isStreaming: false })));
  await settle();
  expect(getItems(entry().submissions).map((s) => s.id)).toEqual([submissions[0].id]);
  expect(drafts.clear).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  enqueue('stale callback');
  expect(getItems(entry().submissions).map((s) => s.id)).toEqual([submissions[0].id]);
});

it.each(['valid', 'other-root', 'malformed'] as const)(
  'restores repository reference without upload (%s)',
  async (kind) => {
    store.dispatch(
      setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/repo' } as Workspace),
    );
    const ref = {
      id: 'repo-ref',
      type: 'file' as const,
      label: 'same.txt',
      repositoryFile: {
        workspaceId: ws,
        rootPath: kind === 'other-root' ? '/retired' : '/owned/repo',
        path: kind === 'malformed' ? '../outside' : 'nested/same.txt',
      },
    };
    vi.mocked(drafts.get).mockResolvedValue({
      text: 'saved draft',
      attachments: [ref],
      updatedAt: '',
    });
    await mount();
    await vi.waitFor(async () => {
      await settle();
      expect(selectComposerContextItems.select(store.state, ws, agent)).toEqual([ref]);
    });
    expect(container.textContent).toContain(ref.repositoryFile.path);
    expect(ui.props?.sendDisabled).toBe(kind !== 'valid');
    const contexts = selectComposerContextItems.select(store.state, ws, agent);
    expect(contexts).toEqual([ref]);
    await act(async () => ui.props!.onSend!('saved draft', []));
    expect(entry() ? getItems(entry().submissions) : []).toHaveLength(kind === 'valid' ? 1 : 0);
    expect(drafts.clear).not.toHaveBeenCalled();
  },
);

it('uses a desktop presenter without a second draft owner and rejects its parked callbacks', async () => {
  let active = true;
  await act(async () =>
    root.render(
      <WorkspaceConversationComposer
        workspaceId={ws}
        agentId={agent}
        presentation={{ Composer: MessageComposer, isCurrent: () => active }}
      />,
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(ui.props?.value).toBe('saved draft');
  });
  const captured = ui.props!;
  await act(async () => captured.onValueChange?.('desktop draft Ω'));
  await settle();
  expect(selectChatDraft.select(store.state, ws, agent)).toBe('desktop draft Ω');
  active = false;
  await act(async () => {
    captured.onValueChange?.('stale');
    captured.onSend?.('stale', []);
    captured.onStop?.();
  });
  expect(selectChatDraft.select(store.state, ws, agent)).toBe('desktop draft Ω');
  expect(entry()).toBeUndefined();
});
