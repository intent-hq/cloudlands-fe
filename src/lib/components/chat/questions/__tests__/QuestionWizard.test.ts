/**
 * Sequential Q&A wizard (pixel mock t2 interaction logic): choose-one
 * advances or completes on selection, multi-select toggles and keeps
 * Continue, Enter in the free-form field advances, Skip clears + advances, Back
 * returns with the previous answer pre-selected, Hide collapses to the
 * banner, Dismiss is gated behind a confirmation dialog, and Continue on the
 * last typed answer hands back the full answers array. With a `draftKey`,
 * in-progress answers + step persist to localStorage (debounced, flushed on
 * unmount) and restore on remount; completing or dismissing clears the draft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import QuestionWizard, { type QuestionAnswer } from '../QuestionWizard.svelte';
import { createNullableMessageSource } from './nullable-message-source.svelte';
import { wizardDraftKey } from '../wizard-draft-storage';
import type { Question } from '$shared/types/question-resource';

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
  options: [
    { label: 'Desktop app', description: 'Primary surface.' },
    { label: 'CLI', description: 'Headless login.' },
    { label: 'Web dashboard', description: 'Old cookie flow.' },
  ],
  multiSelect: true,
};

const LAST: Question = {
  attachmentId: 'tar-eee555fff666',
  header: 'Migration',
  question: 'Migrate existing sessions or force re-login?',
  options: [{ label: 'Migrate silently' }, { label: 'Force re-login' }],
  multiSelect: false,
};

const APPROVAL: Question = {
  attachmentId: 'tar-fff666aaa111',
  header: 'Schema migration',
  question: 'Approve applying the callback schema migration?',
  options: [{ label: 'Approve' }, { label: 'Reject' }],
  multiSelect: false,
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function setup(questions: Question[] = [SINGLE, MULTI, LAST]) {
  const onComplete = vi.fn<(answers: QuestionAnswer[]) => void>();
  const onToggleCollapsed = vi.fn<(collapsed: boolean) => void>();
  const utils = render(QuestionWizard, {
    props: { questions, onComplete, onToggleCollapsed },
  });
  return { ...utils, onComplete, onToggleCollapsed };
}

function currentOtherInput(): HTMLTextAreaElement {
  const inputs = screen.getAllByPlaceholderText('Or type your own answer…');
  return inputs.at(-1) as HTMLTextAreaElement;
}

describe('QuestionWizard', () => {
  it('renders the fixed question header and RadioGroup rows', () => {
    const { container } = setup();
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(container.querySelectorAll('[data-progress-segment]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.getByText('Token storage')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: SINGLE.question })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(SINGLE.options.length);
  });

  it('renders the counter, question header, Hide, and Dismiss controls', () => {
    render(QuestionWizard, {
      props: { questions: [SINGLE, LAST], onDismiss: vi.fn() },
    });
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    expect(screen.getByText('Token storage')).toBeTruthy();
    expect(screen.getByRole('button', { name: /hide/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeTruthy();
  });

  it('uses radio semantics and an inline textarea', () => {
    setup([LAST]);
    const input = screen.getByPlaceholderText('Or type your own answer…');

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(input.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('heading', { name: LAST.question })).toBeTruthy();
  });

  it('single-question wizard hides the counter, progress segments, and Back button', () => {
    const { container } = setup([MULTI]);
    expect(screen.queryByText('Question 1 of 1')).toBeNull();
    expect(container.querySelectorAll('[data-progress-segment]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.queryByText('Agent Has Questions')).toBeNull();
    expect(screen.queryByText('select all that apply')).toBeNull();
    expect(screen.getByRole('button', { name: /hide/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /skip/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy();
  });

  it('single-select only question completes on one option click without Continue', async () => {
    const { container, onComplete } = setup([LAST]);
    expect(screen.queryByText('Question 1 of 1')).toBeNull();
    expect(container.querySelectorAll('[data-progress-segment]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.queryByText('Selecting an option moves to the next question')).toBeNull();
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();

    await fireEvent.click(screen.getByText('Migrate silently'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual([
      {
        question: LAST,
        selectedLabels: ['Migrate silently'],
        freeText: '',
        skipped: false,
      },
    ]);
  });

  it('single-select advances immediately in mid-flow without completing', async () => {
    const { onComplete } = setup();
    await fireEvent.click(screen.getByText('OS keychain'));
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
    expect(screen.getByText('Scope')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('single-select final question completes on one click with the exact full payload', async () => {
    const { onComplete } = setup([SINGLE, LAST]);
    await fireEvent.click(screen.getByText('OS keychain'));
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();

    await fireEvent.click(screen.getByText('Force re-login'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual([
      { question: SINGLE, selectedLabels: ['OS keychain'], freeText: '', skipped: false },
      { question: LAST, selectedLabels: ['Force re-login'], freeText: '', skipped: false },
    ]);
  });

  it('keeps approval choices as one-click exact submissions', async () => {
    const { onComplete } = setup([APPROVAL]);
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();

    await fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual([
      { question: APPROVAL, selectedLabels: ['Approve'], freeText: '', skipped: false },
    ]);
  });

  it('ignores rapid option clicks after the first completion', async () => {
    const { onComplete } = setup([LAST]);
    const first = screen.getByRole('radio', { name: /Migrate silently/ });
    const second = screen.getByRole('radio', { name: /Force re-login/ });

    first.click();
    second.click();
    first.click();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0][0]).toEqual({
      question: LAST,
      selectedLabels: ['Migrate silently'],
      freeText: '',
      skipped: false,
    });
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(second.getAttribute('aria-checked')).toBe('false');
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(second.getAttribute('aria-disabled')).toBe('true');
  });

  it('multi-select toggles CheckboxGroup rows and requires Continue', async () => {
    setup();
    await fireEvent.click(screen.getByText('OS keychain'));
    expect(screen.queryByText('select all that apply')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(MULTI.options.length);
    const next = screen.getByRole('button', { name: /continue/i });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByText('Desktop app'));
    await fireEvent.click(screen.getByText('CLI'));
    expect(screen.getByRole('checkbox', { name: /Desktop app/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect((next as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(next);
    expect(screen.getByText('Question 3 of 3')).toBeTruthy();
  });

  it('Back returns with the previous answer pre-selected and is hidden on Q1', async () => {
    setup();
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    await fireEvent.click(screen.getByText('OS keychain'));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /OS keychain/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('Back then replacement records exactly one single-select answer', async () => {
    const { onComplete } = setup([SINGLE, LAST]);
    await fireEvent.click(screen.getByText('OS keychain'));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await fireEvent.click(screen.getByText('Encrypted file'));
    await fireEvent.click(screen.getByText('Migrate silently'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].map((answer) => answer.selectedLabels)).toEqual([
      ['Encrypted file'],
      ['Migrate silently'],
    ]);
  });

  it('Skip clears selection and text and advances', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'draft' } });
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(currentOtherInput().value).toBe('');
  });

  it('Enter in the free-form field advances', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
  });

  it('Enter explicitly submits an exact typed answer on the only question', async () => {
    const { onComplete } = setup([LAST]);
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: '  Ask the user  ' } });
    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy();

    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual([
      { question: LAST, selectedLabels: [], freeText: 'Ask the user', skipped: false },
    ]);
  });

  it('Shift+Enter keeps a typed answer open while Enter submits it', async () => {
    const { onComplete } = setup([LAST]);
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'First line\nSecond line' } });

    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: LAST.question })).toBeTruthy();

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onComplete.mock.calls[0][0][0].freeText).toBe('First line\nSecond line');
  });

  it('number shortcuts target the focused wizard, then the most-recent wizard', async () => {
    const firstComplete = vi.fn<(answers: QuestionAnswer[]) => void>();
    const secondComplete = vi.fn<(answers: QuestionAnswer[]) => void>();
    render(QuestionWizard, { props: { questions: [LAST], onComplete: firstComplete } });
    render(QuestionWizard, { props: { questions: [LAST], onComplete: secondComplete } });

    screen.getAllByRole('radio', { name: /Migrate silently/i })[0].focus();
    await fireEvent.keyDown(document, { key: '1' });
    expect(firstComplete.mock.calls[0][0][0].selectedLabels).toEqual(['Migrate silently']);
    expect(secondComplete).not.toHaveBeenCalled();

    (document.activeElement as HTMLElement).blur();
    await fireEvent.keyDown(document, { key: '2' });
    expect(secondComplete.mock.calls[0][0][0].selectedLabels).toEqual(['Force re-login']);
  });

  it('number and Ctrl+Enter shortcuts toggle and submit a multi-select answer', async () => {
    const { onComplete } = setup([MULTI]);
    await fireEvent.keyDown(document, { key: '2' });
    expect(screen.getByRole('checkbox', { name: /CLI/ }).getAttribute('aria-checked')).toBe('true');

    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });
    expect(onComplete.mock.calls[0][0][0].selectedLabels).toEqual(['CLI']);
  });

  it('restores focus to the first choice after advancing', async () => {
    setup();
    const firstChoice = screen.getByRole('radio', { name: /OS keychain/i });
    firstChoice.focus();
    await fireEvent.click(firstChoice);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: /Desktop app/ }));
    });
  });

  it('single-select options expose native focusable radio semantics', () => {
    setup([LAST]);
    const option = screen.getByRole('radio', { name: /Migrate silently/i });
    option.focus();

    expect(option.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(option);
    expect(option.getAttribute('aria-checked')).toBe('false');
  });

  it('renders Other as an auto-growing textarea row', () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');

    expect(input.tagName).toBe('TEXTAREA');
    expect(input.getAttribute('rows')).toBe('1');
  });

  it('last typed answer uses Continue and hands back the full answers array', async () => {
    const { onComplete } = setup();
    await fireEvent.click(screen.getByText('OS keychain'));
    await fireEvent.click(screen.getByText('Desktop app'));
    await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('heading', { name: LAST.question })).toBeTruthy();
    const input = currentOtherInput();
    await fireEvent.input(input, { target: { value: 'Ask the user' } });
    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect((continueButton as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(continueButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const answers = onComplete.mock.calls[0][0];
    expect(answers).toHaveLength(3);
    expect(answers[0]).toMatchObject({ selectedLabels: ['OS keychain'], skipped: false });
    expect(answers[1]).toMatchObject({ selectedLabels: ['Desktop app'] });
    expect(answers[2]).toMatchObject({ selectedLabels: [], freeText: 'Ask the user' });
  });

  it('skipped questions report skipped=true in the answers array', async () => {
    const { onComplete } = setup([SINGLE, LAST]);
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByText('Migrate silently'));
    const answers = onComplete.mock.calls[0][0];
    expect(answers[0]).toMatchObject({ selectedLabels: [], freeText: '', skipped: true });
    expect(answers[1]).toMatchObject({ selectedLabels: ['Migrate silently'], skipped: false });
  });

  it('multi-select answer after Skip then Back clears the stale skipped flag', async () => {
    const { onComplete } = setup([MULTI, LAST]);
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await fireEvent.click(screen.getByText('Desktop app'));
    await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await fireEvent.click(screen.getByText('Migrate silently'));
    const answers = onComplete.mock.calls[0][0];
    expect(answers[0]).toMatchObject({ selectedLabels: ['Desktop app'], skipped: false });
  });

  it('free-text answer after Skip then Back clears the stale skipped flag', async () => {
    const { onComplete } = setup([SINGLE, LAST]);
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    const input = currentOtherInput();
    await fireEvent.input(input, { target: { value: 'Redis' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.click(screen.getByText('Migrate silently'));
    const answers = onComplete.mock.calls[0][0];
    expect(answers[0]).toMatchObject({ selectedLabels: [], freeText: 'Redis', skipped: false });
  });

  it('single-select: typing in the Other input clears the option selection', async () => {
    setup([SINGLE, LAST]);
    await fireEvent.click(screen.getByText('OS keychain'));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('radio', { name: /OS keychain/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const input = currentOtherInput();
    await fireEvent.input(input, { target: { value: 'R' } });
    expect(screen.getByRole('radio', { name: /OS keychain/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy();
  });

  it('single-select: option buttons are disabled while Other text is present and clicks are no-ops', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    const option = screen.getByRole('radio', { name: /OS keychain/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(option);
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(option.getAttribute('aria-checked')).toBe('false');
  });

  it('single-select: clearing the Other input re-enables the option buttons', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    const option = screen.getByRole('radio', { name: /OS keychain/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.input(input, { target: { value: '' } });
    expect(option.getAttribute('aria-disabled')).toBeNull();
    await fireEvent.click(option);
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
  });

  it('single-select: option buttons stay disabled when returning via Back with Other text', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    const option = screen.getByRole('radio', { name: /OS keychain/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
  });

  it('multi-select: options and Other text coexist; buttons never disabled by text', async () => {
    const { onComplete } = setup([MULTI]);
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Also the API' } });
    const option = screen.getByRole('checkbox', { name: /Desktop app/ });
    expect(option.getAttribute('aria-disabled')).toBeNull();
    await fireEvent.click(option);
    expect(option.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onComplete.mock.calls[0][0][0]).toMatchObject({
      selectedLabels: ['Desktop app'],
      freeText: 'Also the API',
    });
  });

  it('Hide requests collapse; collapsed renders the banner that re-expands on click', async () => {
    const { container, onToggleCollapsed, rerender } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    await rerender({ collapsed: true });
    expect(screen.getByText('Click to expand')).toBeTruthy();
    expect(screen.queryByText('Question 1 of 3')).toBeNull();
    const wizard = container.querySelector('[data-question-wizard]');
    expect(wizard?.className).toContain('bg-card');
    expect(wizard?.className).toContain('rounded-(--radius-large)');
    expect(wizard?.className).not.toContain('shadow');
    await fireEvent.click(screen.getByText('Agent Has Questions'));
    expect(onToggleCollapsed).toHaveBeenCalledWith(false);
  });

  it('Dismiss from the expanded header opens the confirm dialog; confirming fires onDismiss', async () => {
    const onDismiss = vi.fn();
    const onToggleCollapsed = vi.fn();
    const onComplete = vi.fn();
    render(QuestionWizard, {
      props: { questions: [SINGLE], onDismiss, onToggleCollapsed, onComplete },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Dismiss questions?')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss questions' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onToggleCollapsed).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('Cancel closes the confirm dialog without dismissing', async () => {
    const onDismiss = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], onDismiss } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('focuses the confirm action first and restores focus to Dismiss after cancel', async () => {
    const onDismiss = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], onDismiss } });
    const dismissTrigger = screen.getByRole('button', { name: 'Dismiss' });
    dismissTrigger.focus();
    await fireEvent.click(dismissTrigger);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Dismiss questions' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(document.activeElement).not.toBe(cancel);

    cancel.focus();
    await fireEvent.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(dismissTrigger));
  });

  it('renders the dismissal confirmation as an accessible dialog', async () => {
    const onDismiss = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], onDismiss } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    const dialog = screen.getByRole('dialog', { name: 'Dismiss questions?' });
    expect(dialog.contains(screen.getByRole('button', { name: 'Cancel' }))).toBe(true);
    expect(dialog.contains(screen.getByRole('button', { name: 'Dismiss questions' }))).toBe(true);
  });

  it('Escape and backdrop click close the confirm dialog without dismissing', async () => {
    const onDismiss = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], onDismiss } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(overlay, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Dismiss on the Hide-collapsed banner also goes through the confirm dialog', async () => {
    const onDismiss = vi.fn();
    render(QuestionWizard, {
      props: { questions: [SINGLE], collapsed: true, onDismiss },
    });
    expect(screen.getByText('Click to expand')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss questions' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('no onDismiss prop → no Dismiss button rendered (expanded or collapsed)', async () => {
    const { rerender } = setup([SINGLE]);
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    await rerender({ collapsed: true });
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });
});

describe('QuestionWizard draft persistence', () => {
  const KEY = wizardDraftKey('agent-draft-test', 'msg-draft-test');
  const PREFIX = 'chat.questionWizardDraft/';

  // The global test-setup localStorage stub is a no-op. Install a functional
  // mock whose entries are enumerable own properties (Web Storage enumeration
  // semantics) so `safeLocalStorage.keysWithPrefix` — which save-time pruning
  // depends on — sees them; methods stay configurable for `vi.spyOn`.
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

  beforeEach(() => {
    installEnumerableLocalStorage();
  });

  function seedDraft(
    idx: number,
    answers: Array<{ sel: number[]; text: string; skipped: boolean }>,
  ) {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, idx, answers, savedAt: Date.now() }),
    );
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('restores skipped flags, selections, free text, and the step on remount', async () => {
    const questions = [SINGLE, MULTI, LAST];
    const first = render(QuestionWizard, { props: { questions, draftKey: KEY } });
    // Q1: explicit skip; Q2: multi-select + free text, left mid-answer.
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByText('Desktop app'));
    const input = currentOtherInput();
    await fireEvent.input(input, { target: { value: 'Also the API' } });
    // Unmount before the debounce fires — the pending save must flush.
    first.unmount();

    const onComplete = vi.fn<(answers: QuestionAnswer[]) => void>();
    render(QuestionWizard, { props: { questions, draftKey: KEY, onComplete } });
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
    const option = screen.getByRole('checkbox', { name: /Desktop app/ });
    expect(option.getAttribute('aria-checked')).toBe('true');
    expect(currentOtherInput().value).toBe('Also the API');

    await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await fireEvent.click(screen.getByText('Migrate silently'));
    expect(onComplete.mock.calls[0][0]).toEqual([
      { question: SINGLE, selectedLabels: [], freeText: '', skipped: true },
      {
        question: MULTI,
        selectedLabels: ['Desktop app'],
        freeText: 'Also the API',
        skipped: false,
      },
      { question: LAST, selectedLabels: ['Migrate silently'], freeText: '', skipped: false },
    ]);
  });

  it('debounces draft writes while typing; rendering alone writes nothing', async () => {
    vi.useFakeTimers();
    render(QuestionWizard, { props: { questions: [SINGLE, LAST], draftKey: KEY } });
    expect(window.localStorage.getItem(KEY)).toBeNull();

    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'd' } });
    await fireEvent.input(input, { target: { value: 'draft' } });
    expect(window.localStorage.getItem(KEY)).toBeNull();

    vi.advanceTimersByTime(300);
    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(stored.idx).toBe(0);
    expect(stored.answers[0]).toEqual({ sel: [], text: 'draft', skipped: false });
  });

  it('completing the wizard clears the stored draft and unmount cannot resurrect it', async () => {
    vi.useFakeTimers();
    const view = render(QuestionWizard, {
      props: { questions: [LAST], draftKey: KEY, onComplete: vi.fn() },
    });
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    vi.advanceTimersByTime(300);
    expect(window.localStorage.getItem(KEY)).not.toBeNull();

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    view.unmount();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('confirmed Dismiss clears the stored draft once onDismiss resolves', async () => {
    seedDraft(0, [{ sel: [], text: 'draft', skipped: false }]);
    const view = render(QuestionWizard, {
      props: { questions: [LAST], draftKey: KEY, onDismiss: vi.fn(async () => {}) },
    });
    expect(
      (screen.getByPlaceholderText('Or type your own answer…') as HTMLInputElement).value,
    ).toBe('draft');

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss questions' }));
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
    view.unmount();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('a failed dismissal keeps the stored draft for the re-surfaced wizard', async () => {
    seedDraft(0, [{ sel: [], text: 'draft', skipped: false }]);
    let rejectDismiss!: (error: Error) => void;
    const onDismiss = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectDismiss = reject;
        }),
    );
    render(QuestionWizard, { props: { questions: [LAST], draftKey: KEY, onDismiss } });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss questions' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Still in flight — the draft must not be cleared optimistically.
    expect(window.localStorage.getItem(KEY)).not.toBeNull();

    rejectDismiss(new Error('wire failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('a draft for a mismatched question set is discarded and the wizard starts fresh', () => {
    seedDraft(0, [{ sel: [0], text: '', skipped: false }]);
    render(QuestionWizard, { props: { questions: [SINGLE, MULTI, LAST], draftKey: KEY } });
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('teardown after the draftKey source goes null still flushes under the original key', async () => {
    // Mirrors the host: ChatPanel computes `draftKey` from a nullable
    // `$derived` (`wizardDraftKey(agentId, pendingQuestions.messageId)`), so
    // nulling the source makes the prop expression unevaluable while the
    // wizard tears down. `mount()` with a get-accessor prop over a rune-backed
    // source reproduces the crash deterministically: nulling the `$state`
    // dirties the prop derived, so any teardown-time re-read of the prop
    // (the pre-fix onDestroy flush) re-executes the accessor against null and
    // throws `Cannot read properties of null (reading 'messageId')`. The key
    // is now captured once at init, so unmount must not throw AND the pending
    // draft must flush under the original key.
    vi.useFakeTimers();
    const source = createNullableMessageSource('msg-draft-test');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const wizard = mount(QuestionWizard, {
      target,
      props: {
        questions: [SINGLE, LAST],
        get draftKey() {
          return wizardDraftKey('agent-draft-test', source.current!.messageId);
        },
      },
    });
    flushSync();

    try {
      // Arm a pending debounced save, then null the source and unmount.
      const input = screen.getByPlaceholderText('Or type your own answer…');
      await fireEvent.input(input, { target: { value: 'draft' } });
      expect(window.localStorage.getItem(KEY)).toBeNull();

      source.current = null;
      flushSync();
      unmount(wizard);
      flushSync();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.answers[0]).toEqual({ sel: [], text: 'draft', skipped: false });
    } finally {
      target.remove();
    }
  });

  it('without draftKey the wizard never reads or writes wizard-draft storage', async () => {
    const getSpy = vi.spyOn(window.localStorage, 'getItem');
    const setSpy = vi.spyOn(window.localStorage, 'setItem');
    const removeSpy = vi.spyOn(window.localStorage, 'removeItem');

    const view = render(QuestionWizard, { props: { questions: [SINGLE, LAST] } });
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'draft' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    view.unmount();

    const draftCalls = (spy: ReturnType<typeof vi.spyOn>) =>
      spy.mock.calls.filter(([key]) => String(key).startsWith(PREFIX));
    expect(draftCalls(getSpy)).toHaveLength(0);
    expect(draftCalls(setSpy)).toHaveLength(0);
    expect(draftCalls(removeSpy)).toHaveLength(0);
  });
});
