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

/**
 * Joins a capped snapshot to live output that may already hold its start. The
 * log and the stream carry the same PTY bytes, so live text that matches the
 * snapshot exactly is the same output. Returns the snapshot part to write after
 * the live output: empty when live output holds the whole snapshot, the rest of
 * the snapshot when the live output ends with at least its first line, and
 * undefined when the two do not join. One KMP pass finds the longest overlap,
 * so repeated lines can repeat output but never hide it.
 */
export function snapshotRemainderAfterLive(live: string, snapshotText: string): string | undefined {
  const body = snapshotText.replace(HEADER, '');
  if (!live || !body) return undefined;
  const failure = new Int32Array(body.length);
  for (let i = 1, k = 0; i < body.length; i++) {
    while (k > 0 && body.charCodeAt(i) !== body.charCodeAt(k)) k = failure[k - 1];
    if (body.charCodeAt(i) === body.charCodeAt(k)) k++;
    failure[i] = k;
  }
  let matched = 0;
  for (let i = 0; i < live.length; i++) {
    const c = live.charCodeAt(i);
    while (matched > 0 && c !== body.charCodeAt(matched)) matched = failure[matched - 1];
    if (c === body.charCodeAt(matched)) matched++;
    if (matched === body.length) return '';
  }
  const firstLine = body.indexOf('\n') + 1;
  return firstLine > 0 && matched >= firstLine ? body.slice(matched) : undefined;
}
