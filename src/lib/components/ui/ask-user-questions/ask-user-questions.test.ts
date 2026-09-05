// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import AskUserQuestions, {
  type AskUserAnswer,
  type AskUserQuestion,
} from './ask-user-questions.svelte';
import { askUserQuestionsFixtures } from './ask-user-questions.fixtures';
import { askUserQuestionsMetadata } from './ask-user-questions.meta';

afterEach(() => cleanup());

const options = [
  { id: 'speed', title: 'Speed' },
  { id: 'quality', title: 'Quality' },
];

const twoQuestions: AskUserQuestion[] = [
  { id: 'priority', title: 'Choose a priority', options },
  { id: 'audience', title: 'Choose an audience', options },
];

describe('AskUserQuestions', () => {
  it('advances a single-select answer and supports digit shortcuts', async () => {
    const onAnswersChange = vi.fn();
    const onCurrentIndexChange = vi.fn();
    const view = render(AskUserQuestions, {
      props: { questions: twoQuestions, onAnswersChange, onCurrentIndexChange },
    });

    await fireEvent.keyDown(document.body, { key: '2' });

    expect(onCurrentIndexChange).toHaveBeenCalledWith(1);
    expect(onAnswersChange).toHaveBeenLastCalledWith({
      priority: {
        questionId: 'priority',
        selectedIds: ['quality'],
        otherText: undefined,
        skipped: false,
      },
    });
    expect(view.getByText('Choose an audience')).toBeTruthy();
  });

  it('toggles multi-select answers and submits Continue then Finish', async () => {
    const onComplete = vi.fn();
    const questions = twoQuestions.map((question) => ({ ...question, multiSelect: true }));
    const view = render(AskUserQuestions, { props: { questions, onComplete } });

    await fireEvent.click(view.getByRole('checkbox', { name: /Speed/ }));
    await fireEvent.click(view.getByRole('button', { name: /Continue/ }));
    await waitFor(() => expect(view.queryByText('Choose a priority')).toBeNull());
    await fireEvent.click(view.getByRole('checkbox', { name: /Quality/ }));
    await fireEvent.click(view.getByRole('button', { name: /Finish/ }));

    expect(onComplete).toHaveBeenCalledWith({
      priority: expect.objectContaining({ selectedIds: ['speed'] }),
      audience: expect.objectContaining({ selectedIds: ['quality'] }),
    });
  });

  it('submits an allowOther answer with Enter but preserves Shift+Enter', async () => {
    const onComplete = vi.fn();
    const view = render(AskUserQuestions, {
      props: {
        questions: [{ id: 'direction', title: 'Choose a direction', options, allowOther: true }],
        onComplete,
      },
    });
    const input = view.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'A third path' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onComplete).toHaveBeenCalledWith({
      direction: expect.objectContaining({ otherText: 'A third path' }),
    });
  });

  it('blocks invalid free text, clears the error on edit, and then submits', async () => {
    const onComplete = vi.fn();
    const view = render(AskUserQuestions, {
      props: {
        questions: [
          {
            id: 'name',
            title: 'Name the project',
            freeText: true,
            freeTextMultiline: false,
            freeTextValidate: (value) =>
              value.length < 3 ? 'Use at least three characters.' : null,
          },
        ],
        onComplete,
      },
    });
    const input = view.getByRole('textbox', { name: 'Name the project' });
    await fireEvent.input(input, { target: { value: 'No' } });
    await fireEvent.click(view.getByRole('button', { name: /Finish/ }));
    expect(view.getByRole('alert').textContent).toContain('three characters');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.input(input, { target: { value: 'Nova' } });
    expect(view.queryByRole('alert')).toBeNull();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onComplete).toHaveBeenCalledWith({
      name: expect.objectContaining({ otherText: 'Nova' }),
    });
  });

  it('records skip and advances to the next question', async () => {
    const onSkip = vi.fn();
    const onAnswersChange = vi.fn();
    const view = render(AskUserQuestions, {
      props: { questions: twoQuestions, onSkip, onAnswersChange },
    });
    await fireEvent.click(view.getByRole('button', { name: /Skip/ }));
    expect(onSkip).toHaveBeenCalledWith('priority', 0);
    expect(onAnswersChange).toHaveBeenCalledWith({
      priority: expect.objectContaining({ skipped: true }),
    });
    expect(view.getByText('Choose an audience')).toBeTruthy();
  });

  it('places chips on the configured side and exposes optional Back navigation', async () => {
    const onBack = vi.fn();
    const view = render(AskUserQuestions, {
      props: {
        questions: [twoQuestions[0], { ...twoQuestions[1], chipPosition: 'left' }],
        currentIndex: 1,
        showBack: true,
        onBack,
      },
    });
    expect(view.getByRole('radio', { name: /Speed/ }).getAttribute('data-chip-position')).toBe(
      'left',
    );
    await fireEvent.click(view.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalledWith(1);
  });

  it('honors controlled index and answer state while emitting requested changes', async () => {
    const onCurrentIndexChange = vi.fn();
    const onAnswersChange = vi.fn();
    const answers: Record<string, AskUserAnswer> = {
      priority: { questionId: 'priority', selectedIds: ['quality'] },
    };
    const view = render(AskUserQuestions, {
      props: {
        questions: twoQuestions,
        currentIndex: 0,
        answers,
        onCurrentIndexChange,
        onAnswersChange,
      },
    });
    expect(view.getByRole('radio', { name: /Quality/ }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(view.getByRole('radio', { name: /Speed/ }));
    expect(onCurrentIndexChange).toHaveBeenCalledWith(1);
    expect(onAnswersChange).toHaveBeenCalledWith({
      priority: expect.objectContaining({ selectedIds: ['speed'] }),
    });
    expect(view.getByText('Choose a priority')).toBeTruthy();
  });

  it('publishes the ten reference fixtures and valid metadata', () => {
    expect(() => parseUiComponentMetadata(askUserQuestionsMetadata)).not.toThrow();
    expect(askUserQuestionsFixtures.map(({ title }) => title)).toEqual([
      'Playground',
      'Multiple questions',
      'Multi-select',
      'With other',
      'Free text',
      'Free text validation',
      'Skippable',
      'Chip on left',
      'Stacked layout',
      'Controlled',
    ]);
  });
});
