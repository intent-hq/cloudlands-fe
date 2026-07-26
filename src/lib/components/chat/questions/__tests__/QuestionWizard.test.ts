/**
 * Sequential Q&A wizard (pixel mock t2 interaction logic): choose-one
 * advances on selection (re-click deselects), multi-select toggles and keeps
 * Next, Enter in the free-form field advances, Skip clears + advances, Back
 * returns with the previous answer pre-selected, Ignore collapses to the
 * banner, and Send on the last question hands back the full answers array.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
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

function setup(questions: Question[] = [SINGLE, MULTI, LAST]) {
  const onComplete = vi.fn<(answers: QuestionAnswer[]) => void>();
  const onToggleCollapsed = vi.fn<(collapsed: boolean) => void>();
  const utils = render(QuestionWizard, {
    props: { questions, onComplete, onToggleCollapsed },
  });
  return { ...utils, onComplete, onToggleCollapsed };
}

describe('QuestionWizard', () => {
  it('renders the first question with counter and no Next for mid-flow single-select', () => {
    setup();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('Token storage')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
    expect(screen.getByText('Selecting an option moves to the next question')).toBeTruthy();
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
    expect(screen.getByText('select all that apply')).toBeTruthy();
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
    const selectedRow = container.querySelector('.border-primary.bg-primary\\/10');
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

  it('Ignore requests collapse; collapsed renders the banner that re-expands on click', async () => {
    const { onToggleCollapsed, rerender } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /ignore/i }));
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    await rerender({ collapsed: true });
    expect(screen.getByText('Click to expand')).toBeTruthy();
    expect(screen.queryByText('1 of 3')).toBeNull();
    await fireEvent.click(screen.getByText('Agent Has Questions'));
    expect(onToggleCollapsed).toHaveBeenCalledWith(false);
  });
});
