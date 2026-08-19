import { describe, expect, it } from 'vitest';
import {
  getReleasedWorkspaceTabMove,
  getWorkspaceTabInsertionIndex,
  proposeWorkspaceTabOrder,
} from './workspace-tab-drag';

describe('workspace tab drag geometry', () => {
  const slots = [
    { id: 'one', centerX: 80 },
    { id: 'three', centerX: 404 },
  ];

  it('uses the dragged tab center and preserves the pointer grab offset', () => {
    expect(getWorkspaceTabInsertionIndex(130, 30, 160, slots)).toBe(1);
    expect(getWorkspaceTabInsertionIndex(353, 30, 160, slots)).toBe(1);
    expect(getWorkspaceTabInsertionIndex(355, 30, 160, slots)).toBe(2);
  });

  it('clamps the proposed slot while preserving every tab exactly once', () => {
    const order = ['one', 'two', 'three'];
    expect(proposeWorkspaceTabOrder(order, 'two', -1)).toEqual(['two', 'one', 'three']);
    expect(proposeWorkspaceTabOrder(order, 'two', 99)).toEqual(['one', 'three', 'two']);
    expect(order).toEqual(['one', 'two', 'three']);
  });

  it('converts only a changed released order into one relative persisted move', () => {
    const original = ['one', 'two', 'three'];
    expect(getReleasedWorkspaceTabMove(original, original, 'one')).toBeNull();
    expect(getReleasedWorkspaceTabMove(original, ['two', 'one', 'three'], 'one')).toEqual({
      targetId: 'three',
      placement: 'before',
    });
    expect(getReleasedWorkspaceTabMove(original, ['two', 'three', 'one'], 'one')).toEqual({
      targetId: 'three',
      placement: 'after',
    });
  });
});
