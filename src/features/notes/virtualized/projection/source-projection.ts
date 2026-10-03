import { TableSourceView, sourcePayloadBytes, sourceLogicalBytes } from './table-source-view';
import type { ListCode } from './list-code';
import { mapParagraphSeam, touchesParagraphSeam, type ParagraphSeam } from './paragraph-seam';
import { Lexer, type Token as MarkdownToken } from 'marked';
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { Selection } from './source-types';
import { Transform, type Step } from '@tiptap/pm/transform';
import type { Splice } from './source-types';
import { scanFences, type Fence } from './fence-context';
import type { ListItem, ListSeam } from './list-context';
import { ListProjection } from './list-projection';
import { TableProjection } from './table-projection';
import { MixedProjection } from './mixed-projection';
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
  atomic?: { from: number; to: number; node: JSONContent };
  atoms?: Array<{ from: number; to: number; node: JSONContent }>;
  headings?: Array<{ from: number; to: number; bodyFrom: number; bodyTo: number; level: number }>;
  textblock?: { type: 'heading'; attrs: { level: number } };
  revision: number;
  from: number;
  to: number;
  before: Mark[];
  after: Mark[];
  fences?: Fence[];
  lists?: ListItem[];
  listCodes?: ListCode[];
  seams?: ListSeam[];
  paragraphSeams?: ParagraphSeam[];
  listParagraph?: boolean;
  literalNewlines?: Array<{ from: number; to: number }>;
  documentEnd?: boolean;
  table?: TableWindow;
  tables?: TableWindow[];
  fragments?: Array<{ source: string; start: number; context: InlineContext }>;
};
export const openMark = (mark: Mark) => {
  if (mark.type === 'bold') return mark.delimiter ?? '**';
  if (mark.type === 'italic') return mark.delimiter ?? '*';
  if (mark.type === 'strike') return '~~';
  if (mark.type === 'code') return mark.delimiter ?? '`';
  return '[';
};
export const closeMark = (mark: Mark) =>
  mark.type === 'link' ? `](${mark.attrs?.href})` : openMark(mark);
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
  readonly anchorRanges: Array<{ from: number; to: number }> = [];
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
  private paragraphTails = new Map<number, string>();
  private leading = '';
  readonly addedParagraphSeams: ParagraphSeam[] = [];
  readonly list?: ListProjection;
  readonly table?: TableProjection;
  readonly mixed?: MixedProjection;
  readonly source!: string;
  readonly tableSource?: TableSourceView;
  get sourcePayload() {
    return this.tableSource ?? this.source;
  }
  get sourcePayloadBytes() {
    return sourcePayloadBytes(this.sourcePayload);
  }
  get sourceLogicalBytes() {
    return sourceLogicalBytes(this.sourcePayload);
  }
  constructor(
    source: string | TableSourceView,
    readonly start = 0,
    readonly context?: InlineContext,
    indexOnly = false,
  ) {
    if (source instanceof TableSourceView) {
      if (
        !context?.table ||
        !source.owns(context.table) ||
        indexOnly ||
        context.fragments ||
        context.tables
      )
        throw new Error('Invalid standalone packed cell source');
      this.tableSource = source;
      Object.defineProperty(this, 'source', {
        get() {
          throw new Error('Standalone table uses packed cell source');
        },
      });
    } else {
      if (context?.table?.sourceOwnership === 'packed-cells')
        throw new Error('Copied source cannot use packed cell source accounting');
      this.source = source;
    }
    if (context?.atomic && !indexOnly) {
      this.content.content = [context.atomic.node];
      this.positions.set(0, context.atomic.from);
      this.positions.set(1, context.atomic.to);
      this.ends.set(1, context.atomic.to);
      return;
    }
    if (context?.atoms?.length && !indexOnly) {
      if (typeof source !== 'string') throw new Error('Atomic projection requires admitted source');
      const fragments: NonNullable<InlineContext['fragments']> = [];
      const end = start + source.length;
      let cursor = start;
      const append = (from: number, to: number, atomic?: NonNullable<InlineContext['atomic']>) => {
        if (to <= from) return;
        const raw = this.source.slice(from - start, to - start);
        if (!atomic && !raw.trim()) return;
        fragments.push({
          source: raw,
          start: from,
          context: {
            ...context,
            from,
            to,
            atoms: undefined,
            fragments: undefined,
            atomic,
            before: from === start ? context.before : [],
            after: to === end ? context.after : [],
            documentEnd: to === end && context.documentEnd,
          },
        });
      };
      for (const atom of context.atoms) {
        if (atom.from < start || atom.to > end)
          throw new Error('Atomic payload requires a bounded reference consumer');
        append(cursor, atom.from);
        append(atom.from, atom.to, atom);
        cursor = atom.to;
      }
      append(cursor, end);
      this.mixed = new MixedProjection(
        source,
        start,
        { ...context, atoms: undefined, fragments },
        [],
      );
      this.content.content = this.mixed.content.content;
      for (const [p, s] of this.mixed.positions) this.positions.set(p, s);
      for (const [p, s] of this.mixed.ends) this.ends.set(p, s);
      for (const [p, s] of this.mixed.boundaries) this.boundaries.set(p, s);
      this.tokens.push(...this.mixed.tokens);
      return;
    }
    if ((context?.tables?.length || context?.fragments?.length) && !indexOnly) {
      this.mixed = new MixedProjection(this.source, start, context, context.tables ?? []);
      this.content.content = this.mixed.content.content;
      for (const [p, s] of this.mixed.positions) this.positions.set(p, s);
      for (const [p, s] of this.mixed.ends) this.ends.set(p, s);
      for (const [p, s] of this.mixed.boundaries) this.boundaries.set(p, s);
      this.tokens.push(...this.mixed.tokens);
      return;
    }
    if (context?.table && !indexOnly) {
      this.table = new TableProjection(context.table);
      this.content.content = this.table.content.content;
      for (const [p, s] of this.table.positions) this.positions.set(p, s);
      for (const [p, s] of this.table.ends) this.ends.set(p, s);
      for (const [p, s] of this.table.boundaries) this.boundaries.set(p, s);
      this.tokens.push(...this.table.tokens);
      return;
    }
    if (typeof source !== 'string') throw new Error('Missing table source owner');
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
    if (context?.headings?.length && !indexOnly) {
      const fragments: NonNullable<InlineContext['fragments']> = [];
      const end = start + source.length;
      let cursor = start;
      const append = (from: number, to: number, level?: number) => {
        if (to <= from) return;
        const raw = this.source.slice(from - start, to - start);
        if (level === undefined && !raw.trim()) return;
        const leading = level === undefined ? (raw.match(/^\r?\n(?:\r?\n)*/)?.[0].length ?? 0) : 0;
        const trailing = level === undefined ? (raw.match(/(?:\r?\n)+$/)?.[0].length ?? 0) : 0;
        from += leading;
        to = Math.max(from, to - trailing);
        fragments.push({
          source: this.source.slice(from - start, to - start),
          start: from,
          context: {
            ...context,
            from,
            to,
            headings: undefined,
            fragments: undefined,
            before: from === start ? context.before : [],
            after: to === end ? context.after : [],
            ...(level === undefined ? {} : { textblock: { type: 'heading', attrs: { level } } }),
            documentEnd: to === end && context.documentEnd,
          },
        });
      };
      for (const heading of context.headings) {
        if (heading.to <= start || heading.from >= end) continue;
        append(cursor, Math.max(cursor, Math.min(end, heading.from)));
        append(Math.max(start, heading.bodyFrom), Math.min(end, heading.bodyTo), heading.level);
        cursor = Math.max(cursor, Math.min(end, heading.to));
      }
      append(cursor, end);
      this.mixed = new MixedProjection(
        source,
        start,
        { ...context, headings: undefined, fragments },
        [],
      );
      this.content.content = this.mixed.content.content;
      for (const [p, s] of this.mixed.positions) this.positions.set(p, s);
      for (const [p, s] of this.mixed.ends) this.ends.set(p, s);
      for (const [p, s] of this.mixed.boundaries) this.boundaries.set(p, s);
      this.tokens.push(...this.mixed.tokens);
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
          this.source.slice(cursor - start, to - start),
          cursor,
          {
            revision: context?.revision ?? 0,
            from: cursor,
            to,
            before: cursor === start ? (context?.before ?? []) : [],
            after: to === end ? (context?.after ?? []) : [],
            fences: [],
            paragraphSeams: context?.paragraphSeams
              ?.filter((seam) => seam.from < to && seam.to > cursor)
              .map((seam) =>
                !seam.kind && seam.from === cursor && cursor > start
                  ? { ...seam, kind: 'leading' as const }
                  : seam,
              ),
          },
          indexOnly,
        );
        for (const [pos, src] of part.positions) this.positions.set(pm + pos, src);
        for (const [pos, src] of part.ends) this.ends.set(pm + pos, src);
        for (const [pos, src] of part.boundaries) this.boundaries.set(pm + pos, src);
        this.tokens.push(...part.tokens.map((t) => ({ ...t, pm: t.pm + pm })));
        this.anchorRanges.push(...part.anchorRanges);
        this.marks.push(
          ...part.marks.map((m) => ({ ...m, pmFrom: m.pmFrom + pm, pmTo: m.pmTo + pm })),
        );
        this.paragraphs.push(
          ...part.paragraphs.map((p) => ({ ...p, end: p.end + pm, next: p.next + pm })),
        );
        this.content.content!.push(...part.content.content!);
        for (const node of part.content.content!)
          pm +=
            2 +
            (node.content ?? []).reduce(
              (n, t) => n + (t.type === 'commentAnchor' ? 1 : (t.text?.length ?? 0)),
              0,
            );
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
    const paragraphs = /([^]*?)(^(?:\r?\n)+|\r?\n[ \t]+(?:\r?\n)+|(?:\r?\n){2,}|$)/g;
    let match: RegExpExecArray | null;
    while ((match = paragraphs.exec(source)) && match[0]) {
      const split =
        !indexOnly &&
        context?.paragraphSeams?.find(
          (seam) =>
            seam.kind === 'split' &&
            seam.from >= start + match!.index &&
            seam.from < start + match!.index + match![1].length,
        );
      if (split) {
        const raw = source.slice(match.index, split.from - start);
        match[0] = raw + source.slice(split.from - start, split.to - start);
        match[1] = raw;
        match[2] = source.slice(split.from - start, split.to - start);
        paragraphs.lastIndex = split.to - start;
      }
      if (context?.listParagraph) {
        match[0] = source;
        match[1] = source;
        match[2] = '';
        paragraphs.lastIndex = source.length;
      }
      const raw = match[1];
      let base = start + match.index;
      const leading =
        !raw &&
        !indexOnly &&
        context?.paragraphSeams?.find(
          (seam) =>
            seam.kind === 'leading' && seam.from === base && seam.to <= base + match![2].length,
        );
      if (leading) {
        this.leading += source.slice(match.index, leading.to - start);
        // Only the recorded deletion boundary disappears from the live tree.
        // Remaining LF/CRLF separators still represent surviving blank paragraphs.
        match[2] = match[2].slice(leading.to - base);
        base = leading.to;
        if (!match[2]) continue;
      }
      if (!indexOnly) this.boundaries.set(pm, base);
      pm++;
      if (!indexOnly) this.positions.set(pm, base);
      const nodes: JSONContent[] = [];
      const text = (value: string, from: number, to: number, stack: Mark[]) => {
        if (indexOnly) {
          pm += value.length;
          return;
        }
        // DOMParser collapses horizontal whitespace in normal paragraph text.
        // Retain the entire raw run as one token so edits preserve its bytes.
        if (/^[ \t]$/.test(value) && !stack.some((mark) => mark.type === 'code')) {
          value = ' ';
          const prior = this.tokens.at(-1);
          if (
            prior?.text === ' ' &&
            prior.pm + 1 === pm &&
            prior.to === base + from &&
            !context?.paragraphSeams?.some(
              (seam) => seam.kind === 'space' && seam.from === base + from,
            ) &&
            JSON.stringify(prior.marks) === JSON.stringify(stack)
          ) {
            prior.to = base + to;
            prior.raw += raw.slice(from, to);
            this.positions.set(pm, base + to);
            this.ends.set(pm, base + to);
            return;
          }
        }
        const previous = nodes.at(-1);
        if (previous?.type === 'text' && JSON.stringify(previous.marks) === JSON.stringify(stack))
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
      const strong = new Map<number, number>();
      const strike = new Map<number, number>();
      const codes = new Map<number, { raw: string; text: string }>();
      const indexItalics = (tokens: MarkdownToken[], offset: number) => {
        for (const token of tokens) {
          if (token.type === 'em') italics.set(offset, offset + token.raw.length);
          if (token.type === 'strong') strong.set(offset, offset + token.raw.length);
          if (token.type === 'del') strike.set(offset, offset + token.raw.length);
          if (token.type === 'codespan' && typeof token.text === 'string')
            codes.set(offset, { raw: token.raw, text: token.text });
          if (token.type === 'em' || token.type === 'strong' || token.type === 'del')
            indexItalics(token.tokens!, offset + (token.type === 'em' ? 1 : 2));
          else if (token.type === 'link') indexItalics(token.tokens!, offset + 1);
          offset += token.raw.length;
        }
      };
      if (/[_*`~]/.test(raw)) indexItalics(Lexer.lexInline(raw, { gfm: true }), 0);
      for (const mark of [...(context?.before ?? []), ...(context?.after ?? [])]) {
        if (!['italic', 'bold'].includes(mark.type) || !mark.range) continue;
        const width = mark.type === 'bold' ? 2 : 1;
        let open = mark.range.from - base - width;
        let end = mark.range.to - base + width;
        if (mark.range.from <= this.start && match.index === 0) {
          open = 0;
          for (const before of context?.before ?? []) {
            if (before.type === mark.type && before.range?.from === mark.range.from) break;
            open += openMark(before).length;
          }
        }
        if (mark.range.to >= this.start + this.source.length) {
          end = this.start + this.source.length - base;
          for (const after of (context?.after ?? []).slice().reverse()) {
            end += closeMark(after).length;
            if (after.type === mark.type && after.range?.to === mark.range.to) break;
          }
        }
        // Cropped whitespace does not become an actual Markdown delimiter edge.
        // These two scalar bounds come from the revisioned backing token index.
        if (open >= 0 && end <= raw.length) {
          if (mark.type === 'bold') {
            // Local edits can split an inherited span. Its old outer range must
            // not override actual closing/opening delimiters inside this crop.
            const firstClose = closing('**', open + width, end);
            if (firstClose >= 0) strong.set(open, firstClose + width);
            if (mark.range.to >= this.start + this.source.length) {
              let lastOpen = open;
              for (
                let next = closing('**', open + width, end - width);
                next >= 0;
                next = closing('**', next + width, end - width)
              )
                lastOpen = next;
              strong.set(lastOpen, end);
            }
          } else italics.set(open, end);
        }
      }
      const parse = (from: number, to: number, stack: Mark[]) => {
        for (let i = from; i < to;) {
          if (
            raw[i] === '\n' &&
            context?.listParagraph &&
            !context.literalNewlines?.some((range) => base + i >= range.from && base + i < range.to)
          ) {
            if (!indexOnly) {
              nodes.push({ type: 'hardBreak', marks: stack });
              this.tokens.push({
                pm,
                from: base + i,
                to: base + i + 1,
                text: '\n',
                raw: '\n',
                marks: stack,
              });
              this.positions.set(pm, base + i);
              this.ends.set(pm + 1, base + i + 1);
              this.positions.set(pm + 1, base + i + 1);
            }
            pm++;
            i++;
            continue;
          }
          const anchor = raw.startsWith('<!--anchor:', i)
            ? raw.slice(i, to).match(/^<!--anchor:([^:]+):(start|end|point)-->/)
            : null;
          if (anchor) {
            this.anchorRanges.push({ from: base + i, to: base + i + anchor[0].length });
            if (!indexOnly) {
              nodes.push({
                type: 'commentAnchor',
                attrs: {
                  id: `${anchor[1]}:${anchor[2]}`,
                  type: anchor[2],
                  commentId: anchor[1],
                },
                marks: stack,
              });
              this.positions.set(pm, base + i);
              this.ends.set(pm + 1, base + i + anchor[0].length);
              this.tokens.push({
                pm,
                from: base + i,
                to: base + i + anchor[0].length,
                raw: anchor[0],
                text: '\ufffc',
                marks: stack,
              });
              this.positions.set(pm + 1, base + i + anchor[0].length);
            }
            pm++;
            i += anchor[0].length;
            continue;
          }
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
          } else if (strong.has(i)) {
            const close = (strong.get(i) ?? -1) - 2;
            if (close > i + 2 && close + 2 <= to) {
              contentFrom = i + 2;
              contentTo = close;
              end = close + 2;
              mark = { type: 'bold', ...(raw.startsWith('__', i) ? { delimiter: '__' } : {}) };
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
          if (!mark && strike.has(i)) {
            contentFrom = i + 2;
            end = strike.get(i)!;
            contentTo = end - 2;
            mark = { type: 'strike' };
          }
          const code = codes.get(i);
          if (!mark && code && i + code.raw.length <= to) {
            const delimiter = code.raw.match(/^`+/)![0];
            const body = code.raw.slice(delimiter.length, -delimiter.length).replace(/\r?\n/g, ' ');
            const trim = body.startsWith(' ') && body.endsWith(' ') && /[^ ]/.test(body) ? 1 : 0;
            let cursor = i + delimiter.length + trim;
            for (const value of code.text.split('')) {
              const width = raw.startsWith('\r\n', cursor) ? 2 : 1;
              text(value, cursor, cursor + width, [...stack, { type: 'code', delimiter }]);
              cursor += width;
            }
            i += code.raw.length;
            continue;
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
      if (!indexOnly && (match[2] || !context || context.documentEnd)) {
        const token = this.tokens.at(-1),
          node = nodes.at(-1);
        if (
          token?.text === ' ' &&
          !token.marks.length &&
          token.pm + 1 === pm &&
          token.to === base + raw.length &&
          !context?.paragraphSeams?.some(
            (seam) =>
              (seam.kind === 'space' || seam.kind === 'trailing-space') && seam.to === token.to,
          ) &&
          node?.type === 'text'
        ) {
          this.paragraphTails.set(pm - 1, token.raw);
          this.tokens.pop();
          node.text = node.text!.slice(0, -1);
          if (!node.text) nodes.pop();
          this.positions.delete(pm);
          this.ends.delete(pm);
          pm--;
          this.positions.set(pm, token.from);
          this.ends.set(pm, token.from);
        }
      }
      if (!indexOnly)
        this.positions.set(pm, Math.min(this.start + this.source.length, base + raw.length));
      const separator = match[2];
      const suppressed = indexOnly
        ? 0
        : (context?.paragraphSeams ?? []).filter(
            (seam) =>
              !seam.kind &&
              seam.from >= base + raw.length &&
              seam.to <= base + raw.length + separator.length,
          ).length;
      const newlines = separator.match(/\r?\n/g) ?? [];
      const explicitBoundary =
        !indexOnly &&
        context?.paragraphSeams?.some(
          (seam) => seam.kind === 'split' && seam.from === base + raw.length,
        );
      const emptyParagraphs = /^(?:\r?\n){2,}$/.test(separator)
        ? Math.max(0, newlines.length - (raw.length && !explicitBoundary ? 2 : 1) - suppressed)
        : 0;
      const firstSeparator = emptyParagraphs
        ? newlines.slice(0, (raw.length && !explicitBoundary ? 2 : 1) + suppressed).join('')
        : separator;
      if (!indexOnly) this.paragraphs.push({ end: pm, next: pm + 2, separator: firstSeparator });
      if (!indexOnly)
        this.content.content!.push({
          ...(context?.textblock ?? { type: 'paragraph' }),
          content: nodes,
        });
      pm++;
      let boundary = base + raw.length + firstSeparator.length;
      if (!indexOnly) this.boundaries.set(pm, boundary);
      this.trailing = firstSeparator;
      for (let empty = 0; empty < emptyParagraphs; empty++) {
        if (!indexOnly) {
          this.positions.set(pm + 1, boundary);
          this.paragraphs.push({ end: pm + 1, next: pm + 3, separator: newlines.at(-1)! });
          this.content.content!.push({ type: 'paragraph' });
          this.boundaries.set(pm + 2, (boundary += newlines.at(-1)!.length));
        }
        pm += 2;
        this.trailing = newlines.at(-1)!;
      }
    }
    if (
      !indexOnly &&
      context?.paragraphSeams?.some(
        (seam) => seam.kind === 'terminal' && seam.to === this.start + this.source.length,
      )
    ) {
      this.positions.set(pm + 1, this.start + this.source.length);
      this.content.content!.push({ type: 'paragraph' });
      this.trailing = '';
    }
    if (!this.content.content!.length) {
      this.content.content!.push({ type: 'paragraph' });
      this.positions.set(1, start);
    }
  }
  restoreNodeSelection(doc: PMNode, selection: Selection) {
    if (!selection.node) return undefined;
    let found: NodeSelection | undefined;
    doc.descendants((node, pos) => {
      if (
        !found &&
        node.type.name === selection.node!.type &&
        this.boundaries.get(pos) === selection.node!.from &&
        NodeSelection.isSelectable(node)
      )
        found = NodeSelection.create(doc, pos);
    });
    return found;
  }
  sourceAt(pm: number, affinity = 1) {
    if (this.table) return this.table.sourceAt(pm, affinity);
    const source =
      affinity < 0 ? (this.ends.get(pm) ?? this.positions.get(pm)) : this.positions.get(pm);
    const exact = source ?? this.boundaries.get(pm) ?? this.mixed?.sourceAt(pm, affinity);
    if (exact === undefined) throw new Error(`No exact source provenance at PM ${pm}`);
    return exact;
  }
  pmAt(source: number, affinity = 1) {
    if (this.table) return this.table.pmAt(source, affinity);
    const mixed = this.mixed?.pmAt(source, affinity);
    if (mixed !== undefined) return mixed;
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
    if (this.context?.atomic)
      throw new Error('Atomic node edits require the document operation owner');
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
    const tails = new Map<number, string>();
    for (const [end, raw] of this.paragraphTails) {
      const mapped = mapping.mapResult(end, 1);
      if (!mapped.deleted) tails.set(mapped.pos, raw);
    }
    const separators = new Map<number, string>();
    for (const paragraph of this.paragraphs) {
      const end = mapping.mapResult(paragraph.end, 1),
        next = mapping.mapResult(paragraph.next, -1);
      if (!end.deleted && !next.deleted && next.pos === end.pos + 2) {
        // A split at a paragraph's end transfers its separator to the new empty
        // paragraph. Empty paragraphs consume one newline, not the two that
        // separated the original nonempty paragraph from its neighbor.
        const becameEmpty =
          before.resolve(paragraph.end).parent.content.size > 0 &&
          after.resolve(end.pos).parent.content.size === 0;
        separators.set(
          end.pos,
          becameEmpty && paragraph.separator.startsWith('\n\n')
            ? paragraph.separator.slice(1)
            : paragraph.separator,
        );
      }
    }
    let source = this.leading;
    this.addedParagraphSeams.length = 0;
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
      if (
        paragraph.type.name !== 'paragraph' &&
        !(
          this.context?.textblock?.type === 'heading' &&
          paragraph.type.name === 'heading' &&
          paragraph.attrs.level === this.context.textblock.attrs.level
        )
      )
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
        if (node.type.name === 'commentAnchor') {
          const token = survivors.get(offset + 1 + inner);
          transition(node.marks.map((m) => ({ type: m.type.name, attrs: m.attrs })));
          const marker = `<!--anchor:${node.attrs.commentId}:${node.attrs.type}-->`;
          source += token?.raw === marker ? token.raw : marker;
          return;
        }
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
          // Separate surviving native spaces may become adjacent after a deletion.
          // Record their source boundary; a genuinely fresh parse still collapses them.
          if (/^[ \t]$/.test(char) && /[ \t]$/.test(source))
            this.addedParagraphSeams.push({
              from: this.start + source.length,
              to: this.start + source.length + 1,
              kind: 'space',
            });
          source += token?.text === char ? token.raw : escape(char);
        }
      });
      transition(index === after.childCount - 1 ? (this.context?.after ?? []) : []);
      const end = offset + paragraph.nodeSize - 1;
      // A native split can leave a surviving space at the true paragraph end.
      // Preserve its live width without changing bytes or fresh parser behavior.
      if (
        paragraph.lastChild?.isText &&
        /[ \t]$/.test(paragraph.lastChild.text!) &&
        /[ \t]$/.test(source) &&
        !this.addedParagraphSeams.some((seam) => seam.from === this.start + source.length - 1)
      )
        this.addedParagraphSeams.push({
          from: this.start + source.length - 1,
          to: this.start + source.length,
          kind: 'trailing-space',
        });
      source += tails.get(end) ?? '';
      const separator = separators.get(end);
      const retainSingle =
        this.context?.paragraphSeams?.length &&
        paragraph.content.size &&
        /^(?:\r?\n)$/.test(separator ?? '') &&
        index < after.childCount - 1;
      if (retainSingle)
        this.addedParagraphSeams.push({
          from: this.start + source.length,
          to: this.start + source.length + separator!.length,
          kind: 'split',
        });
      source +=
        index < after.childCount - 1
          ? paragraph.content.size && separator === '\n' && !retainSingle
            ? '\n\n'
            : separator || (paragraph.content.size ? '\n\n' : '\n')
          : this.trailing;
    });
    let from = 0,
      oldEnd = this.source.length,
      newEnd = source.length;
    while (from < oldEnd && from < newEnd && this.source[from] === source[from]) from++;
    while (oldEnd > from && newEnd > from && this.source[oldEnd - 1] === source[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    const splice = {
      from: this.start + from,
      to: this.start + oldEnd,
      insert: source.slice(from, newEnd),
    };
    const paragraphSeams = (this.context?.paragraphSeams ?? [])
      .filter((seam) => !touchesParagraphSeam(seam, splice))
      .map((seam) => mapParagraphSeam(seam, splice))
      .concat(this.addedParagraphSeams);
    // Verify the entire bounded projection BEFORE admitting a source/journal mutation.
    const projected = before.type.schema.nodeFromJSON(
      new SourceProjection(
        source,
        this.start,
        this.context && {
          ...this.context,
          to: this.start + source.length,
          fences: nextFences,
          paragraphSeams,
        },
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
