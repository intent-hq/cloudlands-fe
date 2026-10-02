import { compactRunContext, deriveTableRuns, type RunContext } from './table-run-context';
import type { TableFragment, TableWindow } from './table-source';

// Renderer cells retain this tuple, not an expanded object plus an encoded copy.
// Plain text provenance is derived from its source interval when requested.
type Extra = Partial<
  Omit<TableFragment, 'row' | 'column' | 'from' | 'to' | 'body' | 'raw' | 'align'>
> & { syntax?: RunContext };
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
export function packTableCell(c: TableFragment): TableFragment {
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
    else extra.runs = c.runs;
  }
  for (const key of ['span', 'blocks', 'blockCount', 'attrs', 'nodeType'] as const)
    if (c[key] !== undefined) Object.assign(extra, { [key]: c[key] });
  const data: CellData = [c.row, c.column, c.from, c.body - c.from, c.to - c.from, c.raw];
  if (c.align !== null || Object.keys(extra).length) data[6] = c.align;
  if (Object.keys(extra).length) data[7] = extra;
  return new PackedCell(data);
}
export function packTableWindow(w: TableWindow): TableWindow {
  return { ...w, cells: w.cells.map(packTableCell) };
}
export function cloneTableWindow(w: TableWindow): TableWindow {
  return structuredClone({
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
      ...(c.span === undefined ? {} : { span: c.span }),
      ...(c.blocks
        ? { blocks: c.blocks, blockCount: c.blockCount, attrs: c.attrs, nodeType: c.nodeType }
        : {}),
    })),
  });
}

export function unpackTableWindow(
  w: Omit<TableWindow, 'cells'> & { cells: CellData[] },
): TableWindow {
  return { ...w, cells: w.cells.map((data) => new PackedCell(data)) };
}
