/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAgentAvatarStateLabel } from '$features/agent/components/agent-avatar/avatar-state-label';

const state = vi.hoisted(() => {
  function mutable<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<(next: T) => void>();
    return {
      readable: {
        subscribe(run: (next: T) => void) {
          subscribers.add(run);
          run(value);
          return () => subscribers.delete(run);
        },
      },
      set(next: T) {
        value = next;
        subscribers.forEach((run) => run(next));
      },
    };
  }

  return {
    session: mutable<Record<string, unknown> | undefined>(undefined),
    provider: mutable<string | undefined>(undefined),
    permissionCount: mutable(0),
    hasQuestion: mutable(false),
  };
});

vi.mock('$store/renderer/store', () => ({
  store: { state: { agentSessions: { byAgentId: {} } } },
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: Object.assign(() => state.session.readable, { select: () => undefined }),
  selectAgentProvider: () => state.provider.readable,
  selectAgentIsResponding: Object.assign(() => ({ subscribe: () => () => {} }), {
    select: () => false,
  }),
  selectAgentMessageById: { select: () => undefined },
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => state.permissionCount.readable,
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectHudAgentHasPendingQuestion: () => state.hasQuestion.readable,
}));
vi.mock('$lib/components/chat/questions/wizard-gate', () => ({
  deriveWizardPendingQuestions: () => null,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));

import PanelHeaderAgentAvatar from '../PanelHeaderAgentAvatar.svelte';

const session = (fields: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  status: 'idle',
  messages: [],
  metadata: { specialist: 'verifier' },
  ...fields,
});

async function expectState(expected: Parameters<typeof getAgentAvatarStateLabel>[0]) {
  await tick();
  const avatar = screen.getByRole('img', { name: getAgentAvatarStateLabel(expected) });
  expect(avatar.getAttribute('data-avatar-state')).toBe(expected);
  return avatar;
}

afterEach(() => cleanup());

describe('PanelHeaderAgentAvatar', () => {
  it('reacts to canonical live session states without remounting', async () => {
    state.session.set(session({ hasUnread: true }));
    state.provider.set('codex');
    const view = render(PanelHeaderAgentAvatar, { props: { agentId: 'agent-1' } });
    const initial = await expectState('idle');

    expect(view.container.querySelector('[data-specialist="verifier"]')).not.toBeNull();
    expect(view.container.querySelector('[data-provider="codex"]')).not.toBeNull();

    state.session.set(session({ status: 'active', isResponding: true }));
    expect(await expectState('running')).toBe(initial);
    state.session.set(session({ status: 'waiting' }));
    await expectState('waiting');
    state.session.set(session({ status: 'completed' }));
    await expectState('completed');
    state.session.set(session({ status: 'error' }));
    await expectState('failed');
  });

  it('applies question, permission, and attention priority with localized labels', async () => {
    state.session.set(session({ attentionRequestKind: 'blocker' }));
    render(PanelHeaderAgentAvatar, { props: { agentId: 'agent-1' } });
    await expectState('attention-blocker');

    state.session.set(session({ attentionRequestKind: 'discussion' }));
    await expectState('attention-discussion');
    state.permissionCount.set(1);
    await expectState('needs-permission');
    state.hasQuestion.set(true);
    await expectState('question');
  });
});
