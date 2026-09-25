/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { WORKSPACE_ROUTE_CONTEXT } from '$lib/utils/workspace-route-context';

vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));

import QueuedMessageList from '../QueuedMessageList.svelte';
import QueuedMessageEditMotionHost from './QueuedMessageEditMotionHost.svelte';
import { resolveAttachmentImageUrl } from '../attachment-image-url';

function queued(overrides: Partial<QueuedMessage>): QueuedMessage {
  return {
    id: 'q-1',
    content: 'hello',
    queuedAt: '2026-01-01T00:00:00.000Z',
    position: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function buttonTooltips(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button[tooltip]')).map(
    (b) => b.getAttribute('tooltip') ?? '',
  );
}

describe('QueuedMessageList', () => {
  it('renders a regular queued message as raw text with the reference remove affordance', () => {
    const { container } = render(QueuedMessageList, {
      props: { messages: [queued({ content: 'run the tests' })] },
    });

    expect(screen.getByText('run the tests')).toBeTruthy();
    const tooltips = buttonTooltips(container);
    expect(tooltips).toContain('Remove');
  });

  it('supports reference edit, remove, and send-now keyboard interactions', async () => {
    const onedit = vi.fn().mockResolvedValue({ success: true });
    const onremove = vi.fn();
    const onsendnow = vi.fn();
    render(QueuedMessageList, {
      props: {
        messages: [queued({ content: 'A long queued message that stays on one line' })],
        onedit,
        onremove,
        onsendnow,
      },
    });

    const content = screen.getByTestId('queued-message-content');
    await fireEvent.keyDown(content, { key: 'F2' });
    await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', expect.any(String), true));
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    await fireEvent.keyDown(screen.getByTestId('queued-message-content'), {
      key: 'Enter',
      metaKey: true,
    });
    expect(onsendnow).toHaveBeenCalledWith('q-1');
    await fireEvent.keyDown(screen.getByTestId('queued-message-content'), { key: 'Delete' });
    expect(onremove).toHaveBeenCalledWith('q-1');
  });

  describe('edit action', () => {
    it('edits only the selected row, cancelling drafts or saving without sending or removing', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const onsendnow = vi.fn();
      const onremove = vi.fn();
      render(QueuedMessageList, {
        props: {
          messages: [queued({}), queued({ id: 'q-2', content: 'second', position: 1 })],
          onedit,
          onsendnow,
          onremove,
        },
      });
      const row = within(screen.getAllByTestId('queued-message-row')[1]);
      await fireEvent.click(row.getByRole('button', { name: 'Edit', exact: true }));
      await waitFor(() => expect(onedit.mock.calls).toEqual([['q-2', 'second', true]]));
      const editor = row.getByRole('textbox') as HTMLTextAreaElement;
      await waitFor(() => expect(document.activeElement).toBe(editor));
      expect(editor.value).toBe('second');
      await fireEvent.input(editor, { target: { value: 'discard draft' } });
      await fireEvent.keyDown(editor, { key: 'Escape' });
      await waitFor(() => expect(row.queryByRole('textbox')).toBeNull());
      expect(onedit.mock.calls).toEqual([
        ['q-2', 'second', true],
        ['q-2', 'second', false],
      ]);

      await fireEvent.click(row.getByRole('button', { name: 'Edit', exact: true }));
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(3));
      expect((row.getByRole('textbox') as HTMLTextAreaElement).value).toBe('second');
      await fireEvent.input(row.getByRole('textbox'), { target: { value: 'saved draft' } });
      await fireEvent.keyDown(row.getByRole('textbox'), { key: 'Enter' });
      await waitFor(() => expect(row.queryByRole('textbox')).toBeNull());
      expect(onedit).toHaveBeenLastCalledWith('q-2', 'saved draft', false);
      expect(onsendnow).not.toHaveBeenCalled();
      expect(onremove).not.toHaveBeenCalled();
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(2);
    });

    it('does not expose editing or accept its keyboard shortcut while disabled', async () => {
      const onedit = vi.fn();
      render(QueuedMessageList, { props: { messages: [queued({})], onedit, disabled: true } });
      expect(screen.queryByRole('button', { name: 'Edit', exact: true })).toBeNull();
      await fireEvent.keyDown(screen.getByTestId('queued-message-content'), { key: 'F2' });
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(onedit).not.toHaveBeenCalled();
    });
  });

  describe('send immediately', () => {
    it('targets only the chosen ID and prevents duplicate/edit/remove actions until acknowledgement', async () => {
      const pending = deferred<'delivered'>();
      const onsendnow = vi.fn(() => pending.promise);
      const onremove = vi.fn();
      const onedit = vi.fn();
      const message = queued({
        imageBlocks: [{ type: 'image', data: 'synthetic', mimeType: 'image/png' }],
        fileBlocks: [
          {
            type: 'file',
            attachmentId: 'fixture-file',
            fileName: 'fixture.txt',
            mimeType: 'text/plain',
          },
        ],
      });
      const view = render(QueuedMessageList, {
        props: {
          messages: [message, queued({ id: 'q-2', content: 'second', position: 1 })],
          onsendnow,
          onremove,
          onedit,
        },
      });
      const row = within(screen.getAllByTestId('queued-message-row')[0]);
      await fireEvent.click(row.getByRole('button', { name: 'Send immediately' }));
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), {
        key: 'Enter',
        ctrlKey: true,
      });
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), { key: 'Delete' });
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), { key: 'F2' });
      const edit = row.getByRole('button', { name: 'Edit', exact: true });
      expect(edit.hasAttribute('disabled')).toBe(true);
      await fireEvent.click(edit);
      expect(onsendnow.mock.calls).toEqual([['q-1']]);
      expect(onremove).not.toHaveBeenCalled();
      expect(onedit).not.toHaveBeenCalled();
      expect(screen.getAllByTestId('queued-message-row')[0].getAttribute('aria-busy')).toBe('true');
      expect(row.getByTestId('queued-image-thumbnail')).toBeTruthy();
      expect(row.getByTestId('queued-file-chip')).toBeTruthy();

      await view.rerender({ messages: [queued({ id: 'q-2', content: 'second' }), message] });
      pending.resolve('delivered');
      await waitFor(() =>
        expect(row.getByRole('button', { name: 'Send immediately' }).hasAttribute('disabled')).toBe(
          true,
        ),
      );
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), {
        key: 'Enter',
        metaKey: true,
      });
      expect(onsendnow).toHaveBeenCalledTimes(1);
      await view.rerender({ messages: [queued({ id: 'q-2', content: 'second' })] });
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
      expect(screen.getByText('second')).toBeTruthy();
    });

    it.each(['queued', 'quarantined'] as const)(
      'keeps %s outcomes actionable without removing attachments',
      async (outcome) => {
        const onsendnow = vi.fn().mockResolvedValue(outcome);
        render(QueuedMessageList, { props: { messages: [queued({})], onsendnow } });
        const send = screen.getByRole('button', { name: 'Send immediately' });
        await fireEvent.click(send);
        await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
        expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
        expect(send.hasAttribute('disabled')).toBe(false);
        await fireEvent.click(send);
        expect(onsendnow).toHaveBeenCalledTimes(2);
      },
    );

    it('shows failure and retries the same ID without invoking remove', async () => {
      const onsendnow = vi
        .fn()
        .mockRejectedValueOnce(new Error('fixture failure'))
        .mockResolvedValue('delivered');
      const onremove = vi.fn();
      render(QueuedMessageList, { props: { messages: [queued({})], onsendnow, onremove } });
      await fireEvent.click(screen.getByRole('button', { name: 'Send immediately' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('fixture failure'),
      );
      await fireEvent.click(screen.getByRole('button', { name: 'Send immediately' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(onsendnow.mock.calls).toEqual([['q-1'], ['q-1']]);
      expect(onremove).not.toHaveBeenCalled();
    });

    it('does not send disabled or edit-held messages through the shortcut', async () => {
      const onsendnow = vi.fn();
      const view = render(QueuedMessageList, {
        props: { messages: [queued({})], onsendnow, disabled: true },
      });
      await fireEvent.keyDown(screen.getByTestId('queued-message-content'), {
        key: 'Enter',
        ctrlKey: true,
      });
      await view.rerender({ messages: [queued({ editing: true })], disabled: false });
      await fireEvent.keyDown(screen.getByTestId('queued-message-content'), {
        key: 'Enter',
        metaKey: true,
      });
      expect(onsendnow).not.toHaveBeenCalled();
    });

    it('ignores an acknowledgement after the selected message disappeared', async () => {
      const pending = deferred<'queued'>();
      const onsendnow = vi.fn(() => pending.promise);
      const view = render(QueuedMessageList, { props: { messages: [queued({})], onsendnow } });
      await fireEvent.click(screen.getByRole('button', { name: 'Send immediately' }));
      await view.rerender({ messages: [queued({ id: 'q-2', content: 'next' })] });
      pending.resolve('queued');
      await tick();
      expect(screen.queryByRole('status')).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Send immediately' }).hasAttribute('disabled'),
      ).toBe(false);
      expect(onsendnow.mock.calls).toEqual([['q-1']]);
    });
  });

  describe('queue disclosure', () => {
    it('starts expanded and exposes the controlled queue content', () => {
      render(QueuedMessageList, { props: { messages: [queued({})] } });

      const disclosure = screen.getByTestId('queued-messages-disclosure');
      const content = screen.getByTestId('queued-messages-content');
      const container = screen.getByTestId('queued-messages-container');
      const label = screen.getByTestId('queued-messages-label');
      const chevron = screen.getByTestId('queued-messages-chevron').querySelector('svg')!;
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(disclosure.getAttribute('aria-controls')).toBe(content.id);
      expect(chevron.classList.contains('rotate-90')).toBe(false);
      expect(label.textContent?.trim()).toBe('1 queued message');
      expect(container.className).not.toContain('before:');
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
    });

    it('keeps focus and updates the live count while collapsed', async () => {
      const view = render(QueuedMessageList, { props: { messages: [queued({})] } });
      const disclosure = screen.getByTestId('queued-messages-disclosure');
      disclosure.focus();

      await fireEvent.click(disclosure);
      await tick();
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(
        screen
          .getByTestId('queued-messages-chevron')
          .querySelector('svg')
          ?.classList.contains('rotate-90'),
      ).toBe(true);
      expect(screen.queryByTestId('queued-messages-content')).toBeNull();
      expect(screen.queryByTestId('queued-message-row')).toBeNull();
      expect(document.activeElement).toBe(disclosure);

      await view.rerender({
        messages: [queued({}), queued({ id: 'q-2', content: 'second', position: 1 })],
      });
      expect(screen.getByTestId('queued-messages-label').textContent?.trim()).toBe(
        '2 queued messages',
      );
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('queued-message-row')).toBeNull();

      await fireEvent.click(disclosure);
      await tick();
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(2);
      expect(document.activeElement).toBe(disclosure);
    });
  });

  it('editLastMessage() starts editing the last queued message', async () => {
    const { component, container } = render(QueuedMessageList, {
      props: {
        messages: [
          queued({ id: 'q-1', content: 'first message', position: 0 }),
          queued({ id: 'q-2', content: 'second message', position: 1 }),
        ],
      },
    });

    expect(component.editLastMessage()).toBe(true);
    await tick();

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.value).toBe('second message');
  });

  it('editLastMessage() returns false when the queue is empty', async () => {
    const { component, container } = render(QueuedMessageList, {
      props: { messages: [] },
    });

    expect(component.editLastMessage()).toBe(false);
    await tick();

    expect(container.querySelector('textarea')).toBeNull();
  });

  describe('editing lifecycle', () => {
    async function beginEdit(
      props: Parameters<typeof render<typeof QueuedMessageList>>[1]['props'],
    ) {
      const view = render(QueuedMessageList, { props });
      const row = view.container.querySelector<HTMLElement>('[data-testid="queued-message-row"]')!;
      await fireEvent.dblClick(
        view.container.querySelector<HTMLElement>('[data-testid="queued-message-content"]')!,
      );
      const textarea = await waitFor(() => view.container.querySelector('textarea'));
      return { ...view, row, textarea: textarea as HTMLTextAreaElement };
    }

    it('saves with Enter once and keeps Shift+Enter for a newline', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { textarea } = await beginEdit({ messages: [queued({})], onedit });
      await fireEvent.input(textarea, { target: { value: 'hello\nagain' } });
      await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect(onedit).toHaveBeenCalledTimes(1);
      await fireEvent.keyDown(textarea, { key: 'Enter' });
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(2));
      expect(onedit).toHaveBeenLastCalledWith('q-1', 'hello\nagain', false);
      expect(screen.queryByTestId('queued-message-edit-mode')).toBeNull();
    });

    it('cancels with Escape and releases the daemon hold with original content', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { textarea } = await beginEdit({
        messages: [queued({ content: 'original' })],
        onedit,
      });
      await fireEvent.input(textarea, { target: { value: 'changed' } });
      await fireEvent.keyDown(textarea, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('queued-message-edit-mode')).toBeNull());
      expect(onedit).toHaveBeenLastCalledWith('q-1', 'original', false);
    });

    it('saves on blur without a second save from the save action', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { textarea, container } = await beginEdit({ messages: [queued({})], onedit });
      await fireEvent.input(textarea, { target: { value: 'blurred' } });
      await fireEvent.blur(textarea);
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(2));
      const save = Array.from(container.querySelectorAll('button')).find(
        (button) => button.getAttribute('tooltip') === 'Save',
      );
      if (save) await fireEvent.click(save);
      expect(onedit).toHaveBeenCalledTimes(2);
    });

    it('stays in edit mode when hold, save, or cancel release fails', async () => {
      const holdFailure = vi.fn().mockResolvedValue({ success: false, error: 'gone' });
      const first = await beginEdit({ messages: [queued({})], onedit: holdFailure });
      await waitFor(() => expect(first.container.querySelector('textarea')).toBeNull());
      first.unmount();

      const saveFailure = vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValue({ success: false, error: 'offline' });
      const second = await beginEdit({
        messages: [queued({ id: 'q-2' })],
        onedit: saveFailure,
      });
      await fireEvent.keyDown(second.textarea, { key: 'Enter' });
      await waitFor(() => expect(second.container.querySelector('textarea')).toBe(second.textarea));
      const cancel = Array.from(second.container.querySelectorAll('button')).find(
        (button) => button.getAttribute('tooltip') === 'Cancel',
      )!;
      await fireEvent.pointerDown(cancel);
      await fireEvent.click(cancel);
      await waitFor(() => expect(saveFailure).toHaveBeenCalledTimes(3));
      expect(second.container.querySelector('textarea')).toBe(second.textarea);
    });

    it('keeps a new edit focused when a removed row pending cancel settles', async () => {
      const cancel = deferred<{ success: boolean }>();
      const onedit = vi.fn((id: string, _content: string, editing: boolean) => {
        if (id === 'q-1' && !editing) return cancel.promise;
        return Promise.resolve({ success: true });
      });
      const messages = [
        queued({ id: 'q-1', content: 'first', position: 0 }),
        queued({ id: 'q-2', content: 'second', position: 1 }),
      ];
      const view = render(QueuedMessageList, { props: { messages, onedit } });

      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-1"] button')!);
      const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
      await fireEvent.keyDown(firstTextarea!, { key: 'Escape' });
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', false));

      await view.rerender({ messages: [messages[1]] });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-2"] button')!);
      const secondTextarea = await waitFor(() => view.container.querySelector('textarea'));
      expect((secondTextarea as HTMLTextAreaElement).value).toBe('second');
      await waitFor(() => expect(document.activeElement).toBe(secondTextarea));

      cancel.resolve({ success: true });
      await tick();
      await waitFor(() => expect(view.container.querySelector('textarea')).toBe(secondTextarea));
      expect(document.activeElement).toBe(secondTextarea);
    });

    it.each(['start', 'save'] as const)(
      'ignores a removed row pending %s result after another row starts editing',
      async (pendingAction) => {
        const pending = deferred<{ success: boolean; error?: string }>();
        const onedit = vi.fn((id: string, _content: string, editing: boolean) => {
          const isPendingStart = pendingAction === 'start' && id === 'q-1' && editing;
          const isPendingSave = pendingAction === 'save' && id === 'q-1' && !editing;
          if (isPendingStart || isPendingSave) return pending.promise;
          return Promise.resolve({ success: true });
        });
        const messages = [
          queued({ id: 'q-1', content: 'first', position: 0 }),
          queued({ id: 'q-2', content: 'second', position: 1 }),
        ];
        const view = render(QueuedMessageList, { props: { messages, onedit } });

        await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-1"] button')!);
        const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
        if (pendingAction === 'save') {
          await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
          await fireEvent.input(firstTextarea!, { target: { value: 'changed' } });
          await fireEvent.keyDown(firstTextarea!, { key: 'Enter' });
          await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'changed', false));
        } else {
          await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
        }

        await view.rerender({ messages: [messages[1]] });
        await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
        await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-2"] button')!);
        const secondTextarea = await waitFor(() => view.container.querySelector('textarea'));
        expect((secondTextarea as HTMLTextAreaElement).value).toBe('second');
        await waitFor(() => expect(document.activeElement).toBe(secondTextarea));

        pending.resolve(
          pendingAction === 'start' ? { success: false, error: 'removed' } : { success: true },
        );
        await tick();
        await waitFor(() => expect(view.container.querySelector('textarea')).toBe(secondTextarea));
        expect(document.activeElement).toBe(secondTextarea);
      },
    );

    it('auto-resizes multiline content', async () => {
      const { textarea } = await beginEdit({ messages: [queued({})] });
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 84 });
      await fireEvent.input(textarea, { target: { value: 'one\ntwo\nthree' } });
      expect(textarea.style.height).toBe('84px');
    });

    it('keeps row, textarea, focus, and selection through refresh and reorder', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const messages = [
        queued({ id: 'q-1', content: 'first', position: 0 }),
        queued({ id: 'q-2', content: 'second', position: 1 }),
      ];
      const view = render(QueuedMessageList, { props: { messages, onedit } });
      const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[data-message-id]'));
      await fireEvent.dblClick(rows[0].querySelector('[data-testid="queued-message-content"]')!);
      const textarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(document.activeElement).toBe(textarea));
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(1));
      textarea!.setSelectionRange(2, 4);

      const rowList = rows[0].parentElement!;
      let didBlurDuringMove = false;
      const blurDuringMove = new MutationObserver(() => {
        didBlurDuringMove = true;
        textarea!.blur();
      });
      blurDuringMove.observe(rowList, { childList: true });
      await view.rerender({ messages: [messages[1], { ...messages[0], editing: true }] });
      blurDuringMove.disconnect();
      await tick();
      expect(didBlurDuringMove).toBe(true);
      expect(view.container.querySelector('[data-message-id="q-1"]')).toBe(rows[0]);
      expect(view.container.querySelector('textarea')).toBe(textarea);
      await waitFor(() => expect(document.activeElement).toBe(textarea));
      expect([textarea!.selectionStart, textarea!.selectionEnd]).toEqual([2, 4]);
      expect(onedit).toHaveBeenCalledTimes(1);

      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(2));
      expect(onedit).toHaveBeenLastCalledWith('q-1', 'first', false);
      outside.remove();
    });

    it('handles rapid reorder and removal before a stale save settles', async () => {
      const save = deferred<{ success: boolean }>();
      const onedit = vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockImplementationOnce(() => save.promise)
        .mockResolvedValue({ success: true });
      const messages = [
        queued({ id: 'q-1', content: 'first', position: 0 }),
        queued({ id: 'q-2', content: 'second', position: 1 }),
      ];
      const view = render(QueuedMessageList, { props: { messages, onedit } });
      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-1"] button')!);
      const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await fireEvent.input(firstTextarea!, { target: { value: 'changed' } });
      await fireEvent.keyDown(firstTextarea!, { key: 'Enter' });
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'changed', false));

      await view.rerender({ messages: [messages[1], messages[0]] });
      await view.rerender({ messages: [messages[1]] });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-2"] button')!);
      const secondTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(document.activeElement).toBe(secondTextarea));

      save.resolve({ success: true });
      await tick();
      await waitFor(() => expect(view.container.querySelector('textarea')).toBe(secondTextarea));
      expect((secondTextarea as HTMLTextAreaElement).value).toBe('second');
    });

    it('removes an editing row without residual shell state', async () => {
      const view = render(QueuedMessageList, { props: { messages: [queued({})] } });
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeTruthy());
      await view.rerender({ messages: [] });
      await waitFor(() => expect(view.container.querySelector('[data-message-id]')).toBeNull());
      expect(view.container.querySelector('[style*="height"]')).toBeNull();
    });

    it('rapidly reverses on Escape without remounting the row or overlapping modes', async () => {
      const view = render(QueuedMessageList, { props: { messages: [queued({})] } });
      const row = screen.getByTestId('queued-message-row');
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      const textarea = await waitFor(() => view.container.querySelector('textarea'));
      await fireEvent.keyDown(textarea!, { key: 'Escape' });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      expect(screen.getByTestId('queued-message-row')).toBe(row);
      expect(row.querySelectorAll('[data-mode="display"]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-testid="queued-message-edit-mode"]')).toHaveLength(0);
    });

    it('completes mode changes immediately for reduced motion', async () => {
      const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      });
      const { row } = await beginEdit({ messages: [queued({})] });
      expect(row.style.height).toBe('');
      expect(row.style.overflow).toBe('');
      matchMedia.mockRestore();
    });
  });

  it('lets the canonical follow authority pin bottom and preserve an unlocked viewport', async () => {
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const view = render(QueuedMessageEditMotionHost);
    const transcript = screen.getByTestId('queued-edit-transcript');
    let expandedHeight = 900;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, get: () => expandedHeight },
    });
    transcript.scrollTop = 700;
    expandedHeight = 980;
    await fireEvent.dblClick(
      view.container.querySelector('[data-testid="queued-message-content"]')!,
    );
    await waitFor(() => expect(transcript.scrollTop).toBe(780));

    await fireEvent.wheel(transcript, { deltaY: -20 });
    transcript.scrollTop = 240;
    expandedHeight = 1060;
    await fireEvent.click(screen.getByTestId('queued-edit-refresh'));
    await tick();
    expect(transcript.scrollTop).toBe(240);
    vi.unstubAllGlobals();
  });

  it('keeps the requeued-after-failure indicator on queued rows', () => {
    const { container } = render(QueuedMessageList, {
      props: { messages: [queued({ content: 'try again', requeuedAfterFailure: true })] },
    });

    expect(screen.getByText(/try again/)).toBeTruthy();
    expect(container.querySelector('[title="Failed — will retry"]')).toBeTruthy();
  });

  describe('human author identity (multiplayer)', () => {
    // Queue entries carry the daemon's `messageMetadata.fromPrincipalId`
    // stamp (PROTOCOL §5.5, intent-hq/intentd#1869); the author projection is
    // resolved by the panel from the transcript and handed in as `authors`
    // only once the workspace has more than one member.
    const guest = {
      principalId: 'principal-guest',
      login: 'guest',
      displayName: 'Guest User',
      avatarUrl: 'https://avatars.example/guest.png',
    };
    const owner = {
      principalId: 'principal-owner',
      login: 'owner',
      displayName: null,
      avatarUrl: null,
    };
    const authors = new Map([
      [guest.principalId, guest],
      [owner.principalId, owner],
    ]);

    it('renders each stamped entry with its own author once authors are provided', () => {
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              id: 'q-guest',
              content: 'queued by guest',
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
            queued({
              id: 'q-owner',
              content: 'queued by owner',
              position: 1,
              messageMetadata: { fromPrincipalId: owner.principalId },
            }),
          ],
          authors,
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers.map((h) => h.getAttribute('data-principal-id'))).toEqual([
        guest.principalId,
        owner.principalId,
      ]);
      expect(headers[0].getAttribute('aria-label')).toContain('Guest User');
      expect(headers[1].getAttribute('aria-label')).toContain('owner');
      expect(screen.getAllByTestId('queued-message-author-name').map((n) => n.textContent)).toEqual(
        ['Guest User', 'owner'],
      );
      const avatar = screen.getByTestId('queued-message-author-avatar') as HTMLImageElement;
      expect(avatar.getAttribute('src')).toBe(guest.avatarUrl);
      expect(screen.getByTestId('queued-message-author-avatar-fallback').textContent).toBe('O');
      expect(screen.getByText('queued by guest')).toBeTruthy();
      expect(screen.getByText('queued by owner')).toBeTruthy();
    });

    it('omits the author when no authors are provided (single-member workspace)', () => {
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({ content: 'solo', messageMetadata: { fromPrincipalId: guest.principalId } }),
          ],
        },
      });

      expect(screen.queryByTestId('queued-message-author')).toBeNull();
      expect(screen.getByText('solo')).toBeTruthy();
    });

    it("omits the author on the viewer's own entries, keeping it on other members'", () => {
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              id: 'q-guest',
              content: 'queued by guest',
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
            queued({
              id: 'q-owner',
              content: 'queued by owner',
              position: 1,
              messageMetadata: { fromPrincipalId: owner.principalId },
            }),
          ],
          authors,
          ownPrincipalId: owner.principalId,
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers.map((h) => h.getAttribute('data-principal-id'))).toEqual([guest.principalId]);
      expect(screen.getByText('queued by guest')).toBeTruthy();
      expect(screen.getByText('queued by owner')).toBeTruthy();
    });

    it('omits the author on unstamped or unresolvable entries', () => {
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({ id: 'q-legacy', content: 'older daemon entry' }),
            queued({
              id: 'q-new',
              content: 'member without a transcript row yet',
              position: 1,
              messageMetadata: { fromPrincipalId: 'principal-unseen' },
            }),
          ],
          authors,
        },
      });

      expect(screen.queryByTestId('queued-message-author')).toBeNull();
      expect(screen.getByText('older daemon entry')).toBeTruthy();
      expect(screen.getByText('member without a transcript row yet')).toBeTruthy();
    });

    it("renders the entry's own author projection with no transcript history", () => {
      // A member whose first message is queued before any of their transcript
      // rows exist: the daemon serves the projection on the queue entry
      // (intent-hq/intentd#1869), so the empty transcript map is not needed.
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              id: 'q-first',
              content: 'first ever message, still queued',
              messageMetadata: { fromPrincipalId: guest.principalId },
              author: guest,
            }),
            // Stale transcript copy vs. fresher projection: the projection wins.
            queued({
              id: 'q-renamed',
              content: 'renamed since the transcript row',
              position: 1,
              messageMetadata: { fromPrincipalId: owner.principalId },
              author: { ...owner, displayName: 'Owner Renamed' },
            }),
          ],
          authors: new Map(),
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers.map((h) => h.getAttribute('data-principal-id'))).toEqual([
        guest.principalId,
        owner.principalId,
      ]);
      expect(screen.getAllByTestId('queued-message-author-name').map((n) => n.textContent)).toEqual(
        ['Guest User', 'Owner Renamed'],
      );
      expect(screen.getByText('first ever message, still queued')).toBeTruthy();
    });

    it('omits the author on an explicit null projection even when the transcript resolves it', () => {
      // `author: null` is the daemon's authoritative "principal row is gone";
      // the stamp-based transcript fallback applies only when the field is absent.
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              id: 'q-gone',
              content: 'author row deleted',
              messageMetadata: { fromPrincipalId: guest.principalId },
              author: null,
            }),
            queued({
              id: 'q-legacy',
              content: 'older daemon, stamp only',
              position: 1,
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
          ],
          authors,
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers).toHaveLength(1);
      expect(headers[0].closest('[data-message-id]')?.getAttribute('data-message-id')).toBe(
        'q-legacy',
      );
      expect(screen.getByText('author row deleted')).toBeTruthy();
      expect(screen.getByText('older daemon, stamp only')).toBeTruthy();
    });

    it('omits the author on daemon-origin entries even when a projection is attached', () => {
      // Agent-to-agent sends and system wakes fall back to the workspace owner
      // on the daemon side; they are not human-authored and get no attribution.
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              id: 'q-agent',
              content: 'agent-to-agent',
              messageMetadata: {
                type: 'agent_message',
                fromAgentId: 'agent-2',
                fromPrincipalId: owner.principalId,
              },
              author: owner,
            }),
            queued({
              id: 'q-system',
              content: 'system wake',
              position: 1,
              messageMetadata: { source: 'system', fromPrincipalId: owner.principalId },
              author: owner,
            }),
          ],
          authors,
        },
      });

      expect(screen.queryByTestId('queued-message-author')).toBeNull();
      expect(screen.getByText('agent-to-agent')).toBeTruthy();
      expect(screen.getByText('system wake')).toBeTruthy();
    });

    it('does not render the author while the entry is being edited', async () => {
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              content: 'edit me',
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
          ],
          authors,
        },
      });

      expect(screen.getByTestId('queued-message-author')).toBeTruthy();
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await tick();
      expect(screen.getByTestId('queued-message-edit-mode')).toBeTruthy();
      expect(screen.queryByTestId('queued-message-author')).toBeNull();
    });
  });

  describe('image thumbnails', () => {
    const IMAGE_BLOCKS: NonNullable<QueuedMessage['imageBlocks']> = [
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ];

    function thumbnails(container: HTMLElement): HTMLButtonElement[] {
      return Array.from(
        container.querySelectorAll<HTMLButtonElement>('[data-testid="queued-image-thumbnail"]'),
      );
    }

    it('renders one thumbnail per image block with the data-URL src', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({ content: 'look at these', imageBlocks: IMAGE_BLOCKS })] },
      });

      const buttons = thumbnails(container);
      expect(buttons).toHaveLength(2);
      const imgs = buttons.map((b) => b.querySelector('img'));
      expect(imgs[0]?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
      expect(imgs[1]?.getAttribute('src')).toBe('data:image/jpeg;base64,BBBB');
      expect(buttons[0].getAttribute('aria-label')).toBe('View attached image 1 of 2 full size');
      expect(screen.getByText('look at these')).toBeTruthy();
    });

    it('renders no thumbnails when imageBlocks is absent or empty', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [
            queued({ id: 'q-1', content: 'no images', position: 0 }),
            queued({ id: 'q-2', content: 'empty images', position: 1, imageBlocks: [] }),
          ],
        },
      });

      expect(thumbnails(container)).toHaveLength(0);
      expect(container.querySelector('[data-testid="queued-image-thumbnail"] img')).toBeNull();
    });

    it('clicking a thumbnail opens the lightbox and does not start edit mode', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({ content: 'with image', imageBlocks: IMAGE_BLOCKS })], onedit },
      });

      await fireEvent.click(thumbnails(container)[1]);
      await tick();

      // Lightbox opened (portaled to body) with the clicked image
      const dialog = document.body.querySelector('[role="dialog"][aria-label="Image preview"]');
      expect(dialog).toBeTruthy();
      const lightboxImg = dialog?.querySelector('img');
      expect(lightboxImg?.getAttribute('src')).toBe('data:image/jpeg;base64,BBBB');
      expect(lightboxImg?.getAttribute('alt')).toBe('Attached image 2');

      // Edit mode not triggered
      expect(container.querySelector('textarea')).toBeNull();
      expect(onedit).not.toHaveBeenCalled();
    });

    it('offers no remove or edit affordance for images', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({ content: 'with image', imageBlocks: IMAGE_BLOCKS })] },
      });

      // Only the row-level remove button exists; images stay view-only.
      const tooltips = buttonTooltips(container);
      expect(tooltips.filter((t) => t === 'Remove')).toHaveLength(1);
      // Every thumbnail button is a view-only affordance
      for (const button of thumbnails(container)) {
        expect(button.getAttribute('aria-label')).toMatch(
          /^View attached image \d+ of \d+ full size$/,
        );
      }
    });
  });

  describe('attachment-reference thumbnails', () => {
    const originalInvoke = window.electronAPI!.invoke;
    const routeContext = new Map([
      [WORKSPACE_ROUTE_CONTEXT, { workspaceId: WorkspaceId('ws-queued') }],
    ]);

    // PROTOCOL §5.9 `file.getAttachmentInfo` result for the referenced row.
    const attachmentInfo = {
      attachmentId: 'att-q-1',
      fileName: 'shot.png',
      mimeType: 'image/png',
      size: 1234,
      uploadedAt: '2026-01-01T12:00:00Z',
      path: '.intent/attachments/att-q-1/shot.png',
      exists: true,
    };

    beforeEach(() => {
      resetMockIpcRouter();
      window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
        mockInvoke(channel, payload),
      );
    });
    afterEach(() => {
      window.electronAPI!.invoke = originalInvoke;
      resetMockIpcRouter();
      vi.restoreAllMocks();
    });

    it('falls back to the placeholder tile and evicts the cached URL when the thumbnail fails to load', async () => {
      const getAttachmentInfo = vi.fn(() => ({ ok: true, result: attachmentInfo }));
      registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
        expect(payload).toEqual({
          method: 'file.getAttachmentInfo',
          params: { attachmentId: 'att-q-1' },
        });
        return getAttachmentInfo();
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              content: 'see attached',
              imageBlocks: [{ type: 'image', attachmentId: 'att-q-1', mimeType: 'image/png' }],
            }),
          ],
        },
        context: routeContext,
      });

      // The reference resolves to a workspace-file:// URL and renders as <img>.
      const img = await screen.findByRole('img', { name: /attached image/i });
      const url = 'workspace-file://ws-queued/.intent/attachments/att-q-1/shot.png';
      expect(img.getAttribute('src')).toBe(url);
      expect(getAttachmentInfo).toHaveBeenCalledTimes(1);

      // The protocol handler refused the bytes (e.g. 404): the <img> errors.
      await fireEvent.error(img);

      await waitFor(() => expect(screen.getByTestId('queued-image-placeholder')).toBeTruthy());
      expect(screen.queryByRole('img', { name: /attached image/i })).toBeNull();
      const thumbnailWarnings = warn.mock.calls.filter(([message]) =>
        String(message).includes('Attachment thumbnail failed to load'),
      );
      expect(thumbnailWarnings).toHaveLength(1);
      expect(thumbnailWarnings[0][1]).toEqual({ attachmentId: 'att-q-1', url });
      // Evicted: the next resolve re-issues file.getAttachmentInfo instead of
      // replaying the URL that just failed — and this instance does not loop.
      await expect(resolveAttachmentImageUrl('ws-queued', 'att-q-1')).resolves.toBe(url);
      expect(getAttachmentInfo).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('queued-image-placeholder')).toBeTruthy();
      expect(screen.queryByRole('img', { name: /attached image/i })).toBeNull();
    });
  });
});
