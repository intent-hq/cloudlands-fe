import { describe, it, expect } from 'vitest';
import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import * as BrandedIds from '$shared/types/branded-ids';
import { getAgentPeekData } from '../agent-peek-utils';

function makeAssistantMessage(blocks: any[]): AgentMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    contentBlocks: blocks,
    timestamp: new Date().toISOString(),
  } as AgentMessage;
}

function makeSession(messages: AgentMessage[]): AgentSession {
  return {
    id: BrandedIds.AgentId('agent-1'),
    backendSessionId: null,
    workspaceId: BrandedIds.WorkspaceId('workspace-1'),
    name: 'Test Agent',
    status: AgentStatus.Active,
    messages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as AgentSession;
}

describe('getAgentPeekData', () => {
  it('returns null for a null agent', () => {
    expect(getAgentPeekData(null)).toBeNull();
    expect(getAgentPeekData(undefined)).toBeNull();
  });

  it('exposes lastResponse when the assistant message is text-only', () => {
    const session = makeSession([
      makeAssistantMessage([{ type: 'text', text: 'Hello world' }]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.lastResponse).toBe('Hello world');
    expect(data?.lastToolUse).toBeUndefined();
  });

  it('exposes lastToolUse when the assistant message is tool-only', () => {
    const session = makeSession([
      makeAssistantMessage([
        { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
      ]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.lastResponse).toBe('');
    expect(data?.lastToolUse?.name).toBe('view');
    expect((data?.lastToolUse?.input as any)?.path).toBe('foo.ts');
  });

  it('prefers tool preview when the latest block is a tool_use after text', () => {
    const session = makeSession([
      makeAssistantMessage([
        { type: 'text', text: 'Let me read the file' },
        { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
      ]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.lastResponse).toBe('');
    expect(data?.lastToolUse?.name).toBe('view');
  });

  it('prefers text when a later text block follows a tool_use', () => {
    const session = makeSession([
      makeAssistantMessage([
        { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
        { type: 'text', text: 'Done reading' },
      ]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.lastResponse).toBe('Done reading');
    expect(data?.lastToolUse).toBeUndefined();
  });

  it('ignores trailing tool_result blocks when picking the latest block', () => {
    const session = makeSession([
      makeAssistantMessage([
        { type: 'text', text: 'Ran it' },
        { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
        { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
      ]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.lastToolUse?.name).toBe('view');
    expect(data?.lastResponse).toBe('');
  });

  it('ignores empty trailing text blocks when picking the latest block', () => {
    const session = makeSession([
      makeAssistantMessage([
        { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
        { type: 'text', text: '   ' },
      ]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.lastToolUse?.name).toBe('view');
  });

  it('extracts digest from text but still surfaces trailing tool_use', () => {
    const session = makeSession([
      makeAssistantMessage([
        { type: 'text', text: 'Working <agent_digest>Short summary</agent_digest>' },
        { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
      ]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.digest).toBe('Short summary');
    expect(data?.lastToolUse?.name).toBe('view');
    expect(data?.lastResponse).toBe('');
  });

  it('extracts the last user message independently of assistant tool previews', () => {
    const userMessage: AgentMessage = {
      id: 'u1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'please read foo' } as any],
      timestamp: new Date().toISOString(),
    } as AgentMessage;
    const session = makeSession([
      userMessage,
      makeAssistantMessage([
        { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
      ]),
    ]);
    const data = getAgentPeekData(session);
    expect(data?.lastUserMessage).toBe('please read foo');
    expect(data?.lastToolUse?.name).toBe('view');
  });

  it('returns empty previews for an empty session', () => {
    const session = makeSession([]);
    const data = getAgentPeekData(session);
    expect(data?.lastResponse).toBe('');
    expect(data?.lastUserMessage).toBe('');
    expect(data?.lastToolUse).toBeUndefined();
  });
});
