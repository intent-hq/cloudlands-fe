import { describe, it, expect } from 'vitest';
import type { AgentMessage, MessageAuthor, MessageMetadata } from '$shared/types';
import { findPreviousUserMessage, isAutomatedChatMessage } from '$lib/utils/previous-user-message';
import {
  collectMessageAuthors,
  getHumanMessageAuthor,
  getMessageAuthorLabel,
  getQueuedMessageAuthor,
  getQueueSurfaceAuthors,
} from '$lib/utils/message-authorship';

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

describe('getHumanMessageAuthor', () => {
  // PROTOCOL §5.5 serve-time projection (intent-hq/intentd#1869): every user
  // row carries `author`, resolved from `metadata.fromPrincipalId`.
  const author: MessageAuthor = {
    principalId: 'principal-guest',
    login: 'guest',
    displayName: 'Guest User',
    avatarUrl: 'https://avatars.example/guest.png',
  };

  it('returns the daemon projection verbatim for a human-typed user row', () => {
    const row = { ...msg('u1', 'user', 'hi', { fromPrincipalId: 'principal-guest' }), author };
    expect(getHumanMessageAuthor(row)).toBe(author);
  });

  it('returns null for rows without a projection (optimistic or older daemon)', () => {
    expect(getHumanMessageAuthor(msg('u1', 'user', 'hi'))).toBeNull();
    expect(getHumanMessageAuthor(null)).toBeNull();
    expect(getHumanMessageAuthor(undefined)).toBeNull();
  });

  it('returns null for non-user rows even when a projection is present', () => {
    expect(getHumanMessageAuthor({ ...msg('a1', 'assistant', 'ack'), author })).toBeNull();
  });

  it('returns null for automated user rows (the projection falls back to the owner)', () => {
    expect(
      getHumanMessageAuthor({
        ...msg('w1', 'user', 'x', { type: 'agent_message', fromAgentId: 'agent-1' }),
        author,
      }),
    ).toBeNull();
    expect(
      getHumanMessageAuthor({ ...msg('w2', 'user', 'x', { type: 'hook_wake' }), author }),
    ).toBeNull();
    expect(
      getHumanMessageAuthor({ ...msg('w3', 'user', 'x', { source: 'system' }), author }),
    ).toBeNull();
  });

  it('keeps the Q&A wizard answer row human-authored', () => {
    expect(
      getHumanMessageAuthor({ ...msg('q1', 'user', 'x', { type: 'question_answers' }), author }),
    ).toBe(author);
  });

  it('rejects a projection without a principal id', () => {
    const malformed = { ...msg('u1', 'user', 'hi'), author: { login: 'guest' } } as AgentMessage;
    expect(getHumanMessageAuthor(malformed)).toBeNull();
  });
});

describe('getMessageAuthorLabel', () => {
  it('prefers displayName, then login, then null for a vanished principal', () => {
    expect(
      getMessageAuthorLabel({
        principalId: 'p',
        login: 'guest',
        displayName: 'Guest User',
        avatarUrl: null,
      }),
    ).toBe('Guest User');
    expect(
      getMessageAuthorLabel({
        principalId: 'p',
        login: 'guest',
        displayName: null,
        avatarUrl: null,
      }),
    ).toBe('guest');
    expect(
      getMessageAuthorLabel({
        principalId: 'p',
        login: 'guest',
        displayName: '  ',
        avatarUrl: null,
      }),
    ).toBe('guest');
    expect(
      getMessageAuthorLabel({
        principalId: 'gone',
        login: null,
        displayName: null,
        avatarUrl: null,
      }),
    ).toBeNull();
  });
});

