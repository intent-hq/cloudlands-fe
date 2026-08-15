/**
 * Sequential Q&A wizard (pixel mock t2 interaction logic): choose-one
 * advances on selection (re-click deselects), multi-select toggles and keeps
 * Next, Enter in the free-form field advances, Skip clears + advances, Back
 * returns with the previous answer pre-selected, Hide collapses to the
 * banner, Dismiss is gated behind a confirmation dialog, and Send on the
 * last question hands back the full answers array.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import QuestionWizard, { type QuestionAnswer } from '../QuestionWizard.svelte';
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

describe('QuestionWizard', () => {
  it('renders a focused first question with counter and no decorative progress', () => {
    const { container } = setup();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(container.querySelectorAll('[data-progress-segment]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy();
    expect(screen.getByText('Token storage')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
    expect(screen.queryByText('Selecting an option moves to the next question')).toBeNull();
  });

  it('uses one semantic card with lightweight unboxed choices and an outlined input', () => {
    const { container } = setup([LAST]);
    const wizard = container.querySelector('[data-question-wizard]');
    const options = Array.from(container.querySelectorAll('[data-question-option]'));
    const input = screen.getByPlaceholderText('Or type your own answer…');

    expect(wizard?.className).toContain('bg-card');
    expect(wizard?.className).toContain('border-border/70');
    expect(wizard?.className).toContain('rounded-(--radius-large)');
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.className.includes('border-0'))).toBe(true);
    expect(options.every((option) => option.className.includes('focus-visible:ring-inset'))).toBe(
      true,
    );
    expect(options.every((option) => !option.className.includes('shadow'))).toBe(true);
    expect(container.querySelectorAll('[data-option-indicator]')).toHaveLength(2);
    expect(input.parentElement?.className).toContain('focus-within:border-ring');
    expect(screen.getByRole('heading', { name: LAST.question })).toBeTruthy();
  });

  it('keeps the action footer compact and symmetrically inset', () => {
    setup([LAST]);
    const footer = screen.getByTestId('question-wizard-footer');

    expect(footer.className).toContain('py-3');
    expect(footer.className).not.toContain('pb-4');
  });

  it('single-question wizard hides the counter, progress segments, and Back button', () => {
    const { container } = setup([MULTI]);
    expect(screen.queryByText('1 of 1')).toBeNull();
    expect(container.querySelectorAll('[data-progress-segment]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.queryByText('Agent Has Questions')).toBeNull();
    expect(screen.queryByText('select all that apply')).toBeNull();
    expect(screen.getByRole('button', { name: /hide/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /skip/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy();
  });

  it('single-select single-question wizard shows Send and no advance hint', () => {
    const { container } = setup([LAST]);
    expect(screen.queryByText('1 of 1')).toBeNull();
    expect(container.querySelectorAll('[data-progress-segment]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.queryByText('Selecting an option moves to the next question')).toBeNull();
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy();
  });

  it('single-select advances immediately on selection', async () => {
    setup();
    await fireEvent.click(screen.getByText('OS keychain'));
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByText('Scope')).toBeTruthy();
  });

  it('single-select re-click deselects on the last question', async () => {
    setup([LAST]);
    await fireEvent.click(screen.getByText('Migrate silently'));
    const send = screen.getByRole('button', { name: /send/i });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(screen.getByText('Migrate silently'));
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it('multi-select toggles checkboxes and requires Next; Next disabled with no selection/text', async () => {
    setup();
    await fireEvent.click(screen.getByText('OS keychain'));
    expect(screen.queryByText('select all that apply')).toBeNull();
    const next = screen.getByRole('button', { name: /next/i });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByText('Desktop app'));
    await fireEvent.click(screen.getByText('CLI'));
    expect((next as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(next);
    expect(screen.getByText('3 of 3')).toBeTruthy();
  });

  it('Back returns with the previous answer pre-selected and is disabled on Q1', async () => {
    const { container } = setup();
    const back = screen.getByRole('button', { name: /back/i });
    expect((back as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByText('OS keychain'));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('1 of 3')).toBeTruthy();
    const selectedRow = container.querySelector('[data-question-option][data-selected="true"]');
    expect(selectedRow?.textContent).toContain('OS keychain');
  });

  it('Skip clears selection and text and advances', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'draft' } });
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(screen.getByText('2 of 3')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(
      (screen.getByPlaceholderText('Or type your own answer…') as HTMLInputElement).value,
    ).toBe('');
  });

  it('Enter in the free-form field advances', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('keeps the free-form field visually integrated when focused', () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');

    expect(input.className).toContain('focus:outline-none!');
    expect(input.className).toContain('focus:ring-0!');
    expect(input.className).toContain('focus-visible:outline-none!');
    expect(input.className).toContain('focus-visible:ring-0!');
  });

  it('last question shows Send and hands back the full answers array', async () => {
    const { onComplete } = setup();
    await fireEvent.click(screen.getByText('OS keychain'));
    await fireEvent.click(screen.getByText('Desktop app'));
    await fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const send = screen.getByRole('button', { name: /send/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Ask the user' } });
    await fireEvent.click(send);
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
    await fireEvent.click(screen.getByRole('button', { name: /send/i }));
    const answers = onComplete.mock.calls[0][0];
    expect(answers[0]).toMatchObject({ selectedLabels: [], freeText: '', skipped: true });
    expect(answers[1]).toMatchObject({ selectedLabels: ['Migrate silently'], skipped: false });
  });

  it('multi-select answer after Skip then Back clears the stale skipped flag', async () => {
    const { onComplete } = setup([MULTI, LAST]);
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await fireEvent.click(screen.getByText('Desktop app'));
    await fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await fireEvent.click(screen.getByText('Migrate silently'));
    await fireEvent.click(screen.getByRole('button', { name: /send/i }));
    const answers = onComplete.mock.calls[0][0];
    expect(answers[0]).toMatchObject({ selectedLabels: ['Desktop app'], skipped: false });
  });

  it('free-text answer after Skip then Back clears the stale skipped flag', async () => {
    const { onComplete } = setup([SINGLE, LAST]);
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.click(screen.getByText('Migrate silently'));
    await fireEvent.click(screen.getByRole('button', { name: /send/i }));
    const answers = onComplete.mock.calls[0][0];
    expect(answers[0]).toMatchObject({ selectedLabels: [], freeText: 'Redis', skipped: false });
  });

  it('single-select: typing in the Other input clears the option selection', async () => {
    const { container } = setup([LAST]);
    await fireEvent.click(screen.getByText('Migrate silently'));
    expect(container.querySelector('[data-question-option][data-selected="true"]')).toBeTruthy();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'R' } });
    expect(container.querySelector('[data-question-option][data-selected="true"]')).toBeNull();
    const send = screen.getByRole('button', { name: /send/i });
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  it('single-select: option buttons are disabled while Other text is present and clicks are no-ops', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    const option = screen.getByText('OS keychain').closest('button') as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    await fireEvent.click(option);
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(option.getAttribute('aria-pressed')).toBe('false');
  });

  it('single-select: clearing the Other input re-enables the option buttons', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    const option = screen.getByText('OS keychain').closest('button') as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: '' } });
    expect(option.disabled).toBe(false);
    await fireEvent.click(option);
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('single-select: option buttons stay disabled when returning via Back with Other text', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Redis' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2 of 3')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    const option = screen.getByText('OS keychain').closest('button') as HTMLButtonElement;
    expect(option.disabled).toBe(true);
  });

  it('multi-select: options and Other text coexist; buttons never disabled by text', async () => {
    const { onComplete } = setup([MULTI]);
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'Also the API' } });
    const option = screen.getByText('Desktop app').closest('button') as HTMLButtonElement;
    expect(option.disabled).toBe(false);
    await fireEvent.click(option);
    expect(option.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onComplete.mock.calls[0][0][0]).toMatchObject({
      selectedLabels: ['Desktop app'],
      freeText: 'Also the API',
    });
  });

  it('Hide requests collapse; collapsed renders the banner that re-expands on click', async () => {
    const { onToggleCollapsed, rerender } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    await rerender({ collapsed: true });
    expect(screen.getByText('Click to expand')).toBeTruthy();
    expect(screen.queryByText('1 of 3')).toBeNull();
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
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onToggleCollapsed).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('Cancel closes the confirm dialog without dismissing', async () => {
    const onDismiss = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], onDismiss } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
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
    expect(confirm.className).toContain('ring-[3px]');

    cancel.focus();
    await waitFor(() => expect(confirm.className).not.toContain('ring-[3px]'));

    await fireEvent.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(dismissTrigger));
  });

  it('uses the canonical compact editorial dialog surface', async () => {
    const onDismiss = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], onDismiss } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-slot')).toBe('dialog-content');
    expect(dialog.className).toContain('max-w-sm');
    expect(dialog.className).toContain('bg-popover');
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="dialog-footer"]')?.className).toContain('border-0');
    expect(dialog.querySelector('.svelte-fa')).toBeNull();
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
