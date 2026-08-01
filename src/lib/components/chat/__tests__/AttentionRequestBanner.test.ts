/**
 * @vitest-environment jsdom
 *
 * AttentionRequestBanner — kind-flavored header (icon + label) on its own
 * line with the reason stacked below it as a separate paragraph.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import type { AgentAttentionRequest } from '$shared/utils/agent-attention';

const makeReadable = <T>(value: T) => ({
  subscribe: (run: (value: T) => void) => {
    run(value);
    return () => {};
  },
});

let attentionRequest: AgentAttentionRequest | null = null;

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentAttentionRequest: () => makeReadable(attentionRequest),
}));

import AttentionRequestBanner from '../AttentionRequestBanner.svelte';

afterEach(() => {
  cleanup();
  attentionRequest = null;
});

describe('AttentionRequestBanner', () => {
  it('renders the blocker header with the reason stacked below it', () => {
    attentionRequest = { kind: 'blocker', reason: 'Docker daemon is down' };
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    const banner = screen.getByTestId('attention-request-banner');
    const column = banner.firstElementChild as HTMLElement;
    expect(column.className).toContain('flex-col');

    const header = screen.getByText(/Reports a blocker/i);
    const reason = screen.getByText('Docker daemon is down');
    expect(header.className).toContain('text-red-500');
    expect(reason.className).toContain('text-subtle');
    expect(header.parentElement).toBe(column);
    expect(reason.parentElement).toBe(column);
  });

  it('renders the discussion header and reason', () => {
    attentionRequest = { kind: 'discussion', reason: 'Need input on API design' };
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    const header = screen.getByText(/Requests a discussion/i);
    expect(header.className).toContain('text-amber-500');
    expect(screen.getByText('Need input on API design')).toBeTruthy();
  });

  it('omits the reason paragraph when the reason is absent', () => {
    attentionRequest = { kind: 'blocker' };
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    const banner = screen.getByTestId('attention-request-banner');
    expect(screen.getByText(/Reports a blocker/i)).toBeTruthy();
    expect(banner.querySelector('.text-subtle')).toBeNull();
  });

  it('renders nothing when no attention request is pending', () => {
    attentionRequest = null;
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    expect(screen.queryByTestId('attention-request-banner')).toBeNull();
  });
});
