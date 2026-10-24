import { describe, expect, it } from 'vitest';
import { presentQueuedMessageText } from '../collaborator-sender-attribution';

const OWNER = 'principal-owner';
const AUTHOR = {
  principalId: 'principal-member',
  login: 'panghy',
  displayName: 'Clement Pang',
  avatarUrl: null,
  identity: { provider: 'github', host: 'github.com', externalUserId: '526899' },
};
// Daemon templates (intentd harness v1 / v2_9, PROTOCOL §5.5) for AUTHOR.
const MEMBER_PREAMBLE =
  'Message from @panghy (Clement Pang), a host member (principal principal-member; github@github.com user 526899) — not the workspace owner.';
const GUEST_PREAMBLE =
  'Message from @panghy (Clement Pang), a collaborator (guest) of this workspace — not the workspace owner.';
const BODY = 'can you make each loop a bit tighter, you seem to be doing a lot in each round';
const metadata = { fromPrincipalId: AUTHOR.principalId };

describe('presentQueuedMessageText', () => {
  it('drops the host member preamble from a non-owner queued entry', () => {
    const text = `${MEMBER_PREAMBLE}\n\n${BODY}`;
    expect(
      presentQueuedMessageText({ author: AUTHOR, messageMetadata: metadata }, text, OWNER),
    ).toBe(BODY);
  });

  it('drops the guest preamble from a non-owner queued entry', () => {
    const { identity: _identity, ...guest } = AUTHOR;
    const text = `${GUEST_PREAMBLE}\n\n${BODY}`;
    expect(
      presentQueuedMessageText({ author: guest, messageMetadata: metadata }, text, OWNER),
    ).toBe(BODY);
  });

  it('keeps multi-line bodies and their whitespace intact', () => {
    const body = '  first line\n\nsecond line\n';
    const text = `${MEMBER_PREAMBLE}\n\n${body}`;
    expect(
      presentQueuedMessageText({ author: AUTHOR, messageMetadata: metadata }, text, OWNER),
    ).toBe(body);
  });

  it('never strips the workspace owner own prose', () => {
    const text = `${MEMBER_PREAMBLE}\n\n${BODY}`;
    expect(
      presentQueuedMessageText(
        { author: AUTHOR, messageMetadata: metadata },
        text,
        AUTHOR.principalId,
      ),
    ).toBe(text);
  });

  it.each([null, undefined, '', '  '])('strips nothing when the owner is %p', (owner) => {
    const text = `${MEMBER_PREAMBLE}\n\n${BODY}`;
    expect(
      presentQueuedMessageText({ author: AUTHOR, messageMetadata: metadata }, text, owner),
    ).toBe(text);
  });

  it.each([
    ['missing author', { messageMetadata: metadata }],
    ['null author', { author: null, messageMetadata: metadata }],
    ['agent-origin metadata', { author: AUTHOR, messageMetadata: { fromAgentId: 'agent-1' } }],
    ['system event metadata', { author: AUTHOR, messageMetadata: { type: 'event_notification' } }],
  ])('strips nothing for %s', (_label, queued) => {
    const text = `${MEMBER_PREAMBLE}\n\n${BODY}`;
    expect(presentQueuedMessageText(queued, text, OWNER)).toBe(text);
  });

  it('strips nothing when the queued entry is absent', () => {
    expect(presentQueuedMessageText(null, `${MEMBER_PREAMBLE}\n\n${BODY}`, OWNER)).toBe(
      `${MEMBER_PREAMBLE}\n\n${BODY}`,
    );
  });

  it.each([
    ['a different principal', MEMBER_PREAMBLE.replace('principal-member', 'principal-other')],
    ['a different login', MEMBER_PREAMBLE.replace('@panghy', '@someone')],
    ['a single newline separator', null],
    ['no separator', null],
  ])('keeps a lookalike first line (%s)', (label, preamble) => {
    const text =
      label === 'a single newline separator'
        ? `${MEMBER_PREAMBLE}\n${BODY}`
        : label === 'no separator'
          ? MEMBER_PREAMBLE
          : `${preamble}\n\n${BODY}`;
    expect(
      presentQueuedMessageText({ author: AUTHOR, messageMetadata: metadata }, text, OWNER),
    ).toBe(text);
  });

  it('presents a delivery group text independently of the entry content', () => {
    const queued = { author: AUTHOR, messageMetadata: metadata };
    expect(presentQueuedMessageText(queued, `${MEMBER_PREAMBLE}\n\nfirst`, OWNER)).toBe('first');
    expect(presentQueuedMessageText(queued, 'second, no preamble', OWNER)).toBe(
      'second, no preamble',
    );
  });

  it('does not mutate the queued entry', () => {
    const queued = { author: AUTHOR, messageMetadata: metadata };
    const snapshot = JSON.stringify(queued);
    presentQueuedMessageText(queued, `${MEMBER_PREAMBLE}\n\n${BODY}`, OWNER);
    expect(JSON.stringify(queued)).toBe(snapshot);
  });
  it('drops the repeated line inside a same-sender merged entry', () => {
    // The daemon annotates each send before enqueueing, then merges
    // same-principal appends as `content + "\n\n" + incoming.content`.
    const text = `${MEMBER_PREAMBLE}\n\nfirst\n\n${MEMBER_PREAMBLE}\n\nsecond`;
    expect(
      presentQueuedMessageText({ author: AUTHOR, messageMetadata: metadata }, text, OWNER),
    ).toBe('first\n\nsecond');
  });

  it('keeps an interior line when the entry does not start with it', () => {
    const text = `first\n\n${MEMBER_PREAMBLE}\n\nsecond`;
    expect(
      presentQueuedMessageText({ author: AUTHOR, messageMetadata: metadata }, text, OWNER),
    ).toBe(text);
  });
});
