import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Step } from '@tiptap/pm/transform';
import type { Splice } from './source-journal';

/** Exact provenance for the proof grammar: paragraphs, bold and links. Never a fuzzy alignment. */
export class SourceProjection {
  readonly content: JSONContent = { type: 'doc', content: [] };
  readonly positions = new Map<number, number>();
  readonly ends = new Map<number, number>();
  readonly marks: Array<{
    type: string;
    pmFrom: number;
    pmTo: number;
    openFrom: number;
    closeTo: number;
    open: string;
    close: string;
  }> = [];
  constructor(
    readonly source: string,
    readonly start = 0,
  ) {
    let pm = 0;
    const paragraphs = /([^]*?)(\n[ \t]+\n+|\n\n|$)/g;
    let match: RegExpExecArray | null;
    while ((match = paragraphs.exec(source)) && match[0]) {
      const raw = match[1];
      if (!raw && match.index === source.length) break;
      const nodes: JSONContent[] = [];
      pm++;
      this.positions.set(pm, start + match.index);
      const inline = /\*\*([^]*?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
      let consumed = 0;
      const text = (value: string, offset: number, marks?: JSONContent['marks']) => {
        if (value) nodes.push({ type: 'text', text: value, ...(marks ? { marks } : {}) });
        for (let i = 0; i < value.length; i++) {
          this.positions.set(pm + i, start + match!.index + offset + i);
          this.ends.set(pm + i + 1, start + match!.index + offset + i + 1);
        }
        if (value)
          this.positions.set(pm + value.length, start + match!.index + offset + value.length);
        pm += value.length;
      };
      for (const token of raw.matchAll(inline)) {
        text(raw.slice(consumed, token.index), consumed);
        const pmFrom = pm;
        if (token[1] !== undefined) text(token[1], token.index! + 2, [{ type: 'bold' }]);
        else text(token[2], token.index! + 1, [{ type: 'link', attrs: { href: token[3] } }]);
        const prefix = token[1] !== undefined ? 2 : 1;
        const label = token[1] ?? token[2];
        this.marks.push({
          type: token[1] !== undefined ? 'bold' : 'link',
          pmFrom,
          pmTo: pm,
          openFrom: start + match.index + token.index!,
          closeTo: start + match.index + token.index! + token[0].length,
          open: token[0].slice(0, prefix),
          close: token[0].slice(prefix + label.length),
        });
        consumed = token.index! + token[0].length;
      }
      text(raw.slice(consumed), consumed);
      this.positions.set(pm, start + match.index + raw.length);
      this.content.content!.push({ type: 'paragraph', content: nodes });
      pm++;
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
    const json = step.toJSON();
    let from = this.sourceAt(json.from),
      to = json.from === json.to ? from : this.sourceAt(json.to, -1);
    if (json.stepType === 'addMark' && json.mark.type === 'bold')
      return [
        { from: to, to, insert: '**' },
        { from, to: from, insert: '**' },
      ];
    if (json.stepType === 'removeMark' && json.mark.type === 'bold') {
      if (
        this.source.slice(from - this.start - 2, from - this.start) !== '**' ||
        this.source.slice(to - this.start, to - this.start + 2) !== '**'
      )
        throw new Error('Partial bold removal not supported by proof grammar');
      return [
        { from: to, to: to + 2, insert: '' },
        { from: from - 2, to: from, insert: '' },
      ];
    }
    if (json.stepType !== 'replace') throw new Error(`Unsupported proof step: ${json.stepType}`);
    const slice = json.slice;
    let prefix = '',
      suffix = '';
    const crossed: string[] = [];
    for (const mark of this.marks) {
      if (json.from === json.to) continue;
      if (json.from <= mark.pmFrom && json.to >= mark.pmTo) {
        from = Math.min(from, mark.openFrom);
        to = Math.max(to, mark.closeTo);
      } else if (json.from > mark.pmFrom && json.from < mark.pmTo && json.to > mark.pmTo) {
        prefix += mark.close;
        crossed.push(mark.type);
      } else if (json.from < mark.pmFrom && json.to > mark.pmFrom && json.to < mark.pmTo) {
        suffix += mark.open;
      }
    }
    const contextMarks = before
      .resolve(json.from)
      .marks()
      .filter((mark) => !crossed.includes(mark.type.name));
    const inline = (node: JSONContent): string => {
      if (node.type === 'text') {
        let value = node.text ?? '';
        for (const mark of node.marks ?? []) {
          if (contextMarks.some((m) => m.type.name === mark.type)) continue;
          if (mark.type === 'bold') value = `**${value}**`;
          else if (mark.type === 'link') value = `[${value}](${mark.attrs?.href})`;
          else throw new Error(`Unsupported inserted mark ${mark.type}`);
        }
        return value;
      }
      if (node.type !== 'paragraph') throw new Error(`Unsupported inserted node ${node.type}`);
      return (node.content ?? []).map(inline).join('');
    };
    const nodes: JSONContent[] = slice?.content ?? [];
    const insert = nodes.map(inline).join(nodes.some((n) => n.type === 'paragraph') ? '\n\n' : '');
    return [{ from, to, insert: prefix + insert + suffix }];
  }
}
