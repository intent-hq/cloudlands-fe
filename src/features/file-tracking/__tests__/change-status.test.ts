import { describe, expect, it } from 'vitest';
import { mapStatusToAction } from '../utils/change-status';

describe('mapStatusToAction', () => {
  it.each([
    ['added', 'create'],
    ['deleted', 'delete'],
    ['modified', 'modify'],
    ['renamed', 'modify'],
    ['A', 'create'],
    ['D', 'delete'],
    ['M', 'modify'],
    [undefined, 'modify'],
  ] as const)('maps %s to %s', (status, action) => {
    expect(mapStatusToAction(status)).toBe(action);
  });
});
