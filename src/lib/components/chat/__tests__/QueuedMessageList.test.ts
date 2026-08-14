/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '$shared/types';

vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));

import QueuedMessageList from '../QueuedMessageList.svelte';

function queued(overrides: Partial<QueuedMessage>): QueuedMessage {
  return {
    id: 'q-1',
    content: 'hello',
    queuedAt: '2026-01-01T00:00:00.000Z',
    position: 0,
    ...overrides,
  };
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

  it('reserves the three-action lane on hover and keyboard focus without changing row height', () => {
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
    expect(content.className).toContain('pr-0');
    expect(content.className).toContain('group-hover:pr-24');
    expect(content.className).toContain('group-focus-within:pr-24');
    expect(text.className).toContain('truncate');
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

  describe('held-for-questions hint', () => {
    const hint = (container: HTMLElement) =>
      container.querySelector('[data-testid="queued-messages-held-hint"]');

    it('renders the singular hint when one message is held', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({})], heldForQuestions: true },
      });

      expect(hint(container)?.textContent).toContain(
        "1 message waiting — held until you answer or dismiss the agent's questions",
      );
    });

    it('renders the plural hint with the queue count', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [queued({ id: 'q-1' }), queued({ id: 'q-2', content: 'second' })],
          heldForQuestions: true,
        },
      });

      expect(hint(container)?.textContent).toContain(
        "2 messages waiting — held until you answer or dismiss the agent's questions",
      );
    });

    it('omits the hint when the queue is not held', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({})] },
      });

      expect(hint(container)).toBeNull();
    });
  });
});
