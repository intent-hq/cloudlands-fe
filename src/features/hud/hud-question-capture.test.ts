import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import { extractQuestionsFromStreamEnd, HUD_QUESTION_MIME } from './hud-question-capture';

const WS_ID = '11111111-1111-4111-8111-111111111111';

/** §7.1 question resource block, wire-shaped. */
function questionBlock(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'resource',
    resource: {
      uri: 'intent-question://tar-3f9c2a81d0b4',
      name: 'Auth method',
      mimeType: HUD_QUESTION_MIME,
      text: JSON.stringify(payload),
    },
  };
}

function streamEnd(data: Record<string, unknown>, type = 'agent:stream:end'): WorkspaceEvent {
  return {
    type,
    workspaceId: WS_ID,
    id: 'evt-1',
    timestamp: '2026-07-30T12:00:00.000Z',
    actor: { type: 'system' },
    data,
  } as WorkspaceEvent;
}

const QUESTION_PAYLOAD = {
  attachmentId: 'tar-3f9c2a81d0b4',
  header: 'Auth method',
  question: 'Which authentication method should the new endpoint use?',
  options: [{ label: 'OAuth' }, { label: 'API key' }],
  multiSelect: false,
};

describe('extractQuestionsFromStreamEnd (PROTOCOL §7 / §7.1)', () => {
  it('extracts a question block from trailingBlocks', () => {
    const questions = extractQuestionsFromStreamEnd(
      streamEnd({
        agentId: 'agent-1',
        messageId: 'msg-1',
        trailingBlocks: [questionBlock(QUESTION_PAYLOAD)],
      }),
    );
    expect(questions).toEqual([
      {
        workspaceId: WS_ID,
        agentId: 'agent-1',
        messageId: 'msg-1',
        header: 'Auth method',
        question: 'Which authentication method should the new endpoint use?',
        ts: '2026-07-30T12:00:00.000Z',
      },
    ]);
  });

  it('keeps wire order across multiple question blocks', () => {
    const questions = extractQuestionsFromStreamEnd(
      streamEnd({
        agentId: 'agent-1',
        messageId: 'msg-1',
        trailingBlocks: [
          questionBlock({ ...QUESTION_PAYLOAD, question: 'First?' }),
          questionBlock({ ...QUESTION_PAYLOAD, question: 'Second?' }),
        ],
      }),
    );
    expect(questions.map((q) => q.question)).toEqual(['First?', 'Second?']);
  });

  it('skips non-question resources and undecodable payloads', () => {
    const proposal = {
      type: 'resource',
      resource: {
        uri: 'intent-proposal://x/y',
        mimeType: 'application/vnd.intent.proposal+json',
        text: '{}',
      },
    };
    const broken = {
      type: 'resource',
      resource: { uri: 'intent-question://tar-x', mimeType: HUD_QUESTION_MIME, text: '{nope' },
    };
    const missingFields = questionBlock({ attachmentId: 'tar-x', header: 'H' });
    const questions = extractQuestionsFromStreamEnd(
      streamEnd({
        agentId: 'agent-1',
        trailingBlocks: [proposal, broken, missingFields, questionBlock(QUESTION_PAYLOAD)],
      }),
    );
    expect(questions).toHaveLength(1);
  });

  it('returns [] for other event types, absent trailingBlocks, or missing identity', () => {
    expect(
      extractQuestionsFromStreamEnd(
        streamEnd({ agentId: 'a', trailingBlocks: [questionBlock(QUESTION_PAYLOAD)] }, 'agent:idle'),
      ),
    ).toEqual([]);
    expect(extractQuestionsFromStreamEnd(streamEnd({ agentId: 'agent-1' }))).toEqual([]);
    expect(
      extractQuestionsFromStreamEnd(streamEnd({ trailingBlocks: [questionBlock(QUESTION_PAYLOAD)] })),
    ).toEqual([]);
  });
});
