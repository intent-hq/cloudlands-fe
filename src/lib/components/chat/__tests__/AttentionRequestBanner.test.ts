/**
 * @vitest-environment jsdom
 *
 * AttentionRequestBanner — kind-flavored label and relative time share a
 * header row, with the reason stacked below it as a separate paragraph.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import type { AgentAttentionRequest } from '$shared/utils/agent-attention';
import type { AgentMessage } from '$shared/types';

const attentionRequest = writable<AgentAttentionRequest | null>(null);
const messages = writable<AgentMessage[]>([]);
const historyMessages = writable<AgentMessage[]>([]);

const { loadFullAttentionReason } = vi.hoisted(() => ({
  loadFullAttentionReason: vi.fn<(agentId: string, request: unknown) => Promise<string | null>>(),
}));
vi.mock('../attention-reason', () => ({ loadFullAttentionReason }));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentAttentionRequest: () => attentionRequest,
  selectAgentMessages: () => messages,
  selectAgentHistoryMessages: () => historyMessages,
}));

import AttentionRequestBanner from '../AttentionRequestBanner.svelte';

afterEach(() => {
  cleanup();
  loadFullAttentionReason.mockReset();
  vi.unstubAllGlobals();
  attentionRequest.set(null);
  messages.set([]);
  historyMessages.set([]);
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('AttentionRequestBanner', () => {
  it.each(['blocker', 'discussion'] as const)(
    'hides the %s fallback when its notice arrives and keeps it hidden in scrollback',
    async (kind) => {
      const request = { kind, reason: 'Need your input', timestamp: '2026-09-23T03:00:00Z' };
      const notice: AgentMessage = {
        id: 'notice-1',
        role: 'system',
        timestamp: request.timestamp,
        contentBlocks: [
          {
            type: 'text',
            text: request.reason,
            meta: { kind: kind === 'blocker' ? 'blocker-report' : 'discussion-request' },
          },
        ],
      };
      attentionRequest.set(request);
      render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });
      expect(screen.getByTestId('attention-request-reason').textContent).toBe(request.reason);

      messages.set([notice]);
      await waitFor(() => expect(screen.queryByTestId('attention-request-banner')).toBeNull());

      historyMessages.set([notice]);
      messages.set([]);
      await waitFor(() => expect(screen.queryByTestId('attention-request-banner')).toBeNull());

      attentionRequest.set({ ...request, timestamp: '2026-09-23T04:00:00Z' });
      await waitFor(() => expect(screen.getByTestId('attention-request-banner')).toBeTruthy());
      attentionRequest.set(null);
      await waitFor(() => expect(screen.queryByTestId('attention-request-banner')).toBeNull());
    },
  );

  // intent-hq/intent#7250: a reason over the 400-byte agent.list cap reaches
  // the banner shortened while the saved notice keeps the full text.
  it('hides the fallback when the pending reason is a shortened copy of the saved notice', async () => {
    const fullReason = `Provider stalled. ${'Retry the turn to continue. '.repeat(20)}`;
    const timestamp = '2026-10-17T16:00:00.123456Z';
    attentionRequest.set({ kind: 'blocker', reason: fullReason.slice(0, 400), timestamp });
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });
    expect(screen.getByTestId('attention-request-banner')).toBeTruthy();

    messages.set([
      {
        id: 'notice-long',
        role: 'system',
        timestamp,
        contentBlocks: [{ type: 'text', text: fullReason, meta: { kind: 'blocker-report' } }],
      },
    ]);
    await waitFor(() => expect(screen.queryByTestId('attention-request-banner')).toBeNull());
  });

  // PROTOCOL §5.5 truncation flags: a reason the agent.list cap shortened is
  // never shown as if complete.
  describe('shortened reason', () => {
    const timestamp = '2026-10-18T00:00:00Z';
    const fullReason = `Provider stalled. ${'Retry the turn to continue. '.repeat(20)}`;
    const shortened = { kind: 'blocker' as const, reason: fullReason.slice(0, 40), timestamp };

    it('marks the shortened text, then shows the full reason from agent.get', async () => {
      let resolve!: (reason: string | null) => void;
      loadFullAttentionReason.mockReturnValue(new Promise((r) => (resolve = r)));
      attentionRequest.set({ ...shortened, reasonTruncated: true });
      render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

      expect(screen.getByTestId('attention-request-reason').textContent).toBe(
        `${shortened.reason.trimEnd()}…`,
      );
      expect(loadFullAttentionReason).toHaveBeenCalledTimes(1);
      expect(loadFullAttentionReason).toHaveBeenCalledWith('agent-1', {
        ...shortened,
        reasonTruncated: true,
      });

      resolve(fullReason);
      await waitFor(() =>
        expect(screen.getByTestId('attention-request-reason').textContent).toBe(fullReason),
      );
    });

    it('keeps the ellipsis when the full reason cannot be read', async () => {
      loadFullAttentionReason.mockResolvedValue(null);
      attentionRequest.set({ ...shortened, reasonTruncated: true });
      render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });
      await waitFor(() => expect(loadFullAttentionReason).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      expect(screen.getByTestId('attention-request-reason').textContent).toBe(
        `${shortened.reason.trimEnd()}…`,
      );
    });

    it('does not reuse a full reason loaded for an earlier request', async () => {
      loadFullAttentionReason.mockResolvedValueOnce(fullReason);
      attentionRequest.set({ ...shortened, reasonTruncated: true });
      render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });
      await waitFor(() =>
        expect(screen.getByTestId('attention-request-reason').textContent).toBe(fullReason),
      );

      loadFullAttentionReason.mockReturnValueOnce(new Promise(() => {}));
      attentionRequest.set({
        kind: 'blocker',
        reason: 'Second request, shortened',
        timestamp: '2026-10-18T01:00:00Z',
        reasonTruncated: true,
      });
      await waitFor(() =>
        expect(screen.getByTestId('attention-request-reason').textContent).toBe(
          'Second request, shortened…',
        ),
      );
      expect(loadFullAttentionReason).toHaveBeenCalledTimes(2);
    });

    it('renders an unflagged reason unchanged without reading agent.get', () => {
      attentionRequest.set(shortened);
      render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });
      expect(screen.getByTestId('attention-request-reason').textContent).toBe(shortened.reason);
      expect(loadFullAttentionReason).not.toHaveBeenCalled();
    });
  });

  it('updates pending attention in both directions and removes it when resolved', async () => {
    attentionRequest.set({ kind: 'discussion', reason: 'Choose the scope' });
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });
    expect(screen.getByTestId('attention-request-label').textContent).toMatch(/discussion/i);
    expect(screen.getByTestId('attention-request-reason').textContent).toContain(
      'Choose the scope',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen
        .getByTestId('attention-request-header')
        .querySelector('[title], [data-tooltip-trigger]'),
    ).toBeNull();
    attentionRequest.set({
      kind: 'blocker',
      reason: 'Docker daemon is down',
      timestamp: '2026-08-25T12:00:00Z',
    });
    await waitFor(() =>
      expect(screen.getByTestId('attention-request-label').textContent).toMatch(/blocker/i),
    );
    expect(screen.getByTestId('attention-request-reason').textContent).toContain(
      'Docker daemon is down',
    );
    const header = screen.getByTestId('attention-request-header');
    expect(header.querySelector('[title]')).toBeNull();
    const timestamp = header.querySelector<HTMLElement>('[data-tooltip-trigger]');
    expect(timestamp).not.toBeNull();
    await fireEvent.focus(timestamp!);
    expect((await screen.findByRole('tooltip', { hidden: true })).textContent).toMatch(/2026/);
    expect(screen.queryByRole('alert')).toBeNull();
    attentionRequest.set({ kind: 'discussion', reason: 'Confirm the next step' });
    await waitFor(() =>
      expect(screen.getByTestId('attention-request-label').textContent).toMatch(/discussion/i),
    );
    expect(screen.getByTestId('attention-request-reason').textContent).toContain(
      'Confirm the next step',
    );
    expect(
      screen
        .getByTestId('attention-request-header')
        .querySelector('[title], [data-tooltip-trigger]'),
    ).toBeNull();
    attentionRequest.set(null);
    await waitFor(() => expect(screen.queryByTestId('attention-request-banner')).toBeNull());
  });

  it('omits missing reason and timestamp fields', () => {
    attentionRequest.set({ kind: 'blocker' });
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    const banner = screen.getByTestId('attention-request-banner');
    expect(screen.getByText(/Reports a blocker/i)).toBeTruthy();
    expect(screen.queryByTestId('attention-request-reason')).toBeNull();
    expect(banner.querySelector('[title]')).toBeNull();
  });

  it('renders nothing when no attention request is pending', () => {
    attentionRequest.set(null);
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    expect(screen.queryByTestId('attention-request-banner')).toBeNull();
  });
});
