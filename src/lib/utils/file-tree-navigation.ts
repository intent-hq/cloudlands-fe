/** Navigation over the canonical flattened tree, including source creation sentinels. */
type TreeRow = { depth: number; node: { path: string } };

export function nextFileTreeIndex(
  rows: readonly TreeRow[],
  from: number,
  direction: 1 | -1,
  skippedPath?: string,
): number {
  for (let index = from + direction; index >= 0 && index < rows.length; index += direction) {
    if (rows[index].node.path !== skippedPath) return index;
  }
  return from;
}

export function parentFileTreeIndex(
  rows: readonly TreeRow[],
  from: number,
  skippedPath?: string,
): number {
  if (from < 0 || from >= rows.length || rows[from].depth === 0) return -1;
  for (let index = from - 1; index >= 0; index--) {
    if (rows[index].node.path !== skippedPath && rows[index].depth < rows[from].depth) return index;
  }
  return -1;
}
