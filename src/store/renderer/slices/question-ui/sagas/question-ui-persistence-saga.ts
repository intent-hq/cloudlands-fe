import { call, delay, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { Question } from '$shared/types/question-resource';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  getLocalStorageKeysWithPrefix,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import { selectQuestionUiConsumer } from '../question-ui-selectors';
import {
  questionWizardCollapsedChanged,
  questionWizardCollapsedPersisted,
  questionWizardConsumed,
  questionWizardDraftChanged,
  questionWizardDraftPersisted,
  questionWizardHydrated,
  questionWizardReleaseRequested,
  questionWizardReleased,
  questionWizardResolved,
} from '../question-ui-slice';
import type { QuestionWizardDraft, QuestionWizardDraftAnswer } from '../question-ui-types';

const QUESTION_WIZARD_STORAGE_PREFIX = 'chat.questionWizardDraft/';
const COLLAPSED_SUFFIX = '/collapsed';
const VERSION = 1;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const QUESTION_WIZARD_SAVE_DEBOUNCE_MS = 300;

interface StoredDraft extends QuestionWizardDraft {
  version: number;
  savedAt: number;
}

interface StoredCollapsed {
  version: number;
  collapsed: boolean;
  savedAt: number;
}

function isValidAnswer(value: unknown, question: Question): value is QuestionWizardDraftAnswer {
  if (!value || typeof value !== 'object') return false;
  const answer = value as Partial<QuestionWizardDraftAnswer>;
  return (
    Array.isArray(answer.sel) &&
    answer.sel.every(
      (index) =>
        typeof index === 'number' &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < question.options.length,
    ) &&
    typeof answer.text === 'string' &&
    typeof answer.skipped === 'boolean'
  );
}

function parseDraft(raw: string, questions: Question[]): QuestionWizardDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || questions.length === 0) return null;
  const stored = parsed as Partial<StoredDraft>;
  if (
    stored.version !== VERSION ||
    typeof stored.idx !== 'number' ||
    !Number.isInteger(stored.idx) ||
    typeof stored.savedAt !== 'number' ||
    !Array.isArray(stored.answers) ||
    stored.answers.length !== questions.length ||
    !stored.answers.every((answer, index) => isValidAnswer(answer, questions[index]))
  )
    return null;
  return {
    idx: Math.min(Math.max(stored.idx, 0), questions.length - 1),
    answers: stored.answers.map((answer) => ({
      sel: [...answer.sel],
      text: answer.text,
      skipped: answer.skipped,
    })),
  };
}

function parseCollapsed(raw: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const stored = parsed as Partial<StoredCollapsed> | null;
  return stored &&
    typeof stored === 'object' &&
    stored.version === VERSION &&
    typeof stored.collapsed === 'boolean' &&
    typeof stored.savedAt === 'number'
    ? stored.collapsed
    : null;
}

function* pruneStale(skipKey: string): SagaGenerator<void> {
  const cutoff = Date.now() - MAX_AGE_MS;
  const keys = yield* call(getLocalStorageKeysWithPrefix, QUESTION_WIZARD_STORAGE_PREFIX);
  for (const key of keys) {
    if (key === skipKey) continue;
    const stored = yield* call(getLocalStorageJSON<{ savedAt?: unknown }>, key);
    if (!stored || typeof stored.savedAt !== 'number' || stored.savedAt < cutoff)
      yield* call(removeLocalStorageItem, key);
  }
}

function* persistDraft(key: string, draft: QuestionWizardDraft): SagaGenerator<void> {
  yield* call(pruneStale, key);
  yield* call(setLocalStorageJSON, key, { version: VERSION, ...draft, savedAt: Date.now() });
}

function* persistCollapsed(key: string, collapsed: boolean): SagaGenerator<void> {
  const collapsedKey = `${key}${COLLAPSED_SUFFIX}`;
  yield* call(pruneStale, collapsedKey);
  yield* call(setLocalStorageJSON, collapsedKey, {
    version: VERSION,
    collapsed,
    savedAt: Date.now(),
  });
}

