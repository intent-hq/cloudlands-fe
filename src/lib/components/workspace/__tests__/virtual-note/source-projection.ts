import { Lexer, type Token } from 'marked';
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Transform, type Step } from '@tiptap/pm/transform';
import type { Splice } from './source-journal';
import { scanFences, type Fence } from './fence-context';
import type { ListItem, ListSeam } from './list-context';
import { ListProjection } from './list-projection';
import { TableProjection } from './table-projection';
import type { TableWindow } from './table-source';

export type Mark = {
  type: string;
  attrs?: Record<string, unknown>;
  delimiter?: string;
  range?: { from: number; to: number };
};
type Token = { pm: number; from: number; to: number; text: string; raw: string; marks: Mark[] };
const key = (mark: Mark) => `${mark.type}:${mark.type === 'link' ? mark.attrs?.href : ''}`;
export type InlineContext = {
  revision: number;
  from: number;
  to: number;
  before: Mark[];
  after: Mark[];
  fences?: Fence[];
  lists?: ListItem[];
  seams?: ListSeam[];
  documentEnd?: boolean;
  table?: TableWindow;
};
export const openMark = (mark: Mark) =>
  mark.type === 'bold' ? '**' : mark.type === 'italic' ? (mark.delimiter ?? '*') : '[';
export const closeMark = (mark: Mark) =>
  mark.type === 'bold'
    ? '**'
    : mark.type === 'italic'
      ? (mark.delimiter ?? '*')
      : `](${mark.attrs?.href})`;
