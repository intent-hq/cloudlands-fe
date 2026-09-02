import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

const makeReadable = <T>(value: T) => ({
  subscribe: (run: (value: T) => void) => {
    run(value);
    return () => {};
  },
});

/** Mutable BE-owned activity flags the avatar-state derivation reads. */
const agentFlags = vi.hoisted(() => ({ isResponding: false, isBlockedWaiting: false }));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: () =>
    makeReadable(
      agentFlags.isResponding || agentFlags.isBlockedWaiting
        ? {
            id: 'agent-1',
            backendSessionId: null,
            workspaceId: 'workspace-1',
            name: 'Agent',
            status: agentFlags.isBlockedWaiting ? 'waiting' : 'active',
            messages: [],
            isResponding: agentFlags.isResponding,
            isWaitingForOtherAgents: agentFlags.isBlockedWaiting,
          }
        : null,
    ),
  selectAgentIsResponding: () => makeReadable(agentFlags.isResponding),
  selectAgentPreview: Object.assign(() => makeReadable(null), { select: () => null }),
  selectAgentIsWaiting: () => makeReadable(agentFlags.isBlockedWaiting),
  selectAgentIsBlockedWaiting: () => makeReadable(agentFlags.isBlockedWaiting),
  selectAgentSessionStreamingContent: () => makeReadable(''),
  selectAgentSessionHasStreamOwnedMessage: () => makeReadable(false),
  selectAgentProvider: () => makeReadable(undefined),
}));

vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', () => ({
  selectChatReceivedFirstChunk: () => makeReadable(false),
  selectChatLastChunkReceivedAt: () => makeReadable(0),
}));

vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => makeReadable(0),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectAgentLineStats: () => makeReadable(null),
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/MockAvatarWithState.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('./mocks/SlotOnly.svelte')).default;
  return {
    Provider: SlotOnly,
    Root: SlotOnly,
    Trigger: SlotOnly,
    Content: SlotOnly,
  };
});

import AgentCard from '../AgentCard.svelte';
import InlineAgentAvatar from '../InlineAgentAvatar.svelte';

describe('isCompleted avatar state wiring', () => {
  beforeEach(() => {
    agentFlags.isResponding = false;
    agentFlags.isBlockedWaiting = false;
  });
  afterEach(() => cleanup());

  it('InlineAgentAvatar renders completed avatar state when isCompleted is true', () => {
    render(InlineAgentAvatar, { props: { agentId: 'agent-1', isCompleted: true } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('completed');
  });

  it('InlineAgentAvatar defaults to non-completed avatar state', () => {
    render(InlineAgentAvatar, { props: { agentId: 'agent-1' } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('idle');
  });

  it('AgentCard renders completed avatar state when isCompleted is true', () => {
    render(AgentCard, { props: { agentId: 'agent-1', isCompleted: true } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('completed');
  });

  it('AgentCard defaults to non-completed avatar state', () => {
    render(AgentCard, { props: { agentId: 'agent-1' } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('idle');
  });

  it('AgentCard presents wake-up details in one compact inline row', () => {
    render(AgentCard, {
      props: {
        agentId: 'agent-1',
        agentName: 'Verifier',
        inline: true,
        hidePreview: true,
        statusLabel: 'finished',
        lastResponseSummary: 'All checks passed',
      },
    });

    const row = screen.getByRole('button');
    expect(row.textContent).toContain('Verifier');
    expect(row.textContent).toContain('finished');
    expect(row.textContent).not.toContain('All checks passed');
    expect(row.textContent).not.toContain('·');
    expect(row.className).toContain('type-body');
    expect(row.querySelector('.agent-card-content')?.className).toContain('flex-row');
    expect(row.querySelector('.agent-card-header')?.className).toContain(
      'inline-agent-card-header',
    );
    expect(row.querySelector('.agent-card-header')?.className).not.toContain('max-w-[52%]');
    expect(row.querySelector('.inline-agent-card-preview')).toBeNull();
    expect(row.querySelector('h3')?.parentElement?.className).toContain('overflow-hidden');
    expect(row.querySelector('h3')?.className).not.toContain('text-sm');
    const avatarClasses = Array.from(
      screen.getByTestId('mock-avatar-with-state').parentElement?.classList ?? [],
    );
    expect(avatarClasses).toContain('relative');
    expect(avatarClasses).toContain('shrink-0');
    expect(
      avatarClasses.filter((name) => name.startsWith('mt-') || name.startsWith('-mb-')),
    ).toEqual([]);
  });

  it('uses the emphasized single-line grammar for Agents-panel rows', () => {
    render(AgentCard, {
      props: {
        agentId: 'agent-panel',
        agentName: 'A very long agent name',
        panelRow: true,
        hidePreview: true,
        isBackground: true,
        openPanelCount: 2,
        lastResponseSummary: 'must not be exposed',
      },
    });

    const row = screen.getByRole('button');
    expect(row.getAttribute('data-agent-panel-row')).toBe('agent-panel');
    expect(row.className).toContain('h-10');
    expect(row.className).toContain('border-transparent');
    expect(screen.getByTestId('mock-avatar-with-state').dataset.variant).toBe('emphasized');
    expect(row.querySelector('[data-agent-row-name]')?.className).toContain('truncate');
    expect(row.querySelector('[data-agent-row-trailing]')).toBeTruthy();
    expect(row.querySelector('[data-agent-background-badge]')).toBeTruthy();
    expect(row.querySelector('[data-panel-open-count]')).toBeNull();
    expect(screen.queryByTestId('agent-card-preview')).toBeNull();
    expect(row.textContent).not.toContain('must not be exposed');
  });

  it('AgentCard renders running, not completed, for a re-woken completed agent', () => {
    agentFlags.isResponding = true;

    render(AgentCard, { props: { agentId: 'agent-1', isCompleted: true } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('running');
  });

  it('InlineAgentAvatar renders running, not completed, for a re-woken completed agent', () => {
    agentFlags.isResponding = true;

    render(InlineAgentAvatar, { props: { agentId: 'agent-1', isCompleted: true } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('running');
  });

  it('AgentCard renders waiting for a genuinely blocked agent', () => {
    agentFlags.isBlockedWaiting = true;

    render(AgentCard, { props: { agentId: 'agent-1' } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('waiting');
  });
});
