/**
 * Paged list reads (protocol §5.2 "Bounded note and comment reads").
 *
 * A paged daemon read answers one page plus `nextToken` (an opaque string, or
 * `null` on the last page). A daemon without paging ignores `limit` /
 * `nextToken` and answers the whole list with no `nextToken`, so the same loop
 * works against both.
 */

/** Hard stop for a page walk, so a misbehaving daemon cannot loop forever. */
export const MAX_LIST_PAGES = 1_000;

/** The continuation token of a paged result, or `undefined` at the end. */
export function nextPageToken(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const token = (result as { nextToken?: unknown }).nextToken;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * Read every page of a list method. `request` sends one page with the given
 * params; `params` are the first page's params (including `limit`) and are
 * repeated on every page with the previous page's `nextToken`. Returns the
 * concatenated `field` rows. Stops at the end, on a repeated token, or after
 * {@link MAX_LIST_PAGES} pages.
 */
export async function requestAllPages(
  request: (params: Record<string, unknown>) => Promise<unknown>,
  params: Record<string, unknown>,
  field: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await request(token ? { ...params, nextToken: token } : params);
    const pageRows =
      result && typeof result === 'object' ? (result as Record<string, unknown>)[field] : undefined;
    if (Array.isArray(pageRows)) rows.push(...pageRows);
    token = nextPageToken(result);
    if (!token || seen.has(token)) break;
    seen.add(token);
  }
  return rows;
}

/** Hard stop for a note content walk (`note.get` `contentOffset` pages). */
const MAX_NOTE_CONTENT_PAGES = 1_000;

function unwrapNote(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const inner = 'note' in result ? (result as { note?: unknown }).note : result;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : undefined;
}

/** `nextContentOffset` of a cut `note.get` row, or `undefined` at the end. */
function nextContentOffset(note: Record<string, unknown>): number | undefined {
  const next = note.nextContentOffset;
  return note.contentTruncated === true && typeof next === 'number' && next > 0 ? next : undefined;
}

async function readContentPages(
  request: (params: Record<string, unknown>) => Promise<unknown>,
  params: Record<string, unknown>,
  first: unknown,
): Promise<{ result: unknown; retry: boolean }> {
  const note = unwrapNote(first);
  if (!note) return { result: first, retry: false };
  let offset = nextContentOffset(note);
  if (offset === undefined) return { result: first, retry: false };
  let content = typeof note.content === 'string' ? note.content : '';
  for (let page = 1; page < MAX_NOTE_CONTENT_PAGES && offset !== undefined; page++) {
    const chunk = unwrapNote(await request({ ...params, contentOffset: offset }));
    // The note changed between pages: read it again from the start.
    if (chunk && chunk.rev !== note.rev) return { result: first, retry: true };
    if (!chunk || typeof chunk.content !== 'string' || chunk.contentOffset !== offset) {
      return { result: first, retry: false };
    }
    content += chunk.content;
    offset = nextContentOffset(chunk);
  }
  if (offset !== undefined || new TextEncoder().encode(content).length !== note.contentBytes) {
    return { result: first, retry: false };
  }
  const {
    contentTruncated: _truncated,
    contentBytes: _bytes,
    contentOffset: _offset,
    nextContentOffset: _next,
    ...rest
  } = note;
  const whole = { ...rest, content };
  const wrapped =
    first && typeof first === 'object' && 'note' in first ? { ...first, note: whole } : whole;
  return { result: wrapped, retry: false };
}

/**
 * Read a whole note through `note.get` (protocol §5.2 "Bounded note and
 * comment reads"). A daemon that cuts a large note to the read budget marks
 * the row `contentTruncated` with `nextContentOffset`; this follows the
 * `contentOffset` cursor and returns the result with the full `content` and
 * no truncation markers. If the note changes between pages (`rev`) the read
 * restarts; if the pages cannot be joined into exactly `contentBytes`, the
 * first (still truncated) reply is returned so callers keep treating it as a
 * prefix. An older daemon without the cursor answers in one request.
 */
export async function requestWholeNote(
  request: (params: Record<string, unknown>) => Promise<unknown>,
  params: Record<string, unknown>,
): Promise<unknown> {
  let first: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    first = await request(params);
    const { result, retry } = await readContentPages(request, params, first);
    if (!retry) return result;
  }
  return first;
}
