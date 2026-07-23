/**
 * Paging + debounce primitives for the context picker (IssueSuggestions).
 *
 * `createPagedSource` owns the accumulated items, the opaque `nextToken`
 * cursor, and the in-flight bookkeeping for one paginated list. A
 * monotonically increasing generation counter guards against out-of-order
 * responses: any response that started before the most recent
 * `refresh()`/`seed()`/`reset()` is discarded.
 */

export interface PageResult<T> {
  items: T[];
  /** Opaque cursor for the next page, or `null` when this is the last page. */
  nextToken: string | null;
}

export interface PagedSourceState<T> {
  items: T[];
  nextToken: string | null;
  /** A first-page (`refresh`) fetch is in flight. */
  isFetching: boolean;
  /** A next-page (`loadMore`) fetch is in flight. */
  isLoadingMore: boolean;
}

export interface PagedSourceConfig<T> {
  getId: (item: T) => string;
  /** Fetch one page. `nextToken` is `null` for the first page. */
  fetchPage: (query: string, nextToken: string | null) => Promise<PageResult<T>>;
  onChange?: (state: PagedSourceState<T>) => void;
  onError?: (error: unknown) => void;
}

export interface PagedSource<T> {
  /** Replace the list with a fresh first page for `query`. */
  refresh(query: string): Promise<void>;
  /** Append the next page (no-op when exhausted or a fetch is in flight). */
  loadMore(): Promise<void>;
  /** Prime state without fetching (e.g. from a cache). Invalidates in-flight requests. */
  seed(items: T[], nextToken: string | null): void;
  /** Clear all state. Invalidates in-flight requests. */
  reset(): void;
  readonly state: PagedSourceState<T>;
}

/** Drop items whose id was already seen, preserving order. */
export function dedupeById<T>(items: T[], getId: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/** Append a page to an existing list, deduping by id. */
export function appendPage<T>(existing: T[], incoming: T[], getId: (item: T) => string): T[] {
  const seen = new Set(existing.map(getId));
  const out = existing.slice();
  for (const item of incoming) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

export function createPagedSource<T>(config: PagedSourceConfig<T>): PagedSource<T> {
  let items: T[] = [];
  let nextToken: string | null = null;
  let query = '';
  let isFetching = false;
  let isLoadingMore = false;
  let generation = 0;

  function emit(): void {
    config.onChange?.({ items, nextToken, isFetching, isLoadingMore });
  }

  async function refresh(newQuery: string): Promise<void> {
    const gen = ++generation;
    query = newQuery;
    isFetching = true;
    isLoadingMore = false;
    emit();
    try {
      const page = await config.fetchPage(newQuery, null);
      if (gen !== generation) return;
      items = dedupeById(page.items, config.getId);
      nextToken = page.nextToken;
    } catch (error) {
      if (gen !== generation) return;
      config.onError?.(error);
    } finally {
      if (gen === generation) {
        isFetching = false;
        emit();
      }
    }
  }

  async function loadMore(): Promise<void> {
    if (isFetching || isLoadingMore || nextToken === null) return;
    const gen = generation;
    const token = nextToken;
    isLoadingMore = true;
    emit();
    try {
      const page = await config.fetchPage(query, token);
      if (gen !== generation) return;
      items = appendPage(items, page.items, config.getId);
      nextToken = page.nextToken;
    } catch (error) {
      if (gen !== generation) return;
      config.onError?.(error);
    } finally {
      if (gen === generation) {
        isLoadingMore = false;
        emit();
      }
    }
  }

  function seed(seedItems: T[], seedToken: string | null): void {
    generation++;
    items = dedupeById(seedItems, config.getId);
    nextToken = seedToken;
    isFetching = false;
    isLoadingMore = false;
    emit();
  }

  function reset(): void {
    seed([], null);
    query = '';
  }

  return {
    refresh,
    loadMore,
    seed,
    reset,
    get state(): PagedSourceState<T> {
      return { items, nextToken, isFetching, isLoadingMore };
    },
  };
}

export interface TrailingDebouncer {
  /** Schedule `fn` to run after the delay, replacing any pending call. */
  schedule(fn: () => void): void;
  /** Drop any pending call. */
  cancel(): void;
}

/** Trailing-edge debouncer: only the last scheduled fn runs, after `delayMs`. */
export function createTrailingDebouncer(delayMs: number): TrailingDebouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(fn: () => void): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, delayMs);
    },
    cancel(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
