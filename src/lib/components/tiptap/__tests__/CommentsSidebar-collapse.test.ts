/**
 * CommentsSidebar.svelte Collapse action on a focused comment.
 *
 * Regression for intent-hq/intent#4778: the Collapse click used to bubble to
 * the card container, whose expand-on-click policy re-focused the comment and
 * left the reply editor mounted. Renders the real thread (no stub) so the
 * editor lifecycle is observed end to end.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import type { Editor } from '@tiptap/core';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { store as appStore } from '$store/renderer/store';
import type { CommentV2 } from '$features/comments/comment-types-v2';
import CommentsSidebar from '../CommentsSidebar.svelte';

const RENDER_WAIT = { timeout: 3000 };

const comment: CommentV2 = {
  id: 'c-1',
  threadId: 't-1',
  type: 'comment',
  content: 'A comment',
  author: 'user',
  authorType: 'user',
  status: 'open',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  anchor: { type: 'point', pointId: 'p-1' },
} as CommentV2;

// Minimal editor: a view with a DOM node but no comment anchors, so the
// sidebar falls back to stacked default positions and renders the comment.
function makeMockEditor(): Editor {
  return {
    state: { doc: { descendants: () => {} } },
    view: {
      dom: document.createElement('div'),
      coordsAtPos: () => ({ top: 100, left: 0, bottom: 110, right: 10 }),
    },
    on: vi.fn(),
    off: vi.fn(),
    isDestroyed: false,
  } as unknown as Editor;
}

describe('CommentsSidebar Collapse action', () => {
  beforeAll(() => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
    appStore.init();
  });

  afterEach(() => {
    cleanup();
  });

  // Focusing a comment schedules a short scroll-adjust timer in the sidebar
  // that reads `document`; let it fire before continuing (or before the test
  // ends and jsdom is torn down).
  async function settlePostFocusTimers() {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  async function renderAndFocusComment() {
    const { container } = render(CommentsSidebar, {
      props: { comments: [comment], editor: makeMockEditor() },
    });

    // Positions are debounced (300ms on initial load) before comments render.
    const thread = await waitFor(() => {
      const el = container.querySelector('[data-comment-id="c-1"]');
      if (!el) throw new Error('comment not rendered yet');
      return el as HTMLElement;
    }, RENDER_WAIT);

    await fireEvent.keyDown(thread, { key: ' ' });
    await waitFor(() => {
      expect(thread.classList.contains('is-focused')).toBe(true);
      expect(thread.querySelectorAll('[contenteditable]').length).toBeGreaterThan(0);
    });

    // Also lets the sidebar's post-focus click guard elapse before interacting.
    await settlePostFocusTimers();
    return thread;
  }

  it('Collapse unfocuses the comment and unmounts its reply editor', async () => {
    const thread = await renderAndFocusComment();

    await fireEvent.click(thread.querySelector('button[aria-label="Collapse"]')!);

    await waitFor(() => {
      expect(thread.classList.contains('is-focused')).toBe(false);
      expect(thread.querySelectorAll('[contenteditable]').length).toBe(0);
    });
  });

  it('a collapsed comment can be expanded again afterwards', async () => {
    const thread = await renderAndFocusComment();

    await fireEvent.click(thread.querySelector('button[aria-label="Collapse"]')!);
    await waitFor(() => {
      expect(thread.classList.contains('is-focused')).toBe(false);
    });

    await fireEvent.click(thread);

    await waitFor(() => {
      expect(thread.classList.contains('is-focused')).toBe(true);
      expect(thread.querySelectorAll('[contenteditable]').length).toBeGreaterThan(0);
    });
    await settlePostFocusTimers();
  });
});
