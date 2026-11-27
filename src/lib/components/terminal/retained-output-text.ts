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

const OVERLAP_PROBE_CHARS = 1024;
const OVERLAP_MAX_CANDIDATES = 256;

/**
 * Joins a capped snapshot to live output that may already hold its start. The
 * log and the stream carry the same PTY bytes, so a live tail that matches the
 * snapshot head exactly is the same output. Returns the snapshot part to write
 * after the live output (empty when live output holds all of it), or undefined
 * when no live tail matches. Of the nearest candidates the longest overlap
 * wins; a wrong match on a repeated line can repeat output but never hide it.
 */
export function snapshotRemainderAfterLive(live: string, snapshotText: string): string | undefined {
  const body = snapshotText.replace(HEADER, '');
  if (!live || !body) return undefined;
  const lineEnd = body.indexOf('\n');
  const probe = body.slice(
    0,
    Math.min(lineEnd < 0 ? body.length : lineEnd + 1, OVERLAP_PROBE_CHARS),
  );
  let remainder: string | undefined;
  let at = live.lastIndexOf(probe);
  for (let tries = 0; at >= 0 && tries < OVERLAP_MAX_CANDIDATES; tries++) {
    const tail = live.slice(at);
    if (tail.startsWith(body)) return '';
    if (body.startsWith(tail)) remainder = body.slice(tail.length);
    at = at > 0 ? live.lastIndexOf(probe, at - 1) : -1;
  }
  return remainder;
}
