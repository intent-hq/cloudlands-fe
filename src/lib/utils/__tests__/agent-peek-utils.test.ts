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

function makeUserMessage(text: string): AgentMessage {
  return {
    id: 'u1',
    role: 'user',
    contentBlocks: [{ type: 'text', text } as any],
    timestamp: new Date().toISOString(),
  } as AgentMessage;
}

describe('getAgentPeekData', () => {
  it('returns null for a null agent', () => {
    expect(getAgentPeekData(null)).toBeNull();
    expect(getAgentPeekData(undefined)).toBeNull();
  });

  it('serves the wire preview fields verbatim', () => {
    const session = {
      ...makeSession([]),
      lastAgentResponse: 'wire response',
      lastUserMessage: 'wire user message',
      digest: 'Wire digest summary',
      lastMessageRole: 'assistant' as const,
    };
    const data = getAgentPeekData(session);
    expect(data?.lastResponse).toBe('wire response');
    expect(data?.lastUserMessage).toBe('wire user message');
    expect(data?.digest).toBe('Wire digest summary');
    expect(data?.lastMessageRole).toBe('assistant');
  });

  it('returns empty previews for an empty session', () => {
    const session = makeSession([]);
    const data = getAgentPeekData(session);
    expect(data?.lastResponse).toBe('');
    expect(data?.lastUserMessage).toBe('');
    expect(data?.lastToolUse).toBeUndefined();
    expect(data?.digest).toBeUndefined();
    expect(data?.lastMessageRole).toBeUndefined();
  });

  it('does not expose derived activity state', () => {
    const session = makeSession([]);
    const data = getAgentPeekData(session);
    expect(data).not.toHaveProperty('isActive');
    expect(data?.status).toBe(AgentStatus.Active);
  });

  it('passes messages and fileChanges through unchanged', () => {
    const messages = [makeUserMessage('hello'), makeAssistantMessage([{ type: 'text', text: 'hi' }])];
    const session = {
      ...makeSession(messages),
      fileChanges: [{ path: 'src/a.ts', type: 'modify' as const, timestamp: '2026-08-18T00:00:00Z' }],
    };
    const data = getAgentPeekData(session);
    expect(data?.messages).toBe(messages);
    expect(data?.fileChanges).toEqual([
      { path: 'src/a.ts', action: 'modify', timestamp: '2026-08-18T00:00:00Z' },
    ]);
  });

  describe('wire authority over the loaded transcript', () => {
    it('previews the cleaned wire text over a transcript ending in a suggested-prompts block (monorepo#2843)', () => {
      // The daemon's clean_response_text strips the multi-line
      // <!-- suggested-prompts --> block before serving lastAgentResponse;
      // the hydrated transcript still carries the raw text. The preview must
      // render the cleaned wire text, never a suggested-prompt line.
      const rawText = [
        'Here is the actual final answer line.',
        '',
        '<!-- suggested-prompts',
        '- Try running the tests',
        '- Open a PR',
        '-->',
      ].join('\n');
      const session = {
        ...makeSession([makeAssistantMessage([{ type: 'text', text: rawText }])]),
        lastAgentResponse: 'Here is the actual final answer line.',
      };
      const data = getAgentPeekData(session);
      expect(data?.lastResponse).toBe('Here is the actual final answer line.');
      expect(data?.lastResponse).not.toContain('suggested-prompts');
      expect(data?.lastResponse).not.toContain('Open a PR');
    });

    it('never derives lastResponse from transcript messages when the wire field is absent', () => {
      const session = makeSession([
        makeAssistantMessage([{ type: 'text', text: 'transcript answer' }]),
      ]);
      expect(getAgentPeekData(session)?.lastResponse).toBe('');
    });

    it('never derives lastUserMessage from transcript messages when the wire field is absent', () => {
      const session = makeSession([makeUserMessage('transcript user message')]);
      expect(getAgentPeekData(session)?.lastUserMessage).toBe('');
    });

    it('never derives a digest from transcript messages', () => {
      const session = makeSession([
        makeAssistantMessage([
          { type: 'text', text: 'answer <agent_digest>Transcript digest</agent_digest>' },
        ]),
      ]);
      expect(getAgentPeekData(session)?.digest).toBeUndefined();
    });

    it('never derives lastToolUse from transcript tool_use blocks', () => {
      const session = makeSession([
        makeAssistantMessage([
          { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
        ]),
      ]);
      expect(getAgentPeekData(session)?.lastToolUse).toBeUndefined();
    });

    it('prefers the wire lastAgentResponse over a hydrated transcript', () => {
      const session = {
        ...makeSession([makeAssistantMessage([{ type: 'text', text: 'transcript answer' }])]),
        lastAgentResponse: 'cleaned wire response',
      };
      expect(getAgentPeekData(session)?.lastResponse).toBe('cleaned wire response');
    });

    it('prefers the wire lastUserMessage over a hydrated transcript', () => {
      const session = {
        ...makeSession([makeUserMessage('transcript user message')]),
        lastUserMessage: 'wire user message',
      };
      expect(getAgentPeekData(session)?.lastUserMessage).toBe('wire user message');
    });

    it('does not re-extract <agent_digest> from the wire response text', () => {
      // The daemon strips digest spans at the source; the FE serves the wire
      // fields verbatim without a defensive extraction pass.
      const session = {
        ...makeSession([]),
        lastAgentResponse: 'Body <agent_digest>Embedded digest</agent_digest>',
        digest: 'Wire digest summary',
      };
      const data = getAgentPeekData(session);
      expect(data?.lastResponse).toBe('Body <agent_digest>Embedded digest</agent_digest>');
      expect(data?.digest).toBe('Wire digest summary');
    });
  });

  describe('lastMessageRole (wire field, served verbatim)', () => {
    it('passes the wire lastMessageRole through verbatim', () => {
      const session = { ...makeSession([]), lastMessageRole: 'user' as const };
      expect(getAgentPeekData(session)?.lastMessageRole).toBe('user');
    });

    it('is undefined when the wire field is absent, even with a loaded transcript', () => {
      const session = makeSession([
        makeUserMessage('question'),
        makeAssistantMessage([{ type: 'text', text: 'answer' }]),
      ]);
      expect(getAgentPeekData(session)?.lastMessageRole).toBeUndefined();
    });
  });

  describe('lastToolUse (wire field, streaming/idle gating)', () => {
    it('renders the tool chip from the wire lastToolUse when idle with no response text', () => {
      const session = {
        ...makeSession([]),
        lastToolUse: { name: 'str-replace-editor', input: { path: 'src/x.ts' } },
      };
      const data = getAgentPeekData(session);
      expect(data?.lastToolUse?.id).toBe('wire-tool:agent-1');
      expect(data?.lastToolUse?.name).toBe('str-replace-editor');
      expect((data?.lastToolUse?.input as any)?.path).toBe('src/x.ts');
      expect(data?.lastResponse).toBe('');
    });

    it('keeps response text ahead of the wire lastToolUse preview', () => {
      const session = {
        ...makeSession([]),
        lastAgentResponse: 'wire response',
        lastToolUse: { name: 'view' },
      };
      const data = getAgentPeekData(session);
      expect(data?.lastResponse).toBe('wire response');
      expect(data?.lastToolUse).toBeUndefined();
    });

    it('lets the live streaming overlay win and clears lastResponse', () => {
      const session = {
        ...makeSession([]),
        isStreaming: true,
        lastAgentResponse: 'previous turn response',
        lastToolUse: { name: 'launch-process', status: 'running' },
      };
      const data = getAgentPeekData(session);
      expect(data?.lastToolUse?.id).toBe('live-tool:agent-1');
      expect(data?.lastToolUse?.name).toBe('launch-process');
      expect(data?.lastResponse).toBe('');
    });
  });
});
