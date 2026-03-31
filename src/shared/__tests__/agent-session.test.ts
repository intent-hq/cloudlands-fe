import { describe, expect, it } from 'vitest';

import { hasAgentHandledFirstPrompt } from '../types/agent-session';

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

describe('hasAgentHandledFirstPrompt', () => {
  it('returns false before any session work exists', () => {
    expect(hasAgentHandledFirstPrompt(createSession())).toBe(false);
  });

  it('returns false when a blank agent only has a local backend session id', () => {
    expect(hasAgentHandledFirstPrompt(createSession({ backendSessionId: 'backend-1' }))).toBe(false);
  });

  it('returns false when only an ACP session has been created', () => {
    expect(hasAgentHandledFirstPrompt(createSession({ acpSessionId: 'acp-1' }))).toBe(false);
  });

  it('returns true when only assistant messages exist', () => {
    expect(
      hasAgentHandledFirstPrompt(
        createSession({ messages: [{ role: 'assistant', content: 'hello' }] }),
      ),
    ).toBe(true);
  });

  it('returns true once the agent has a user message', () => {
    expect(
      hasAgentHandledFirstPrompt(
        createSession({ messages: [{ role: 'user', content: 'hello' }] }),
      ),
    ).toBe(true);
  });
});
