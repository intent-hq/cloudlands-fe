import {
  compactRunContext,
  compactParagraphContexts,
  deriveTableRuns,
  type RunContext,
  type ParagraphRunContext,
} from './table-run-context';
import type { TableFragment, TableWindow } from './table-source';
import { bytes } from './bounded-note-service';

export const tableAliasExpansionWork = { calls: 0, bytes: 0, maxBytes: 0, maxResidentBytes: 0 };

// Renderer cells retain this tuple, not an expanded object plus an encoded copy.
// Plain text provenance is derived from its source interval when requested.
type Extra = Partial<
  Omit<TableFragment, 'row' | 'column' | 'from' | 'to' | 'body' | 'raw' | 'align'>
> & {
  syntax?: RunContext;
  paragraphSyntax?: ParagraphRunContext[];
  aliasAtoms?: Array<[number, number, number, string, number]>;
};
type CellData = [number, number, number, number, number, string, (string | null)?, Extra?];
class PackedCell implements TableFragment {
  constructor(readonly data: CellData) {}
  get row() {
    return this.data[0];
  }
  get column() {
    return this.data[1];
  }
  get from() {
    return this.data[2];
  }
  get body() {
    return this.from + this.data[3];
  }
  get to() {
    return this.from + this.data[4];
  }
  get raw() {
    return this.data[5];
  }
  get align() {
    return this.data[6] ?? null;
  }
  get first() {
    return this.data[7]?.first ?? this.body;
  }
  get last() {
    return this.data[7]?.last ?? this.first + this.raw.length;
  }
  get end() {
    return this.data[7]?.end ?? this.body + this.raw.length;
  }
  get runs() {
    const atoms = this.data[7]?.aliasAtoms;
    if (atoms) {
      const runs = [
        ...(this.data[7]?.runs ?? []),
        ...atoms.map(([at, block, offset, id, emittedFrom]) => {
          const typeAt = id.lastIndexOf(':'),
            raw = `<!--anchor:${id}-->`;
          return {
            from: this.first + at,
            to: this.first + at,
            text: '\ufffc',
            marks: [],
            block,
            offset,
            anchor: { id, type: id.slice(typeAt + 1), commentId: id.slice(0, typeAt) },
            emitted: { from: emittedFrom, to: emittedFrom + raw.length, raw },
          };
        }),
      ].sort((a, b) => (a.block ?? 0) - (b.block ?? 0) || (a.offset ?? 0) - (b.offset ?? 0));
      const size = bytes(JSON.stringify(runs));
      tableAliasExpansionWork.calls++;
      tableAliasExpansionWork.bytes += size;
      tableAliasExpansionWork.maxBytes = Math.max(tableAliasExpansionWork.maxBytes, size);
      tableAliasExpansionWork.maxResidentBytes = Math.max(
        tableAliasExpansionWork.maxResidentBytes,
        size + bytes(JSON.stringify(this.data)),
      );
      return runs;
    }
    const paragraphs = this.data[7]?.paragraphSyntax;
    if (paragraphs)
      return paragraphs.flatMap(([first, last, context]) =>
        deriveTableRuns(this.raw.slice(first - this.first, last - this.first), first, context),
      );
    const context = this.data[7]?.syntax;
    if (context) return deriveTableRuns(this.raw, this.first, context);
    return (
      this.data[7]?.runs ??
      (this.raw
        ? [
            {
              from: this.first,
              to: this.last,
              text: this.raw,
              marks: [],
              offset: this.first - this.body,
            },
          ]
        : [])
    );
  }
  get owner() {
    return this.data[7]?.owner;
  }
  get partial() {
    return this.data[7]?.partial;
  }
  get mounted() {
    return this.data[7]?.mounted;
  }
  get rowSpan() {
    return this.data[7]?.rowSpan;
  }
  get span() {
    return this.data[7]?.span;
  }
  get blocks() {
    return this.data[7]?.blocks;
  }
  get blockCount() {
    return this.data[7]?.blockCount;
  }
  get attrs() {
    return this.data[7]?.attrs;
  }
  get nodeType() {
    return this.data[7]?.nodeType;
  }
  toJSON() {
    return this.data;
  }
}
function packTableCell(c: TableFragment): TableFragment {
  if (c instanceof PackedCell) return c;
  const extra: Extra = {};
  if (c.first !== c.body) extra.first = c.first;
  if (c.last !== c.first + c.raw.length) extra.last = c.last;
  if (c.end !== c.body + c.raw.length) extra.end = c.end;
  const plain =
    c.runs.length === 1 &&
    c.runs[0].from === c.first &&
    c.runs[0].to === c.last &&
    c.runs[0].text === c.raw &&
    !c.runs[0].marks.length &&
    !c.runs[0].hardBreak &&
    !c.runs[0].code &&
    (c.runs[0].offset ?? 0) === c.first - c.body &&
    !(c.runs[0].block ?? 0);
  if (!plain && (c.runs.length || c.raw)) {
    const syntax = compactRunContext(c);
    if (syntax) extra.syntax = syntax;
    else {
      const paragraphs = compactParagraphContexts(c);
      if (paragraphs) extra.paragraphSyntax = paragraphs;
      else {
        const atoms = c.runs.filter(
          (r) =>
            r.anchor &&
            r.emitted &&
            !r.marks.length &&
            r.from === r.to &&
            r.anchor.id === `${r.anchor.commentId}:${r.anchor.type}` &&
            r.emitted.raw === `<!--anchor:${r.anchor.id}-->` &&
            r.emitted.to - r.emitted.from === r.emitted.raw.length,
        );
        if (atoms.length) {
          extra.aliasAtoms = atoms.map((r) => [
            r.from - c.first,
            r.block ?? 0,
            r.offset ?? 0,
            r.anchor!.id,
            r.emitted!.from,
          ]);
          const packed = new Set(atoms);
          extra.runs = c.runs.filter((r) => !packed.has(r));
        } else extra.runs = c.runs;
      }
    }
  }
  for (const key of [
    'partial',
    'span',
    'rowSpan',
    'owner',
    'mounted',
    'blocks',
    'blockCount',
    'attrs',
    'nodeType',
  ] as const)
    if (c[key] !== undefined) Object.assign(extra, { [key]: c[key] });
  const data: CellData = [c.row, c.column, c.from, c.body - c.from, c.to - c.from, c.raw];
  if (c.align !== null || Object.keys(extra).length) data[6] = c.align;
  if (Object.keys(extra).length) data[7] = extra;
  return new PackedCell(data);
}
export function packTableWindow(w: TableWindow): TableWindow {
  return { ...w, cells: w.cells.map(packTableCell) };
}
export const tableCloneWork = {
  calls: 0,
  maxExpandedPayloadBytes: 0,
  maxOwnerAndClonePayloadBytes: 0,
  liveScratchBytes: 0,
};
export function cloneTableWindow(w: TableWindow): TableWindow {
  const expanded = {
    ...w,
    cells: w.cells.map((c) => ({
      row: c.row,
      column: c.column,
      from: c.from,
      to: c.to,
      body: c.body,
      end: c.end,
      align: c.align,
      first: c.first,
      last: c.last,
      raw: c.raw,
      runs: c.runs,
      ...(c.partial ? { partial: true } : {}),
      ...(c.owner ? { owner: c.owner, mounted: c.mounted } : {}),
      ...(c.rowSpan === undefined ? {} : { rowSpan: c.rowSpan }),
      ...(c.span === undefined ? {} : { span: c.span }),
      ...(c.blocks
        ? { blocks: c.blocks, blockCount: c.blockCount, attrs: c.attrs, nodeType: c.nodeType }
        : {}),
    })),
  };
  // Native structuredClone receives this expanded object. Its derived runs and
  // result coexist with the packed owner until return; none are hidden by compaction.
  const size = bytes(JSON.stringify(expanded));
  tableCloneWork.calls++;
  tableCloneWork.maxExpandedPayloadBytes = Math.max(tableCloneWork.maxExpandedPayloadBytes, size);
  tableCloneWork.liveScratchBytes += size;
  tableCloneWork.maxOwnerAndClonePayloadBytes = Math.max(
    tableCloneWork.maxOwnerAndClonePayloadBytes,
    bytes(JSON.stringify(w)) + tableCloneWork.liveScratchBytes + size,
  );
  try {
    return structuredClone(expanded);
  } finally {
    tableCloneWork.liveScratchBytes -= size;
  }
}

export function unpackTableWindow(
  w: Omit<TableWindow, 'cells'> & { cells: CellData[] },
): TableWindow {
  return { ...w, cells: w.cells.map((data) => new PackedCell(data)) };
}
