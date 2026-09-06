import { describe, it, expect } from 'vitest';
import type { AgentMessage, MessageMetadata } from '$shared/types';
import { findPreviousUserMessage, isAutomatedChatMessage } from '$lib/utils/previous-user-message';

// PROTOCOL §5.5-shaped transcript rows: id/role/timestamp always present,
// content carried in contentBlocks (canonical `text` field).
function msg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  metadata?: MessageMetadata,
): AgentMessage {
  return {
    id,
    role,
    timestamp: '2026-08-18T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text }],
    ...(metadata ? { metadata } : {}),
  };
}

describe('isAutomatedChatMessage', () => {
  it('treats plain user-typed messages as user-authored', () => {
    expect(isAutomatedChatMessage(msg('m1', 'user', 'hello'))).toBe(false);
    expect(isAutomatedChatMessage(msg('m2', 'user', 'hi', { model: 'x' }))).toBe(false);
  });

  it('flags messages with a string metadata.type as automated', () => {
    expect(
      isAutomatedChatMessage(
        msg('m1', 'user', '[WORKSPACE EVENTS] x', { type: 'event_notification' }),
      ),
    ).toBe(true);
    expect(isAutomatedChatMessage(msg('m2', 'user', 'wake', { type: 'pr_monitor_wake' }))).toBe(
      true,
    );
  });

  it('keeps question_answers user-authored despite its tag', () => {
    expect(
      isAutomatedChatMessage(
        msg('m1', 'user', 'answers', {
          type: 'question_answers',
          answeredQuestionsMessageId: 'q1',
        }),
      ),
    ).toBe(false);
  });

  it('keeps question_answers user-authored even alongside system/fromAgentId markers', () => {
    // Pins the gate ordering shared with isUserQueuedMessage: the
    // question_answers exception is applied before the other checks.
    expect(
      isAutomatedChatMessage(
        msg('m1', 'user', 'answers', { type: 'question_answers', source: 'system' }),
      ),
    ).toBe(false);
    expect(
      isAutomatedChatMessage(
        msg('m2', 'user', 'answers', { type: 'question_answers', fromAgentId: 'agent-123' }),
      ),
    ).toBe(false);
  });

  it('exempts question_answers from the legacy text-prefix fallback', () => {
    expect(
      isAutomatedChatMessage(
        msg('m1', 'user', '[AGENT MESSAGE] quoted text', { type: 'question_answers' }),
      ),
    ).toBe(false);
  });

  it('flags agent-origin (fromAgentId) and system-source messages as automated', () => {
    expect(
      isAutomatedChatMessage(msg('m1', 'user', 'from agent', { fromAgentId: 'agent-123' })),
    ).toBe(true);
    expect(isAutomatedChatMessage(msg('m2', 'user', 'sys', { source: 'system' }))).toBe(true);
    expect(isAutomatedChatMessage(msg('m3', 'user', 'ok', { fromAgentId: '  ' }))).toBe(false);
  });

  it('falls back to legacy text prefixes when metadata is missing', () => {
    expect(isAutomatedChatMessage(msg('m1', 'user', '[WORKSPACE EVENTS] file changed'))).toBe(true);
    expect(isAutomatedChatMessage(msg('m2', 'user', '[TASK WAKE] resume'))).toBe(true);
    expect(isAutomatedChatMessage(msg('m3', 'user', '[AGENT MESSAGE] hi'))).toBe(true);
    expect(isAutomatedChatMessage(msg('m4', 'user', 'normal text'))).toBe(false);
  });

  it('applies the legacy prefix fallback when metadata exists but carries no markers', () => {
    expect(
      isAutomatedChatMessage(msg('m1', 'user', '[WORKSPACE EVENTS] file changed', { model: 'x' })),
    ).toBe(true);
  });
});

describe('findPreviousUserMessage', () => {
  it('skips a wake row between two user messages', () => {
    const messages = [
      msg('u1', 'user', 'first question'),
      msg('a1', 'assistant', 'answer'),
      msg('w1', 'user', '[WORKSPACE EVENTS] x', { type: 'event_notification' }),
      msg('a2', 'assistant', 'wake reply'),
      msg('u2', 'user', 'second question'),
    ];
    expect(findPreviousUserMessage(messages, 'u2')?.id).toBe('u1');
  });

  it('treats question_answers rows as user-authored jump targets', () => {
    const messages = [
      msg('q1', 'user', 'answers', { type: 'question_answers' }),
      msg('a1', 'assistant', 'ok'),
      msg('u2', 'user', 'next'),
    ];
    expect(findPreviousUserMessage(messages, 'u2')?.id).toBe('q1');
  });

  it('starts from the current row position when it is itself automated', () => {
    const messages = [
      msg('u1', 'user', 'typed'),
      msg('a1', 'assistant', 'reply'),
      msg('w1', 'user', '[TASK WAKE] resume', { type: 'task_wake' }),
    ];
    expect(findPreviousUserMessage(messages, 'w1')?.id).toBe('u1');
  });

  it('returns null when no user-authored message precedes the current one', () => {
    const messages = [
      msg('w1', 'user', 'sys', { source: 'system' }),
      msg('u1', 'user', 'first typed'),
    ];
    expect(findPreviousUserMessage(messages, 'u1')).toBeNull();
    expect(findPreviousUserMessage(messages, 'w1')).toBeNull();
  });

  it('returns null when the current message id is not in the list', () => {
    const messages = [msg('u1', 'user', 'typed')];
    expect(findPreviousUserMessage(messages, 'missing')).toBeNull();
  });

  it('skips agent-origin rows without a type tag', () => {
    const messages = [
      msg('u1', 'user', 'typed'),
      msg('agent-row', 'user', 'from sibling', { fromAgentId: 'agent-9' }),
      msg('u2', 'user', 'latest'),
    ];
    expect(findPreviousUserMessage(messages, 'u2')?.id).toBe('u1');
  });
});
