import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Transform, type Step } from '@tiptap/pm/transform';
import type { Splice } from './source-journal';

type Mark = { type: string; attrs?: Record<string, unknown> };
type Token = { pm: number; from: number; to: number; text: string; raw: string; marks: Mark[] };
const key = (mark: Mark) => `${mark.type}:${mark.type === 'link' ? mark.attrs?.href : ''}`;
const escape = (text: string) => text.replace(/[\\`*_[\]{}()#+.!>~-]/g, '\\$&');

// Markdown strong delimiters cannot enclose boundary whitespace. Normalize only
// those invisible marks; all text, positions, internal whitespace and other marks stay intact.
function canonicalBold(doc: PMNode): PMNode {
  const tr = new Transform(doc);
  const bold = doc.type.schema.marks.bold;
  doc.forEach((paragraph, offset) => {
    let from = offset + 1,
      text = '';
    const flush = () => {
      const leading = text.match(/^\s+/u)?.[0].length ?? 0;
      const trailing = text.match(/\s+$/u)?.[0].length ?? 0;
      if (leading) tr.removeMark(from, from + leading, bold);
      if (trailing) tr.removeMark(from + text.length - trailing, from + text.length, bold);
      text = '';
    };
    paragraph.forEach((node, inner) => {
      if (node.isText && bold.isInSet(node.marks)) {
        if (!text) from = offset + 1 + inner;
        text += node.text!;
      } else flush();
    });
    flush();
  });
  return tr.doc;
}

/** Exact UTF-16 token provenance for paragraphs, escaped text, nested bold and links. */
export class SourceProjection {
  readonly content: JSONContent = { type: 'doc', content: [] };
  readonly positions = new Map<number, number>();
  readonly ends = new Map<number, number>();
  readonly tokens: Token[] = [];
  readonly marks: Array<{
    type: string;
    pmFrom: number;
    pmTo: number;
    openFrom: number;
    closeTo: number;
  }> = [];
  private paragraphs: Array<{ end: number; next: number; separator: string }> = [];
  private trailing = '';
  constructor(
    readonly source: string,
    readonly start = 0,
  ) {
    let pm = 0;
    const paragraphs = /([^]*?)(\n[ \t]+\n+|\n\n|$)/g;
    let match: RegExpExecArray | null;
    while ((match = paragraphs.exec(source)) && match[0]) {
      const raw = match[1],
        base = start + match.index;
      pm++;
      this.positions.set(pm, base);
      const nodes: JSONContent[] = [];
      const text = (value: string, from: number, to: number, stack: Mark[]) => {
        const previous = nodes.at(-1);
        if (previous && JSON.stringify(previous.marks) === JSON.stringify(stack))
          previous.text += value;
        else nodes.push({ type: 'text', text: value, marks: stack });
        this.tokens.push({
          pm,
          text: value,
          from: base + from,
          to: base + to,
          raw: raw.slice(from, to),
          marks: stack,
        });
        this.positions.set(pm, base + from);
        this.ends.set(pm + 1, base + to);
        this.positions.set(++pm, base + to);
      };
      const closing = (delimiter: string, from: number, end: number) => {
        for (let i = from; i < end; i++) {
          if (raw[i] === '\\') {
            i++;
            continue;
          }
          if (raw.startsWith(delimiter, i)) return i;
        }
        return -1;
      };
      const parse = (from: number, to: number, stack: Mark[]) => {
        for (let i = from; i < to;) {
          if (
            raw[i] === '\\' &&
            i + 1 < to &&
            /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(raw[i + 1])
          ) {
            text(raw[i + 1], i, i + 2, stack);
            i += 2;
            continue;
          }
          let contentFrom = i,
            contentTo = i,
            end = i;
          let mark: Mark | undefined;
          if (raw.startsWith('**', i)) {
            const close = closing('**', i + 2, to);
            if (close > i + 2) {
              contentFrom = i + 2;
              contentTo = close;
              end = close + 2;
              mark = { type: 'bold' };
            }
          } else if (raw[i] === '[') {
            const close = closing('](', i + 1, to);
            const destinationEnd = close < 0 ? -1 : closing(')', close + 2, to);
            if (close > i + 1 && destinationEnd >= 0) {
              contentFrom = i + 1;
              contentTo = close;
              end = destinationEnd + 1;
              mark = { type: 'link', attrs: { href: raw.slice(close + 2, destinationEnd) } };
            }
          }
          if (mark) {
            const pmFrom = pm;
            parse(contentFrom, contentTo, [...stack, mark]);
            this.marks.push({
              type: mark.type,
              pmFrom,
              pmTo: pm,
              openFrom: base + i,
              closeTo: base + end,
            });
            i = end;
          } else {
            text(raw[i], i, i + 1, stack);
            i++;
          }
        }
      };
      parse(0, raw.length, []);
      this.positions.set(pm, base + raw.length);
      this.paragraphs.push({ end: pm, next: pm + 2, separator: match[2] });
      this.content.content!.push({ type: 'paragraph', content: nodes });
      pm++;
      this.trailing = match[2];
    }
    if (!this.content.content!.length) {
      this.content.content!.push({ type: 'paragraph' });
      this.positions.set(1, start);
    }
  }
  sourceAt(pm: number, affinity = 1) {
    const source =
      affinity < 0 ? (this.ends.get(pm) ?? this.positions.get(pm)) : this.positions.get(pm);
    if (source === undefined) throw new Error(`No exact source provenance at PM ${pm}`);
    return source;
  }
  pmAt(source: number, affinity = 1) {
    let nearest = 1,
      distance = Infinity;
    for (const [pm, offset] of this.positions) {
      const d = Math.abs(offset - source);
      if (d < distance || (d === distance && affinity > 0)) {
        distance = d;
        nearest = pm;
      }
    }
    return nearest;
  }
  translate(step: Step, before: PMNode): Splice[] {
    const applied = step.apply(before);
    if (!applied.doc) throw new Error(applied.failed ?? 'Invalid proof step');
    const after = canonicalBold(applied.doc),
      mapping = step.getMap();
    const survivors = new Map<number, Token>();
    for (const token of this.tokens) {
      const from = mapping.mapResult(token.pm, 1),
        to = mapping.mapResult(token.pm + 1, -1);
      if (!from.deleted && !to.deleted && to.pos === from.pos + 1) survivors.set(from.pos, token);
    }
    const separators = new Map<number, string>();
    for (const paragraph of this.paragraphs) {
      const end = mapping.mapResult(paragraph.end, -1),
        next = mapping.mapResult(paragraph.next, 1);
      if (!end.deleted && !next.deleted && next.pos === end.pos + 2)
        separators.set(end.pos, paragraph.separator);
    }
    let source = '';
    after.forEach((paragraph, offset, index) => {
      if (paragraph.type.name !== 'paragraph')
        throw new Error(`Unsupported proof node ${paragraph.type.name}`);
      let active: Mark[] = [];
      const close = (mark: Mark) => (mark.type === 'bold' ? '**' : `](${mark.attrs?.href})`);
      const open = (mark: Mark) => (mark.type === 'bold' ? '**' : '[');
      const transition = (next: Mark[]) => {
        let shared = 0;
        while (
          shared < active.length &&
          shared < next.length &&
          key(active[shared]) === key(next[shared])
        )
          shared++;
        for (let i = active.length - 1; i >= shared; i--) source += close(active[i]);
        for (let i = shared; i < next.length; i++) source += open(next[i]);
        active = next;
      };
      paragraph.forEach((node, inner) => {
        if (!node.isText) throw new Error(`Unsupported proof inline ${node.type.name}`);
        const desired = node.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }));
        if (desired.some((m) => !['bold', 'link'].includes(m.type)))
          throw new Error('Unsupported proof mark');
        for (let i = 0; i < node.text!.length; i++) {
          const token = survivors.get(offset + 1 + inner + i),
            char = node.text![i];
          // Keep the original nesting and raw spelling for every surviving token.
          const sameMarks =
            token &&
            token.marks.length === desired.length &&
            token.marks.every((m) => desired.some((d) => key(m) === key(d)));
          const stack = sameMarks
            ? token.marks
            : [...desired].sort((a, b) => Number(b.type === 'link') - Number(a.type === 'link'));
          transition(stack);
          source += token?.text === char ? token.raw : escape(char);
        }
      });
      transition([]);
      const end = offset + paragraph.nodeSize - 1;
      source += index < after.childCount - 1 ? separators.get(end) || '\n\n' : this.trailing;
    });
    // Verify the entire bounded projection BEFORE admitting a source/journal mutation.
    const projected = before.type.schema.nodeFromJSON(
      new SourceProjection(source, this.start).content,
    );
    if (!projected.eq(after)) throw new Error('Translated source differs from accepted document');
    let from = 0,
      oldEnd = this.source.length,
      newEnd = source.length;
    while (from < oldEnd && from < newEnd && this.source[from] === source[from]) from++;
    while (oldEnd > from && newEnd > from && this.source[oldEnd - 1] === source[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    return from === oldEnd && from === newEnd
      ? []
      : [{ from: this.start + from, to: this.start + oldEnd, insert: source.slice(from, newEnd) }];
  }
}
