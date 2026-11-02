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
