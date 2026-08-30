/**
 * Async, cached code-block syntax highlighting.
 *
 * highlight.js work is deferred off the mount flush: callers render escaped
 * plain code synchronously and swap in the highlighted HTML once it resolves.
 * Results are LRU-cached per content+language so re-mounts (e.g. workspace
 * switches) are free cache hits with no highlight.js work at all.
 */
import hljs from 'highlight.js';

/** Escape HTML entities so raw code is safe to inject with {@html}. */
export function escapeCodeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// LRU cache of highlight results. Map iteration order doubles as LRU order:
// hits are re-inserted, evictions remove the oldest (first) key.
// Bounded by entry count AND total chars; oversize values are never cached
// so a few huge blocks cannot pin lots of memory.
const HIGHLIGHT_CACHE_SIZE = 300;
const HIGHLIGHT_CACHE_MAX_CHARS = 2_000_000;
const HIGHLIGHT_ENTRY_MAX_CHARS = 100_000;
const highlightCache = new Map<string, string>();
let highlightCacheChars = 0;

// Keys embed the full code: values (highlighted HTML) are strictly larger
// than the code, so hashing would save little while risking a collision
// silently serving another block's HTML. '\u0000' cannot appear in a
// language identifier, so keys are unambiguous.
function cacheKey(code: string, language: string): string {
  return `${language}\u0000${code}`;
}

/**
 * Synchronous cache lookup. Returns the highlighted HTML when this exact
 * code+language pair was highlighted before, else null. Never invokes
 * highlight.js.
 */
export function getCachedHighlight(code: string, language: string): string | null {
  const key = cacheKey(code, language);
  const hit = highlightCache.get(key);
  if (hit === undefined) return null;
  // Refresh LRU position
  highlightCache.delete(key);
  highlightCache.set(key, hit);
  return hit;
}

function deleteCacheEntry(key: string): void {
  const existing = highlightCache.get(key);
  if (existing !== undefined) {
    highlightCacheChars -= key.length + existing.length;
    highlightCache.delete(key);
  }
}

function setCachedHighlight(key: string, value: string): void {
  deleteCacheEntry(key);
  const entryChars = key.length + value.length;
  if (entryChars > HIGHLIGHT_ENTRY_MAX_CHARS) return;
  while (
    highlightCache.size >= HIGHLIGHT_CACHE_SIZE ||
    (highlightCache.size > 0 && highlightCacheChars + entryChars > HIGHLIGHT_CACHE_MAX_CHARS)
  ) {
    const oldest = highlightCache.keys().next().value;
    if (oldest === undefined) break;
    deleteCacheEntry(oldest);
  }
  highlightCache.set(key, value);
  highlightCacheChars += entryChars;
}

// Bumped on clear so in-flight computations from before the clear cannot
// repopulate the cache when they resolve.
let cacheGeneration = 0;

/** Clear the highlight cache and pending computations (for tests). */
export function clearHighlightCache(): void {
  highlightCache.clear();
  highlightCacheChars = 0;
  pendingHighlights.clear();
  cacheGeneration++;
}

/** Yield until the browser is idle (bounded), so highlighting never lands in the mount flush. */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 200 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Synchronous highlight.js invocation with escape fallback on failure.
 * The fallback is cached like a real result — hljs throws are rare and
 * deterministic for a given input, so re-running would not help.
 */
function highlightNow(code: string, language: string): string {
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeCodeHtml(code);
  }
}

// Dedupe concurrent requests for identical content (e.g. the same snippet
// rendered by several mounted blocks at once). Each requester may register
// a staleness check; the computation is skipped when ALL requesters have
// gone stale by the time the idle callback fires.
type PendingHighlight = { promise: Promise<string>; staleChecks: (() => boolean)[] };
const pendingHighlights = new Map<string, PendingHighlight>();

/**
 * Highlight `code` asynchronously (idle callback; setTimeout fallback) and
 * cache the result. Cache hits resolve without invoking highlight.js;
 * identical concurrent requests share one computation.
 *
 * `isStale` lets callers cancel superseded requests (e.g. streaming chunks
 * that were replaced before idle): when every requester of a computation
 * reports stale, highlight.js is skipped and the promise resolves with
 * escaped code that is never cached.
 */
export function highlightAsync(
  code: string,
  language: string,
  isStale?: () => boolean,
): Promise<string> {
  const key = cacheKey(code, language);
  const cached = highlightCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = pendingHighlights.get(key);
  if (pending) {
    pending.staleChecks.push(isStale ?? (() => false));
    return pending.promise;
  }

  const generation = cacheGeneration;
  const entry: PendingHighlight = {
    staleChecks: [isStale ?? (() => false)],
    promise: Promise.resolve(''),
  };
  entry.promise = whenIdle().then(() => {
    if (pendingHighlights.get(key) === entry) pendingHighlights.delete(key);
    if (entry.staleChecks.every((check) => check())) return escapeCodeHtml(code);
    const html = highlightNow(code, language);
    if (generation === cacheGeneration) setCachedHighlight(key, html);
    return html;
  });
  pendingHighlights.set(key, entry);
  return entry.promise;
}
