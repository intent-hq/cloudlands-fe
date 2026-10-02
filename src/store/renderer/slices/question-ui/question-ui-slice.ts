import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type { Question } from '$shared/types/question-resource';
import type { QuestionUiState, QuestionWizardDraft } from './question-ui-types';

export const questionWizardConsumed = createAction<
  [
    consumerId: string,
    requestId: string,
    storageKey: string | null,
    questions: Question[],
    initialDraft: QuestionWizardDraft,
    initialCollapsed: boolean,
  ]
>('questionUi/wizardConsumed');

export const questionWizardHydrated = createAction<
  [
    consumerId: string,
    requestId: string,
    draft: QuestionWizardDraft | null,
    collapsed: boolean | null,
  ]
>('questionUi/wizardHydrated');

export const questionWizardDraftChanged = createAction<
  [consumerId: string, requestId: string, draft: QuestionWizardDraft]
>('questionUi/wizardDraftChanged');

export const questionWizardCollapsedChanged = createAction<
  [consumerId: string, requestId: string, collapsed: boolean]
>('questionUi/wizardCollapsedChanged');

export const questionWizardDraftPersisted = createAction<
  [consumerId: string, requestId: string, revision: number]
>('questionUi/wizardDraftPersisted');

export const questionWizardCollapsedPersisted = createAction<
  [consumerId: string, requestId: string, revision: number]
>('questionUi/wizardCollapsedPersisted');

export const questionWizardResolved = createAction<[consumerId: string, requestId: string]>(
  'questionUi/wizardResolved',
);

export const questionWizardReleaseRequested = createAction<[consumerId: string, requestId: string]>(
  'questionUi/wizardReleaseRequested',
);

export const questionWizardReleased = createAction<[consumerId: string, requestId: string]>(
  'questionUi/wizardReleased',
);

export const questionUiReducer = createReducer<QuestionUiState>({
  consumers: createCollection('id'),
});

questionUiReducer.with(
  questionWizardConsumed,
  (state, { payload: [id, requestId, storageKey, _questions, initialDraft, collapsed] }) => ({
    consumers: upsertItem(removeItem(state.consumers, id), {
      id,
      requestId,
      storageKey,
      status: 'loading',
      draft: initialDraft,
      collapsed,
      draftRevision: 0,
      collapsedRevision: 0,
      draftDirty: false,
      collapsedDirty: false,
      resolved: false,
    }),
  }),
);
questionUiReducer.with(
  questionWizardHydrated,
  (state, { payload: [id, requestId, draft, collapsed] }) => {
    const current = getItem(state.consumers, id);
    if (!current || current.requestId !== requestId || current.resolved) return state;
    return {
      consumers: upsertItem(state.consumers, {
        ...current,
        status: 'ready',
        draft: current.draftDirty || !draft ? current.draft : draft,
        collapsed: current.collapsedDirty || collapsed === null ? current.collapsed : collapsed,
      }),
    };
  },
);
questionUiReducer.with(questionWizardDraftChanged, (state, { payload: [id, requestId, draft] }) => {
  const current = getItem(state.consumers, id);
  if (!current || current.requestId !== requestId || current.resolved) return state;
  return {
    consumers: upsertItem(state.consumers, {
      ...current,
      draft,
      draftRevision: current.draftRevision + 1,
      draftDirty: true,
    }),
  };
});
questionUiReducer.with(
  questionWizardCollapsedChanged,
  (state, { payload: [id, requestId, collapsed] }) => {
    const current = getItem(state.consumers, id);
    if (
      !current ||
      current.requestId !== requestId ||
      current.resolved ||
      current.collapsed === collapsed
    )
      return state;
    return {
      consumers: upsertItem(state.consumers, {
        ...current,
        collapsed,
        collapsedRevision: current.collapsedRevision + 1,
        collapsedDirty: true,
      }),
    };
  },
);
questionUiReducer.with(
  questionWizardDraftPersisted,
  (state, { payload: [id, requestId, revision] }) => {
    const current = getItem(state.consumers, id);
    if (!current || current.requestId !== requestId || current.draftRevision !== revision)
      return state;
    return { consumers: upsertItem(state.consumers, { ...current, draftDirty: false }) };
  },
);
questionUiReducer.with(
  questionWizardCollapsedPersisted,
  (state, { payload: [id, requestId, revision] }) => {
    const current = getItem(state.consumers, id);
    if (!current || current.requestId !== requestId || current.collapsedRevision !== revision)
      return state;
    return { consumers: upsertItem(state.consumers, { ...current, collapsedDirty: false }) };
  },
);
questionUiReducer.with(questionWizardResolved, (state, { payload: [id, requestId] }) => {
  const current = getItem(state.consumers, id);
  if (!current || current.requestId !== requestId || current.resolved) return state;
  return {
    consumers: upsertItem(state.consumers, {
      ...current,
      resolved: true,
      draftDirty: false,
      collapsedDirty: false,
    }),
  };
});
questionUiReducer.with(questionWizardReleased, (state, { payload: [id, requestId] }) =>
  getItem(state.consumers, id)?.requestId === requestId
    ? { consumers: removeItem(state.consumers, id) }
    : state,
);
