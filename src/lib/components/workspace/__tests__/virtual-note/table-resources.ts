import type { JSONContent } from '@tiptap/core';
import { TABLE_NODE_LIMIT } from './table-transfer';

/** Bounds for the native table/paragraph/inline schema exercised by this proof.
 * Eight admitted annotations can split each text leaf at sixteen endpoints.
 * Each resulting segment needs at most one annotation span and one element per mark.
 * TableView owns wrapper/table/colgroup/tbody plus its admitted column elements;
 * paragraphs allow both ProseMirror trailing hacks, cells allow resize handles.
 * Column expansion is reported separately: this is not an arbitrary-colspan guarantee.
 */
export function tableResourceBound(doc: JSONContent) {
  let nodes = 0,
    elements = 0,
    textNodes = 0,
    columns = 0,
    supported = true;
  const marks = new Set(['bold', 'italic', 'strike', 'code', 'link', 'underline']);
  const visit = (node: JSONContent) => {
    nodes++;
    if (node.marks?.some((mark) => !marks.has(mark.type))) supported = false;
    switch (node.type) {
      case 'doc':
        break;
      case 'table': {
        const width = (node.content?.[0]?.content ?? []).reduce(
          (n, cell) => n + Number(cell.attrs?.colspan ?? 1),
          0,
        );
        if (!Number.isSafeInteger(width) || width < 0) supported = false;
        else {
          columns += width;
          elements += width + 4;
        }
        break;
      }
      case 'tableRow':
      case 'hardBreak':
        elements++;
        break;
      case 'tableCell':
      case 'tableHeader':
        elements += 2;
        break;
      case 'paragraph':
        elements += 3;
        break;
      case 'text':
        textNodes += 17;
        elements += 17 * (1 + (node.marks?.length ?? 0));
        break;
      default:
        supported = false;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return { nodes, elements, textNodes, columns, supported };
}
export function tableNodeBudget(doc: JSONContent) {
  const result = tableResourceBound(doc);
  if (result.nodes > TABLE_NODE_LIMIT)
    throw new Error('Proof table projection exceeds node budget');
  return result;
}
export function measureTableDOM(root: HTMLElement, bound: ReturnType<typeof tableResourceBound>) {
  const elements = root.querySelectorAll('*').length;
  let textNodes = 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) textNodes++;
  if (bound.supported && (elements > bound.elements || textNodes > bound.textNodes))
    throw new Error('Native table DOM exceeds schema-derived bound');
  return { elements, textNodes };
}
