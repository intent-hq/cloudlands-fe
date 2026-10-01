import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Mapping, type Step } from '@tiptap/pm/transform';
import {
  SourceProjection,
  openMark,
  closeMark,
  type Mark,
  type InlineContext,
} from './source-projection';
import type { ListItem } from './list-context';
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
  node.type === 'text'
    ? node.text!.length
    : 2 + (node.content ?? []).reduce((n, c) => n + size(c), 0);

/** Structural ancestors contain no invented text. Only loaded source tokens receive caret provenance. */
export class ListProjection {
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
      for (const node of part.content.content!) {
        this.content.content!.push(node);
        this.prose.push({ node, part, prefix, suffix, pm: 0 });
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
      if (!list || list.type !== item.kind) {
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
  translate(step: Step, before: PMNode) {
    const result = step.apply(before);
    if (!result.doc) throw new Error(result.failed ?? 'Invalid list step');
    return this.translateDocument(result.doc, new Mapping([step.getMap()]));
  }
  translateDocument(doc: PMNode, mapping: Mapping) {
    const survivors = new Map<number, SourceProjection['tokens'][number]>();
    for (const t of this.tokens) {
      const a = mapping.mapResult(t.pm, 1),
        b = mapping.mapResult(t.pm + 1, -1);
      if (!a.deleted && !b.deleted && b.pos === a.pos + 1) survivors.set(a.pos, t);
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
    const list = (node: PMNode, pm: number, indent: number) => {
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
        item.forEach((child, offset) => {
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
          } else list(child, at, indent + marker.length);
        });
      });
    };
    doc.forEach((node, pm, index) => {
      if (node.type.name === 'paragraph') {
        if (index === doc.childCount - 1 && !node.content.size && this.context.documentEnd) return;
        const old = this.prose.find((p) => mapping.map(p.pm, -1) === pm);
        output += (old?.prefix ?? '\n') + text(node, pm) + (old?.suffix ?? '\n\n');
      } else list(node, pm, 0);
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
