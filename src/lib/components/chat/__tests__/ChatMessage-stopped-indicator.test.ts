/**
 * @vitest-environment jsdom
 */
// Regression test for the reason-specific Stopped indicator labels
// (intent-hq/monorepo#2355): the #1031 redesign silently reverted
// ChatMessage to the generic "Stopped" for every interruption. These
// tests assert the rendered label end-to-end so a future rewrite of
// ChatMessage cannot drop the resolveStoppedIndicatorLabel wiring again.
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: vi.fn(),
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: Object.assign(
    () => ({
      subscribe: (run: (value: string | null) => void) => {
        run('ws-1');
        return () => {};
      },
    }),
    { select: () => 'ws-1' },
  ),
  selectWorkspaceById: Object.assign(
    () => ({
      subscribe: (run: (value: unknown) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

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

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/AuggieAvatar.svelte')).default,
}));

vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';

function interruptedAssistant(extra: Record<string, unknown> = {}): AgentMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    contentBlocks: [{ type: 'text', text: 'Partial answer' }],
    timestamp: new Date('2026-01-01T12:00:00Z'),
    metadata: { interrupted: true, stopReason: 'interrupted', ...extra },
  };
}

function renderStopped(extra: Record<string, unknown> = {}) {
  render(ChatMessage, {
    props: { message: interruptedAssistant(extra), isStreaming: false },
  });
}

describe('ChatMessage reason-specific stopped indicator labels', () => {
  it('renders the generic "Stopped" for legacy rows without interruptReason', () => {
    renderStopped();
    expect(screen.getByText('Stopped')).toBeTruthy();
  });

  it('renders "Interrupted by a new message" for a user-sent preemption', () => {
    renderStopped({ interruptReason: 'preempted_by_message', interruptedBy: { kind: 'user' } });
    expect(screen.getByText('Interrupted by a new message')).toBeTruthy();
  });

  it('renders "Interrupted by {name}" for an agent-sent preemption', () => {
    renderStopped({
      interruptReason: 'preempted_by_message',
      interruptedBy: { kind: 'agent', agentId: 'agent-1', name: 'Coordinator' },
    });
    expect(screen.getByText('Interrupted by Coordinator')).toBeTruthy();
  });

  it('renders "Stopped — daemon restarted" for daemon_shutdown', () => {
    renderStopped({ interruptReason: 'daemon_shutdown' });
    expect(screen.getByText('Stopped — daemon restarted')).toBeTruthy();
  });

  it('renders "Stopped — agent terminated" for agent_stopped', () => {
    renderStopped({ interruptReason: 'agent_stopped' });
    expect(screen.getByText('Stopped — agent terminated')).toBeTruthy();
  });

  it('renders the system-suspend label for system_suspend', () => {
    renderStopped({ interruptReason: 'system_suspend' });
    expect(screen.getByText('Stopped — system suspended; resumes on wake')).toBeTruthy();
  });

  it('renders the generic "Stopped" for user_stop', () => {
    renderStopped({ interruptReason: 'user_stop' });
    expect(screen.getByText('Stopped')).toBeTruthy();
  });

  it('falls back to the generic "Stopped" for unknown future reasons', () => {
    renderStopped({ interruptReason: 'some_future_reason' });
    expect(screen.getByText('Stopped')).toBeTruthy();
  });
});
