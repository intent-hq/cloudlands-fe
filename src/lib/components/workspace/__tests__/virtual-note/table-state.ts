import type { JSONContent } from '@tiptap/core';
import { tableRuns, type TableFragment } from './table-source';

const length = (node: JSONContent) => (node.type === 'hardBreak' ? 1 : (node.text?.length ?? 0));
function slice(nodes: JSONContent[], from: number, to: number) {
  let cursor = 0;
  const result: JSONContent[] = [];
  for (const node of nodes) {
    const end = cursor + length(node);
    if (end > from && cursor < to)
      result.push(
        node.type === 'text'
          ? {
              ...node,
              text: node.text!.slice(Math.max(0, from - cursor), Math.min(end, to) - cursor),
            }
          : { ...node },
      );
    cursor = end;
  }
  return result;
}
function join(nodes: JSONContent[]) {
  const result: JSONContent[] = [];
  for (const node of nodes) {
    const previous = result.at(-1);
    if (
      node.type === 'text' &&
      previous?.type === 'text' &&
      JSON.stringify(node.marks ?? []) === JSON.stringify(previous.marks ?? [])
    )
      previous.text += node.text!;
    else result.push(structuredClone(node));
  }
  return result;
}

/** Mock backing only: splice an admitted native fragment into its backing cell record. */
export function patchTableCell(
  source: string,
  fragment: TableFragment,
  existing: JSONContent | undefined,
  next: JSONContent,
) {
  const original: JSONContent = existing ?? {
    type: fragment.row === 0 ? 'tableHeader' : 'tableCell',
    attrs: next.attrs,
    content: [
      {
        type: 'paragraph',
        content: tableRuns(source, fragment.body).map((run) => ({
          type: run.hardBreak ? 'hardBreak' : 'text',
          ...(run.hardBreak ? {} : { text: run.text }),
          marks: run.marks,
        })),
      },
    ],
  };
  const first = fragment.runs[0],
    last = fragment.runs.at(-1);
  const firstBlock = fragment.blocks?.[0].index ?? first?.block ?? 0,
    lastBlock = fragment.blocks?.at(-1)?.index ?? last?.block ?? firstBlock;
  const from = first && (first.block ?? 0) === firstBlock ? (first.offset ?? 0) : 0,
    to = last && (last.block ?? 0) === lastBlock ? (last.offset ?? 0) + last.text.length : 0;
  const paragraphs = structuredClone(next.content ?? [{ type: 'paragraph' }]);
  const before = slice(original.content![firstBlock].content ?? [], 0, from);
  const after = slice(original.content![lastBlock].content ?? [], to, Infinity);
  paragraphs[0].content = join([...before, ...(paragraphs[0].content ?? [])]);
  paragraphs.at(-1)!.content = join([...(paragraphs.at(-1)!.content ?? []), ...after]);
  return {
    ...original,
    attrs: next.attrs,
    content: [
      ...original.content!.slice(0, firstBlock),
      ...paragraphs,
      ...original.content!.slice(lastBlock + 1),
    ],
  };
}
