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

/**
 * Fast, high-quality string hash (cyrb53 variant) for cache keys.
 * Much cheaper than storing full code strings as Map keys.
 */
function fastHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// LRU cache of highlight results. Map iteration order doubles as LRU order:
// hits are re-inserted, evictions remove the oldest (first) key.
const HIGHLIGHT_CACHE_SIZE = 300;
const highlightCache = new Map<string, string>();

function cacheKey(code: string, language: string): string {
  return `${language}|${fastHash(code)}:${code.length}`;
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

function setCachedHighlight(key: string, value: string): void {
  highlightCache.delete(key);
  while (highlightCache.size >= HIGHLIGHT_CACHE_SIZE) {
    const oldest = highlightCache.keys().next().value;
    if (oldest === undefined) break;
    highlightCache.delete(oldest);
  }
  highlightCache.set(key, value);
}

/** Clear the highlight cache (for tests). */
export function clearHighlightCache(): void {
  highlightCache.clear();
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

/** Synchronous highlight.js invocation with escape fallback on failure. */
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
// rendered by several mounted blocks at once).
const pendingHighlights = new Map<string, Promise<string>>();

/**
 * Highlight `code` asynchronously (idle callback; setTimeout fallback) and
 * cache the result. Cache hits resolve without invoking highlight.js;
 * identical concurrent requests share one computation.
 */
export function highlightAsync(code: string, language: string): Promise<string> {
  const key = cacheKey(code, language);
  const cached = highlightCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = pendingHighlights.get(key);
  if (pending) return pending;

  const promise = whenIdle().then(() => {
    const html = highlightNow(code, language);
    setCachedHighlight(key, html);
    pendingHighlights.delete(key);
    return html;
  });
  pendingHighlights.set(key, promise);
  return promise;
}
