import { describe, expect, it } from 'vitest';
import { getAgentMessageAttribution } from './agent-message-attribution';

describe('getAgentMessageAttribution', () => {
  it('preserves ordinary agent attribution', () => {
    expect(
      getAgentMessageAttribution({
        type: 'agent_message',
        fromAgentId: 'agent-builder',
        fromAgentName: 'Builder',
      }),
    ).toEqual({ kind: 'agent', fromAgentId: 'agent-builder', displayName: 'Builder' });
  });

  it('extracts complete Chief attribution and its canonical source link', () => {
    const sourceUrl = 'intent://local/__chief__/agent/agent-chief/message/msg-source';

    expect(
      getAgentMessageAttribution({
        type: 'chief_message',
        fromAgentId: 'agent-chief',
        fromAgentName: 'Chief of Staff',
        fromWorkspaceId: '__chief__',
        sourceMessageId: 'msg-source',
        sourceUrl,
      }),
    ).toEqual({ kind: 'chief', fromAgentId: 'agent-chief', sourceUrl });
  });

  it.each([
    { fromWorkspaceId: '__chief__', sourceMessageId: 'msg-source' },
    { fromWorkspaceId: '__chief__', sourceMessageId: 'msg-source', sourceUrl: 'not-a-link' },
    {
      fromWorkspaceId: 'wrong-workspace',
      sourceMessageId: 'msg-source',
      sourceUrl: 'intent://local/wrong-workspace/agent/agent-chief/message/msg-source',
    },
  ])('keeps the Chief label but omits unsafe source navigation for %o', (sourceMetadata) => {
    expect(
      getAgentMessageAttribution({
        type: 'chief_message',
        fromAgentId: 'agent-chief',
        ...sourceMetadata,
      }),
    ).toEqual({ kind: 'chief', fromAgentId: 'agent-chief' });
  });

  it('falls back to a plain message when Chief sender identity is missing', () => {
    expect(
      getAgentMessageAttribution({ type: 'chief_message', sourceMessageId: 'msg-source' }),
    ).toBe(null);
  });
});
