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

  it('locks once any message is already rendered in chat state', () => {
    expect(
      canChangeAgentProvider({
        session: createSession(),
        messages: [{ role: 'user' }],
      }),
    ).toBe(false);

    expect(
      canChangeAgentProvider({
        session: createSession(),
        messages: [{ role: 'assistant' }],
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

  it('returns unlocked when session is null and no messages or pending state', () => {
    expect(
      canChangeAgentProvider({
        session: null,
        messages: [],
      }),
    ).toBe(true);
  });

  it('locks when session is null but messages are visible', () => {
    expect(
      canChangeAgentProvider({
        session: null,
        messages: [{ role: 'user' }],
      }),
    ).toBe(false);

    expect(
      canChangeAgentProvider({
        session: null,
        messages: [{ role: 'assistant' }],
      }),
    ).toBe(false);
  });

  it('locks when session is null but a pending initial prompt exists', () => {
    expect(
      canChangeAgentProvider({
        session: null,
        messages: [],
        pendingInitialPrompt: 'Hello',
      }),
    ).toBe(false);
  });

  it('locks when session is null but pending context references exist', () => {
    expect(
      canChangeAgentProvider({
        session: null,
        messages: [],
        pendingContextReferenceCount: 1,
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
