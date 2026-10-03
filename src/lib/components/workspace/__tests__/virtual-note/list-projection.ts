import type { JSONContent } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Mapping, ReplaceStep, type Step } from '@tiptap/pm/transform';
import {
  SourceProjection,
  openMark,
  closeMark,
  type Mark,
  type InlineContext,
} from './source-projection';
import type { Transaction } from '@tiptap/pm/state';
import type { ListItem, ListSeam } from './list-context';
import type { Splice } from './source-journal';

type Entry = {
  item: ListItem;
  node: JSONContent;
  paragraph: JSONContent;
  part?: SourceProjection;
  pm: number;
  paragraphPM: number;
};
const size = (node: JSONContent): number =>
  node.type === 'commentAnchor'
    ? 1
    : node.type === 'text'
      ? node.text!.length
      : 2 + (node.content ?? []).reduce((n, c) => n + size(c), 0);

/** Structural ancestors contain no invented text. Only loaded source tokens receive caret provenance. */
export class ListProjection {
  readonly seams: ListSeam[] = [];
  readonly indentation: Array<{ from: number; after: number; delta: number }> = [];
  readonly content: JSONContent = { type: 'doc', content: [] };
  readonly entries: Entry[] = [];
  readonly positions = new Map<number, number>();
  readonly ends = new Map<number, number>();
  readonly boundaries = new Map<number, number>();
  readonly tokens: SourceProjection['tokens'] = [];
  readonly marks: SourceProjection['marks'] = [];
  readonly synthetic: number[] = [];
  readonly prose: Array<{
    node: JSONContent;
    part: SourceProjection;
    prefix: string;
    suffix: string;
    pm: number;
  }> = [];
  constructor(
    readonly source: string,
    readonly start: number,
    readonly context: InlineContext,
  ) {
    const parents = new Map<number, JSONContent>();
    const lists = new Map<number, JSONContent>();
    const groups = new Map<number, number | undefined>();
    const markers = new Map<number, string>();
    const end = start + source.length;
    let cursor = start;
    const addProse = (from: number, to: number) => {
      const raw = source.slice(from - start, to - start);
      if (!raw.trim()) {
        if (to === end && context.documentEnd && raw.includes('\n')) {
          const node: JSONContent = { type: 'paragraph' };
          this.content.content!.push(node);
          this.prose.push({
            node,
            part: new SourceProjection('', Math.min(end, from + 1)),
            prefix: '\n',
            suffix: raw.slice(1),
            pm: 0,
          });
          if (raw.length > 1) {
            const tail: JSONContent = { type: 'paragraph' };
            this.content.content!.push(tail);
            this.prose.push({
              node: tail,
              part: new SourceProjection('', end),
              prefix: '',
              suffix: '',
              pm: 0,
            });
          }
        }
        return;
      }
      const prefix = raw.match(/^\n*/)?.[0] ?? '',
        suffix = raw.match(/\n*$/)?.[0] ?? '';
      const body = raw.slice(prefix.length, raw.length - suffix.length);
      const part = new SourceProjection(body, from + prefix.length);
      const total = part.content.content!.reduce((n, child) => n + size(child), 0);
      let offset = 0;
      for (const node of part.content.content!) {
        const nodeFrom = part.boundaries.get(offset)!,
          nodeTo = part.boundaries.get(offset + size(node))!;
        const fragment = new SourceProjection(
          body.slice(nodeFrom - part.start, nodeTo - part.start),
          nodeFrom,
        );
        this.content.content!.push(node);
        this.prose.push({
          node,
          part: fragment,
          prefix: offset === 0 ? prefix : '',
          suffix:
            (fragment.source.match(/\n*$/)?.[0] ?? '') +
            (offset + size(node) === total ? suffix : ''),
          pm: 0,
        });
        offset += size(node);
      }
      if (to === end && context.documentEnd && suffix) {
        const node: JSONContent = { type: 'paragraph' };
        this.content.content!.push(node);
        this.prose.push({
          node,
          part: new SourceProjection('', end),
          prefix: '',
          suffix: '',
          pm: 0,
        });
      }
      lists.clear();
    };
    for (const item of context.lists!) {
      if (item.parent < 0 && item.from > cursor) addProse(cursor, item.from);
      cursor = Math.max(cursor, Math.min(end, item.to));
      const parent = parents.get(item.parent) ?? this.content;
      let list = lists.get(item.parent);
      if (
        !list ||
        list.type !== item.kind ||
        groups.get(item.parent) !== item.group ||
        markers.get(item.parent) !== item.marker
      ) {
        groups.set(item.parent, item.group);
        markers.set(item.parent, item.marker);
        list = {
          type: item.kind,
          ...(item.kind === 'orderedList' ? { attrs: { start: item.ordinal } } : {}),
          content: [],
        };
        parent.content!.push(list);
        lists.set(item.parent, list);
      }
      const from = Math.max(start, item.body),
        to = Math.min(end, item.end);
      const part =
        to >= from
          ? new SourceProjection(source.slice(from - start, to - start), from, {
              revision: context.revision,
              from,
              to,
              before: from === start ? context.before : [],
              after: to === end ? context.after : [],
              fences: [],
            })
          : undefined;
      const paragraph = part?.content.content![0] ?? { type: 'paragraph' };
      const status =
        item.prefix.includes('[x]') || item.prefix.includes('[X]')
          ? 'done'
          : item.prefix.includes('[/]')
            ? 'in-progress'
            : 'todo';
      const node: JSONContent = {
        type: item.kind === 'taskList' ? 'taskItem' : 'listItem',
        ...(item.kind === 'taskList'
          ? { attrs: { checked: status === 'done', status, delegatedAgentId: null } }
          : {}),
        content: [paragraph],
      };
      list.content!.push(node);
      parents.set(item.from, node);
      this.entries.push({ item, node, paragraph, part, pm: 0, paragraphPM: 0 });
    }
    if (cursor < end) addProse(cursor, end);
    const visit = (node: JSONContent, pm: number) => {
      const prose = this.prose.find((p) => p.node === node);
      if (prose) {
        prose.pm = pm;
        this.boundaries.set(pm, prose.part.start);
        this.boundaries.set(pm + size(node), prose.part.start + prose.part.source.length);
        for (const [p, s] of prose.part.positions) this.positions.set(pm + p, s);
        for (const [p, s] of prose.part.ends) this.ends.set(pm + p, s);
        for (const [p, s] of prose.part.boundaries) this.boundaries.set(pm + p, s);
        this.tokens.push(...prose.part.tokens.map((t) => ({ ...t, pm: pm + t.pm })));
      }
      const entry = this.entries.find((e) => e.node === node);
      if (entry) {
        entry.pm = pm;
        entry.paragraphPM = pm + 1;
        this.boundaries.set(pm, Math.max(start, entry.item.from));
        this.boundaries.set(pm + size(node), Math.min(end, entry.item.to));
        if (!entry.part) {
          this.synthetic.push(pm + 1);
          this.boundaries.set(pm + 1, entry.item.body);
          this.boundaries.set(pm + 3, entry.item.end);
        }
      }
      const paragraph = this.entries.find((e) => e.paragraph === node);
      if (paragraph?.part) {
        const part = paragraph.part;
        this.boundaries.set(pm, Math.max(start, paragraph.item.body));
        this.boundaries.set(pm + size(node), Math.min(end, paragraph.item.end));
        for (const [p, s] of part.positions) this.positions.set(pm + p, s);
        for (const [p, s] of part.ends) this.ends.set(pm + p, s);
        for (const [p, s] of part.boundaries) this.boundaries.set(pm + p, s);
        this.tokens.push(...part.tokens.map((t) => ({ ...t, pm: pm + t.pm })));
        this.marks.push(
          ...part.marks.map((m) => ({ ...m, pmFrom: pm + m.pmFrom, pmTo: pm + m.pmTo })),
        );
      }
      let next = pm + 1;
      for (const child of node.content ?? []) {
        visit(child, next);
        next += size(child);
      }
      if (entry || ['bulletList', 'orderedList', 'taskList'].includes(node.type!)) {
        const end = this.boundaries.get(next);
        if (end !== undefined)
          this.boundaries.set(
            pm + size(node),
            Math.max(this.boundaries.get(pm + size(node)) ?? this.start, end),
          );
        if (!entry) {
          const from = this.boundaries.get(pm + 1);
          if (from !== undefined) this.boundaries.set(pm, from);
        }
      }
    };
    let pm = 0;
    for (const node of this.content.content!) {
      visit(node, pm);
      pm += size(node);
    }
    if (context.documentEnd && this.content.content!.at(-1)?.type !== 'paragraph') {
      this.content.content!.push({ type: 'paragraph' });
      this.boundaries.set(pm + 1, end);
      this.boundaries.set(pm + 2, end);
    }
    this.boundaries.set(0, start);
    this.boundaries.set(pm, end);
  }
  translateTransaction(tr: Transaction) {
    // TipTap's native cut command deletes and reinserts an identical immutable slice.
    // Carry that slice's exact token provenance, without searching document substrings.
    let tokens = this.tokens.map((t) => ({ ...t }));
    let cut: { step: ReplaceStep; doc: PMNode; tokens: typeof tokens } | undefined;
    for (let n = 0; n < tr.steps.length; n++) {
      const step = tr.steps[n],
        map = step.getMap();
      const survivors: typeof tokens = [];
      const removed: typeof tokens = [];
      for (const token of tokens) {
        const a = map.mapResult(token.pm, 1),
          b = map.mapResult(token.pm + 1, -1);
        if (!a.deleted && !b.deleted && b.pos === a.pos + 1)
          survivors.push({ ...token, pm: a.pos });
        else removed.push(token);
      }
      if (
        step instanceof ReplaceStep &&
        step.from === step.to &&
        cut &&
        step.slice.eq(cut.doc.slice(cut.step.from, cut.step.to))
      ) {
        survivors.push(...cut.tokens.map((t) => ({ ...t, pm: step.from + t.pm - cut!.step.from })));
        cut = undefined;
      } else
        cut =
          step instanceof ReplaceStep && !step.slice.size && removed.length
            ? { step, doc: tr.docs[n], tokens: removed }
            : undefined;
      tokens = survivors;
    }
    return this.translateDocument(tr.doc, tr.mapping, new Map(tokens.map((t) => [t.pm, t])));
  }
  translate(step: Step, before: PMNode) {
    const result = step.apply(before);
    if (!result.doc) throw new Error(result.failed ?? 'Invalid list step');
    return this.translateDocument(result.doc, new Mapping([step.getMap()]));
  }
  translateDocument(
    doc: PMNode,
    mapping: Mapping,
    moved?: Map<number, SourceProjection['tokens'][number]>,
  ) {
    this.seams.length = 0;
    const survivors = new Map<number, SourceProjection['tokens'][number]>();
    for (const t of this.tokens) {
      const a = mapping.mapResult(t.pm, 1),
        b = mapping.mapResult(t.pm + 1, -1);
      if (!a.deleted && !b.deleted && b.pos === a.pos + 1) survivors.set(a.pos, t);
    }
    if (moved) {
      survivors.clear();
      for (const [pos, token] of moved) survivors.set(pos, token);
    }
    const entries = new Map(this.entries.map((e) => [mapping.map(e.pm, -1), e]));
    const paragraphs = new Map(this.entries.map((e) => [mapping.map(e.paragraphPM, -1), e]));
    let output = '';
    const external: Splice[] = [];
    this.indentation.length = 0;
    let lastParagraph = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size) lastParagraph = pos;
    });
    const escape = (text: string) => text.replace(/[\\`*_[\]{}()#+.!>~-]/g, '\\$&');
    const text = (node: PMNode, pm: number) => {
      const origin = this.entries.find((e) => mapping.map(e.paragraphPM, -1) === pm);
      let out = '',
        active: Mark[] = origin?.part?.context?.before ?? [];
      const transition = (next: Mark[]) => {
        const key = (m: Mark) => m.type + ':' + (m.attrs?.href ?? '');
        let shared = 0;
        while (
          shared < active.length &&
          shared < next.length &&
          key(active[shared]) === key(next[shared])
        )
          shared++;
        for (let i = active.length - 1; i >= shared; i--) out += closeMark(active[i]);
        for (let i = shared; i < next.length; i++) out += openMark(next[i]);
        active = next;
      };
      node.forEach((child, offset) => {
        if (child.type.name === 'commentAnchor') {
          transition(child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs })));
          out += `<!--anchor:${child.attrs.commentId}:${child.attrs.type}-->`;
          return;
        }
        if (!child.isText || child.marks.some((m) => !['bold', 'link'].includes(m.type.name)))
          throw new Error('List proof inline grammar not yet admitted');
        for (let i = 0; i < child.text!.length; i++) {
          const char = child.text![i],
            t = survivors.get(pm + 1 + offset + i);
          transition(child.marks.map((m) => ({ type: m.type.name, attrs: m.attrs })));
          out += t?.text === char ? t.raw : escape(char);
        }
      });
      transition(origin?.part?.context?.after ?? []);
      return out;
    };
    const used = new Set<Entry>();
    const boundary = (node: PMNode, pm: number) => {
      const old = entries.get(pm + 1);
      const prior =
        old &&
        this.entries
          .filter((e) => e.item.parent === old.item.parent && e.item.from < old.item.from)
          .at(-1);
      // A surviving marker change already encodes this canonical boundary exactly.
      if (old && prior && old.item.marker !== prior.item.marker) return;
      if (output) output += '\n';
      this.seams.push({
        from: this.start + output.length,
        kind: node.type.name as ListItem['kind'],
        start: node.attrs.start ?? 1,
      });
    };
    const list = (node: PMNode, pm: number, indent: number) => {
      let previous: Entry | undefined;
      node.forEach((item, inner, index) => {
        const pos = pm + 1 + inner;
        let old = entries.get(pos);
        if (!old)
          old = this.entries.find(
            (e) =>
              !used.has(e) &&
              e.part?.tokens.some((t) => {
                const mapped = mapping.mapResult(e.paragraphPM + t.pm, 1);
                return (
                  !mapped.deleted &&
                  mapped.pos >= pos + 2 &&
                  mapped.pos < pos + 1 + item.firstChild!.nodeSize
                );
              }),
          );
        if (
          old &&
          previous &&
          previous.item.to >= this.start &&
          old.item.from >= previous.item.to
        ) {
          const gap = this.source.slice(previous.item.to - this.start, old.item.from - this.start);
          if (/^\n+$/.test(gap)) output += gap;
        }
        previous = old;
        if (
          index === 0 &&
          old &&
          (old.item.group === old.item.from ||
            (node.type.name === 'orderedList' && old.item.ordinal !== node.attrs.start))
        ) {
          const from = this.start + output.length;
          if (!this.seams.some((s) => s.from === from))
            this.seams.push({
              from,
              kind: node.type.name as ListItem['kind'],
              start: node.attrs.start ?? 1,
            });
        }
        if (old) {
          used.add(old);
          if (old.item.indent !== indent)
            this.indentation.push({
              from: old.item.from,
              after: this.start + this.source.length,
              delta: indent - old.item.indent,
            });
        }
        let prefix = old?.item.prefix;
        const ordinal = (node.attrs.start ?? 1) + index;
        const marker = node.type.name === 'orderedList' ? `${ordinal}. ` : '- ';
        const status = item.attrs.status === 'in-progress' ? '/' : item.attrs.checked ? 'x' : ' ';
        const canonical =
          ' '.repeat(indent) + marker + (node.type.name === 'taskList' ? `[${status}] ` : '');
        if (!old || old.item.indent !== indent || old.item.kind !== node.type.name)
          prefix = canonical;
        else if (node.type.name === 'taskList')
          prefix = prefix!.replace(/\[[ xX/]\]/, `[${status}]`);
        item.forEach((child, offset, childIndex) => {
          const at = pos + 1 + offset;
          if (child.type.name === 'paragraph') {
            const origin = paragraphs.get(at) ?? old;
            if (origin && !origin.part) {
              if (child.content.size) throw new Error('Synthetic ancestor cannot accept text');
              return;
            }
            const partial = origin && origin.item.body < this.start;
            const tail =
              at === lastParagraph &&
              this.context.lists!.some((i) => i.to > this.start + this.source.length);
            if (partial && prefix !== origin.item.prefix)
              external.push({ from: origin.item.from, to: origin.item.body, insert: prefix! });
            output += (partial ? '' : prefix) + text(child, at) + (tail ? '' : '\n');
          } else {
            if (childIndex > 0 && child.type.name === item.child(childIndex - 1).type.name)
              boundary(child, at);
            list(child, at, indent + marker.length);
          }
        });
      });
    };
    doc.forEach((node, pm, index) => {
      if (node.type.name === 'paragraph') {
        if (index === doc.childCount - 1 && !node.content.size && this.context.documentEnd) return;
        const old = this.prose.find((p) => mapping.map(p.pm, -1) === pm);
        output += (old?.prefix ?? '\n') + text(node, pm) + (old?.suffix ?? '\n\n');
      } else if (node.type.name === 'codeBlock') {
        const old = this.prose.find((p) => mapping.map(p.pm, -1) === pm);
        if (!old) throw new Error('Missing mixed code source provenance');
        const before = doc.type.schema.nodeFromJSON(old.part.content);
        const replacement = new ReplaceStep(
          0,
          before.content.size,
          new Slice(Fragment.from(node), 0, 0),
        );
        let source = old.part.source;
        for (const splice of old.part
          .translate(replacement, before)
          .sort((a, b) => b.from - a.from))
          source =
            source.slice(0, splice.from - old.part.start) +
            splice.insert +
            source.slice(splice.to - old.part.start);
        output += old.prefix + source;
        // The fragment already owns its internal separator. Only the outer
        // list/prose gap is absent from its source.
        const internal = old.part.source.match(/\n*$/)?.[0] ?? '';
        output += old.suffix.slice(internal.length);
      } else {
        if (index > 0 && node.type.name === doc.child(index - 1).type.name) boundary(node, pm);
        list(node, pm, 0);
      }
    });
    if (!this.source.endsWith('\n') && output.endsWith('\n')) output = output.slice(0, -1);
    let from = 0,
      oldEnd = this.source.length,
      newEnd = output.length;
    while (from < oldEnd && from < newEnd && this.source[from] === output[from]) from++;
    while (oldEnd > from && newEnd > from && this.source[oldEnd - 1] === output[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    return [
      ...(from === oldEnd && from === newEnd
        ? []
        : [
            {
              from: this.start + from,
              to: this.start + oldEnd,
              insert: output.slice(from, newEnd),
            },
          ]),
      ...external,
    ].sort((a, b) => b.from - a.from);
  }
}
