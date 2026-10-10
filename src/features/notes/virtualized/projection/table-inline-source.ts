import { Lexer } from 'marked';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import type { ReplaceStep } from '@tiptap/pm/transform';
import { processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { bytes } from './source-types';
import { scanTables, type TableFragment } from './table-source';
import type { TableProjection } from './table-projection';

export const tableEditWork = {
  calls: 0,
  maxSourceBytes: 0,
  maxHTMLBytes: 0,
  maxDetachedElements: 0,
};
/** Repair only touched inline token envelopes. Every input is already admitted;
 * detached serializer DOM is counted separately and never laid out or mounted.
 */
export function tableInlineSourcePatch(
  projection: TableProjection,
  cell: TableFragment,
  step: ReplaceStep,
  before: PMNode,
) {
  let from = projection.sourceAt(step.from, -1),
    to = projection.sourceAt(step.to);
  let cursor = cell.first;
  tableEditWork.calls++;
  tableEditWork.maxSourceBytes = Math.max(tableEditWork.maxSourceBytes, bytes(cell.raw));
  for (const token of Lexer.lexInline(cell.raw, { gfm: true })) {
    const end = cursor + token.raw.length;
    const touched = step.from === step.to ? cursor < from && end > from : cursor < to && end > from;
    if (touched && ['strong', 'em', 'del', 'link', 'codespan'].includes(token.type)) {
      from = Math.min(from, cursor);
      to = Math.max(to, end);
    }
    cursor = end;
  }
  if (from < cell.first || to > cell.last)
    throw new Error('Inline table repair requires boundary context');
  const left = projection.pmAt(from, 1),
    right = projection.pmAt(to, -1);
  const result = step.apply(before);
  if (!result.doc) throw new Error(result.failed ?? 'Invalid native table inline edit');
  const mapping = step.getMap();
  const content = result.doc.slice(mapping.map(left, -1), mapping.map(right, 1)).content;
  const container = document.createElement('div');
  container.append(DOMSerializer.fromSchema(before.type.schema).serializeFragment(content));
  const html = `<table><tr><td><p>${container.innerHTML}</p></td></tr></table>`;
  tableEditWork.maxHTMLBytes = Math.max(tableEditWork.maxHTMLBytes, bytes(html));
  tableEditWork.maxDetachedElements = Math.max(
    tableEditWork.maxDetachedElements,
    container.querySelectorAll('*').length,
  );
  const markdown = processHTMLToMarkdown(html).trim();
  const parsed = scanTables(markdown)[0]?.rows[0].cells[0];
  if (!parsed) throw new Error('Native table inline serialization produced no cell');
  return { from, to, insert: markdown.slice(parsed.body, parsed.end) };
}
