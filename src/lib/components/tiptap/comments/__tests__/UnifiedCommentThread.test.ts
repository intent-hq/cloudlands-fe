// @vitest-environment jsdom

import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
  });
});

vi.mock('$store/renderer/slices/comments/comments-selectors', () => ({
  selectCommentById: { select: vi.fn(() => null) },
}));

import {
  render,
  fireEvent,
} from '@testing-library/svelte';
import UnifiedCommentThread from '../UnifiedCommentThread.svelte';
import TooltipWrapper from './TooltipWrapper.svelte';

describe('UnifiedCommentThread', () => {
  const mockComment = {
    id: 'comment-1',
    author: 'Test User',
    content: 'This is a test comment',
    createdAt: new Date().toISOString(),
    status: 'open',
    type: 'comment',
  };

  const mockReplies = [
    {
      id: 'reply-1',
      author: 'Reply User',
      content: 'This is a reply',
      createdAt: new Date().toISOString(),
      status: 'open',
      type: 'comment',
    },
  ];

  afterEach(() => {
    // Clean up DOM after each test
    if (typeof document !== 'undefined') {
      document.body.innerHTML = '';
    }
    vi.clearAllTimers();
  });

  it('renders in collapsed state', () => {
    const { container } = render(TooltipWrapper, {
      props: {
        component: UnifiedCommentThread,
        props: {
          comment: mockComment,
          replies: [],
          isCollapsed: true,
        },
      },
    });

    // Outer container exists
    const outer = container.querySelector('.flex.flex-col.bg-background.rounded');
    expect(outer).toBeTruthy();

    // Should show truncated text
    const textElement = container.querySelector('.line-clamp-2');
    expect(textElement).toBeTruthy();
  });

  it('renders in expanded state', () => {
    const { container } = render(TooltipWrapper, {
      props: {
        component: UnifiedCommentThread,
        props: {
          comment: mockComment,
          replies: [],
          isCollapsed: false,
        },
      },
    });

    // Should show full thread view
    const threadContainer = container.querySelector('.flex.flex-col.bg-background.rounded');
    expect(threadContainer).toBeTruthy();

    // Should have reply input area
    const replyArea = container.querySelector('.px-3.py-1\\.5.border-t.border-border');
    expect(replyArea).toBeTruthy();
  });

  it('renders the reply composer avatar as the user, not the hardcoded agent "A"', () => {
    const { container } = render(TooltipWrapper, {
      props: {
        component: UnifiedCommentThread,
        props: {
          comment: mockComment,
          replies: [],
          isCollapsed: false,
        },
      },
    });

    const replyArea = container.querySelector('.px-3.py-1\\.5.border-t.border-border');
    expect(replyArea).toBeTruthy();

    const composerAvatar = replyArea?.querySelector('[aria-hidden="true"]');
    expect(composerAvatar).toBeTruthy();
    expect(composerAvatar?.textContent?.trim()).toBe('U');
  });

  it('shows replies count in collapsed state', () => {
    const { getByText } = render(UnifiedCommentThread, {
      props: {
        comment: mockComment,
        replies: mockReplies,
        isCollapsed: true,
      },
    });

    // Should show reply count
    expect(getByText('Show 1 reply')).toBeTruthy();
  });

  it('shows replies in expanded state', () => {
    const { getByText } = render(TooltipWrapper, {
      props: {
        component: UnifiedCommentThread,
        props: {
          comment: mockComment,
          replies: mockReplies,
          isCollapsed: false,
        },
      },
    });

    // Should show reply content
    expect(getByText('Reply User')).toBeTruthy();
  });

  it('calls onShow when clicking show replies in collapsed state', async () => {
    const onShow = vi.fn();
    const { getByText } = render(TooltipWrapper, {
      props: {
        component: UnifiedCommentThread,
        props: {
          comment: mockComment,
          replies: mockReplies,
          isCollapsed: true,
          onShow,
        },
      },
    });

    const showButton = getByText('Show 1 reply');
    await fireEvent.click(showButton);

    expect(onShow).toHaveBeenCalled();
  });

  it('transitions smoothly between collapsed and expanded states', async () => {
    const { container, rerender } = render(TooltipWrapper, {
      props: {
        component: UnifiedCommentThread,
        props: {
          comment: mockComment,
          replies: mockReplies,
          isCollapsed: true,
        },
      },
    });

    // Initially collapsed
    let lineClamp = container.querySelector('.line-clamp-2');
    expect(lineClamp).toBeTruthy();

    // Change to expanded
    await rerender({
      component: UnifiedCommentThread,
      props: {
        comment: mockComment,
        replies: mockReplies,
        isCollapsed: false,
      },
    });

    // Should now be expanded
    const threadContainer = container.querySelector('.flex.flex-col.bg-background.rounded');
    expect(threadContainer).toBeTruthy();

    // Change back to collapsed
    await rerender({
      component: UnifiedCommentThread,
      props: {
        comment: mockComment,
        replies: mockReplies,
        isCollapsed: true,
      },
    });

    // Should be collapsed again
    lineClamp = container.querySelector('.line-clamp-2');
    expect(lineClamp).toBeTruthy();
  });
});
