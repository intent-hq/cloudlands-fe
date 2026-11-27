// `script.output` leads with a `[N lines]` or `[showing last N of M lines…]` header.
const HEADER = /^\[(\d+ lines|showing last \d+ of \d+ lines[^\]\n]*)\]\n?/;

/**
 * Terminal text for a retained `script.output` snapshot: the plain line count is
 * dropped, and a header that says older output was left out stays as a dim line.
 */
export function retainedOutputTerminalText(text: string): string {
  const match = HEADER.exec(text);
  if (!match) return text;
  const body = text.slice(match[0].length);
  return match[1].startsWith('showing') ? `\x1b[2m[${match[1]}]\x1b[22m\n${body}` : body;
}
