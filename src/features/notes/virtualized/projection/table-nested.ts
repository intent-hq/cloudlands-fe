import type { JSONContent } from '@tiptap/core';
export type TablePath = Array<{ index: number; type: string; attrs?: JSONContent['attrs'] }>;
/** External backing traversal. Only paths for admitted leaves enter a window. */
export function tableParagraphLeaves(cell: JSONContent) {
  const leaves: Array<{ node: JSONContent; path: TablePath }> = [];
  const visit = (parent: JSONContent, path: TablePath) => {
    for (const [index, node] of (parent.content ?? []).entries()) {
      const next = [
        ...path,
        { index, type: node.type!, ...(node.attrs ? { attrs: node.attrs } : {}) },
      ];
      if (node.type === 'paragraph') leaves.push({ node, path: next });
      else if (['table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type!))
        visit(node, next);
      else throw new Error('Unrepresented native table block');
    }
  };
  visit(cell, []);
  return leaves;
}
/** Renderer assembly uses only bounded ancestor descriptors and admitted inline data. */
export function nestedTableContent(blocks: Array<{ path: TablePath; node: JSONContent }>) {
  const root: JSONContent = { content: [] };
  const children = new Map<JSONContent, Map<number, JSONContent>>();
  for (const block of blocks) {
    let parent = root;
    for (const [at, part] of block.path.entries()) {
      let siblings = children.get(parent);
      if (!siblings) children.set(parent, (siblings = new Map()));
      let node = siblings.get(part.index);
      if (!node) {
        node =
          at === block.path.length - 1
            ? block.node
            : { type: part.type, ...(part.attrs ? { attrs: part.attrs } : {}), content: [] };
        siblings.set(part.index, node);
        parent.content!.push(node);
      }
      parent = node;
    }
  }
  return root.content!;
}

/** Backing-only native walk; emits one leaf at a time, never a renderer ancestry index. */
function visitTableParagraphs(
  cell: import('@tiptap/pm/model').Node,
  visit: (
    node: import('@tiptap/pm/model').Node,
    position: number,
    path: number[],
    block: number,
  ) => void,
) {
  let block = 0;
  const walk = (parent: import('@tiptap/pm/model').Node, start: number, path: number[]) => {
    parent.forEach((node, offset, index) => {
      const next = [...path, index],
        position = start + offset;
      if (node.type.name === 'paragraph') visit(node, position + 1, next, block++);
      else if (['table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type.name))
        walk(node, position + 1, next);
      else throw new Error('Unrepresented native table block');
    });
  };
  walk(cell, 0, []);
}
export function tableTextPoint(cell: import('@tiptap/pm/model').Node, position: number) {
  let result: { block: number; offset: number; path?: number[]; textOffset: number } | undefined;
  let textOffset = 0,
    nested = false;
  visitTableParagraphs(cell, (node, at, path, block) => {
    nested ||= path.length > 1;
    if (position >= at && position <= at + node.content.size)
      result = { block, offset: position - at, path, textOffset: textOffset + position - at };
    textOffset += node.content.size;
  });
  if (!result) throw new Error('Native table point is outside a paragraph');
  if (!nested) delete result.path;
  return result;
}
export function tablePointPosition(
  cell: import('@tiptap/pm/model').Node,
  point: { block: number; offset: number; path?: number[] },
) {
  let result: number | undefined;
  visitTableParagraphs(cell, (node, at, path, block) => {
    if (block !== point.block) return;
    if (
      (point.path && JSON.stringify(path) !== JSON.stringify(point.path)) ||
      !Number.isSafeInteger(point.offset) ||
      point.offset < 0 ||
      point.offset > node.content.size
    )
      throw new Error('Stale nested table point');
    result = at + point.offset;
  });
  if (result === undefined) throw new Error('Missing native table paragraph');
  return result;
}

/** The production outer-cell flatten omits descendant marker atoms. Their live
 * widths remain in logical PM offsets; primary source offsets exclude them. */
export function tableFlattenedTextOffset(cell: import('@tiptap/pm/model').Node, position: number) {
  let offset = tableTextPoint(cell, position).textOffset;
  visitTableParagraphs(cell, (paragraph, at, path) => {
    if (path.length === 1) return;
    paragraph.forEach((node, childOffset) => {
      if (node.type.name === 'commentAnchor' && at + childOffset < position)
        offset -= node.nodeSize;
    });
  });
  return offset;
}
