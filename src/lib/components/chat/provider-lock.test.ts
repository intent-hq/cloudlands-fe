import { describe, expect, it } from 'vitest';

import { canChangeAgentProvider } from './provider-lock';

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    name: 'Agent',
    status: 'idle',
    provider: 'auggie',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as any;
}

describe('canChangeAgentProvider', () => {
  it('allows provider changes for unused sessions with no visible first-turn state', () => {
    expect(
      canChangeAgentProvider({
        session: createSession({ acpSessionId: 'acp-1' }),
        messages: [],
      }),
    ).toBe(true);
  });

  it('locks once the first user message is already rendered in chat state', () => {
    expect(
      canChangeAgentProvider({
        session: createSession(),
        messages: [{ role: 'user' }],
      }),
    ).toBe(false);
  });

  it('locks during the optimistic pending first-turn state before session hydration catches up', () => {
    expect(
      canChangeAgentProvider({
        session: createSession(),
        messages: [],
        pendingInitialPrompt: 'Hello',
      }),
    ).toBe(false);
  });

  it('keeps reopened used chats locked based on persisted user messages', () => {
    expect(
      canChangeAgentProvider({
        session: createSession({
          messages: [{ role: 'user', content: 'hello' }],
        }),
        messages: [],
      }),
    ).toBe(false);
  });
});
