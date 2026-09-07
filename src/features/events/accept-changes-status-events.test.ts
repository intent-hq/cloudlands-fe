import { describe, expect, it } from 'vitest';

import { isAcceptChangesStatusEvent } from './accept-changes-status-events';

describe('isAcceptChangesStatusEvent', () => {
  it.each([
    'git:commit',
    'git:pull',
    'git:branch',
    'pr:linked',
    'pr:updated',
    'pr:unlinked',
    'changes:git-status',
  ])('accepts the status-invalidating event %s', (type) =>
    expect(isAcceptChangesStatusEvent(type)).toBe(true),
  );

  it.each(['changes:tracked', 'file:changed', 'workspace:updated', 'agent:idle'])(
    'rejects the irrelevant event %s',
    (type) => expect(isAcceptChangesStatusEvent(type)).toBe(false),
  );
});
