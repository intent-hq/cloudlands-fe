import { describe, expect, it } from 'vitest';
import {
  getReleasedWorkspaceTabMove,
  getWorkspaceTabAutoScrollDelta,
  getWorkspaceTabInsertionIndex,
  proposeWorkspaceTabOrder,
} from './workspace-tab-drag';

describe('workspace tab drag geometry', () => {
  const slots = [
    { id: 'one', centerX: 80 },
    { id: 'three', centerX: 404 },
  ];

  it('uses the dragged tab center and preserves the pointer grab offset', () => {
    expect(getWorkspaceTabInsertionIndex(-100, 30, 160, slots)).toBe(0);
    expect(getWorkspaceTabInsertionIndex(29, 30, 160, slots)).toBe(0);
    expect(getWorkspaceTabInsertionIndex(30, 30, 160, slots)).toBe(1);
    expect(getWorkspaceTabInsertionIndex(130, 30, 160, slots)).toBe(1);
    expect(getWorkspaceTabInsertionIndex(353, 30, 160, slots)).toBe(1);
    expect(getWorkspaceTabInsertionIndex(355, 30, 160, slots)).toBe(2);
    expect(getWorkspaceTabInsertionIndex(900, 30, 160, slots)).toBe(2);
  });

  it('calculates proportional overflow scrolling at both strip edges', () => {
    expect(getWorkspaceTabAutoScrollDelta(300, 100, 500)).toBe(0);
    expect(getWorkspaceTabAutoScrollDelta(124, 100, 500)).toBe(-9);
    expect(getWorkspaceTabAutoScrollDelta(476, 100, 500)).toBe(9);
    expect(getWorkspaceTabAutoScrollDelta(90, 100, 500)).toBe(-18);
    expect(getWorkspaceTabAutoScrollDelta(510, 100, 500)).toBe(18);
    expect(getWorkspaceTabAutoScrollDelta(100, 500, 100)).toBe(0);
  });

  it('clamps the proposed slot while preserving every tab exactly once', () => {
    const order = ['one', 'two', 'three'];
    expect(proposeWorkspaceTabOrder(order, 'two', -1)).toEqual(['two', 'one', 'three']);
    expect(proposeWorkspaceTabOrder(order, 'two', 99)).toEqual(['one', 'three', 'two']);
    expect(order).toEqual(['one', 'two', 'three']);
  });

  it('converts both released endpoint directions into one relative persisted move', () => {
    const original = ['one', 'two', 'three', 'four'];
    expect(getReleasedWorkspaceTabMove(original, original, 'three')).toBeNull();
    expect(getReleasedWorkspaceTabMove(original, ['three', 'one', 'two', 'four'], 'three')).toEqual(
      {
        targetId: 'one',
        placement: 'before',
      },
    );
    expect(getReleasedWorkspaceTabMove(original, ['one', 'two', 'four', 'three'], 'three')).toEqual(
      {
        targetId: 'four',
        placement: 'after',
      },
    );
  });
});