describe('collectMessageAuthors / getQueuedMessageAuthor', () => {
  // Queue entries carry only the daemon's `messageMetadata.fromPrincipalId`
  // stamp (intent-hq/intentd#1869); the queue surface resolves the author
  // from the projections the transcript already carries.
  const guest: MessageAuthor = {
    principalId: 'principal-guest',
    login: 'guest',
    displayName: 'Guest User',
    avatarUrl: null,
  };
  const owner: MessageAuthor = {
    principalId: 'principal-owner',
    login: 'owner',
    displayName: 'Owner Person',
    avatarUrl: 'https://avatars.example/owner.png',
  };
  const transcript: AgentMessage[] = [
    { ...msg('u1', 'user', 'hi', { fromPrincipalId: owner.principalId }), author: owner },
    msg('a1', 'assistant', 'ack'),
    { ...msg('u2', 'user', 'hello', { fromPrincipalId: guest.principalId }), author: guest },
    // Agent-to-agent row: the daemon still attaches an author, but it is not a
    // human-authored row and must not seed the map.
    {
      ...msg('w1', 'user', 'wake', { type: 'agent_message', fromAgentId: 'agent-2' }),
      author: { principalId: 'principal-bot', login: null, displayName: null, avatarUrl: null },
    },
    msg('u3', 'user', 'optimistic row without projection'),
  ];

  it('keys the transcript projections by principal id, human rows only', () => {
    const authors = collectMessageAuthors(transcript);
    expect([...authors.keys()].sort()).toEqual([guest.principalId, owner.principalId].sort());
    expect(authors.get(guest.principalId)).toBe(guest);
    expect(authors.get(owner.principalId)).toBe(owner);
  });

  it('resolves a stamped, user-authored queue entry against the map', () => {
    const authors = collectMessageAuthors(transcript);
    expect(
      getQueuedMessageAuthor({ messageMetadata: { fromPrincipalId: guest.principalId } }, authors),
    ).toBe(guest);
    expect(
      getQueuedMessageAuthor(
        { messageMetadata: { fromPrincipalId: owner.principalId, queueInfo: { position: 0 } } },
        authors,
      ),
    ).toBe(owner);
  });

  it('yields null for unstamped, unresolvable, daemon-origin or ungated entries', () => {
    const authors = collectMessageAuthors(transcript);
    expect(getQueuedMessageAuthor({}, authors)).toBeNull();
    expect(
      getQueuedMessageAuthor({ messageMetadata: { fromPrincipalId: '' } }, authors),
    ).toBeNull();
    expect(
      getQueuedMessageAuthor({ messageMetadata: { fromPrincipalId: 'principal-new' } }, authors),
    ).toBeNull();
    expect(
      getQueuedMessageAuthor(
        {
          messageMetadata: {
            type: 'agent_message',
            fromAgentId: 'agent-2',
            fromPrincipalId: guest.principalId,
          },
        },
        authors,
      ),
    ).toBeNull();
    expect(
      getQueuedMessageAuthor(
        { messageMetadata: { source: 'system', fromPrincipalId: guest.principalId } },
        authors,
      ),
    ).toBeNull();
    // Not gated on (single-member workspace passes no map).
    expect(
      getQueuedMessageAuthor({ messageMetadata: { fromPrincipalId: guest.principalId } }, null),
    ).toBeNull();
    expect(getQueuedMessageAuthor(null, authors)).toBeNull();
  });

  it("prefers the entry's own author projection, with no transcript history", () => {
    // The daemon serves the projection next to the stamp on the queue entry,
    // so a member whose first message is queued before any of their transcript
    // rows exist — or whose rows fall outside the loaded window — is attributed.
    const stamped = {
      messageMetadata: { fromPrincipalId: guest.principalId },
      author: guest,
    };
    expect(getQueuedMessageAuthor(stamped, collectMessageAuthors([]))).toBe(guest);
    // The projection wins over a stale transcript copy of the same principal.
    const renamed: MessageAuthor = { ...guest, displayName: 'Guest Renamed' };
    expect(
      getQueuedMessageAuthor(
        { ...stamped, author: renamed },
        new Map([[guest.principalId, guest]]),
      ),
    ).toBe(renamed);
    // The surface gate still applies (single-member workspace).
    expect(getQueuedMessageAuthor(stamped, null)).toBeNull();
  });

  it('ignores the projection on daemon-origin entries and falls back on a malformed one', () => {
    expect(
      getQueuedMessageAuthor(
        {
          messageMetadata: { type: 'agent_message', fromAgentId: 'agent-2' },
          author: owner,
        },
        collectMessageAuthors([]),
      ),
    ).toBeNull();
    expect(
      getQueuedMessageAuthor(
        { messageMetadata: { source: 'system' }, author: owner },
        collectMessageAuthors([]),
      ),
    ).toBeNull();
    const authors = collectMessageAuthors(transcript);
    expect(
      getQueuedMessageAuthor(
        { messageMetadata: { fromPrincipalId: owner.principalId }, author: { login: 'owner' } },
        authors,
      ),
    ).toBe(owner);
    expect(
      getQueuedMessageAuthor(
        { messageMetadata: { fromPrincipalId: owner.principalId }, author: 'owner' },
        authors,
      ),
    ).toBe(owner);
  });

  it('gates the queue surface on the membership boundary', () => {
    expect(getQueueSurfaceAuthors(undefined, transcript)).toBeNull();
    expect(getQueueSurfaceAuthors(null, transcript)).toBeNull();
    expect(getQueueSurfaceAuthors(1, transcript)).toBeNull();
    const two = getQueueSurfaceAuthors(2, transcript);
    expect(two).toBeInstanceOf(Map);
    expect([...two!.keys()].sort()).toEqual([guest.principalId, owner.principalId].sort());
    // On with nothing loaded yet: an empty map, not null — projections still resolve.
    const empty = getQueueSurfaceAuthors(3, []);
    expect(empty).toBeInstanceOf(Map);
    expect(empty!.size).toBe(0);
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
