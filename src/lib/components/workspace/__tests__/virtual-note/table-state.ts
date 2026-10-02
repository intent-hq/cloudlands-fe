import type { JSONContent } from '@tiptap/core';
import { tableRuns, type TableFragment } from './table-source';

export type TableInlineWrite = {
  revision: number;
  cell: number;
  body: number;
  end: number;
  nodeType: string;
  attrs: JSONContent['attrs'];
  block: number;
  from: number;
  to: number;
  content: JSONContent[];
};

export type TableParagraphWrite = Omit<TableInlineWrite, 'content'> & {
  lastBlock: number;
  paragraphs: JSONContent[];
};

/** Mock backing only: the request contains changed paragraph boundaries/inline
 * content, never the unchanged prefix or suffix of an oversized native cell. */
export function patchTableParagraphs(
  source: string,
  existing: JSONContent | undefined,
  edit: TableParagraphWrite,
) {
  const original: JSONContent = existing ?? {
    type: edit.nodeType,
    attrs: edit.attrs,
    content: [
      {
        type: 'paragraph',
        content: tableRuns(source, edit.body).map((run) => ({
          type: run.hardBreak ? 'hardBreak' : 'text',
          ...(run.hardBreak ? {} : { text: run.text }),
          marks: run.marks,
        })),
      },
    ],
  };
  const first = original.content?.[edit.block],
    last = original.content?.[edit.lastBlock];
  const total = (node: JSONContent) =>
    (node.content ?? []).reduce((n, child) => n + length(child), 0);
  if (
    !first ||
    !last ||
    edit.lastBlock < edit.block ||
    edit.from < 0 ||
    edit.to < 0 ||
    edit.from > total(first) ||
    edit.to > total(last) ||
    (edit.block === edit.lastBlock && edit.to < edit.from) ||
    !edit.paragraphs.length ||
    edit.paragraphs.some(
      (p) =>
        p.type !== 'paragraph' ||
        (p.content ?? []).some((n) => n.type !== 'text' && n.type !== 'hardBreak'),
    )
  )
    throw new Error('Invalid native table paragraph range');
  const paragraphs = structuredClone(edit.paragraphs);
  paragraphs[0].content = join([
    ...slice(first.content ?? [], 0, edit.from),
    ...(paragraphs[0].content ?? []),
  ]);
  paragraphs.at(-1)!.content = join([
    ...(paragraphs.at(-1)!.content ?? []),
    ...slice(last.content ?? [], edit.to, Infinity),
  ]);
  return {
    ...original,
    content: [
      ...original.content!.slice(0, edit.block),
      ...paragraphs,
      ...original.content!.slice(edit.lastBlock + 1),
    ],
  };
}

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

/** Mock backing only. The renderer sends native inline changes, never the full cell. */
export function patchTableInline(
  source: string,
  existing: JSONContent | undefined,
  edit: TableInlineWrite,
) {
  const original: JSONContent = existing ?? {
    type: edit.nodeType,
    attrs: edit.attrs,
    content: [
      {
        type: 'paragraph',
        content: tableRuns(source, edit.body).map((run) => ({
          type: run.hardBreak ? 'hardBreak' : 'text',
          ...(run.hardBreak ? {} : { text: run.text }),
          marks: run.marks,
        })),
      },
    ],
  };
  const paragraph = original.content?.[edit.block];
  const nodes = paragraph?.content ?? [];
  if (
    !paragraph ||
    edit.from < 0 ||
    edit.to < edit.from ||
    edit.to > nodes.reduce((n, node) => n + length(node), 0)
  )
    throw new Error('Invalid native table inline range');
  return {
    ...original,
    content: original.content!.map((node, index) =>
      index === edit.block
        ? {
            ...node,
            content: join([
              ...slice(nodes, 0, edit.from),
              ...edit.content,
              ...slice(nodes, edit.to, Infinity),
            ]),
          }
        : node,
    ),
  };
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
