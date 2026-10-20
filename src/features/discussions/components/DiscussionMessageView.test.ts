import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
const navigation = vi.hoisted(() => vi.fn());
vi.mock('../discussion-reference-navigation', () => ({ openDiscussionReference: navigation }));
import DiscussionMessageView from './DiscussionMessageView.svelte';
import type { DiscussionMessage } from '$shared/types/workspace-discussion';
const author = { principalId: 'person', displayName: 'Alex', login: 'alex', avatarUrl: null };
const original = { id: 'original', body: 'First line\nLater detail', author };
const message: DiscussionMessage = {
  id: 'reply',
  workspaceId: 'ws',
  sequence: 2,
  body: 'Reply text',
  author,
  createdAt: '2026-10-20T12:00:00Z',
  replyTo: original,
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('discussion message presentation', () => {
  it('navigates the one-line reply reference above the author and outside the bubble', async () => {
    const onReplyNavigate = vi.fn();
    const { container } = render(DiscussionMessageView, { message, onReplyNavigate });
    const reply = screen.getByRole('button', { name: 'Jump to message from Alex' });
    expect(reply.textContent).toContain('First line');
    expect(reply.textContent).not.toContain('Later detail');
    expect(reply.closest('[data-discussion-bubble]')).toBeNull();
    expect(container.querySelector('blockquote')).toBeNull();
    expect(
      reply.compareDocumentPosition(container.querySelector('time')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await fireEvent.click(reply);
    expect(onReplyNavigate).toHaveBeenCalledExactlyOnceWith('original');
  });
  it('keeps reply references for continuation rows without another author or avatar', () => {
    const { container } = render(DiscussionMessageView, {
      message,
      continuation: true,
      replySelected: true,
    });
    expect(container.querySelector('time')).toBeNull();
    expect(container.querySelector('[data-discussion-reply-to="original"]')).toBeTruthy();
    expect(container.querySelector('[data-discussion-reply-selected]')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Jump to message from Alex' }).hasAttribute('disabled'),
    ).toBe(true);
  });
  it('renders immutable selected mentions inline without a duplicate recipient row', () => {
    const { container } = render(DiscussionMessageView, {
      message: {
        ...message,
        body: '@Old name please review; plain @Other',
        recipientAgentIds: ['agent-1'],
      },
      agentMentions: [{ agentId: 'agent-1', name: 'Old name', start: 0, end: 9 }],
    });
    expect(container.querySelector('[data-discussion-agent-mention="agent-1"]')?.textContent).toBe(
      '@Old name',
    );
    expect(container.querySelectorAll('[data-discussion-agent-mention]')).toHaveLength(1);
    expect(container.querySelector('[data-discussion-agent-targets]')).toBeNull();
  });
  it('uses safe read-only markdown for agents and keeps navigable references in the same bubble', async () => {
    const { container } = render(DiscussionMessageView, {
      workspaceId: 'ws',
      sourcePanelId: 'pane',
      message: {
        ...message,
        author: { ...author, principalId: null, agentId: 'agent-1' },
        body: 'Summary\n\n- Check `createInviteLink`.\n- Keep the empty state.\n\n[file](intent://local/ws/file/src/main.ts)\n\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))',
      },
    });
    await waitFor(() => expect(container.querySelectorAll('li')).toHaveLength(2));
    expect(container.querySelector('code')?.textContent).toBe('createInviteLink');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    const reference = screen.getByRole('button', { name: 'file' });
    expect(reference.closest('[data-discussion-bubble="agent"]')).toBeTruthy();
    expect(container.querySelector('[data-discussion-agent-author]')).toBeTruthy();
    await fireEvent.click(reference);
    expect(navigation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'file', url: 'intent://local/ws/file/src/main.ts' }),
      'ws',
      'pane',
      expect.any(MouseEvent),
    );
  });
  it('keeps human text literal and reference-like code unlinked', () => {
    const { container } = render(DiscussionMessageView, {
      workspaceId: 'ws',
      message: {
        ...message,
        body: '<img src=x onerror=alert(1)> **plain** `[source](intent://local/ws/file/src/main.ts)`',
      },
    });
    expect(container.querySelector('[data-discussion-bubble]')?.textContent).toContain('**plain**');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'source' })).toBeNull();
  });
  it('routes saved agent mentions in markdown and rejects references to another workspace', async () => {
    const { container } = render(DiscussionMessageView, {
      workspaceId: 'ws',
      sourcePanelId: 'pane',
      agentMentions: [{ agentId: 'agent-2', name: 'Reviewer', start: 0, end: 9 }],
      message: {
        ...message,
        author: { ...author, principalId: null, agentId: 'agent-1' },
        body: '@Reviewer please check. [Elsewhere](intent://local/other/agent/agent-3) [Mixed case](Intent://local/other/agent/agent-3)',
      },
    });
    const selected = await screen.findByRole('link', { name: '@Reviewer' });
    await fireEvent.click(selected);
    expect(navigation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'agent', agentId: 'agent-2' }),
      'ws',
      'pane',
      expect.any(MouseEvent),
    );
    navigation.mockClear();
    const wrongWorkspace = container.querySelector('a[href="intent://local/other/agent/agent-3"]');
    expect(wrongWorkspace).toBeTruthy();
    expect(await fireEvent.click(wrongWorkspace!)).toBe(false);
    expect(await fireEvent.click(screen.getByRole('link', { name: 'Mixed case' }))).toBe(false);
    expect(navigation).not.toHaveBeenCalled();
  });
});
