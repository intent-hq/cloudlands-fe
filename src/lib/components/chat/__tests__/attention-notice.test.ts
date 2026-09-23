/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { getAttentionNotice, hasMatchingAttentionNotice } from '../attention-notice';
import DiscussionRequestNotice from '../DiscussionRequestNotice.svelte';
import BlockerReportNotice from '../BlockerReportNotice.svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';
import type { AgentMessage } from '$shared/types';

// Wire shape (PROTOCOL §7 / agent attention requests): system-role message,
// content block { type: "text", text: <reason>, meta: { kind } }.
function systemMessage(kind: string, reason: string): AgentMessage {
  return {
    id: 'msg-1',
    role: 'system',
    contentBlocks: [{ type: 'text', text: reason, meta: { kind } }],
    timestamp: new Date().toISOString(),
  };
}

describe('getAttentionNotice', () => {
  it('detects a discussion-request system message', () => {
    const notice = getAttentionNotice(systemMessage('discussion-request', 'Need input on API'));
    expect(notice).toEqual({ kind: 'discussion-request', reason: 'Need input on API' });
  });

  it('detects a blocker-report system message', () => {
    const notice = getAttentionNotice(systemMessage('blocker-report', 'Docker daemon is down'));
    expect(notice).toEqual({ kind: 'blocker-report', reason: 'Docker daemon is down' });
  });

  it('detects a turn-failure system message', () => {
    const notice = getAttentionNotice(systemMessage('turn-failure', 'Provider stream aborted'));
    expect(notice).toEqual({ kind: 'turn-failure', reason: 'Provider stream aborted' });
  });

  it('returns null for interruption system messages', () => {
    expect(getAttentionNotice(systemMessage('interruption', 'restarted'))).toBeNull();
  });

  it('returns null for system messages without meta', () => {
    const message: AgentMessage = {
      id: 'msg-1',
      role: 'system',
      contentBlocks: [{ type: 'text', text: 'plain notice' }],
      timestamp: new Date().toISOString(),
    };
    expect(getAttentionNotice(message)).toBeNull();
  });

  it('returns null for non-system roles even with an attention meta.kind', () => {
    const message = { ...systemMessage('blocker-report', 'reason'), role: 'assistant' as const };
    expect(getAttentionNotice(message)).toBeNull();
  });

  it('returns null for null/undefined messages', () => {
    expect(getAttentionNotice(null)).toBeNull();
    expect(getAttentionNotice(undefined)).toBeNull();
  });
});

describe('hasMatchingAttentionNotice', () => {
  const request = {
    kind: 'blocker' as const,
    reason: 'Need credentials',
    timestamp: '2026-09-23T03:00:00Z',
  };
  const notice = {
    ...systemMessage('blocker-report', request.reason),
    timestamp: '2026-09-23T03:00:00.000Z',
  };

  it('matches a saved notice using its kind, reason, and timestamp', () => {
    expect(hasMatchingAttentionNotice([notice], request)).toBe(true);
  });

  it('matches Date timestamps without discarding milliseconds', () => {
    const timestamp = '2026-09-23T03:00:00.123Z';
    const message = { ...notice, timestamp: new Date(timestamp) };
    expect(hasMatchingAttentionNotice([message], { ...request, timestamp })).toBe(true);
    expect(hasMatchingAttentionNotice([message], request)).toBe(false);
  });

  it.each([
    { ...notice, timestamp: '2026-09-22T03:00:00Z' },
    { ...notice, timestamp: '2026-09-24T03:00:00Z' },
    { ...notice, timestamp: 'invalid' },
    { ...notice, timestamp: new Date('invalid') },
    { ...notice, role: 'assistant' as const },
    { ...systemMessage('discussion-request', request.reason), timestamp: notice.timestamp },
    { ...systemMessage('turn-failure', request.reason), timestamp: notice.timestamp },
    { ...systemMessage('blocker-report', 'A different reason'), timestamp: notice.timestamp },
  ])('does not hide a request behind an unrelated notice: %j', (message) => {
    expect(hasMatchingAttentionNotice([message], request)).toBe(false);
  });

  it('keeps the fallback when there is no identifiable matching notice', () => {
    expect(hasMatchingAttentionNotice([], request)).toBe(false);
    expect(hasMatchingAttentionNotice([notice], null)).toBe(false);
    expect(hasMatchingAttentionNotice([notice], { ...request, timestamp: undefined })).toBe(false);
    expect(hasMatchingAttentionNotice([notice], { ...request, timestamp: 'invalid' })).toBe(false);
  });
});

describe('DiscussionRequestNotice', () => {
  it('renders the title and reason with alert semantics', () => {
    render(DiscussionRequestNotice, { props: { reason: 'Need input on API design' } });

    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText(/Discussion requested/i)).toBeTruthy();
    expect(screen.getByText('Need input on API design')).toBeTruthy();
  });

  it('renders the title alone when no reason is provided', () => {
    render(DiscussionRequestNotice);

    expect(screen.getByText(/Discussion requested/i)).toBeTruthy();
  });

  it('applies custom class when provided', () => {
    const { container } = render(DiscussionRequestNotice, {
      props: { reason: 'r', class: 'custom-test-class' },
    });

    const notice = container.querySelector('.discussion-request-notice');
    expect(notice?.className).toContain('custom-test-class');
  });
});

describe('TurnFailureNotice', () => {
  it('renders the title and reason with alert semantics', () => {
    render(TurnFailureNotice, { props: { reason: 'Provider stream aborted' } });

    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText(/Turn failed/i)).toBeTruthy();
    expect(screen.getByText('Provider stream aborted')).toBeTruthy();
  });

  it('renders the title alone when no reason is provided', () => {
    render(TurnFailureNotice);

    expect(screen.getByText(/Turn failed/i)).toBeTruthy();
  });

  it('applies custom class when provided', () => {
    const { container } = render(TurnFailureNotice, {
      props: { reason: 'r', class: 'custom-test-class' },
    });

    const notice = container.querySelector('.turn-failure-notice');
    expect(notice?.className).toContain('custom-test-class');
  });
});

describe('BlockerReportNotice', () => {
  it('renders the title and reason with alert semantics', () => {
    render(BlockerReportNotice, { props: { reason: 'Docker daemon is down' } });

    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText(/Blocker reported/i)).toBeTruthy();
    expect(screen.getByText('Docker daemon is down')).toBeTruthy();
  });

  it('renders the title alone when no reason is provided', () => {
    render(BlockerReportNotice);

    expect(screen.getByText(/Blocker reported/i)).toBeTruthy();
  });

  it('applies custom class when provided', () => {
    const { container } = render(BlockerReportNotice, {
      props: { reason: 'r', class: 'custom-test-class' },
    });

    const notice = container.querySelector('.blocker-report-notice');
    expect(notice?.className).toContain('custom-test-class');
  });
});
