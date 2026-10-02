import { describe, expect, it } from 'vitest';
import type { QueuedMessage } from '$shared/types';
import { queuedMessagePermissions } from './queued-message-permissions';

const human: QueuedMessage = {
  id: 'q',
  content: 'hello',
  queuedAt: '2026-10-02T00:00:00Z',
  position: 0,
  messageMetadata: { fromPrincipalId: 'alice' },
};

describe('shared queue action authority', () => {
  it.each([
    ['author', 'alice', 'owner', false, true, true, true],
    ['workspace owner on a guest host role', 'owner', 'owner', false, false, true, false],
    ['host owner', 'admin', 'owner', true, false, true, true],
    ['ordinary host member or workspace guest', 'bob', 'owner', false, false, false, false],
    ['unknown viewer', null, 'owner', true, false, false, false],
  ] as const)('%s', (_label, viewer, owner, admin, edit, remove, sendNow) => {
    expect(queuedMessagePermissions(human, viewer, owner, admin)).toEqual({
      edit,
      remove,
      sendNow,
    });
  });

  it('never treats an unknown or portable author as the viewer', () => {
    for (const message of [
      { ...human, messageMetadata: undefined, author: null },
      {
        ...human,
        author: { principalId: null, displayName: 'Alice', login: null, avatarUrl: null },
      },
    ]) {
      expect(queuedMessagePermissions(message, 'alice', 'owner')).toEqual({
        edit: false,
        remove: false,
        sendNow: false,
      });
    }
  });

  it('uses the served legacy author only when no principal stamp is available', () => {
    const author = { principalId: 'alice', displayName: 'Alice', login: null, avatarUrl: null };
    expect(
      queuedMessagePermissions({ ...human, messageMetadata: undefined, author }, 'alice', 'owner')
        .edit,
    ).toBe(true);
    expect(queuedMessagePermissions({ ...human, author }, 'bob', 'owner').edit).toBe(false);
  });
});
