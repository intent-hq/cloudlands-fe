import { tableRuns, type TableFragment, type TableRun } from './table-source';
import { bytes } from './bounded-note-service';

export type RunContext = { before: string; after: string; offset: number; block?: number };
export const tableRunWork = { calls: 0, bytes: 0, maxBytes: 0 };
export function deriveTableRuns(raw: string, first: number, context: RunContext, measure = true) {
  const input = context.before + raw + context.after;
  if (measure) {
    const size = bytes(input);
    tableRunWork.calls++;
    tableRunWork.bytes += size;
    tableRunWork.maxBytes = Math.max(tableRunWork.maxBytes, size);
  }
  let offset = context.offset;
  return tableRuns(input, first - context.before.length).map((run) => {
    const mapped: TableRun = {
      ...run,
      offset,
      ...(context.block === undefined ? {} : { block: context.block }),
    };
    offset += run.text.length;
    return mapped;
  });
}
const signature = (runs: TableRun[]) =>
  JSON.stringify(
    runs.map((r) => [
      r.from,
      r.to,
      r.text,
      r.marks,
      r.offset ?? 0,
      r.block ?? 0,
      r.hardBreak ?? false,
      r.code ?? null,
    ]),
  );
/** Backing-side validation: use compact syntax only when it reconstructs every exact run. */
export function compactRunContext(cell: TableFragment): RunContext | undefined {
  if (!cell.runs.length || (cell.blocks?.length ?? 1) > 1) return undefined;
  const first = cell.runs[0],
    last = cell.runs.at(-1)!;
  if (
    [...first.marks, ...last.marks].some(
      (m) => !['bold', 'italic', 'strike', 'code'].includes(m.type),
    )
  )
    return undefined;
  const expected = signature(cell.runs);
  for (const bold of ['**', '__'])
    for (const italic of ['_', '*'])
      for (const code of ['`', '``']) {
        const delimiters: Record<string, string> = { bold, italic, code, strike: '~~' };
        const context: RunContext = {
          before: first.marks.map((m) => delimiters[m.type]).join(''),
          after: [...last.marks]
            .reverse()
            .map((m) => delimiters[m.type])
            .join(''),
          offset: first.offset ?? 0,
          ...(first.block === undefined ? {} : { block: first.block }),
        };
        if (signature(deriveTableRuns(cell.raw, cell.first, context, false)) === expected)
          return context;
      }
  return undefined;
}

export type ParagraphRunContext = [number, number, RunContext];
/** Each admitted paragraph gets only its bounded source interval and boundary
 * syntax. Empty paragraphs stay in the separate structural block list. */
export function compactParagraphContexts(cell: TableFragment): ParagraphRunContext[] | undefined {
  if ((cell.blocks?.length ?? 0) < 2) return undefined;
  const parts: ParagraphRunContext[] = [];
  const restored: TableRun[] = [];
  for (const block of cell.blocks!) {
    const runs = cell.runs.filter((r) => r.block === block.index);
    if (!runs.length) continue;
    const first = runs[0].from,
      last = runs.at(-1)!.to;
    const raw = cell.raw.slice(first - cell.first, last - cell.first);
    const context = compactRunContext({ ...cell, first, last, raw, runs, blocks: undefined });
    if (!context) return undefined;
    parts.push([first, last, context]);
    restored.push(...deriveTableRuns(raw, first, context, false));
  }
  return signature(restored) === signature(cell.runs) ? parts : undefined;
}
