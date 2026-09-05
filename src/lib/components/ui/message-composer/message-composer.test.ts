// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import MessageComposerHarness from './MessageComposerHarness.svelte';
import { messageComposerFixtures } from './message-composer.fixtures';
import { messageComposerMetadata } from './message-composer.meta';
import MessageComposer from './message-composer.svelte';
import type { QueuedMessage } from './types';

afterEach(cleanup);

const queue: QueuedMessage[] = [
  { id: 'first', text: 'First queued prompt', files: [] },
  { id: 'second', text: 'Second queued prompt', files: [] },
  { id: 'third', text: 'Third queued prompt', files: [] },
];

describe('MessageComposer', () => {
  it('sends a trimmed draft and preserves Shift+Enter for a newline', async () => {
    const onSend = vi.fn();
    const { getByRole } = render(MessageComposer, { props: { value: '  Ship it  ', onSend } });
    const textbox = getByRole('textbox');
    await fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    await fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Ship it', []);
  });

  it('morphs between stop and queue while streaming', async () => {
    const empty = render(MessageComposerHarness, { props: { initialStatus: 'streaming' } });
    await fireEvent.click(empty.getByRole('button', { name: 'Stop' }));
    expect(empty.getByTestId('stopped').textContent).toBe('1');
    empty.unmount();

    const draft = render(MessageComposerHarness, {
      props: { initialStatus: 'streaming', initialValue: 'Queue this' },
    });
    const textbox = draft.getByRole('textbox');
    expect(draft.getByRole('button', { name: 'Queue message' })).not.toBeNull();
    await fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(draft.getByTestId('value').textContent).toBe('');
    expect(draft.getByTestId('queue').textContent).not.toBe('');
  });

  it('dispatches the queue head on the streaming to idle edge and announces it', async () => {
    const view = render(MessageComposerHarness, {
      props: { initialStatus: 'streaming', initialQueue: queue },
    });
    await fireEvent.click(view.getByRole('button', { name: 'Finish response' }));
    await waitFor(() => expect(view.getByTestId('queue').textContent).toBe('second,third'));
    expect(view.getByTestId('sends').textContent).toContain(
      JSON.stringify({ text: 'First queued prompt', queuedId: 'first' }),
    );
    expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Message sent',
    );
  });

  it.each(['double-click', 'Enter', 'F2'] as const)(
    'edits a queued row with %s',
    async (method) => {
      const view = render(MessageComposerHarness, {
        props: { initialStatus: 'streaming', initialQueue: [queue[0]] },
      });
      const row = view.getByRole('button', { name: 'First queued prompt' });
      if (method === 'double-click') await fireEvent.doubleClick(row);
      else await fireEvent.keyDown(row, { key: method });
      expect(view.getByTestId('value').textContent).toBe('First queued prompt');
      expect(view.getByTestId('queue').textContent).toBe('');
      expect(document.activeElement).toBe(view.getByRole('textbox'));
    },
  );

  it('deletes and keyboard-reorders queued rows', async () => {
    const view = render(MessageComposerHarness, {
      props: { initialStatus: 'streaming', initialQueue: queue },
    });
    await fireEvent.keyDown(view.getByRole('button', { name: 'Second queued prompt' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    expect(view.getByTestId('queue').textContent).toBe('second,first,third');
    await fireEvent.keyDown(view.getByRole('button', { name: 'First queued prompt' }), {
      key: 'Delete',
    });
    expect(view.getByTestId('queue').textContent).toBe('second,third');
  });

  it('drag-reorders queued rows', async () => {
    const view = render(MessageComposerHarness, {
      props: { initialStatus: 'streaming', initialQueue: queue },
    });
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    };
    await fireEvent.dragStart(view.getByRole('button', { name: 'First queued prompt' }), {
      dataTransfer,
    });
    await fireEvent.drop(view.getByRole('button', { name: 'Third queued prompt' }), {
      dataTransfer,
    });
    expect(view.getByTestId('queue').textContent).toBe('second,third,first');
  });

  it('fills the placeholder suggestion with Tab', async () => {
    const view = render(MessageComposerHarness, {
      props: { placeholderSuggestion: 'Summarize this workspace' },
    });
    const textbox = view.getByRole('textbox');
    expect(textbox.getAttribute('aria-describedby')).toBeTruthy();
    await fireEvent.keyDown(textbox, { key: 'Tab' });
    expect(view.getByTestId('value').textContent).toBe('Summarize this workspace');
    expect(document.activeElement).toBe(textbox);
  });

  it('drives the suggestions listbox without moving textarea focus', async () => {
    const view = render(MessageComposerHarness, {
      props: { suggestions: ['Explain the changes', 'Write release notes'] },
    });
    const textbox = view.getByRole('textbox');
    textbox.focus();
    await waitFor(() => expect(view.getAllByRole('option')).toHaveLength(2));
    await fireEvent.keyDown(textbox, { key: 'ArrowDown' });
    expect(textbox.getAttribute('aria-activedescendant')).toContain('-0');
    expect(document.activeElement).toBe(textbox);
    await fireEvent.keyDown(textbox, { key: 'ArrowDown' });
    await fireEvent.keyDown(textbox, { key: 'ArrowUp' });
    await fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(view.getByTestId('value').textContent).toBe('Explain the changes');
    expect(document.activeElement).toBe(textbox);
  });

  it('recalls history and restores the in-progress draft', async () => {
    const view = render(MessageComposerHarness, {
      props: { initialValue: 'unfinished', history: ['older', 'newer'] },
    });
    const textbox = view.getByRole('textbox') as HTMLTextAreaElement;
    textbox.focus();
    textbox.setSelectionRange(0, 0);
    await fireEvent.keyDown(textbox, { key: 'ArrowUp' });
    expect(view.getByTestId('value').textContent).toBe('newer');
    await fireEvent.keyDown(textbox, { key: 'ArrowUp' });
    expect(view.getByTestId('value').textContent).toBe('older');
    await fireEvent.keyDown(textbox, { key: 'ArrowDown' });
    await fireEvent.keyDown(textbox, { key: 'ArrowDown' });
    expect(view.getByTestId('value').textContent).toBe('unfinished');
  });

  it('prioritizes drag over focus over hover ring states', async () => {
    const onFilesChange = vi.fn();
    const view = render(MessageComposer, { props: { value: '', files: [], onFilesChange } });
    const root = view.container.querySelector('[data-slot="message-composer"]') as HTMLElement;
    const textbox = view.getByRole('textbox');
    await fireEvent.mouseEnter(root);
    expect(root.dataset.ringState).toBe('hover');
    await fireEvent.focus(textbox);
    expect(root.dataset.ringState).toBe('focus');
    await fireEvent.dragOver(root, { dataTransfer: { types: ['Files'], dropEffect: 'none' } });
    expect(root.dataset.ringState).toBe('drag');
    await fireEvent.dragLeave(root, { relatedTarget: document.body });
    expect(root.dataset.ringState).toBe('focus');
  });

  it('clamps auto-resize between minimum and maximum rows', async () => {
    const view = render(MessageComposer, { props: { value: '', minRows: 2, maxRows: 3 } });
    const textbox = view.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperty(textbox, 'scrollHeight', { configurable: true, value: 200 });
    await fireEvent.input(textbox, { target: { value: 'many lines' } });
    expect(textbox.style.height).toBe('60px');
    expect(textbox.style.overflowY).toBe('auto');
    Object.defineProperty(textbox, 'scrollHeight', { configurable: true, value: 10 });
    await fireEvent.input(textbox, { target: { value: 'short' } });
    expect(textbox.style.height).toBe('40px');
    expect(textbox.style.overflowY).toBe('hidden');
  });

  it('filters, limits, renders, and removes dropped files', async () => {
    const image = new File(['image'], 'preview.png', { type: 'image/png' });
    const text = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const view = render(MessageComposerHarness, { props: { initialFiles: [image] } });
    expect(view.getByText('preview.png')).not.toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'Remove preview.png' }));
    await waitFor(() => expect(view.queryByText('preview.png')).toBeNull());
    expect(
      view.container
        .querySelector('[data-message-composer-height="files"]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');

    const onFilesChange = vi.fn();
    const direct = render(MessageComposer, {
      props: { value: '', files: [], onFilesChange, maxFiles: 1 },
    });
    const root = direct.container.querySelector('[data-slot="message-composer"]') as HTMLElement;
    await fireEvent.drop(root, { dataTransfer: { files: [text, image], types: ['Files'] } });
    expect(onFilesChange).toHaveBeenCalledWith([image]);
  });

  it('publishes the nine reference sections and valid metadata', () => {
    expect(() => parseUiComponentMetadata(messageComposerMetadata)).not.toThrow();
    expect(messageComposerFixtures.map(({ title }) => title)).toEqual([
      'Playground',
      'Basic',
      'Suggestions',
      'Attachments',
      'Queued messages',
      'Left slot only',
      'Right slot only',
      'Send handler',
      'Disabled',
    ]);
  });
});
