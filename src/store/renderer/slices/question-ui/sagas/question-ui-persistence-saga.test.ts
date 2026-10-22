import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { Question } from '$shared/types/question-resource';
import { wizardDraftKey } from '$lib/components/chat/questions/wizard-draft-key';
import { selectQuestionUiConsumer } from '../question-ui-selectors';
import {
  questionUiReducer,
  questionWizardCollapsedChanged,
  questionWizardConsumed,
  questionWizardDraftChanged,
  questionWizardReleaseRequested,
  questionWizardResolved,
} from '../question-ui-slice';
import type { QuestionUiState } from '../question-ui-types';
import {
  QUESTION_WIZARD_SAVE_DEBOUNCE_MS,
  questionUiPersistenceSaga,
} from './question-ui-persistence-saga';

const QUESTIONS: Question[] = [
  {
    attachmentId: 'question-1',
    header: 'Storage',
    question: 'Where?',
    options: [{ label: 'Keychain' }, { label: 'File' }],
    multiSelect: false,
  },
];
const KEY = wizardDraftKey('agent-1', 'message-1');
const EMPTY = { idx: 0, answers: [{ sel: [], text: '', skipped: false }] };
const SAVED = { idx: 0, answers: [{ sel: [1], text: 'detail', skipped: false }] };
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function installStorage(): void {
  const values: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = String(value);
      Object.defineProperty(storage, key, {
        value: values[key],
        enumerable: true,
        configurable: true,
      });
    },
    removeItem: (key: string) => {
      delete values[key];
      delete (storage as Record<string, unknown>)[key];
    },
    clear: () => {
      for (const key of Object.keys(values)) storage.removeItem(key);
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}

function harness() {
  const channel = stdChannel();
  let questionUi: QuestionUiState = questionUiReducer.initialState;
  const dispatch = (action: any) => {
    questionUi = questionUiReducer(questionUi, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ questionUi }) },
    questionUiPersistenceSaga,
  );
  return {
    dispatch,
    task,
    consumer: () => selectQuestionUiConsumer.select({ questionUi } as any, 'card'),
  };
}

let tasks: Task[] = [];
beforeEach(() => installStorage());
afterEach(async () => {
  vi.useRealTimers();
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

describe('question UI persistence saga', () => {
  it('hydrates a validated draft and persisted collapsed state', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, ...SAVED, savedAt: Date.now() }));
    window.localStorage.setItem(
      `${KEY}/collapsed`,
      JSON.stringify({ version: 1, collapsed: true, savedAt: Date.now() }),
    );
    const run = harness();
    tasks.push(run.task);
    run.dispatch(questionWizardConsumed('card', 'request-1', KEY, QUESTIONS, EMPTY, false));
    await settle();
    expect(run.consumer()).toMatchObject({ status: 'ready', draft: SAVED, collapsed: true });
  });

  it.each([
    ['corrupt JSON', '{not json'],
    ['wrong version', JSON.stringify({ version: 2, ...SAVED, savedAt: Date.now() })],
    [
      'wrong answer count',
      JSON.stringify({ version: 1, idx: 0, answers: [], savedAt: Date.now() }),
    ],
    [
      'out-of-range option',
      JSON.stringify({
        version: 1,
        idx: 0,
        answers: [{ sel: [9], text: '', skipped: false }],
        savedAt: Date.now(),
      }),
    ],
  ])('clears %s instead of hydrating it', async (_name, raw) => {
    window.localStorage.setItem(KEY, raw);
    const run = harness();
    tasks.push(run.task);
    run.dispatch(questionWizardConsumed('card', 'request-1', KEY, QUESTIONS, EMPTY, false));
    await settle();
    expect(run.consumer()).toMatchObject({ status: 'ready', draft: EMPTY });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('debounces the latest draft, persists collapse, and prunes stale namespace records', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const stale = wizardDraftKey('agent-1', 'stale');
    window.localStorage.setItem(
      stale,
      JSON.stringify({ version: 1, ...EMPTY, savedAt: now - 15 * 24 * 60 * 60 * 1000 }),
    );
    const run = harness();
    tasks.push(run.task);
    run.dispatch(questionWizardConsumed('card', 'request-1', KEY, QUESTIONS, EMPTY, false));
    await settle();
    run.dispatch(questionWizardDraftChanged('card', 'request-1', SAVED));
    run.dispatch(questionWizardDraftChanged('card', 'request-1', { ...SAVED, idx: 3 }));
    run.dispatch(questionWizardCollapsedChanged('card', 'request-1', true));
    await settle();
    expect(JSON.parse(window.localStorage.getItem(`${KEY}/collapsed`)!).collapsed).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(QUESTION_WIZARD_SAVE_DEBOUNCE_MS);
    await settle();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).idx).toBe(3);
    expect(window.localStorage.getItem(stale)).toBeNull();
  });

  it('flushes dirty state before release and removes the correlated consumer', async () => {
    vi.useFakeTimers();
    const run = harness();
    tasks.push(run.task);
    run.dispatch(questionWizardConsumed('card', 'request-1', KEY, QUESTIONS, EMPTY, false));
    await settle();
    run.dispatch(questionWizardDraftChanged('card', 'request-1', SAVED));
    run.dispatch(questionWizardReleaseRequested('card', 'request-1'));
    await settle();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).answers).toEqual(SAVED.answers);
    expect(run.consumer()).toBeUndefined();
  });

  it('clears answer and collapse persistence only after a correlated resolution', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, ...SAVED, savedAt: Date.now() }));
    window.localStorage.setItem(
      `${KEY}/collapsed`,
      JSON.stringify({ version: 1, collapsed: true, savedAt: Date.now() }),
    );
    const run = harness();
    tasks.push(run.task);
    run.dispatch(questionWizardConsumed('card', 'request-1', KEY, QUESTIONS, EMPTY, false));
    await settle();
    run.dispatch(questionWizardResolved('card', 'wrong-request'));
    await settle();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    run.dispatch(questionWizardResolved('card', 'request-1'));
    await settle();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(`${KEY}/collapsed`)).toBeNull();
  });
});
