import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  DockConversationAgent,
  DockConversationDraft,
  DockConversationState,
  DockConversationPrompt,
} from './dock-conversation-types';

export const openDockConversationRequested =
  createAction<[workspaceId: string]>('dockConversation/open');
export const closeDockConversationRequested = createAction<[]>('dockConversation/close');
export const selectDockConversationAgentRequested = createAction<[agentId: string]>(
  'dockConversation/selectAgent',
);
export const reloadDockConversationRequested = createAction<[]>('dockConversation/reload');
export const sendDockConversationRequested =
  createAction<[prompt?: DockConversationPrompt]>('dockConversation/send');
export const dockConversationContextItemsChanged = createAction<
  [workspaceId: string, agentId: string, items: DockConversationPrompt['contextItems']]
>('dockConversation/contextItemsChanged');
export const retryDockConversationSendRequested = createAction<[]>('dockConversation/retrySend');
export const dockConversationContextSet = createAction<[identity: string, authority: string]>(
  'dockConversation/contextSet',
);
export const dockConversationLoaded =
  createAction<
    [
      generation: number,
      workspaceId: string,
      title: string,
      agents: DockConversationAgent[],
      agentId: string | null,
    ]
  >('dockConversation/loaded');
export const dockConversationFailed =
  createAction<[generation: number, error: string]>('dockConversation/failed');
export const dockConversationDraftChanged = createAction<
  [workspaceId: string, agentId: string, text: string]
>('dockConversation/draftChanged');
export const dockConversationDraftRestored = createAction<
  [workspaceId: string, agentId: string, text: string, hasAttachments: boolean]
>('dockConversation/draftRestored');
export const dockConversationDeliverySettled = createAction<
  [workspaceId: string, agentId: string, submissionId: string]
>('dockConversation/deliverySettled');
export const dockConversationRetryArmed = createAction<
  [workspaceId: string, agentId: string, revision: number]
>('dockConversation/retryArmed');
export const dockConversationDeliveryTracked = createAction<
  [workspaceId: string, agentId: string, delivery: NonNullable<DockConversationDraft['delivery']>]
>('dockConversation/deliveryTracked');
export const dockConversationDraftAdmitted = createAction<
  [workspaceId: string, agentId: string, revision: number]
>('dockConversation/draftAdmitted');
export const dockConversationDraftRecovered = createAction<
  [workspaceId: string, agentId: string, revision: number, contextFingerprint: string]
>('dockConversation/draftRecovered');
export const dockConversationSendState = createAction<
  [generation: number, sending: boolean, error: string | null]
>('dockConversation/sendState');