function* hydrateWizard(action: ReturnType<typeof questionWizardConsumed>): SagaGenerator<void> {
  const [consumerId, requestId, storageKey, questions] = action.payload;
  if (!storageKey) {
    yield* put(questionWizardHydrated(consumerId, requestId, null, null));
    return;
  }
  const draftRaw = yield* call(getLocalStorageItem, storageKey);
  const collapsedKey = `${storageKey}${COLLAPSED_SUFFIX}`;
  const collapsedRaw = yield* call(getLocalStorageItem, collapsedKey);
  const draft = draftRaw === null ? null : parseDraft(draftRaw, questions);
  const collapsed = collapsedRaw === null ? null : parseCollapsed(collapsedRaw);
  if (draftRaw !== null && draft === null) yield* call(removeLocalStorageItem, storageKey);
  if (collapsedRaw !== null && collapsed === null)
    yield* call(removeLocalStorageItem, collapsedKey);
  yield* put(questionWizardHydrated(consumerId, requestId, draft, collapsed));
}

function* debounceDraft(
  action: ReturnType<typeof questionWizardDraftChanged>,
): SagaGenerator<void> {
  const [consumerId, requestId] = action.payload;
  const revision = (yield* selectQuestionUiConsumer.effect(consumerId))?.draftRevision;
  yield* delay(QUESTION_WIZARD_SAVE_DEBOUNCE_MS);
  const current = yield* selectQuestionUiConsumer.effect(consumerId);
  if (
    !current ||
    current.requestId !== requestId ||
    current.resolved ||
    !current.storageKey ||
    !current.draftDirty ||
    current.draftRevision !== revision
  )
    return;
  yield* call(persistDraft, current.storageKey, current.draft);
  yield* put(questionWizardDraftPersisted(consumerId, requestId, current.draftRevision));
}

function* saveCollapsed(
  action: ReturnType<typeof questionWizardCollapsedChanged>,
): SagaGenerator<void> {
  const [consumerId, requestId] = action.payload;
  const current = yield* selectQuestionUiConsumer.effect(consumerId);
  if (!current || current.requestId !== requestId || current.resolved || !current.storageKey)
    return;
  yield* call(persistCollapsed, current.storageKey, current.collapsed);
  yield* put(questionWizardCollapsedPersisted(consumerId, requestId, current.collapsedRevision));
}

function* clearResolved(action: ReturnType<typeof questionWizardResolved>): SagaGenerator<void> {
  const [consumerId, requestId] = action.payload;
  const current = yield* selectQuestionUiConsumer.effect(consumerId);
  if (!current || current.requestId !== requestId || !current.storageKey) return;
  yield* call(removeLocalStorageItem, current.storageKey);
  yield* call(removeLocalStorageItem, `${current.storageKey}${COLLAPSED_SUFFIX}`);
}

function* releaseWizard(
  action: ReturnType<typeof questionWizardReleaseRequested>,
): SagaGenerator<void> {
  const [consumerId, requestId] = action.payload;
  const current = yield* selectQuestionUiConsumer.effect(consumerId);
  if (!current || current.requestId !== requestId) return;
  if (!current.resolved && current.storageKey) {
    if (current.draftDirty) yield* call(persistDraft, current.storageKey, current.draft);
    if (current.collapsedDirty)
      yield* call(persistCollapsed, current.storageKey, current.collapsed);
  }
  yield* put(questionWizardReleased(consumerId, requestId));
}

export function* questionUiPersistenceSaga(): SagaGenerator<void> {
  yield* takeEvery(questionWizardConsumed, hydrateWizard);
  yield* takeEvery(questionWizardDraftChanged, debounceDraft);
  yield* takeEvery(questionWizardCollapsedChanged, saveCollapsed);
  yield* takeEvery(questionWizardResolved, clearResolved);
  yield* takeEvery(questionWizardReleaseRequested, releaseWizard);
}
