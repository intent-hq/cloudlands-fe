/**
 * Sequential Q&A wizard (pixel mock t2 interaction logic): choose-one
 * advances or completes on selection, multi-select toggles and keeps
 * Continue, Enter in the free-form field advances, Skip clears + advances, Back
 * returns with the previous answer pre-selected, Hide collapses to the
 * banner, Dismiss is gated behind a confirmation dialog, and Continue on the
 * last typed answer hands back the full answers array. Redux-owned draft props
 * drive restoration; edits and successful resolution are reported to the host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import QuestionWizard, { type QuestionAnswer } from '../QuestionWizard.svelte';
import type { Question } from '$shared/types/question-resource';
import { REDUCE_MOTION_ATTRIBUTE } from '$lib/utils/reduced-motion';

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

const MULTI_B: Question = {
  attachmentId: 'tar-ddd444eee555',
  header: 'Platforms',
  question: 'Which platforms need the new flow first?',
  options: [{ label: 'macOS' }, { label: 'Windows' }, { label: 'Linux' }],
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
  vi.restoreAllMocks();
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

async function pasteImages(files: File[]) {
  return fireEvent.paste(currentOtherInput(), {
    clipboardData: {
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    },
  });
}

function deferImageRead() {
  let complete: (() => void) | undefined;
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
    this: FileReader,
  ) {
    complete = () => {
      Object.defineProperty(this, 'result', { value: 'data:image/png;base64,Zmlyc3Q=' });
      this.dispatchEvent(new ProgressEvent('load'));
    };
  });
  return {
    read,
    finish: () =>
      act(async () => {
        if (!complete) throw new Error('No image read is pending');
        complete();
      }),
  };
}

describe('QuestionWizard image answers', () => {
  it.each([SINGLE, MULTI])(
    'accepts image-only answers for $header without inserting text',
    async (question) => {
      const { onComplete } = setup([question]);
      expect(await pasteImages([new File(['first'], 'first.png', { type: 'image/png' })])).toBe(
        false,
      );
      await screen.findByRole('button', { name: 'Remove first.png' });
      expect(currentOtherInput().value).toBe('');
      await fireEvent.keyDown(currentOtherInput(), { key: 'Enter' });
      expect(onComplete).toHaveBeenCalledWith([
        {
          question,
          selectedLabels: [],
          freeText: '',
          skipped: false,
          imageBlocks: [{ type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png' }],
        },
      ]);
    },
  );

  it('keeps images across navigation and collapse, and removes them independently', async () => {
    const { onComplete, rerender } = setup([SINGLE, LAST]);
    await pasteImages([
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    ]);
    await screen.findByRole('button', { name: 'Remove second.jpg' });
    await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await rerender({ collapsed: true });
    await rerender({ collapsed: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove first.png' }));
    await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await fireEvent.click(screen.getByText('Migrate silently'));
    expect(onComplete.mock.calls[0][0][0].imageBlocks).toEqual([
      { type: 'image', data: 'c2Vjb25k', mimeType: 'image/jpeg' },
    ]);
  });

  it('removing the last image restores single-select choices and prevents empty submission', async () => {
    const { onComplete } = setup([SINGLE]);
    await pasteImages([new File(['first'], 'first.png', { type: 'image/png' })]);
    const remove = await screen.findByRole('button', { name: 'Remove first.png' });
    expect(screen.getByRole('radio', { name: /OS keychain/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    await fireEvent.click(remove);
    await fireEvent.keyDown(currentOtherInput(), { key: 'Enter' });
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText('OS keychain'));
    expect(onComplete.mock.calls[0][0][0]).toMatchObject({ selectedLabels: ['OS keychain'] });
    expect(onComplete.mock.calls[0][0][0].imageBlocks).toBeUndefined();
  });

  it('Skip clears images so Back cannot restore or submit them', async () => {
    const { onComplete } = setup([SINGLE, LAST]);
    await pasteImages([new File(['first'], 'first.png', { type: 'image/png' })]);
    await screen.findByRole('button', { name: 'Remove first.png' });
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.queryByRole('button', { name: 'Remove first.png' })).toBeNull();
    await fireEvent.keyDown(currentOtherInput(), { key: 'Enter' });
    expect(screen.getByRole('heading', { name: SINGLE.question })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await fireEvent.click(screen.getByText('Migrate silently'));
    expect(onComplete.mock.calls[0][0][0].imageBlocks).toBeUndefined();
  });

  it('reports only text and selections to the persisted draft owner', async () => {
    const onDraftChange = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], onDraftChange } });
    await pasteImages([new File(['first'], 'first.png', { type: 'image/png' })]);
    await screen.findByRole('button', { name: 'Remove first.png' });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      idx: 0,
      answers: [{ sel: [], text: '', skipped: false }],
    });
  });

  it.each([
    { workspaceId: 'ordinary-workspace', limitMiB: 30 },
    { workspaceId: '__chief__', limitMiB: 10 },
  ])('matches the composer image cap for $workspaceId', async ({ workspaceId, limitMiB }) => {
    const onComplete = vi.fn();
    render(QuestionWizard, { props: { questions: [SINGLE], workspaceId, onComplete } });
    expect(await fireEvent.paste(currentOtherInput(), { clipboardData: { items: [] } })).toBe(true);
    const oversized = new File(['image'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: limitMiB * 1024 * 1024 + 1 });
    await pasteImages([oversized]);
    await waitFor(() => expect(currentOtherInput().disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'Remove large.png' })).toBeNull();
    await fireEvent.keyDown(currentOtherInput(), { key: 'Enter' });
    expect(onComplete).not.toHaveBeenCalled();
    const atLimit = new File(['first'], 'limit.png', { type: 'image/png' });
    Object.defineProperty(atLimit, 'size', { value: limitMiB * 1024 * 1024 });
    await pasteImages([atLimit]);
    await screen.findByRole('button', { name: 'Remove limit.png' });
    await fireEvent.keyDown(currentOtherInput(), { key: 'Enter' });
    expect(onComplete.mock.calls[0][0][0].imageBlocks).toEqual([
      { type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png' },
    ]);
  });

  it('blocks overlapping pastes and submission until the pending read finishes', async () => {
    const { read, finish } = deferImageRead();
    const { onComplete } = setup([SINGLE]);
    await pasteImages([new File(['first'], 'first.png', { type: 'image/png' })]);
    expect(currentOtherInput().disabled).toBe(true);
    await pasteImages([new File(['second'], 'second.png', { type: 'image/png' })]);
    await fireEvent.keyDown(currentOtherInput(), { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(read).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    await finish();
    await fireEvent.keyDown(currentOtherInput(), { key: 'Enter' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0][0].imageBlocks).toEqual([
      { type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png' },
    ]);
  });

  it.each(['unmount', 'dismiss'])('ignores image reads completed after %s', async (action) => {
    const { finish } = deferImageRead();
    const onDraftChange = vi.fn();
    const onComplete = vi.fn();
    const onResolved = vi.fn();
    const view = render(QuestionWizard, {
      props: { questions: [SINGLE], onDraftChange, onComplete, onResolved, onDismiss: vi.fn() },
    });
    await pasteImages([new File(['first'], 'first.png', { type: 'image/png' })]);
    if (action === 'unmount') {
      view.unmount();
      setup([LAST]);
    } else {
      await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Dismiss questions' }));
      await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    }
    onDraftChange.mockClear();
    await finish();
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remove first.png' })).toBeNull();
  });
});

describe('QuestionWizard', () => {
  it('names the RadioGroup with the current question', () => {
    const { container } = setup();
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(container.querySelectorAll('[data-progress-segment]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    expect(screen.getByRole('heading', { name: SINGLE.question })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: SINGLE.question })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(SINGLE.options.length);
  });

  it('renders the counter, question, Hide, and Dismiss controls', () => {
    render(QuestionWizard, {
      props: { questions: [SINGLE, LAST], onDismiss: vi.fn() },
    });
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: SINGLE.question })).toBeTruthy();
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
    expect(screen.getByRole('heading', { name: MULTI.question })).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('re-reads the reduced-motion flag per step so battery/AC flips apply without remount', async () => {
    const root = document.documentElement;
    const animate = vi.spyOn(Element.prototype, 'animate');
    try {
      setup([SINGLE, MULTI, LAST]);
      animate.mockClear();

      // Mounted on AC, then switched to battery: the next step must not animate.
      root.setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
      await fireEvent.click(screen.getByText('OS keychain'));
      expect(screen.getByText('Question 2 of 3')).toBeTruthy();
      expect(animate).not.toHaveBeenCalled();

      // Plugged back in: the following step animates at full duration again.
      root.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
      await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
      expect(screen.getByText('Question 3 of 3')).toBeTruthy();
      await waitFor(() => {
        const durations = animate.mock.calls.map(([, options]) =>
          typeof options === 'number' ? options : options?.duration,
        );
        expect(durations).toContain(240);
      });
    } finally {
      root.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
      animate.mockRestore();
    }
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

  it('renders the free-form field as a single-row textarea that wraps and resizes', () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…') as HTMLTextAreaElement;
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.rows).toBe(1);
    expect(input.getAttribute('aria-label')).toBe('Type your own answer');
    expect(input.className).toContain('resize-y');
    expect(input.parentElement?.className).not.toContain('items-center');
  });

  it('Shift+Enter keeps the step and lets the field hold a newline', async () => {
    const { onComplete } = setup();
    const input = screen.getByPlaceholderText('Or type your own answer…') as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: 'first line' } });
    const shiftEnter = await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    // Not prevented → the browser inserts the newline natively.
    expect(shiftEnter).toBe(true);
    await fireEvent.input(input, { target: { value: 'first line\nsecond line' } });

    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(input.value).toBe('first line\nsecond line');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('Enter during IME composition does not advance', async () => {
    setup();
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: 'にほん' } });
    const composing = await fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(composing).toBe(true);
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
  });

  it('plain Enter after a Shift+Enter newline advances with the newline preserved', async () => {
    const { onComplete } = setup([SINGLE, LAST]);
    const input = screen.getByPlaceholderText('Or type your own answer…');
    await fireEvent.input(input, { target: { value: '  first line\nsecond line  ' } });
    const plainEnter = await fireEvent.keyDown(input, { key: 'Enter' });
    expect(plainEnter).toBe(false);
    expect(screen.getByText('Question 2 of 2')).toBeTruthy();

    await fireEvent.click(screen.getByText('Migrate silently'));
    expect(onComplete.mock.calls[0][0][0]).toEqual({
      question: SINGLE,
      selectedLabels: [],
      freeText: 'first line\nsecond line',
      skipped: false,
    });
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

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'Ctrl/Cmd+Enter after Back advances exactly one step over prefilled answers (%o)',
    async (modifier) => {
      const { onComplete } = setup([MULTI, MULTI_B, LAST]);
      await fireEvent.click(screen.getByRole('checkbox', { name: /Desktop app/ }));
      await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await fireEvent.click(screen.getByRole('checkbox', { name: /macOS/ }));
      await fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByText('Question 3 of 3')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: /back/i }));
      await fireEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(screen.getByText('Question 1 of 3')).toBeTruthy();

      const checkbox = screen.getByRole('checkbox', { name: /Desktop app/ });
      checkbox.focus();
      await fireEvent.keyDown(checkbox, { key: 'Enter', ...modifier });

      expect(screen.getByText('Question 2 of 3')).toBeTruthy();
      expect(onComplete).not.toHaveBeenCalled();
    },
  );

  it('Enter in the empty Other field submits a checked multi-select answer', async () => {
    const { onComplete } = setup([MULTI]);
    const input = screen.getByPlaceholderText('Or type your own answer…');

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('checkbox', { name: /Desktop app/ }));
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual([
      { question: MULTI, selectedLabels: ['Desktop app'], freeText: '', skipped: false },
    ]);
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
    const { onToggleCollapsed, rerender } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    await rerender({ collapsed: true });
    expect(screen.getByText('Click to expand')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
    await fireEvent.click(screen.getByText('Agent Has Questions'));
    expect(onToggleCollapsed).toHaveBeenCalledWith(false);
  });

  it('Dismiss from the expanded footer opens the confirm dialog; confirming fires onDismiss', async () => {
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

  it('keyboard shortcuts cannot answer or advance while the dismissal dialog is open', async () => {
    const onDismiss = vi.fn();
    const onComplete = vi.fn<(answers: QuestionAnswer[]) => void>();
    render(QuestionWizard, { props: { questions: [MULTI, LAST], onDismiss, onComplete } });
    await fireEvent.click(screen.getByRole('checkbox', { name: /Desktop app/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    const confirm = screen.getByRole('button', { name: 'Dismiss questions' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));

    await fireEvent.keyDown(confirm, { key: '2' });
    await fireEvent.keyDown(document, { key: '2' });
    await fireEvent.keyDown(confirm, { key: 'Enter', ctrlKey: true });
    await fireEvent.keyDown(document, { key: 'Enter', metaKey: true });

    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /CLI/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });
    expect(screen.getByText('Question 2 of 2')).toBeTruthy();
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

describe('QuestionWizard Redux draft integration', () => {
  const PREFIX = 'chat.questionWizardDraft/';

  it('renders the canonical draft and reports an immutable updated snapshot', async () => {
    const questions = [SINGLE, MULTI, LAST];
    const draft = {
      idx: 1,
      answers: [
        { sel: [], text: '', skipped: true },
        { sel: [0], text: 'Also the API', skipped: false },
        { sel: [], text: '', skipped: false },
      ],
    };
    const onDraftChange = vi.fn();
    render(QuestionWizard, { props: { questions, draft, onDraftChange } });
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Desktop app/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(currentOtherInput().value).toBe('Also the API');

    await fireEvent.input(currentOtherInput(), { target: { value: 'Updated' } });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      idx: 1,
      answers: [draft.answers[0], { sel: [0], text: 'Updated', skipped: false }, draft.answers[2]],
    });
  });

  it('resolves only after the host admits completion', async () => {
    const onResolved = vi.fn();
    const rejected = render(QuestionWizard, {
      props: { questions: [LAST], onComplete: () => false, onResolved },
    });
    await fireEvent.click(screen.getByText('Migrate silently'));
    expect(onResolved).not.toHaveBeenCalled();
    rejected.unmount();

    render(QuestionWizard, {
      props: { questions: [LAST], onComplete: () => true, onResolved },
    });
    await fireEvent.click(screen.getByText('Migrate silently'));
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('resolves dismissal only after the existing host acknowledgment succeeds', async () => {
    const onResolved = vi.fn();
    let acknowledge!: () => void;
    const onDismiss = vi.fn(() => new Promise<void>((resolve) => (acknowledge = resolve)));
    render(QuestionWizard, { props: { questions: [LAST], onDismiss, onResolved } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss questions' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onResolved).not.toHaveBeenCalled();
    acknowledge();
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
  });

  it('keeps the draft unresolved when dismissal fails', async () => {
    const onResolved = vi.fn();
    const onDismiss = vi.fn(async () => Promise.reject(new Error('wire failure')));
    render(QuestionWizard, { props: { questions: [LAST], onDismiss, onResolved } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss questions' }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('never reads or writes wizard-draft storage directly', async () => {
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