export const dockConversationReducer = createReducer<DockConversationState>({
  workspaceId: null,
  workspaceTitle: '',
  agentId: null,
  generation: 0,
  identity: null,
  authority: null,
  agents: createCollection('id'),
  drafts: createCollection('id'),
  loading: false,
  error: null,
  sendError: null,
  sending: false,
});
dockConversationReducer.with(
  openDockConversationRequested,
  (state, { payload: [workspaceId] }) => ({
    ...state,
    workspaceId,
    workspaceTitle: '',
    agentId: null,
    agents: createCollection('id'),
    generation: state.generation + 1,
    loading: true,
    error: null,
    sendError: null,
    sending: false,
  }),
);
dockConversationReducer.with(closeDockConversationRequested, (state) => ({
  ...state,
  workspaceId: null,
  agentId: null,
  generation: state.generation + 1,
  loading: false,
  sending: false,
}));
dockConversationReducer.with(
  selectDockConversationAgentRequested,
  (state, { payload: [agentId] }) =>
    getItem(state.agents, agentId)
      ? {
          ...state,
          agentId,
          generation: state.generation + 1,
          loading: true,
          error: null,
          sendError: null,
          sending: false,
        }
      : state,
);
dockConversationReducer.with(reloadDockConversationRequested, (state) => ({
  ...state,
  generation: state.generation + 1,
  loading: !!state.workspaceId,
  error: null,
}));
dockConversationReducer.with(
  dockConversationContextSet,
  (state, { payload: [identity, authority] }) => ({
    ...state,
    identity,
    authority,
    drafts: state.identity && state.identity !== identity ? createCollection('id') : state.drafts,
  }),
);
dockConversationReducer.with(
  dockConversationLoaded,
  (state, { payload: [generation, workspaceId, workspaceTitle, agents, agentId] }) =>
    generation === state.generation && workspaceId === state.workspaceId
      ? {
          ...state,
          workspaceTitle,
          agents: createCollection('id', agents),
          agentId,
          loading: false,
          error: null,
        }
      : state,
);
dockConversationReducer.with(dockConversationFailed, (state, { payload: [generation, error] }) =>
  generation === state.generation ? { ...state, loading: false, error } : state,
);
function draftFor(
  state: DockConversationState,
  workspaceId: string,
  agentId: string,
): DockConversationDraft {
  const id = JSON.stringify([workspaceId, agentId]);
  return (
    getItem(state.drafts, id) ?? {
      id,
      text: '',
      revision: 0,
      restored: false,
      hasAttachments: false,
    }
  );
}
dockConversationReducer.with(
  dockConversationDraftChanged,
  (state, { payload: [ws, agent, text] }) => {
    const draft = draftFor(state, ws, agent);
    return {
      ...state,
      drafts: upsertItem(state.drafts, { ...draft, text, revision: draft.revision + 1 }),
      sendError: null,
    };
  },
);
dockConversationReducer.with(
  dockConversationDraftRestored,
  (state, { payload: [ws, agent, text, hasAttachments] }) => {
    const draft = draftFor(state, ws, agent);
    return {
      ...state,
      drafts: upsertItem(state.drafts, {
        ...draft,
        text: draft.revision === 0 ? text : draft.text,
        restored: true,
        hasAttachments,
      }),
    };
  },
);
dockConversationReducer.with(
  dockConversationDraftAdmitted,
  (state, { payload: [ws, agent, revision] }) => {
    const draft = draftFor(state, ws, agent);
    return draft.revision === revision
      ? {
          ...state,
          drafts: upsertItem(state.drafts, {
            ...draft,
            text: '',
            revision: revision + 1,
            hasAttachments: false,
            clearRevision: revision + 1,
            clearSubmissionId: draft.delivery?.composerSubmissionId,
            delivery: draft.delivery
              ? { ...draft.delivery, clearedRevision: revision + 1 }
              : undefined,
            retryRevision: undefined,
          }),
        }
      : state;
  },
);
dockConversationReducer.with(
  dockConversationSendState,
  (state, { payload: [generation, sending, sendError] }) =>
    generation === state.generation ? { ...state, sending, sendError } : state,
);

dockConversationReducer.with(
  dockConversationDeliveryTracked,
  (state, { payload: [ws, agent, delivery] }) => {
    const draft = draftFor(state, ws, agent);
    return {
      ...state,
      drafts: upsertItem(state.drafts, { ...draft, delivery, retryRevision: undefined }),
    };
  },
);

dockConversationReducer.with(
  dockConversationRetryArmed,
  (state, { payload: [ws, agent, retryRevision] }) => {
    const draft = draftFor(state, ws, agent);
    return { ...state, drafts: upsertItem(state.drafts, { ...draft, retryRevision }) };
  },
);

dockConversationReducer.with(
  dockConversationDeliverySettled,
  (state, { payload: [ws, agent, submissionId] }) => {
    const draft = draftFor(state, ws, agent);
    return draft.delivery?.reference.id === submissionId
      ? {
          ...state,
          drafts: upsertItem(state.drafts, {
            ...draft,
            delivery: { ...draft.delivery, settled: true },
          }),
        }
      : state;
  },
);

// A failed/uncertain send may restore only the untouched empty prompt it created.
dockConversationReducer.with(
  dockConversationDraftRecovered,
  (state, { payload: [ws, agent, revision, contextFingerprint] }) => {
    const draft = draftFor(state, ws, agent);
    const recovery = draft.delivery?.recovery;
    if (!recovery || draft.revision !== revision || draft.delivery?.clearedRevision !== revision)
      return state;
    return {
      ...state,
      drafts: upsertItem(state.drafts, {
        ...draft,
        text: recovery.text,
        revision: revision + 1,
        recoverRevision: revision + 1,
        delivery: {
          ...draft.delivery,
          revision: revision + 1,
          contextFingerprint,
          clearedRevision: undefined,
        },
      }),
    };
  },
);
