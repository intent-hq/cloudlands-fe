import { expect, it } from 'vitest';
import { nextFileTreeIndex, parentFileTreeIndex } from './file-tree-navigation';

it('shares source sentinel skipping and parent depth semantics', () => {
  const rows = [
    { node: { path: 'a' }, depth: 0 },
    { node: { path: 'creating' }, depth: 1 },
    { node: { path: 'a/b' }, depth: 1 },
    { node: { path: 'a/b/c' }, depth: 2 },
  ];
  expect(nextFileTreeIndex(rows, 0, 1, 'creating')).toBe(2);
  expect(parentFileTreeIndex(rows, 3, 'creating')).toBe(2);
  expect(parentFileTreeIndex(rows, 2, 'creating')).toBe(0);
  expect(parentFileTreeIndex(rows, 0)).toBe(-1);
  expect(nextFileTreeIndex(rows, 3, 1)).toBe(3);
});
