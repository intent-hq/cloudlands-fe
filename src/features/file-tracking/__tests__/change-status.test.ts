import { describe, expect, it } from 'vitest';
import { isRenamedStatus, mapStatusToAction } from '../utils/change-status';

describe('isRenamedStatus', () => {
  it.each(['renamed', 'R'])('recognizes %s as a rename', (status) => {
    expect(isRenamedStatus(status)).toBe(true);
  });

  it.each(['modified', 'M', undefined])('does not classify %s as a rename', (status) => {
    expect(isRenamedStatus(status)).toBe(false);
  });
});

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
