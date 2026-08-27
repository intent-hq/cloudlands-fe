/**
 * @vitest-environment jsdom
 *
 * AttentionRequestBanner — kind-flavored label and relative time share a
 * header row, with the reason stacked below it as a separate paragraph.
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
  it('renders the blocker label and timestamp above the reason', () => {
    attentionRequest = {
      kind: 'blocker',
      reason: 'Docker daemon is down',
      timestamp: '2026-08-25T12:00:00Z',
    };
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    const banner = screen.getByTestId('attention-request-banner');
    const column = banner.firstElementChild as HTMLElement;
    const header = screen.getByTestId('attention-request-header');
    const label = screen.getByTestId('attention-request-label');
    const reason = screen.getByTestId('attention-request-reason');
    const relativeTime = header.querySelector('[title]') as HTMLElement;
    const icon = label.previousElementSibling;
    expect(banner.className).toContain('mt-6');
    expect(column.className).toContain('flex-col');
    expect(label.textContent).toMatch(/Reports a blocker/i);
    expect(label.parentElement?.className).toContain('text-red-500');
    expect(icon?.tagName.toLowerCase()).toBe('svg');
    expect(reason.className).toContain('text-subtle');
    expect(relativeTime.className).toContain('text-ghost');
    expect(label.closest('[data-testid="attention-request-header"]')).toBe(header);
    expect(relativeTime.parentElement).toBe(header);
    expect(reason.parentElement).toBe(column);
  });

  it('renders the discussion label, icon, timestamp, and reason with shared layout', () => {
    attentionRequest = {
      kind: 'discussion',
      reason: 'Need input on API design',
      timestamp: '2026-08-25T12:00:00Z',
    };
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    const header = screen.getByTestId('attention-request-header');
    const label = screen.getByTestId('attention-request-label');
    expect(label.textContent).toMatch(/Requests a discussion/i);
    expect(label.parentElement?.className).toContain('text-amber-500');
    expect(label.previousElementSibling?.tagName.toLowerCase()).toBe('svg');
    expect(header.querySelector('[title]')).toBeTruthy();
    expect(screen.getByText('Need input on API design')).toBeTruthy();
  });

  it('omits missing reason and timestamp fields', () => {
    attentionRequest = { kind: 'blocker' };
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    const banner = screen.getByTestId('attention-request-banner');
    expect(screen.getByText(/Reports a blocker/i)).toBeTruthy();
    expect(screen.queryByTestId('attention-request-reason')).toBeNull();
    expect(banner.querySelector('[title]')).toBeNull();
  });

  it('renders nothing when no attention request is pending', () => {
    attentionRequest = null;
    render(AttentionRequestBanner, { props: { agentId: 'agent-1' } });

    expect(screen.queryByTestId('attention-request-banner')).toBeNull();
  });
});
