import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import QuestionWizard from '../QuestionWizard.svelte';
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('focuses an exposed question without changing restored answers or submitting', async () => {
  const draft = { idx: 0, answers: [{ sel: [1], text: '', skipped: false }] };
  const onComplete = vi.fn();
  const onDraftChange = vi.fn();
  const { component, rerender } = render(QuestionWizard, {
    props: { questions, draft, collapsed: true, onComplete, onDraftChange },
  });
  expect(component.focusQuestion()).toBe(false);
  await rerender({ collapsed: false });
  expect(component.focusQuestion()).toBe(true);
  expect(document.activeElement).toBe(screen.getAllByRole('checkbox')[0]);
  expect(screen.getAllByRole('checkbox')[1].getAttribute('aria-checked')).toBe('true');
  expect(onDraftChange).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});
