import {
  describe,
  it,
  expect,
} from 'vitest';
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

  it('does not expose derived activity state', () => {
    const session = makeSession([]);
    const data = getAgentPeekData(session);
    expect(data).not.toHaveProperty('isActive');
    expect(data?.status).toBe(AgentStatus.Active);
  });

  describe('lastMessageRole (wire field + transcript-derived fallback)', () => {
    function makeUserMessage(text: string): AgentMessage {
      return {
        id: 'u1',
        role: 'user',
        contentBlocks: [{ type: 'text', text } as any],
        timestamp: new Date().toISOString(),
      } as AgentMessage;
    }

    it('passes the wire lastMessageRole through verbatim', () => {
      const session = { ...makeSession([]), lastMessageRole: 'user' as const };
      expect(getAgentPeekData(session)?.lastMessageRole).toBe('user');
    });

    it('prefers the wire field over the transcript when both are present', () => {
      // Mid-turn the daemon overlays "assistant" once streamed text is
      // derivable, even while the loaded transcript still ends on the user.
      const session = {
        ...makeSession([makeUserMessage('newest is mine')]),
        lastMessageRole: 'assistant' as const,
      };
      expect(getAgentPeekData(session)?.lastMessageRole).toBe('assistant');
    });

    it('derives user from a loaded transcript when the wire field is absent', () => {
      const session = makeSession([
        makeAssistantMessage([{ type: 'text', text: 'previous answer' }]),
        makeUserMessage('follow-up question'),
      ]);
      expect(getAgentPeekData(session)?.lastMessageRole).toBe('user');
    });

    it('derives assistant when the newest transcript message is the reply', () => {
      const session = makeSession([
        makeUserMessage('question'),
        makeAssistantMessage([{ type: 'text', text: 'answer' }]),
      ]);
      expect(getAgentPeekData(session)?.lastMessageRole).toBe('assistant');
    });

    it('treats trailing system/error rows as transparent', () => {
      const systemMessage = {
        id: 's1',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'housekeeping' } as any],
        timestamp: new Date().toISOString(),
      } as AgentMessage;
      const session = makeSession([makeUserMessage('newest real message'), systemMessage]);
      expect(getAgentPeekData(session)?.lastMessageRole).toBe('user');
    });

    it('is undefined with no wire field and no transcript (older daemon)', () => {
      expect(getAgentPeekData(makeSession([]))?.lastMessageRole).toBeUndefined();
    });
  });

  describe('wire preview fallback (AgentLite §5.5 lastAgentResponse/lastUserMessage)', () => {
    function makeUserMessage(text: string): AgentMessage {
      return {
        id: 'u1',
        role: 'user',
        contentBlocks: [{ type: 'text', text } as any],
        timestamp: new Date().toISOString(),
      } as AgentMessage;
    }

    it('falls back to wire lastAgentResponse when the transcript has no assistant message', () => {
      const session = {
        ...makeSession([makeUserMessage('initial delegation prompt')]),
        lastAgentResponse: 'Real last response from the wire',
      };
      const data = getAgentPeekData(session);
      expect(data?.lastResponse).toBe('Real last response from the wire');
      // Transcript-derived user message stays authoritative
      expect(data?.lastUserMessage).toBe('initial delegation prompt');
    });

    it('falls back to wire fields when the transcript is empty', () => {
      const session = {
        ...makeSession([]),
        lastAgentResponse: 'wire response',
        lastUserMessage: 'wire user message',
      };
      const data = getAgentPeekData(session);
      expect(data?.lastResponse).toBe('wire response');
      expect(data?.lastUserMessage).toBe('wire user message');
    });

    it('keeps the transcript-derived response when an assistant message exists', () => {
      const session = {
        ...makeSession([makeAssistantMessage([{ type: 'text', text: 'transcript answer' }])]),
        lastAgentResponse: 'stale wire response',
      };
      expect(getAgentPeekData(session)?.lastResponse).toBe('transcript answer');
    });

    it('does not override a tool-only transcript assistant message', () => {
      const session = {
        ...makeSession([
          makeAssistantMessage([
            { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
          ]),
        ]),
        lastAgentResponse: 'stale wire response',
      };
      const data = getAgentPeekData(session);
      expect(data?.lastResponse).toBe('');
      expect(data?.lastToolUse?.name).toBe('view');
    });

    it('extracts a digest from the wire fallback text', () => {
      const session = {
        ...makeSession([]),
        lastAgentResponse: 'Full details here <agent_digest>Concise summary</agent_digest>',
      };
      const data = getAgentPeekData(session);
      expect(data?.digest).toBe('Concise summary');
      expect(data?.lastResponse).toBe('Full details here');
    });

    it('fabricates nothing when both transcript and wire fields are absent', () => {
      const data = getAgentPeekData(makeSession([]));
      expect(data?.lastResponse).toBe('');
      expect(data?.lastUserMessage).toBe('');
      expect(data?.digest).toBeUndefined();
    });
  });
});
