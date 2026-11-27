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

const COVER_PROBE_CHARS = 1024;
const COVER_MAX_CANDIDATES = 256;

/**
 * Whether live output already holds everything a capped snapshot shows up to
 * the live position. The log and the stream carry the same PTY bytes, so the
 * live tail must match the start of the snapshot body exactly.
 */
export function liveOutputCoversSnapshot(live: string, snapshotText: string): boolean {
  const body = snapshotText.replace(HEADER, '');
  if (!live || !body) return false;
  const lineEnd = body.indexOf('\n');
  const probe = body.slice(0, Math.min(lineEnd < 0 ? body.length : lineEnd + 1, COVER_PROBE_CHARS));
  let at = live.lastIndexOf(probe);
  for (let tries = 0; at >= 0 && tries < COVER_MAX_CANDIDATES; tries++) {
    const tail = live.slice(at);
    if (tail.startsWith(body) || body.startsWith(tail)) return true;
    at = at > 0 ? live.lastIndexOf(probe, at - 1) : -1;
  }
  return false;
}
