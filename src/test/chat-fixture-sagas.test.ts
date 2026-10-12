import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { clearDraftCacheForTests } from '$lib/components/chat/chat-draft-cache';
import { selectChatDraftOwnerView } from '$store/renderer/slices/chat-drafts/chat-drafts-selectors';
import {
  chatDraftClearRequested,
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftRestoreRequested,
  chatDraftSaveScheduled,
} from '$store/renderer/slices/chat-drafts/chat-drafts-slice';
import { selectQuestionUiConsumer } from '$store/renderer/slices/question-ui/question-ui-selectors';
import {
  questionWizardConsumed,
  questionWizardDraftChanged,
} from '$store/renderer/slices/question-ui/question-ui-slice';
import { startChatFixtureSagas } from './chat-fixture-sagas';

let stopRoot: () => void;
let stops: Array<() => void>;
const draft = () => selectChatDraftOwnerView.select(store.state, 'composer');
const question = () => selectQuestionUiConsumer.select(store.state, 'question');
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  clearDraftCacheForTests();
  stopRoot = startRootStoreLifecycle(store, { startSagas: () => [] });
  stops = startChatFixtureSagas(store);
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stopRoot();
  clearDraftCacheForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('settles restores and flushes a draft across composer ownership changes', async () => {
  store.dispatch(chatDraftOwnerOpened('composer'));
  store.dispatch(chatDraftRestoreRequested('composer', 'empty', 'workspace', 'agent'));
  await settle();
  expect(draft()?.restore).toMatchObject({ status: 'restored', draft: null });

  store.dispatch(
    chatDraftSaveScheduled('composer', 'save', {
      workspaceId: 'workspace',
      agentId: 'agent',
      text: 'Keep this while switching threads',
      attachments: [],
      rollback: null,
    }),
  );
  store.dispatch(chatDraftOwnerReleased('composer'));
  await settle();
  store.dispatch(chatDraftOwnerOpened('composer'));
  store.dispatch(chatDraftRestoreRequested('composer', 'restored', 'workspace', 'agent'));
  await settle();
  expect(draft()?.restore).toMatchObject({
    status: 'restored',
    draft: { text: 'Keep this while switching threads', attachments: [] },
  });

  store.dispatch(chatDraftClearRequested('workspace', 'agent'));
  await settle();
  store.dispatch(chatDraftRestoreRequested('composer', 'cleared', 'workspace', 'agent'));
  await settle();
  expect(draft()?.restore).toMatchObject({ status: 'restored', draft: null });
});

it('hydrates questions and cancels pending persistence when the fixture stops', async () => {
  const empty = { idx: 0, answers: [{ sel: [], text: '', skipped: false }] };
  store.dispatch(
    questionWizardConsumed(
      'question',
      'request',
      'chat.questionWizardDraft/fixture',
      [
        {
          attachmentId: 'q',
          header: 'Plan',
          question: 'Proceed?',
          options: [{ label: 'Yes' }, { label: 'Wait' }],
        },
      ],
      empty,
      false,
    ),
  );
  await settle();
  expect(question()).toMatchObject({ status: 'ready', draft: empty });
  store.dispatch(
    questionWizardDraftChanged('question', 'request', {
      idx: 0,
      answers: [{ sel: [0], text: 'Proceed carefully', skipped: false }],
    }),
  );
  const persist = vi.spyOn(window.localStorage, 'setItem');
  persist.mockClear();
  stops.forEach((stop) => stop());
  await vi.runAllTimersAsync();
  expect(persist).not.toHaveBeenCalled();

  store.dispatch(chatDraftOwnerOpened('composer'));
  store.dispatch(chatDraftRestoreRequested('composer', 'after-stop', 'workspace', 'agent'));
  await settle();
  expect(draft()?.restore).toMatchObject({ status: 'pending', requestId: 'after-stop' });
});
