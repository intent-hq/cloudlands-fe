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

/**
 * Whether a snapshot holds its whole run log: only the plain `[N lines]` header
 * says so. A capped reply, or one cut to the renderer's size limit, is a tail.
 */
export function retainedOutputIsComplete(text: string): boolean {
  return /^\[\d+ lines\]/.test(text);
}
