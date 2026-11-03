/**
 * Paged list reads (PROTOCOL §5.1 "Paged workspace lists", §5.5 "Paged agent
 * lists and queues"). A daemon advertising `server.capabilities.boundedReads`
 * serves `workspace.list`, `agent.list` and `agent.getQueue` one page at a
 * time with a `nextToken`. Callers that need the whole list follow the token
 * here. An older daemon sends no `nextToken`, so its whole-list reply comes
 * back unchanged after one request.
 */

/** Safety stop: a token chain longer than this is treated as complete. */
const MAX_LIST_PAGES = 1000;

type ListReply = Record<string, unknown>;

/**
 * Read every page of a list method and return the first reply with `key`
 * holding all rows and `nextToken: null`. `request` sends one page read;
 * `params` are the read's params (repeated with each `nextToken`). Empty
 * params are sent as `undefined` on the first request so a param-less read
 * stays param-less on the wire.
 */
export async function collectListPages<R extends ListReply>(
  request: (params: Record<string, unknown> | undefined) => Promise<R | null | undefined>,
  params: Record<string, unknown> | undefined,
  key: string,
): Promise<R | null | undefined> {
  const base = params ?? {};
  const first = await request(Object.keys(base).length > 0 ? base : undefined);
  if (!first || typeof first !== 'object') return first;
  const firstRows = first[key];
  let token = first.nextToken;
  if (typeof token !== 'string' || token.length === 0) return first;
  const rows: unknown[] = Array.isArray(firstRows) ? [...firstRows] : [];
  for (let pages = 1; typeof token === 'string' && token.length > 0; pages += 1) {
    if (pages >= MAX_LIST_PAGES) break;
    const next = await request({ ...base, nextToken: token });
    const more = next && typeof next === 'object' ? next[key] : undefined;
    if (Array.isArray(more)) rows.push(...more);
    token = next && typeof next === 'object' ? next.nextToken : undefined;
  }
  return { ...first, [key]: rows, nextToken: null };
}
