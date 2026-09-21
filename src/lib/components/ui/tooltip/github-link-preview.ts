/**
 * GitHub issue / PR details for the link hover card.
 *
 * `loadGitHubLinkPreview` resolves a `github.com/{owner}/{repo}/(pull|issues)/{n}`
 * URL to its details through the `AppClient` integrations seam, with a
 * 60 s in-memory cache (re-hovers within the TTL do not re-fetch), one shared
 * in-flight promise per item (concurrent hovers de-dupe to one request), and
 * NO negative caching — a failed request is forgotten as soon as it settles so
 * the next hover retries. Failures propagate: the card renders its URL-only
 * fallback. `createPreviewRequest` is the stale-response guard for the
 * singleton tooltip: a late response for a previous hover must never
 * overwrite the current one.
 *
 * `$lib/client` is imported lazily on the first fetch: this module is reached
 * from the tooltip barrel, and a static import would make every barrel
 * consumer eagerly load the live client and its transitive dependencies.
 */
import type { GitHubIssueDetails, GitHubPullRequestDetails, IntegrationsClient } from '$lib/client';
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import type { GitHubIssueOrPrRef } from '$shared/utils/link-helpers';

/** Discriminated details for one hovered GitHub link. */
export type GitHubLinkPreview =
  ({ kind: 'pr' } & GitHubPullRequestDetails) | ({ kind: 'issue' } & GitHubIssueDetails);

/** How long a resolved preview is served from cache without a re-fetch. */
export const GITHUB_LINK_PREVIEW_TTL_MS = 60_000;

/** The slice of the integrations seam the preview loader depends on. */
export type GitHubLinkPreviewClient = Pick<IntegrationsClient, 'githubPullRequest' | 'githubIssue'>;

export interface LoadGitHubLinkPreviewOptions {
  /** Rejects the caller's promise on abort; the shared request keeps running so the cache still fills. */
  signal?: AbortSignal;
  /** Injection seam (tests); defaults to the process-wide `appClient.integrations`. */
  client?: GitHubLinkPreviewClient;
}

interface CacheEntry {
  value: GitHubLinkPreview;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GitHubLinkPreview>>();

function cacheKey(ref: GitHubIssueOrPrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}/${ref.kind}`;
}

async function fetchPreview(
  ref: GitHubIssueOrPrRef,
  injected: GitHubLinkPreviewClient | undefined,
): Promise<GitHubLinkPreview> {
  const client = injected ?? (await import('$lib/client')).appClient.integrations;
  if (ref.kind === 'pr') {
    const details = await client.githubPullRequest(ref.owner, ref.repo, ref.number);
    return { kind: 'pr', ...details };
  }
  const details = await client.githubIssue(ref.owner, ref.repo, ref.number);
  return { kind: 'issue', ...details };
}

function abortError(): Error {
  // i18n-ignore (internal AbortError reason, never rendered)
  return new DOMException('The GitHub link preview request was aborted.', 'AbortError');
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    // Observe the shared promise before any early exit so a rejection it
    // settles with later is never left unhandled.
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Resolve a GitHub issue/PR URL to its details. Resolves `null` for any URL
 * that is not a GitHub issue/PR link; rejects when the daemon call fails
 * (GitHub not configured, not found, …).
 */
export async function loadGitHubLinkPreview(
  url: string,
  options: LoadGitHubLinkPreviewOptions = {},
): Promise<GitHubLinkPreview | null> {
  const ref = parseGitHubIssueOrPrUrl(url);
  if (!ref) return null;

  const key = cacheKey(ref);
  const cached = cache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.value;
    cache.delete(key);
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchPreview(ref, options.client)
      .then((value) => {
        cache.set(key, { value, expiresAt: Date.now() + GITHUB_LINK_PREVIEW_TTL_MS });
        return value;
      })
      .finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      });
    inFlight.set(key, pending);
  }

  return options.signal ? raceAbort(pending, options.signal) : pending;
}

/** Drop every cached preview and in-flight handle (tests). */
export function clearGitHubLinkPreviewCache(): void {
  cache.clear();
  inFlight.clear();
}

/** A ticket for one hover; `isCurrent` turns false once a newer hover starts. */
export interface PreviewRequestTicket {
  readonly isCurrent: boolean;
}

/**
 * Stale-response guard: `next()` issues a ticket for the current hover and
 * invalidates every earlier one, so the UI can discard out-of-order
 * resolutions (`if (!ticket.isCurrent) return;`). `invalidate()` retires the
 * current ticket without issuing a new one (e.g. on tooltip hide).
 */
export function createPreviewRequest(): {
  next(): PreviewRequestTicket;
  invalidate(): void;
} {
  let sequence = 0;
  return {
    next() {
      const mine = ++sequence;
      return {
        get isCurrent() {
          return mine === sequence;
        },
      };
    },
    invalidate() {
      sequence++;
    },
  };
}
