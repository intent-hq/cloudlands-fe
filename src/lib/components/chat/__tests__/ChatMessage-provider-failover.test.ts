/**
 * @vitest-environment jsdom
 *
 * A `provider_failover` row reaches ChatMessage through the turn body stream
 * (between the failed attempt and its retry); it must render as the inline
 * failover notice, never as a message bubble.
 */
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}) });
});

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: unknown[]) => void) => {
        run([]);
        return () => {};
      },
    }),
    { select: () => [] },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: unknown) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

import ChatMessage from '../ChatMessage.svelte';

const DAEMON_TEXT = 'claude-code ran out of quota. Switched to the backup claude-code (Work).';

function failoverRow(metadata: Record<string, unknown>): AgentMessage {
  return {
    id: 'failover-1',
    role: 'system',
    contentBlocks: [{ type: 'text', text: DAEMON_TEXT }],
    timestamp: new Date('2026-10-21T12:00:00Z'),
    metadata: { type: 'provider_failover', ...metadata },
  } as AgentMessage;
}

describe('ChatMessage — provider_failover row', () => {
  it('renders the inline failover notice instead of a bubble', () => {
    const { container } = render(ChatMessage, {
      props: {
        message: failoverRow({
          fromProvider: 'claude-code',
          toProvider: 'claude-code@pwork',
          model: 'opus',
          reason: 'quota-exceeded',
        }),
      },
    });
    const notice = screen.getByRole('status');
    expect(notice.textContent?.trim()).toMatch(/ran out of quota — continuing on .+ \(backup\)$/);
    expect(notice.textContent).not.toContain('@pwork');
    // Nothing renders outside the notice: no bubble, no daemon text, no actions.
    expect(container.textContent?.trim()).toBe(notice.textContent?.trim());
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the daemon text inside the notice when the metadata is incomplete', () => {
    const { container } = render(ChatMessage, { props: { message: failoverRow({}) } });
    const notice = screen.getByRole('status');
    expect(notice.textContent?.trim()).toBe(DAEMON_TEXT);
    expect(container.textContent?.trim()).toBe(DAEMON_TEXT);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
