/**
 * @vitest-environment jsdom
 *
 * AttentionRequestBanner — kind-flavored label and relative time share a
 * header row, with the reason stacked below it as a separate paragraph.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import type { AgentAttentionRequest } from '$shared/utils/agent-attention';
import type { AgentMessage } from '$shared/types';

const attentionRequest = writable<AgentAttentionRequest | null>(null);
const messages = writable<AgentMessage[]>([]);
const historyMessages = writable<AgentMessage[]>([]);

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentAttentionRequest: () => attentionRequest,
  selectAgentMessages: () => messages,
  selectAgentHistoryMessages: () => historyMessages,
}));

import AttentionRequestBanner from '../AttentionRequestBanner.svelte';

afterEach(() => {
  cleanup();
  attentionRequest.set(null);
  messages.set([]);
  historyMessages.set([]);
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

  it('updates pending attention in both directions and removes it when resolved', async () => {
    attentionRequest.set({ kind: 'discussion', reason: 'Choose the scope' });
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });
    expect(screen.getByTestId('attention-request-label').textContent).toMatch(/discussion/i);
    expect(screen.getByTestId('attention-request-reason').textContent).toContain(
      'Choose the scope',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('attention-request-header').querySelector('[title]')).toBeNull();
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
    expect(screen.getByTestId('attention-request-header').querySelector('[title]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    attentionRequest.set({ kind: 'discussion', reason: 'Confirm the next step' });
    await waitFor(() =>
      expect(screen.getByTestId('attention-request-label').textContent).toMatch(/discussion/i),
    );
    expect(screen.getByTestId('attention-request-reason').textContent).toContain(
      'Confirm the next step',
    );
    expect(screen.getByTestId('attention-request-header').querySelector('[title]')).toBeNull();
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
