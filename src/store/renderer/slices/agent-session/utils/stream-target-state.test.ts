import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentSession } from '$shared/types';
import {
  findInFlightAssistantMessage,
  findStreamTargetAssistantMessage,
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

  describe('findStreamTargetAssistantMessage', () => {
    it('prefers the exact in-flight match on the canonical assistantMessageId', () => {
      const stale = assistant({ id: 'msg_stale', appMessageId: undefined, isStreaming: true });
      const target = assistant({ id: 'msg_live', appMessageId: undefined, isStreaming: true });
      expect(findStreamTargetAssistantMessage(session([stale, target]), undefined, 'msg_live')).toBe(
        target,
      );
    });

    it('refuses a stale in-flight row bound to a DIFFERENT canonical id when only assistantMessageId is known', () => {
      const stale = assistant({ id: 'msg_stale', appMessageId: undefined, isStreaming: true });
      expect(
        findStreamTargetAssistantMessage(session([stale]), undefined, 'msg_new'),
      ).toBeUndefined();
    });

    it('still binds a local optimistic placeholder (non-canonical id) via the first-in-flight fallback', () => {
      const optimistic = assistant({ id: 'local-uuid', appMessageId: undefined, isStreaming: true });
      expect(findStreamTargetAssistantMessage(session([optimistic]), undefined, 'msg_new')).toBe(
        optimistic,
      );
    });

    it('keeps the appMessageId lookup path when assistantAppMessageId is provided', () => {
      const target = assistant({ id: 'msg_other', appMessageId: 'app-live', isStreaming: true });
      expect(findStreamTargetAssistantMessage(session([target]), 'app-live', 'msg_new')).toBe(
        target,
      );
    });
  });
});