import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import QuestionWizard from '../QuestionWizard.svelte';
import { saveWizardDraft, loadWizardDraft, wizardDraftKey } from '../wizard-draft-storage';
import type { Question } from '$shared/types/question-resource';

const questions: Question[] = [
  {
    attachmentId: 'q1',
    header: 'Target',
    question: 'Choose target',
    options: [{ label: 'Staging' }, { label: 'Production' }],
    multiSelect: true,
  },
];
beforeEach(() => {
  // The global storage fixture is a no-op; model persistence at its shared seam.
  const entries = new Map<string, string>();
  vi.spyOn(safeLocalStorage, 'getItem').mockImplementation((key) => entries.get(key) ?? null);
  vi.spyOn(safeLocalStorage, 'setItem').mockImplementation((key, value) => {
    entries.set(key, value);
  });
  vi.spyOn(safeLocalStorage, 'removeItem').mockImplementation((key) => {
    entries.delete(key);
  });
  vi.spyOn(safeLocalStorage, 'keysWithPrefix').mockImplementation((prefix) =>
    [...entries.keys()].filter((key) => key.startsWith(prefix)),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('focuses an exposed question without changing restored answers or submitting', async () => {
  const key = wizardDraftKey('focus-agent', 'question-1');
  const draft = { idx: 0, answers: [{ sel: [1], text: '', skipped: false }] };
  saveWizardDraft(key, draft);
  const onComplete = vi.fn();
  const { component, rerender } = render(QuestionWizard, {
    questions,
    collapsed: true,
    draftKey: key,
    onComplete,
  });
  expect(component.focusQuestion()).toBe(false);
  await rerender({ collapsed: false });
  expect(component.focusQuestion()).toBe(true);
  expect(document.activeElement).toBe(screen.getAllByRole('checkbox')[0]);
  expect(screen.getAllByRole('checkbox')[1].getAttribute('aria-checked')).toBe('true');
  expect(loadWizardDraft(key, questions)).toEqual(draft);
  expect(onComplete).not.toHaveBeenCalled();
});