const escape = (text: string) => text.replace(/[\\`*_[\]{}()#+.!>~-]/g, '\\$&');

// Markdown strong delimiters cannot enclose boundary whitespace. Normalize only
// those invisible marks; all text, positions, internal whitespace and other marks stay intact.
function canonicalBold(doc: PMNode, context?: InlineContext): PMNode {
  const tr = new Transform(doc);
  const bold = doc.type.schema.marks.bold;
  doc.forEach((paragraph, offset) => {
    let from = offset + 1,
      text = '';
    const flush = () => {
      const leading = text.match(/^\s+/u)?.[0].length ?? 0;
      const trailing = text.match(/\s+$/u)?.[0].length ?? 0;
      if (leading && !(from === 1 && context?.before.some((m) => m.type === 'bold')))
        tr.removeMark(from, from + leading, bold);
      if (
        trailing &&
        !(
          from + text.length === doc.content.size - 1 &&
          context?.after.some((m) => m.type === 'bold')
        )
      )
        tr.removeMark(from + text.length - trailing, from + text.length, bold);
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
  readonly boundaries = new Map<number, number>();
  readonly tokens: Token[] = [];
  readonly marks: Array<{
    type: string;
    pmFrom: number;
    pmTo: number;
    openFrom: number;
    closeTo: number;
    contentFrom: number;
    contentTo: number;
    mark: Mark;
  }> = [];
  private paragraphs: Array<{ end: number; next: number; separator: string }> = [];
  readonly code: Array<{ pm: number; end: number; fence: Fence; prefix: string; suffix: string }> =
    [];
  private trailing = '';
  readonly list?: ListProjection;
  readonly table?: TableProjection;
  constructor(
    readonly source: string,
    readonly start = 0,
    readonly context?: InlineContext,
    indexOnly = false,
  ) {
    if (context?.table && !indexOnly) {
      this.table = new TableProjection(context.table);
      this.content.content = this.table.content.content;
      for (const [p, s] of this.table.positions) this.positions.set(p, s);
      for (const [p, s] of this.table.ends) this.ends.set(p, s);
      for (const [p, s] of this.table.boundaries) this.boundaries.set(p, s);
      this.tokens.push(...this.table.tokens);
      return;
    }
    if (context && (context.from !== start || context.to !== start + source.length))
      throw new Error('Context does not describe this source window');
    if (context?.lists?.length && !indexOnly) {
      this.list = new ListProjection(source, start, context);
      this.content.content = this.list.content.content;
      for (const [p, s] of this.list.positions) this.positions.set(p, s);
      for (const [p, s] of this.list.ends) this.ends.set(p, s);
      for (const [p, s] of this.list.boundaries) this.boundaries.set(p, s);
      this.tokens.push(...this.list.tokens);
      this.marks.push(...this.list.marks);
      return;
    }
    const fences =
      context?.fences ??
      scanFences(source).map((f) => ({
        ...f,
        from: f.from + start,
        bodyFrom: f.bodyFrom + start,
        bodyTo: f.bodyTo + start,
        to: f.to + start,
      }));
    if (fences.length) {
      let cursor = start,
        pm = 0;
      const end = start + source.length;
      const prose = (to: number) => {
        if (to <= cursor) return;
        const part = new SourceProjection(
          source.slice(cursor - start, to - start),
          cursor,
          {
            revision: context?.revision ?? 0,
            from: cursor,
            to,
            before: cursor === start ? (context?.before ?? []) : [],
            after: to === end ? (context?.after ?? []) : [],
            fences: [],
          },
          indexOnly,
        );
        for (const [pos, src] of part.positions) this.positions.set(pm + pos, src);
        for (const [pos, src] of part.ends) this.ends.set(pm + pos, src);
        for (const [pos, src] of part.boundaries) this.boundaries.set(pm + pos, src);
        this.tokens.push(...part.tokens.map((t) => ({ ...t, pm: t.pm + pm })));
        this.marks.push(
          ...part.marks.map((m) => ({ ...m, pmFrom: m.pmFrom + pm, pmTo: m.pmTo + pm })),
        );
        this.paragraphs.push(
          ...part.paragraphs.map((p) => ({ ...p, end: p.end + pm, next: p.next + pm })),
        );
        this.content.content!.push(...part.content.content!);
        for (const node of part.content.content!)
          pm += 2 + (node.content ?? []).reduce((n, t) => n + (t.text?.length ?? 0), 0);
        this.trailing = part.trailing;
        cursor = to;
      };
      for (const fence of fences) {
        prose(Math.max(cursor, Math.min(end, fence.from)));
        const from = Math.max(start, fence.bodyFrom),
          to = Math.min(end, fence.bodyTo);
        if (to < from) continue;
        const text = indexOnly ? '' : source.slice(from - start, to - start);
        if (!indexOnly) {
          this.content.content!.push({
            type: 'codeBlock',
            attrs: { language: fence.language },
            content: text ? [{ type: 'text', text }] : [],
          });
          const prefix = source.slice(Math.max(start, fence.from) - start, from - start);
          const suffix = source.slice(to - start, Math.min(end, fence.to) - start);
          this.code.push({ pm, end: pm + text.length + 2, fence, prefix, suffix });
          this.boundaries.set(pm, Math.max(start, fence.from));
          for (let i = 0; i <= text.length; i++) this.positions.set(pm + 1 + i, from + i);
          for (let i = 0; i < text.length; i++) {
            this.ends.set(pm + 2 + i, from + i + 1);
            this.tokens.push({
              pm: pm + 1 + i,
              from: from + i,
              to: from + i + 1,
              text: text[i],
              raw: text[i],
              marks: [],
            });
          }
          this.boundaries.set(pm + text.length + 2, Math.min(end, fence.to));
        }
        pm += to - from + 2;
        cursor = Math.min(end, fence.to);
        this.trailing = '';
      }
      prose(end);
      // The native trailing paragraph at the real document end has a caret but no
      // source bytes until the user writes into it. Never add it at a crop edge.
      if (
        !indexOnly &&
        context?.documentEnd &&
        this.content.content!.at(-1)?.type === 'codeBlock'
      ) {
        this.content.content!.push({ type: 'paragraph' });
        this.positions.set(pm + 1, end);
        this.boundaries.set(pm + 2, end);
      }
      return;
    }
    const prefix = context?.before.map(openMark).join('') ?? '';
    const suffix = context?.after.slice().reverse().map(closeMark).join('') ?? '';
    source = prefix + source + suffix;
    start -= prefix.length;
    let pm = 0;
    const paragraphs = /([^]*?)(\n[ \t]+\n+|\n\n+|$)/g;
    let match: RegExpExecArray | null;
    while ((match = paragraphs.exec(source)) && match[0]) {
      const raw = match[1],
        base = start + match.index;
      if (!indexOnly) this.boundaries.set(pm, base);
      pm++;
      if (!indexOnly) this.positions.set(pm, base);
      const nodes: JSONContent[] = [];
      const text = (value: string, from: number, to: number, stack: Mark[]) => {
        if (indexOnly) {
          pm += value.length;
          return;
        }
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
      // Use the existing canonical inline lexer for italic delimiter flanking
      // and escapes. Renderer input is still just this bounded paragraph; the
      // full-source index-only pass remains separately accounted mock backing.
      const italics = new Map<number, number>();
      const indexItalics = (tokens: Token[], offset: number) => {
        for (const token of tokens) {
          if (token.type === 'em') italics.set(offset, offset + token.raw.length);
          if (token.type === 'em' || token.type === 'strong')
            indexItalics(token.tokens!, offset + (token.type === 'em' ? 1 : 2));
          else if (token.type === 'link') indexItalics(token.tokens!, offset + 1);
          offset += token.raw.length;
        }
      };
      if (raw.includes('_') || raw.includes('*'))
        indexItalics(Lexer.lexInline(raw, { gfm: true }), 0);
      for (const mark of [...(context?.before ?? []), ...(context?.after ?? [])]) {
        if (mark.type !== 'italic' || !mark.range) continue;
        let open = mark.range.from - base - 1;
        let end = mark.range.to - base + 1;
        if (mark.range.from <= this.start && match.index === 0) {
          open = 0;
          for (const before of context?.before ?? []) {
            if (before.type === 'italic' && before.range?.from === mark.range.from) break;
            open += openMark(before).length;
          }
        }
        if (mark.range.to >= this.start + this.source.length) {
          end = this.start + this.source.length - base;
          for (const after of (context?.after ?? []).slice().reverse()) {
            end += closeMark(after).length;
            if (after.type === 'italic' && after.range?.to === mark.range.to) break;
          }
        }
        // Cropped whitespace does not become an actual Markdown delimiter edge.
        // These two scalar bounds come from the revisioned backing token index.
        if (open >= 0 && end <= raw.length) italics.set(open, end);
      }
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
          const italicEnd = italics.get(i);
          if (italicEnd !== undefined && italicEnd <= to) {
            contentFrom = i + 1;
            contentTo = italicEnd - 1;
            end = italicEnd;
            mark = { type: 'italic', delimiter: raw[i] };
          } else if (raw.startsWith('**', i)) {
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
              contentFrom: base + contentFrom,
              contentTo: base + contentTo,
              mark,
            });
            i = end;
          } else {
            text(raw[i], i, i + 1, stack);
            i++;
          }
        }
      };
      parse(0, raw.length, []);
      if (!indexOnly)
        this.positions.set(pm, Math.min(this.start + this.source.length, base + raw.length));
      const separator = match[2];
      const emptyParagraphs = /^\n{2,}$/.test(separator)
        ? Math.max(0, separator.length - (raw.length ? 2 : 1))
        : 0;
      const firstSeparator = emptyParagraphs ? separator.slice(0, raw.length ? 2 : 1) : separator;
      if (!indexOnly) this.paragraphs.push({ end: pm, next: pm + 2, separator: firstSeparator });
      if (!indexOnly) this.content.content!.push({ type: 'paragraph', content: nodes });
      pm++;
      let boundary = base + raw.length + firstSeparator.length;
      if (!indexOnly) this.boundaries.set(pm, boundary);
      this.trailing = firstSeparator;
      for (let empty = 0; empty < emptyParagraphs; empty++) {
        if (!indexOnly) {
          this.positions.set(pm + 1, boundary);
          this.paragraphs.push({ end: pm + 1, next: pm + 3, separator: '\n' });
          this.content.content!.push({ type: 'paragraph' });
          this.boundaries.set(pm + 2, ++boundary);
        }
        pm += 2;
        this.trailing = '\n';
      }
    }
    if (!this.content.content!.length) {
      this.content.content!.push({ type: 'paragraph' });
      this.positions.set(1, start);
    }
  }
  sourceAt(pm: number, affinity = 1) {
    if (this.table) return this.table.sourceAt(pm, affinity);
    const source =
      affinity < 0 ? (this.ends.get(pm) ?? this.positions.get(pm)) : this.positions.get(pm);
    const exact = source ?? this.boundaries.get(pm);
    if (exact === undefined) throw new Error(`No exact source provenance at PM ${pm}`);
    return exact;
  }
  pmAt(source: number, affinity = 1) {
    if (this.table) return this.table.pmAt(source, affinity);
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
  translate(step: Step, before: PMNode, codeContext?: (fences: Fence[]) => void): Splice[] {
    if (this.table)
      return this.table.translate(step, before, (pm, affinity) => this.sourceAt(pm, affinity));
    if (this.list) return this.list.translate(step, before);
    const applied = step.apply(before);
    if (!applied.doc) throw new Error(applied.failed ?? 'Invalid proof step');
    const after = canonicalBold(applied.doc, this.context),
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
    const nextFences: Fence[] = [];
    after.forEach((paragraph, offset, index) => {
      if (paragraph.type.name === 'codeBlock') {
        const original = this.code.find((c) => mapping.map(c.pm, -1) === offset);
        if (!original) throw new Error('Missing code source provenance');
        let suffix = original.suffix;
        const following = index + 1 < after.childCount ? after.child(index + 1) : undefined;
        if (following?.textContent && !suffix.endsWith('\n\n'))
          suffix += suffix.endsWith('\n') ? '\n' : '\n\n';
        const start = this.start + source.length;
        const bodyEnd = start + original.prefix.length + paragraph.textContent.length;
        nextFences.push({
          ...original.fence,
          from: original.prefix ? start : original.fence.from,
          bodyFrom: original.prefix ? start + original.prefix.length : original.fence.bodyFrom,
          bodyTo: original.suffix
            ? bodyEnd
            : original.fence.bodyTo + paragraph.content.size - (original.end - original.pm - 2),
          to: original.suffix
            ? bodyEnd + suffix.length
            : original.fence.to + paragraph.content.size - (original.end - original.pm - 2),
        });
        source += original.prefix + paragraph.textContent + suffix;
        return;
      }
      if (paragraph.type.name !== 'paragraph')
        throw new Error(`Unsupported proof node ${paragraph.type.name}`);
      let active: Mark[] = index === 0 ? (this.context?.before ?? []) : [];
      const close = closeMark;
      const open = openMark;
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
        if (desired.some((m) => !['bold', 'italic', 'link'].includes(m.type)))
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
      transition(index === after.childCount - 1 ? (this.context?.after ?? []) : []);
      const end = offset + paragraph.nodeSize - 1;
      source += index < after.childCount - 1 ? separators.get(end) || '\n\n' : this.trailing;
    });
    let from = 0,
      oldEnd = this.source.length,
      newEnd = source.length;
    while (from < oldEnd && from < newEnd && this.source[from] === source[from]) from++;
    while (oldEnd > from && newEnd > from && this.source[oldEnd - 1] === source[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    // Verify the entire bounded projection BEFORE admitting a source/journal mutation.
    const projected = before.type.schema.nodeFromJSON(
      new SourceProjection(
        source,
        this.start,
        this.context && { ...this.context, to: this.start + source.length, fences: nextFences },
      ).content,
    );
    if (!projected.eq(after)) throw new Error('Translated source differs from accepted document');
    // These describe the intended native code bodies, before Markdown framing is
    // checked by the backing service. A raw body may itself contain closing syntax.
    codeContext?.(nextFences);
    return from === oldEnd && from === newEnd
      ? []
      : [{ from: this.start + from, to: this.start + oldEnd, insert: source.slice(from, newEnd) }];
  }
}
