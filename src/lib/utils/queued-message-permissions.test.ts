import { describe, expect, it } from 'vitest';
import type { QueuedMessage } from '$shared/types';
import {
  findQueuedMessageForEdit,
  queuedMessagePermissions,
  isQueuedMessageReadyForBatch,
} from './queued-message-permissions';

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

  it.each([{ type: 'custom' }, { source: 'system' }])(
    'keeps human action authority with semantic metadata %j',
    (metadata) => {
      const message = { ...human, messageMetadata: { ...human.messageMetadata, ...metadata } };
      expect(queuedMessagePermissions(message, 'alice', 'owner')).toEqual({
        edit: true,
        remove: true,
        sendNow: true,
      });
      expect(queuedMessagePermissions(message, 'bob', 'owner')).toEqual({
        edit: false,
        remove: false,
        sendNow: false,
      });
    },
  );

  it('does not grant host-owner send permission for script-monitor wakes', () => {
    expect(
      queuedMessagePermissions(
        {
          ...human,
          messageMetadata: { type: 'script_monitor_wake', monitorId: 'monitor-1' },
        },
        'admin',
        'owner',
        true,
      ),
    ).toEqual({ edit: false, remove: true, sendNow: false });
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

describe('active queue edit aliases', () => {
  const survivor = { ...human, id: 'older', editing: true, editingMessageId: 'newer' };
  it('resolves only the current mapped identity and applies canonical author permissions', () => {
    expect(findQueuedMessageForEdit([survivor], 'newer')).toBe(survivor);
    expect(findQueuedMessageForEdit([survivor], 'older')).toBeUndefined();
    expect(findQueuedMessageForEdit([survivor], 'unrelated')).toBeUndefined();
    expect(
      queuedMessagePermissions(findQueuedMessageForEdit([survivor], 'newer'), 'bob', 'owner').edit,
    ).toBe(false);
  });
  it('does not resurrect the absorbed alias after release or removal', () => {
    expect(
      findQueuedMessageForEdit(
        [{ ...survivor, editing: false, editingMessageId: undefined }],
        'newer',
      ),
    ).toBeUndefined();
    expect(findQueuedMessageForEdit([{ ...human, id: 'unrelated' }], 'newer')).toBeUndefined();
  });
});

describe('explicit batch readiness', () => {
  const now = Date.parse('2026-10-02T21:00:00Z');
  it.each([
    [{ editing: true }, false],
    [{ holdKind: 'debounce', holdUntil: '2026-10-02T21:01:00Z' }, false],
    [{ holdKind: 'debounce', holdUntil: '2026-10-02T21:00:00Z' }, true],
    [{ holdKind: 'debounce', holdUntil: 'invalid' }, true],
    [{ holdUntil: '2026-10-02T21:01:00Z' }, true],
    [{ messageMetadata: { humanAuthor: null } }, false],
    [{ messageMetadata: { humanAuthor: {}, fromPrincipalId: '' } }, false],
    [{ messageMetadata: { humanAuthor: {}, fromPrincipalId: ' ' } }, true],
    [{ messageMetadata: { type: 'script_monitor_wake', monitorId: '' } }, false],
    [{ messageMetadata: { type: 'script_monitor_wake' } }, true],
  ] as const)('matches daemon readiness for %j', (fields, ready) => {
    expect(isQueuedMessageReadyForBatch({ ...human, ...fields }, now)).toBe(ready);
  });
});
