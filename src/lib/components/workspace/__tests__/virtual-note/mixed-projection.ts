import type { JSONContent } from '@tiptap/core';
import { Transform, Mapping, StepMap } from '@tiptap/pm/transform';
import type { Fence } from './fence-context';
import { LIMITS, type Splice, type Selection } from './source-journal';
import { TABLE_NODE_LIMIT } from './table-transfer';
import { SourceProjection, type InlineContext } from './source-projection';
import type { TableProjection } from './table-projection';
import type { ListProjection } from './list-projection';
import type { TableWindow } from './table-source';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

const size = (node: JSONContent): number =>
  node.type === 'text'
    ? node.text!.length
    : ['hardBreak', 'commentAnchor', 'horizontalRule', 'image'].includes(node.type!)
      ? 1
      : 2 + (node.content ?? []).reduce((sum, child) => sum + size(child), 0);

/** One bounded native document composed from the existing construct adapters. */
export class MixedProjection {
  readonly content: JSONContent = { type: 'doc', content: [] };
  readonly positions = new Map<number, number>();
  readonly ends = new Map<number, number>();
  readonly boundaries = new Map<number, number>();
  readonly tokens: SourceProjection['tokens'] = [];
  readonly parts: Array<{ pm: number; end: number; projection: SourceProjection }> = [];
  sourceAt(pm: number, affinity = 1) {
    const part = this.parts.find((p) => p.projection.table && pm >= p.pm && pm <= p.end);
    if (!part) return undefined;
    if (pm === part.pm) return part.projection.table!.window.from;
    if (pm === part.end) return part.projection.table!.window.to;
    return part.projection.table!.sourceAt(pm - part.pm, affinity);
  }
  pmAt(source: number, affinity = 1) {
    const part = this.parts.find(
      (p) =>
        p.projection.table &&
        source >= p.projection.table.window.from &&
        source <= p.projection.table.window.to,
    );
    return part ? part.pm + part.projection.table!.pmAt(source, affinity) : undefined;
  }
  pointAt(pm: number, cell = false) {
    const part = this.parts.find((p) => p.pm <= pm && p.end >= pm && p.projection.table);
    if (!part) return undefined;
    const table = part.projection.table!;
    if (!cell) return table.pointAt(pm - part.pm);
    const entry = table.entries.find((e) => e.pm === pm - part.pm);
    return entry && { cell: entry.cell.from, block: 0, offset: 0 };
  }
  restoreSelection(doc: PMNode, selection: Selection) {
    const logical = selection.table;
    if (!logical) return undefined;
    const part = this.parts.find(
      (p) =>
        p.projection.table &&
        logical.anchor.cell >= p.projection.table.window.from &&
        logical.anchor.cell < p.projection.table.window.to,
    );
    const table = part?.projection.table;
    if (!part || !table) return undefined;
    const localDoc = doc.type.create(null, doc.content.cut(part.pm, part.end));
    const local = table.restoreSelection(localDoc, selection);
    return local instanceof CellSelection
      ? CellSelection.create(doc, part.pm + local.$anchorCell.pos, part.pm + local.$headCell.pos)
      : TextSelection.create(doc, part.pm + local.anchor, part.pm + local.head);
  }
  static nodeBudget(doc: JSONContent) {
    const count = (node: JSONContent): number =>
      1 + (node.content ?? []).reduce((n, child) => n + count(child), 0);
    let table = 0,
      prose = 0;
    for (const node of doc.content ?? []) {
      if (node.type === 'table') table += count(node);
      else prose += count(node);
    }
    if (table + 1 > TABLE_NODE_LIMIT || prose > LIMITS.nodes)
      throw new Error('Mixed projection exceeds construct node budget');
    return { table: table + 1, prose };
  }
  translateTransaction(tr: Transform) {
    let from = Infinity,
      to = -Infinity;
    tr.steps.forEach((step, index) => {
      // Mapping.slice is a view; invert() still reverses its entire map array.
      // Slice the inverse instead so only earlier native steps affect ownership.
      const inverse = tr.mapping.invert().slice(tr.mapping.maps.length - index);
      step.getMap().forEach((first, last) => {
        from = Math.min(from, inverse.map(first, -1));
        to = Math.max(to, inverse.map(last, 1));
      });
    });
    const part = this.parts.find((entry) => from >= entry.pm && to <= entry.end);
    if (!part) return this.translateAcross(tr);
    const projection = part.projection;
    const local = new Transform(
      tr.before.type.create(null, tr.before.content.cut(part.pm, part.end)),
    );
    const offset = new Mapping([StepMap.offset(-part.pm)]);
    for (const step of tr.steps) {
      const mapped = step.map(offset);
      if (!mapped) throw new Error('Mixed native step lost its local mapping');
      local.step(mapped);
    }
    let fences: Fence[] = [];
    let splices: Splice[];
    if (projection.table) {
      splices = projection.table.translateTransaction(local, (pm, affinity) =>
        projection.sourceAt(pm, affinity),
      );
    } else if (projection.list) {
      splices = projection.list.translateTransaction(local);
      fences = projection.list.fences;
    } else {
      if (local.steps.length !== 1)
        throw new Error('Mixed prose batch needs atomic adapter admission');
      splices = projection.translate(local.steps[0], local.before, (next) => {
        fences = next;
      });
    }
    return { splices, fences, table: projection.table, list: projection.list };
  }
  private translateAcross(tr: Transform) {
    // Match structural table ordinals, never repeated source substrings. A native
    // replacement may delete a table boundary while retaining that table's cells.
    const tables: Array<{ from: number; to: number }> = [];
    tr.doc.forEach((node, offset) => {
      if (node.type.name === 'table') tables.push({ from: offset, to: offset + node.nodeSize });
    });
    if (tables.length !== this.parts.filter((part) => part.projection.table).length)
      throw new Error('Mixed table insertion/removal requires structural admission');
    const result: {
      splices: Splice[];
      fences: Fence[];
      table?: TableProjection;
      list?: ListProjection;
    } = {
      splices: [],
      fences: [],
    };
    let index = 0;
    for (const part of this.parts) {
      const projection = part.projection;
      const range = projection.table
        ? tables[index++]
        : {
            from: index ? tables[index - 1].to : 0,
            to: tables[index]?.from ?? tr.doc.content.size,
          };
      const before = tr.before.type.create(null, tr.before.content.cut(part.pm, part.end));
      const after = tr.doc.type.create(null, tr.doc.content.cut(range.from, range.to));
      const first = before.content.findDiffStart(after.content);
      if (first === null) continue;
      const last = before.content.findDiffEnd(after.content)!;
      const overlap = first - Math.min(last.a, last.b);
      if (overlap > 0) {
        last.a += overlap;
        last.b += overlap;
      }
      const local = new Transform(before).replace(first, last.a, after.slice(first, last.b));
      if (!local.doc.eq(after)) throw new Error('Mixed child fit differs from native result');
      if (projection.table) {
        if (result.table) throw new Error('Mixed multi-table change requires atomic admission');
        result.table = projection.table;
        result.splices.push(
          ...projection.table.translateTransaction(local, (pm, affinity) =>
            projection.sourceAt(pm, affinity),
          ),
        );
      } else if (projection.list) {
        if (result.list) throw new Error('Mixed multi-list change requires atomic admission');
        result.list = projection.list;
        result.splices.push(...projection.list.translateTransaction(local));
        result.fences.push(...projection.list.fences);
      } else {
        if (local.steps.length !== 1) throw new Error('Mixed child fit requires a batch adapter');
        result.splices.push(
          ...projection.translate(local.steps[0], local.before, (fences) =>
            result.fences.push(...fences),
          ),
        );
      }
    }
    result.splices.sort((a, b) => b.from - a.from);
    return result;
  }
  constructor(source: string, start: number, context: InlineContext, tables: TableWindow[]) {
    let cursor = start,
      pm = 0;
    const end = start + source.length;
    const append = (part: SourceProjection) => {
      const count = part.content.content!.reduce((sum, child) => sum + size(child), 0);
      this.parts.push({ pm, end: pm + count, projection: part });
      this.content.content!.push(...part.content.content!);
      for (const [position, offset] of part.positions) this.positions.set(pm + position, offset);
      for (const [position, offset] of part.ends) this.ends.set(pm + position, offset);
      for (const [position, offset] of part.boundaries) this.boundaries.set(pm + position, offset);
      this.tokens.push(...part.tokens.map((token) => ({ ...token, pm: pm + token.pm })));
      pm += count;
    };
    if (context.fragments) {
      for (const fragment of context.fragments)
        append(new SourceProjection(fragment.source, fragment.start, fragment.context));
      this.boundaries.set(0, context.from);
      this.boundaries.set(pm, context.to);
      return;
    }
    const prose = (to: number) => {
      const raw = source.slice(cursor - start, to - start);
      const leading = raw.match(/^\n*/)?.[0].length ?? 0;
      const trailing = raw.match(/\n*$/)?.[0].length ?? 0;
      const from = cursor + leading,
        last = Math.max(from, to - trailing);
      if (last > from)
        append(
          new SourceProjection(source.slice(from - start, last - start), from, {
            ...context,
            from,
            to: last,
            tables: undefined,
            before: from === start ? context.before : [],
            after: last === end ? context.after : [],
            fences: context.fences?.filter((fence) => fence.from < last && fence.to > from),
            lists: context.lists?.filter((item) => item.from < last && item.to > from),
            documentEnd: to === end && context.documentEnd,
          }),
        );
      cursor = to;
    };
    for (const table of tables) {
      prose(table.from);
      append(
        new SourceProjection(source.slice(table.from - start, table.to - start), table.from, {
          revision: context.revision,
          from: table.from,
          to: table.to,
          before: [],
          after: [],
          table: {
            ...table,
            trailing: !source.slice(table.to - start).trim() && table.trailing !== false,
          },
        }),
      );
      cursor = table.to;
    }
    prose(end);
    this.boundaries.set(0, start);
    this.boundaries.set(pm, end);
  }
}
