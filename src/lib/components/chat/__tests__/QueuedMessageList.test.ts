/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
  it('renders a regular queued message as raw text with Edit, Remove and Send now', () => {
    const { container } = render(QueuedMessageList, {
      props: { messages: [queued({ content: 'run the tests' })] },
    });

    expect(screen.getByText('run the tests')).toBeTruthy();
    const tooltips = buttonTooltips(container);
    expect(tooltips).toContain('Edit');
    expect(tooltips).toContain('Remove');
    expect(tooltips.some((t) => t.startsWith('Send now'))).toBe(true);
  });

  it('reserves the three-action lane before hover and keyboard focus', () => {
    render(QueuedMessageList, {
      props: { messages: [queued({ content: 'A long queued message that stays on one line' })] },
    });

    const content = screen.getByTestId('queued-message-content');
    const text = screen.getByTestId('queued-message-text');
    const actions = screen.getByTestId('queued-message-actions');
    expect(actions.children).toHaveLength(3);
    expect(actions.className).toContain('absolute');
    expect(actions.className).toContain('pointer-events-none');
    expect(actions.className).toContain('group-hover:pointer-events-auto');
    expect(actions.className).toContain('group-focus-within:pointer-events-auto');
    expect(content.className).toContain('pr-24');
    expect(content.className).not.toContain('group-hover:pr-24');
    expect(content.className).not.toContain('group-focus-within:pr-24');
    expect(content.className).not.toContain('transition-[padding-right]');
    expect(text.className).toContain('truncate');
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
      expect(container.className).toContain('pb-2');
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
      await fireEvent.click(
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

      await fireEvent.click(view.container.querySelector('[data-message-id="q-1"] button')!);
      const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
      await fireEvent.keyDown(firstTextarea!, { key: 'Escape' });
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', false));

      await view.rerender({ messages: [messages[1]] });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      await fireEvent.click(view.container.querySelector('[data-message-id="q-2"] button')!);
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

        await fireEvent.click(view.container.querySelector('[data-message-id="q-1"] button')!);
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
        await fireEvent.click(view.container.querySelector('[data-message-id="q-2"] button')!);
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
      await fireEvent.click(rows[0].querySelector('[data-testid="queued-message-content"]')!);
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
      await fireEvent.click(view.container.querySelector('[data-message-id="q-1"] button')!);
      const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await fireEvent.input(firstTextarea!, { target: { value: 'changed' } });
      await fireEvent.keyDown(firstTextarea!, { key: 'Enter' });
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'changed', false));

      await view.rerender({ messages: [messages[1], messages[0]] });
      await view.rerender({ messages: [messages[1]] });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      await fireEvent.click(view.container.querySelector('[data-message-id="q-2"] button')!);
      const secondTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(document.activeElement).toBe(secondTextarea));

      save.resolve({ success: true });
      await tick();
      await waitFor(() => expect(view.container.querySelector('textarea')).toBe(secondTextarea));
      expect((secondTextarea as HTMLTextAreaElement).value).toBe('second');
    });

    it('removes an editing row without residual shell state', async () => {
      const view = render(QueuedMessageList, { props: { messages: [queued({})] } });
      await fireEvent.click(screen.getByTestId('queued-message-content'));
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeTruthy());
      await view.rerender({ messages: [] });
      await waitFor(() => expect(view.container.querySelector('[data-message-id]')).toBeNull());
      expect(view.container.querySelector('[style*="height"]')).toBeNull();
    });

    it('rapidly reverses on Escape without remounting the row or overlapping modes', async () => {
      const view = render(QueuedMessageList, { props: { messages: [queued({})] } });
      const row = screen.getByTestId('queued-message-row');
      await fireEvent.click(screen.getByTestId('queued-message-content'));
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
    await fireEvent.click(view.container.querySelector('[data-testid="queued-message-content"]')!);
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

      // Only the row-level Remove/Edit buttons exist; none per image
      const tooltips = buttonTooltips(container);
      expect(tooltips.filter((t) => t === 'Remove')).toHaveLength(1);
      expect(tooltips.filter((t) => t === 'Edit')).toHaveLength(1);
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
