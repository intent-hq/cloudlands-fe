import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  generateUniqueId,
  generateUniqueIds,
} from '../unique-id';

describe('generateUniqueId', () => {
  it('should generate ID with prefix', () => {
    const id = generateUniqueId('test');
    expect(id).toMatch(/^test-[a-z0-9]{9}$/);
  });

  it('should generate unique IDs on each call', () => {
    const id1 = generateUniqueId('test');
    const id2 = generateUniqueId('test');
    expect(id1).not.toBe(id2);
  });

  it('should respect custom length', () => {
    const id = generateUniqueId('test', 5);
    expect(id).toMatch(/^test-[a-z0-9]{5}$/);
  });

  it('should handle empty prefix', () => {
    const id = generateUniqueId('');
    expect(id).toMatch(/^-[a-z0-9]{9}$/);
  });

  it('should handle special characters in prefix', () => {
    const id = generateUniqueId('task-menu-anchor');
    expect(id).toMatch(/^task-menu-anchor-[a-z0-9]{9}$/);
  });
});

describe('generateUniqueIds', () => {
  it('should generate multiple IDs with same suffix', () => {
    const ids = generateUniqueIds(['anchor', 'popover']);

    expect(ids).toHaveProperty('anchor');
    expect(ids).toHaveProperty('popover');

    // Extract suffixes
    const anchorSuffix = ids.anchor.replace('anchor-', '');
    const popoverSuffix = ids.popover.replace('popover-', '');

    // Should have same suffix
    expect(anchorSuffix).toBe(popoverSuffix);
  });

  it('should generate IDs for all prefixes', () => {
    const prefixes = ['one', 'two', 'three'];
    const ids = generateUniqueIds(prefixes);

    expect(Object.keys(ids)).toEqual(prefixes);
    expect(ids.one).toMatch(/^one-[a-z0-9]{9}$/);
    expect(ids.two).toMatch(/^two-[a-z0-9]{9}$/);
    expect(ids.three).toMatch(/^three-[a-z0-9]{9}$/);
  });

  it('should respect custom length', () => {
    const ids = generateUniqueIds(['test'], 5);
    expect(ids.test).toMatch(/^test-[a-z0-9]{5}$/);
  });

  it('should handle empty array', () => {
    const ids = generateUniqueIds([]);
    expect(ids).toEqual({});
  });

  it('should handle single prefix', () => {
    const ids = generateUniqueIds(['single']);
    expect(ids).toHaveProperty('single');
    expect(ids.single).toMatch(/^single-[a-z0-9]{9}$/);
  });
});
