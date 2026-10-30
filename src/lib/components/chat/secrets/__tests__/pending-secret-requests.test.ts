import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  SECRET_REQUEST_RESOURCE_MIME_TYPE,
  getSecretRequestFromResourceBlock,
  isSecretRequestResourceBlock,
  parseSecretListing,
} from '$shared/types/secret-request-resource';
import { prepareMessageBlocks } from '../../prepare-message-blocks';
import {
  deriveSecretRequestTranscript,
  isSecretStackCollapsed,
  secretRequestCardState,
  visibleSecretRequests,
} from '../pending-secret-requests';
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

function userText(id: string): AgentMessage {
  return {
    id,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hello' }],
  } as unknown as AgentMessage;
}

const openIds = (messages: AgentMessage[]) =>
  deriveSecretRequestTranscript(messages).open.map((r) => r.requestId);

describe('deriveSecretRequestTranscript', () => {
  it('keeps requests no notice answered, de-duplicated by id', () => {
    const messages = [
      assistant('m1', [card('sec-1'), card('sec-2', 'OTHER')]),
      notice('n1', 'secret_provided', 'sec-1'),
      assistant('m2', [card('sec-2', 'OTHER')]),
    ];
    const transcript = deriveSecretRequestTranscript(messages);
    expect(transcript.open.map((r) => r.requestId)).toEqual(['sec-2']);
    expect([...transcript.answered]).toEqual(['sec-1']);
  });

  it('ignores cards on non-assistant rows', () => {
    const user = {
      id: 'u',
      role: 'user',
      contentBlocks: [card('sec-9')],
    } as unknown as AgentMessage;
    expect(openIds([user])).toEqual([]);
  });

  it('marks a card superseded once a real user message follows it, not a notice', () => {
    const base = [assistant('m1', [card('sec-1')]), notice('n', 'secret_declined', 'sec-x')];
    expect(deriveSecretRequestTranscript(base).open[0]?.supersededByUser).toBe(false);
    const moved = [...base, userText('u1')];
    expect(deriveSecretRequestTranscript(moved).open[0]?.supersededByUser).toBe(true);
  });

  it('keeps the same transcript for messages with no secret requests', () => {
    const a = deriveSecretRequestTranscript([
      userText('u'),
      assistant('m', [{ type: 'text', text: 'x' }]),
    ]);
    const b = deriveSecretRequestTranscript([userText('u2')]);
    expect(a).toBe(b);
    expect(a.open).toEqual([]);
  });
});

describe('secretRequestCardState', () => {
  const listing = parseSecretListing({
    secrets: [{ name: 'KEY' }],
    pendingRequests: [{ requestId: 'sec-p', name: 'P' }],
    answeredRequests: [{ requestId: 'sec-a', name: 'A', outcome: 'declined' }],
  });

  const covering = (covered: string[]) => ({ listing, covered, failed: false });

  it('maps the listing to card states', () => {
    expect(secretRequestCardState('sec-p', null)).toBe('checking');
    expect(secretRequestCardState('sec-p', covering([]))).toBe('pending');
    expect(secretRequestCardState('sec-a', covering([]))).toBe('declined');
    expect(secretRequestCardState('sec-gone', covering(['sec-gone']))).toBe('expired');
  });

  it('keeps a request the listing may predate as checking, not expired', () => {
    expect(secretRequestCardState('sec-new', covering(['sec-p']))).toBe('checking');
  });

  it('lets the user answer when refreshes fail', () => {
    expect(secretRequestCardState('sec-new', { listing: null, covered: [], failed: true })).toBe(
      'pending',
    );
    expect(
      secretRequestCardState('sec-gone', { listing, covered: ['sec-gone'], failed: true }),
    ).toBe('expired');
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

describe('visibleSecretRequests', () => {
  const listing = parseSecretListing({
    secrets: [],
    pendingRequests: [
      { requestId: 'sec-1', name: 'KEY' },
      { requestId: 'sec-old', name: 'OLD' },
    ],
    answeredRequests: [],
  });
  const entry = { listing, covered: ['sec-1', 'sec-lost'], failed: false };

  it('adds pending requests whose card is outside the loaded page', () => {
    const transcript = deriveSecretRequestTranscript([assistant('m1', [card('sec-1')])]);
    expect(visibleSecretRequests(transcript, 'agent-a', entry, {})).toEqual([
      {
        request: { requestId: 'sec-1', agentId: 'agent-a', name: 'KEY', reason: 'run tests' },
        state: 'pending',
      },
      {
        request: { requestId: 'sec-old', agentId: 'agent-a', name: 'OLD', reason: '' },
        state: 'pending',
      },
    ]);
  });

  it('drops expired cards the user hid or moved past, never pending ones', () => {
    const lost = [assistant('m1', [card('sec-lost')])];
    const ids = (messages: AgentMessage[], hidden: Record<string, true> = {}) =>
      visibleSecretRequests(deriveSecretRequestTranscript(messages), 'agent-a', entry, hidden).map(
        (v) => `${v.request.requestId}:${v.state}`,
      );
    expect(ids(lost)).toEqual(['sec-lost:expired', 'sec-1:pending', 'sec-old:pending']);
    expect(ids(lost, { 'sec-lost': true })).toEqual(['sec-1:pending', 'sec-old:pending']);
    expect(ids([...lost, userText('u')])).toEqual(['sec-1:pending', 'sec-old:pending']);
    expect(ids([assistant('m', [card('sec-1')]), userText('u')])).toEqual([
      'sec-1:pending',
      'sec-old:pending',
    ]);
  });

  it('never re-adds a listed request that a notice already answered', () => {
    const transcript = deriveSecretRequestTranscript([notice('n', 'secret_provided', 'sec-old')]);
    expect(
      visibleSecretRequests(transcript, 'agent-a', entry, {}).map((v) => v.request.requestId),
    ).toEqual(['sec-1']);
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

describe('isSecretStackCollapsed', () => {
  it('stays collapsed while every showing request was showing when hidden', () => {
    expect(isSecretStackCollapsed(['a', 'b'], undefined)).toBe(false);
    expect(isSecretStackCollapsed(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isSecretStackCollapsed(['a'], ['a', 'b'])).toBe(true);
  });

  it('expands for a new request and never collapses an empty stack', () => {
    expect(isSecretStackCollapsed(['a', 'c'], ['a', 'b'])).toBe(false);
    expect(isSecretStackCollapsed([], ['a'])).toBe(false);
  });
});
