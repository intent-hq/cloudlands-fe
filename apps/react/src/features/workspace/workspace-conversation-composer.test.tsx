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
import type { MessageComposerProps } from '@/components/ui/message-composer';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { pendingSubmissionSettled } from '../../../../../src/store/renderer/slices/pending-submissions/pending-submissions-slice';
import { chatSendFailed } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { runChatDrafts } from '../../../../../src/store/renderer/slices/chat-drafts/sagas/chat-drafts-worker';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { DraftsClient } from '$lib/client/app-client';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';

const ui = vi.hoisted(() => ({ props: undefined as MessageComposerProps | undefined }));
vi.mock('@/components/ui/message-composer', () => ({
  MessageComposer: (props: MessageComposerProps) => {
    ui.props = props;
    return <div />;
  },
}));
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
      await settle();
      expect(ui.props!.sendDisabled).toBe(false);
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
