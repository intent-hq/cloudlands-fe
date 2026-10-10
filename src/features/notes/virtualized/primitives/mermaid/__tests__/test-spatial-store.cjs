// TEST ONLY uniform-grid index over the captured region, not full-scene coverage.
const { isDeepStrictEqual } = require('node:util');
function rectangle(r) {
  return r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
}
async function queryStoredViewport(reader, descriptor, binding, rect) {
  if (!isDeepStrictEqual(binding, descriptor.binding)) throw new Error('Stale spatial binding');
  const g = descriptor.grid;
  if (
    !rectangle(rect) ||
    !rectangle(g) ||
    rect.x < g.x ||
    rect.y < g.y ||
    rect.x + rect.width > g.x + g.width ||
    rect.y + rect.height > g.y + g.height
  )
    throw new Error('Viewport outside captured coverage');
  if (
    ![g.rows, g.columns].every((n) => Number.isInteger(n) && n > 0) ||
    !Number.isInteger(descriptor.firstCell) ||
    descriptor.firstCell < 0
  )
    throw new Error('Invalid spatial grid');
  const w = g.width / g.columns,
    h = g.height / g.rows;
  const left = Math.floor((rect.x - g.x) / w),
    right = Math.ceil((rect.x + rect.width - g.x) / w);
  const top = Math.floor((rect.y - g.y) / h),
    bottom = Math.ceil((rect.y + rect.height - g.y) / h);
  if ((right - left) * (bottom - top) > 16) throw new Error('Spatial query exceeds fixture credit');
  const cells = [];
  for (let row = top; row < bottom; row++)
    for (let column = left; column < right; column++) {
      const page = await reader.read(
        'spatial-cell',
        descriptor.firstCell + row * g.columns + column,
        1,
      );
      const cell = page.records[0];
      if (
        !cell ||
        !isDeepStrictEqual(cell.binding, binding) ||
        cell.row !== row ||
        cell.column !== column
      )
        throw new Error('Invalid spatial cell ownership');
      cells.push(cell);
    }
  return { rect, cells };
}
module.exports = { queryStoredViewport };
