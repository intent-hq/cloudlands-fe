/**
 * CommentsSidebar.svelte Escape handling via the escape-layer stack.
 *
 * Migrated from a manual `document` keydown listener; the layer is only
 * registered while a comment is focused, and Escape unfocuses it.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterEach,
} from 'vitest';
import {
  render,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';
import type { Editor } from '@tiptap/core';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

// Stub the heavy thread renderer — the escape layer lives on the sidebar.
vi.mock('../comments/ResponsiveCommentThread.svelte', async () => ({
  default: (
    await import(
      '../../workspace/initializer/__tests__/mocks/MockComponent.svelte'
    )
  ).default,
}));

import { store as appStore } from '$store/renderer/store';
import type { CommentV2 } from '$features/comments/comment-types-v2';
import CommentsSidebar from '../CommentsSidebar.svelte';

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

async function renderWithFocusedComment() {
  const { container } = render(CommentsSidebar, {
    props: { comments: [comment], editor: makeMockEditor() },
  });

  // Positions are debounced (300ms on initial load) before comments render.
  const thread = await waitFor(
    () => {
      const el = container.querySelector('[data-comment-id="c-1"]');
      if (!el) throw new Error('comment not rendered yet');
      return el as HTMLElement;
    },
    { timeout: 3000 },
  );

  await fireEvent.click(thread);
  await waitFor(() => {
    expect(thread.classList.contains('is-focused')).toBe(true);
  });
  return thread;
}

describe('CommentsSidebar Escape handling (escape-layer stack)', () => {
  beforeAll(() => {
    // jsdom does not implement ResizeObserver; the sidebar uses it for
    // wrapper-rect tracking, which is irrelevant to Escape handling.
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

  it('Escape unfocuses the focused comment', async () => {
    const thread = await renderWithFocusedComment();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(thread.classList.contains('is-focused')).toBe(false);
    });
  });

  it('Escape is not consumed while no comment is focused (no layer registered)', async () => {
    const { container } = render(CommentsSidebar, {
      props: { comments: [comment], editor: makeMockEditor() },
    });
    await waitFor(
      () => {
        expect(container.querySelector('[data-comment-id="c-1"]')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
