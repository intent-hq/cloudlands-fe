import { describe, expect, it } from 'vitest';
import type { Question } from '$shared/types/question-resource';
import { selectQuestionUiConsumer } from './question-ui-selectors';
import {
  questionUiReducer as reducer,
  questionWizardCollapsedChanged,
  questionWizardCollapsedPersisted,
  questionWizardConsumed,
  questionWizardDraftChanged,
  questionWizardDraftPersisted,
  questionWizardHydrated,
  questionWizardReleased,
  questionWizardResolved,
} from './question-ui-slice';

const QUESTIONS: Question[] = [
  {
    attachmentId: 'question-1',
    header: 'Storage',
    question: 'Where?',
    options: [{ label: 'Keychain' }, { label: 'File' }],
    multiSelect: false,
  },
];
const EMPTY = { idx: 0, answers: [{ sel: [], text: '', skipped: false }] };
const SAVED = { idx: 0, answers: [{ sel: [1], text: 'detail', skipped: false }] };
const consume = () =>
  questionWizardConsumed('card', 'request-1', 'draft/key', QUESTIONS, EMPTY, true);
const select = (state: ReturnType<typeof reducer>) =>
  selectQuestionUiConsumer.select({ questionUi: state } as any, 'card');

describe('question UI reducer', () => {
  it('registers a serializable correlated consumer and replaces an older request', () => {
    const first = reducer(reducer.initialState, consume());
    expect(select(first)).toMatchObject({
      id: 'card',
      requestId: 'request-1',
      storageKey: 'draft/key',
      status: 'loading',
      collapsed: true,
      draft: EMPTY,
    });
    const replaced = reducer(
      first,
      questionWizardConsumed('card', 'request-2', null, QUESTIONS, SAVED, false),
    );
    expect(select(replaced)).toMatchObject({
      requestId: 'request-2',
      storageKey: null,
      draft: SAVED,
    });
    expect(JSON.parse(JSON.stringify(replaced))).toEqual(replaced);
  });

  it('hydrates persisted values but preserves edits made while hydration was pending', () => {
    const loading = reducer(reducer.initialState, consume());
    const hydrated = reducer(loading, questionWizardHydrated('card', 'request-1', SAVED, false));
    expect(select(hydrated)).toMatchObject({ status: 'ready', draft: SAVED, collapsed: false });

    const edited = reducer(loading, questionWizardDraftChanged('card', 'request-1', SAVED));
    const collapsed = reducer(edited, questionWizardCollapsedChanged('card', 'request-1', false));
    const late = reducer(collapsed, questionWizardHydrated('card', 'request-1', EMPTY, true));
    expect(select(late)).toMatchObject({ status: 'ready', draft: SAVED, collapsed: false });
  });

  it('tracks draft and collapse revisions until the matching write completes', () => {
    const loading = reducer(reducer.initialState, consume());
    const draft = reducer(loading, questionWizardDraftChanged('card', 'request-1', SAVED));
    const collapsed = reducer(draft, questionWizardCollapsedChanged('card', 'request-1', false));
    expect(select(collapsed)).toMatchObject({
      draftRevision: 1,
      collapsedRevision: 1,
      draftDirty: true,
      collapsedDirty: true,
    });
    expect(reducer(collapsed, questionWizardDraftPersisted('card', 'request-1', 0))).toBe(
      collapsed,
    );
    const draftSaved = reducer(collapsed, questionWizardDraftPersisted('card', 'request-1', 1));
    const allSaved = reducer(draftSaved, questionWizardCollapsedPersisted('card', 'request-1', 1));
    expect(select(allSaved)).toMatchObject({ draftDirty: false, collapsedDirty: false });
  });

  it('rejects stale actions, freezes resolved state, and releases only the matching request', () => {
    const loading = reducer(reducer.initialState, consume());
    expect(reducer(loading, questionWizardDraftChanged('card', 'old', SAVED))).toBe(loading);
    const resolved = reducer(loading, questionWizardResolved('card', 'request-1'));
    expect(select(resolved)).toMatchObject({ resolved: true, draftDirty: false });
    expect(reducer(resolved, questionWizardDraftChanged('card', 'request-1', SAVED))).toBe(
      resolved,
    );
    expect(reducer(resolved, questionWizardReleased('card', 'old'))).toBe(resolved);
    expect(reducer(resolved, questionWizardReleased('card', 'request-1'))).toEqual(
      reducer.initialState,
    );
  });
});
