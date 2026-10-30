import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  SECRET_REQUEST_RESOURCE_MIME_TYPE,
  getSecretRequestFromResourceBlock,
  isSecretRequestResourceBlock,
  parseSecretListing,
} from '$shared/types/secret-request-resource';
import { prepareMessageBlocks } from '../../prepare-message-blocks';
import { deriveOpenSecretRequests, secretRequestCardState } from '../pending-secret-requests';
import { getSecretRequestNotice } from '../secret-request-notice';

function card(requestId: string, name = 'KEY') {
  return {
    type: 'resource',
    resource: {
      uri: `intent-secret-request://${requestId}`,
      name,
      mimeType: SECRET_REQUEST_RESOURCE_MIME_TYPE,
      text: JSON.stringify({ requestId, agentId: 'agent-a', name, reason: 'run tests' }),
    },
  };
}

function assistant(id: string, blocks: unknown[]): AgentMessage {
  return { id, role: 'assistant', contentBlocks: blocks } as unknown as AgentMessage;
}

function notice(id: string, type: string, requestId: string, name = 'KEY'): AgentMessage {
  return {
    id,
    role: 'user',
    metadata: { type, source: 'system', requestId, name },
    contentBlocks: [{ type: 'text', text: `The user provided secret ${name}.` }],
  } as unknown as AgentMessage;
}

describe('secret request resource blocks', () => {
  it('parses a well-formed card and rejects malformed payloads', () => {
    expect(getSecretRequestFromResourceBlock(card('sec-1'))).toEqual({
      requestId: 'sec-1',
      agentId: 'agent-a',
      name: 'KEY',
      reason: 'run tests',
    });
    const broken = { ...card('sec-2'), resource: { ...card('sec-2').resource, text: 'nope' } };
    expect(isSecretRequestResourceBlock(broken)).toBe(true);
    expect(getSecretRequestFromResourceBlock(broken)).toBeNull();
    expect(getSecretRequestFromResourceBlock({ type: 'text', text: 'x' })).toBeNull();
  });

  it('never renders cards in the transcript', () => {
    const blocks = prepareMessageBlocks(
      [{ type: 'text', text: 'I need a key.' }, card('sec-1')] as never,
      { role: 'assistant', isStreaming: false },
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
  });
});

describe('deriveOpenSecretRequests', () => {
  it('keeps requests no notice answered, de-duplicated by id', () => {
    const messages = [
      assistant('m1', [card('sec-1'), card('sec-2', 'OTHER')]),
      notice('n1', 'secret_provided', 'sec-1'),
      assistant('m2', [card('sec-2', 'OTHER')]),
    ];
    expect(deriveOpenSecretRequests(messages).map((r) => r.requestId)).toEqual(['sec-2']);
  });

  it('ignores cards on non-assistant rows', () => {
    const user = {
      id: 'u',
      role: 'user',
      contentBlocks: [card('sec-9')],
    } as unknown as AgentMessage;
    expect(deriveOpenSecretRequests([user])).toEqual([]);
  });
});

describe('secretRequestCardState', () => {
  const listing = parseSecretListing({
    secrets: [{ name: 'KEY' }],
    pendingRequests: [{ requestId: 'sec-p', name: 'P' }],
    answeredRequests: [{ requestId: 'sec-a', name: 'A', outcome: 'declined' }],
  });

  it('maps the listing to card states', () => {
    expect(secretRequestCardState('sec-p', null)).toBe('checking');
    expect(secretRequestCardState('sec-p', listing)).toBe('pending');
    expect(secretRequestCardState('sec-a', listing)).toBe('declined');
    expect(secretRequestCardState('sec-gone', listing)).toBe('expired');
  });

  it('drops malformed listing entries and never keeps a value field', () => {
    const parsed = parseSecretListing({
      secrets: [{ name: 'KEY', value: 'leak' }, { nope: 1 }],
      pendingRequests: [{ name: 'X' }],
      answeredRequests: [{ requestId: 'r', name: 'N', outcome: 'maybe' }],
    });
    expect(parsed).toEqual({
      secrets: [{ name: 'KEY' }],
      pendingRequests: [],
      answeredRequests: [],
    });
    expect(parseSecretListing('nope')).toBeNull();
  });
});

describe('getSecretRequestNotice', () => {
  it('reads the outcome from row or block metadata', () => {
    expect(getSecretRequestNotice(notice('n', 'secret_declined', 'sec-1'))).toEqual({
      outcome: 'declined',
      requestId: 'sec-1',
      name: 'KEY',
    });
    const blockOnly = {
      contentBlocks: [
        {
          type: 'text',
          text: 'x',
          messageMetadata: { type: 'secret_provided', requestId: 'sec-2', name: 'B' },
        },
      ],
    };
    expect(getSecretRequestNotice(blockOnly as never)?.outcome).toBe('provided');
    expect(getSecretRequestNotice({ metadata: { type: 'question_answers' } })).toBeNull();
  });
});
