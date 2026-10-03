import { Lexer } from 'marked';
/** Mock backing index for tight, one-paragraph list items. Never a renderer full-document scan. */
export type ListItem = {
  from: number;
  body: number;
  end: number;
  to: number;
  indent: number;
  parent: number;
  ordinal: number;
  kind: 'bulletList' | 'orderedList' | 'taskList';
  prefix: string;
  marker: string;
  group?: number;
};
export function scanLists(source: string): ListItem[] {
  const result: ListItem[] = [];
  const stack: ListItem[] = [];
  for (const match of source.matchAll(/^( *)([-+*]|\d+[.)]) (?:\[([ xX/])\] )?([^\n]*)(\n|$)/gm)) {
    const indent = match[1].length;
    while (stack.length && stack.at(-1)!.indent > indent) stack.pop();
    const previous = stack.at(-1)?.indent === indent ? stack.pop() : undefined;
    const kind =
      match[3] !== undefined ? 'taskList' : /^\d/.test(match[2]) ? 'orderedList' : 'bulletList';
    const marker = /^\d/.test(match[2]) ? match[2].slice(-1) : match[2];
    const prefix = match[0].slice(0, match[0].length - match[4].length - match[5].length);
    const item: ListItem = {
      from: match.index!,
      body: match.index! + prefix.length,
      end: match.index! + match[0].length - match[5].length,
      to: match.index! + match[0].length,
      indent,
      parent: stack.at(-1)?.from ?? -1,
      ordinal:
        previous &&
        previous.kind === kind &&
        previous.marker === marker &&
        !source
          .slice(previous.to, match.index)
          .split('\n')
          .some((line) => line.trim() && line.search(/\S/) <= indent)
          ? previous.ordinal + 1
          : kind === 'orderedList'
            ? Number.parseInt(match[2])
            : 1,
      kind,
      prefix,
      marker,
    };
    result.push(item);
    stack.push(item);
  }
  // Extend only a canonical list text token. The backing lexer determines
  // lazy continuation ownership; unadmitted trailing lines never enter a view.
  const starts = new Set(result.map((item) => item.from));
  for (const item of result) {
    if (item.to >= source.length || starts.has(item.to) || source[item.to] === '\n') continue;
    const token = Lexer.lex(source.slice(item.from + item.indent), { gfm: true })[0];
    if (token?.type !== 'list') continue;
    const first = token.items[0]?.tokens[0];
    if (first?.type !== 'text' || !first.text.includes('\n')) continue;
    // Native lazy continuations keep their literal source spelling. Indented
    // lines requiring a separate offset map are not guessed here.
    if (source.startsWith(first.text, item.body)) {
      item.end = item.body + first.text.length;
      item.to = item.end + Number(source[item.end] === '\n');
    }
  }
  return result;
}

export type ListSeam = { from: number; kind: ListItem['kind']; start: number };
