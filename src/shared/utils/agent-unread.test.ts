import { describe, expect, it } from 'vitest';
import { deriveAgentHasUnread } from './agent-unread';

// Derivation contract (intent-hq/monorepo#1597):
// hasUnread = lastMessageRole === 'assistant' && lastMessageId != null &&
//             lastMessageId !== metadata.lastSeenMessageId
// An ABSENT seen marker counts as unread. Background agents and delegated
// child agents (metadata.createdByAgentId set) always derive false.
describe('deriveAgentHasUnread', () => {
  it('is unread when the assistant spoke last and the marker lags behind', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-9',
        metadata: { lastSeenMessageId: 'm-5' },
      }),
    ).toBe(true);
  });

  it('is read for a background agent even with an unseen assistant message', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-9',
        isBackground: true,
        metadata: { lastSeenMessageId: 'm-5' },
      }),
    ).toBe(false);
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-9',
        metadata: { lastSeenMessageId: 'm-5', isBackground: true },
      }),
    ).toBe(false);
  });

  it('is read for a delegated child agent even with an unseen assistant message', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-9',
        metadata: { lastSeenMessageId: 'm-5', createdByAgentId: 'agent-parent' },
      }),
    ).toBe(false);
  });

  it('ignores an empty-string / non-string createdByAgentId (not a child)', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-9',
        metadata: { lastSeenMessageId: 'm-5', createdByAgentId: '' },
      }),
    ).toBe(true);
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-9',
        metadata: { lastSeenMessageId: 'm-5', createdByAgentId: 42 },
      }),
    ).toBe(true);
  });

  it('is unread when the seen marker is absent (never marked seen)', () => {
    expect(deriveAgentHasUnread({ lastMessageRole: 'assistant', lastMessageId: 'm-1' })).toBe(true);
    expect(
      deriveAgentHasUnread({ lastMessageRole: 'assistant', lastMessageId: 'm-1', metadata: {} }),
    ).toBe(true);
  });

  it('is read when the marker matches the newest message id', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-9',
        metadata: { lastSeenMessageId: 'm-9' },
      }),
    ).toBe(false);
  });

  it('is read when the user spoke last, regardless of the marker', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'user',
        lastMessageId: 'm-9',
        metadata: { lastSeenMessageId: 'm-5' },
      }),
    ).toBe(false);
  });

  it('is read when lastMessageRole is absent (older daemon / empty session)', () => {
    expect(
      deriveAgentHasUnread({ lastMessageId: 'm-9', metadata: { lastSeenMessageId: 'm-5' } }),
    ).toBe(false);
  });

  it('is read when the daemon omits lastMessageId (older daemon — no exact signal)', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        metadata: { lastSeenMessageId: 'm-5' },
      }),
    ).toBe(false);
    expect(deriveAgentHasUnread({ lastMessageRole: 'assistant' })).toBe(false);
  });

  it('treats an empty-string lastMessageId as absent', () => {
    expect(deriveAgentHasUnread({ lastMessageRole: 'assistant', lastMessageId: '' })).toBe(false);
  });

  it('treats an empty-string seen marker as absent (counts as unread)', () => {
    expect(
      deriveAgentHasUnread({
        lastMessageRole: 'assistant',
        lastMessageId: 'm-1',
        metadata: { lastSeenMessageId: '' },
      }),
    ).toBe(true);
  });
});
