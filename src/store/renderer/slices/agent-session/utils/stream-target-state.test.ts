import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentSession } from '$shared/types';
import {
  findInFlightAssistantMessage,
  isStaleFinalizedAssistantStream,
} from './stream-target-state';

function assistant(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    id: 'msg-default',
    appMessageId: 'app-default',
    role: 'assistant',
    timestamp: '2026-06-22T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text: 'content' }],
    ...overrides,
  } as AgentMessage;
}

function session(messages: AgentMessage[]): AgentSession {
  return { id: 'agent-1', workspaceId: 'ws-1' as any, messages } as AgentSession;
}

describe('stream target state utilities', () => {
  it('finds in-flight assistant messages by app message id', () => {
    const target = assistant({ appMessageId: 'app-live', isStreaming: true });
    expect(findInFlightAssistantMessage(session([target]), 'app-live')).toBe(target);
  });

  it('treats a completed assistant with the same app id as stale restored stream input', () => {
    const completed = assistant({
      appMessageId: 'app-complete',
      isStreaming: false,
      streamingComplete: true,
    });
    expect(isStaleFinalizedAssistantStream(session([completed]), 'app-complete')).toBe(true);
  });

  it('does not mark a new app id as stale just because the session is idle', () => {
    const completed = assistant({
      appMessageId: 'app-complete',
      isStreaming: false,
      streamingComplete: true,
    });
    expect(isStaleFinalizedAssistantStream(session([completed]), 'app-new')).toBe(false);
  });
});