/**
 * Q&A wizard draft storage: localStorage round-trip restore, validation that
 * discards (and clears) corrupt/shape-mismatched entries, idx clamping,
 * 14-day pruning of stale namespace entries on save, and clear.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
  wizardDraftKey,
  type WizardDraft,
} from '../wizard-draft-storage';
import type { Question } from '$shared/types/question-resource';

// The global test-setup localStorage stub is a no-op, and the shared
// `installLocalStorageMock` helper hides entries in a private Map — invisible
// to `safeLocalStorage.keysWithPrefix` (`Object.keys(window.localStorage)`),
// which pruning depends on. Install a functional mock whose entries are real
// enumerable own properties, matching Web Storage enumeration semantics.
function installEnumerableLocalStorage(): void {
  const storage: Record<string, string> = {};
  const methods: Record<string, unknown> = {
    getItem: (key: string) =>
      Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
    setItem: (key: string, value: string) => {
      storage[key] = String(value);
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const key of Object.keys(storage)) delete storage[key];
    },
  };
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(storage, name, { value: fn, enumerable: false, configurable: true });
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}

installEnumerableLocalStorage();

const SINGLE: Question = {
  attachmentId: 'tar-aaa111bbb222',
  header: 'Token storage',
  question: 'Where should refresh tokens persist?',
  options: [
    { label: 'OS keychain', description: 'Keytar via safeStorage.' },
    { label: 'Encrypted file', description: 'AES-256 blob.' },
  ],
  multiSelect: false,
};

const MULTI: Question = {
  attachmentId: 'tar-ccc333ddd444',
  header: 'Scope',
  question: 'Which surfaces should the new auth flow cover?',
  options: [{ label: 'Desktop app' }, { label: 'CLI' }, { label: 'Web dashboard' }],
  multiSelect: true,
};

const QUESTIONS = [SINGLE, MULTI];
const KEY = wizardDraftKey('agent-1', 'msg-q1');

const DRAFT: WizardDraft = {
  idx: 1,
  answers: [
    { sel: [0], text: '', skipped: false },
    { sel: [0, 2], text: 'also mobile', skipped: false },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('wizardDraftKey', () => {
  it('namespaces by agent and message id', () => {
    expect(KEY).toBe('chat.questionWizardDraft/agent-1/msg-q1');
  });
});

describe('save/load round trip', () => {
  it('restores the saved step index and per-question answers', () => {
    saveWizardDraft(KEY, DRAFT);
    expect(loadWizardDraft(KEY, QUESTIONS)).toEqual(DRAFT);
  });

  it('returns null when nothing is stored', () => {
    expect(loadWizardDraft(KEY, QUESTIONS)).toBeNull();
  });

  it('clamps a stored idx outside the question range', () => {
    saveWizardDraft(KEY, { ...DRAFT, idx: 7 });
    expect(loadWizardDraft(KEY, QUESTIONS)!.idx).toBe(1);
    saveWizardDraft(KEY, { ...DRAFT, idx: -3 });
    expect(loadWizardDraft(KEY, QUESTIONS)!.idx).toBe(0);
  });
});

describe('validation discards and clears bad entries', () => {
  function expectDiscarded() {
    expect(loadWizardDraft(KEY, QUESTIONS)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  }

  it('discards corrupt JSON', () => {
    window.localStorage.setItem(KEY, '{not json');
    expectDiscarded();
  });

  it('discards a version mismatch', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 2, idx: 0, answers: DRAFT.answers, savedAt: Date.now() }),
    );
    expectDiscarded();
  });

  it('discards an answers/questions length mismatch', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, idx: 0, answers: [DRAFT.answers[0]], savedAt: Date.now() }),
    );
    expectDiscarded();
  });

  it('discards an out-of-range option index', () => {
    const answers = [{ sel: [5], text: '', skipped: false }, DRAFT.answers[1]];
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, idx: 0, answers, savedAt: Date.now() }),
    );
    expectDiscarded();
  });

  it('discards wrong field types', () => {
    const answers = [{ sel: [0], text: 42, skipped: false }, DRAFT.answers[1]];
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, idx: 0, answers, savedAt: Date.now() }),
    );
    expectDiscarded();
  });
});

describe('pruning on save', () => {
  it('drops namespace entries older than 14 days and keeps fresh ones', () => {
    const staleKey = wizardDraftKey('agent-1', 'msg-old');
    const freshKey = wizardDraftKey('agent-2', 'msg-new');
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now - 15 * 24 * 60 * 60 * 1000);
    saveWizardDraft(staleKey, { idx: 0, answers: [DRAFT.answers[0], DRAFT.answers[1]] });
    vi.setSystemTime(now - 60_000);
    saveWizardDraft(freshKey, DRAFT);
    vi.setSystemTime(now);
    saveWizardDraft(KEY, DRAFT);
    expect(window.localStorage.getItem(staleKey)).toBeNull();
    expect(window.localStorage.getItem(freshKey)).not.toBeNull();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('drops unreadable namespace entries', () => {
    const junkKey = 'chat.questionWizardDraft/agent-9/msg-junk';
    window.localStorage.setItem(junkKey, '{not json');
    saveWizardDraft(KEY, DRAFT);
    expect(window.localStorage.getItem(junkKey)).toBeNull();
  });

  it('prunes before writing, so a quota-full store freed by pruning still saves', () => {
    // Simulate a one-entry quota: setItem throws while another entry exists,
    // so the new draft can only land if pruning ran first and freed the slot.
    const staleKey = wizardDraftKey('agent-1', 'msg-old');
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now - 15 * 24 * 60 * 60 * 1000);
    saveWizardDraft(staleKey, DRAFT);
    vi.setSystemTime(now);

    const realSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      if (window.localStorage.getItem(staleKey) !== null) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      realSetItem(key, value);
    });

    saveWizardDraft(KEY, DRAFT);
    expect(window.localStorage.getItem(staleKey)).toBeNull();
    expect(loadWizardDraft(KEY, QUESTIONS)).toEqual(DRAFT);
  });
});

describe('clearWizardDraft', () => {
  it('removes the stored key', () => {
    saveWizardDraft(KEY, DRAFT);
    clearWizardDraft(KEY);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(loadWizardDraft(KEY, QUESTIONS)).toBeNull();
  });
});
