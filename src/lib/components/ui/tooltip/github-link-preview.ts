/**
 * GitHub issue / PR details for the link hover card.
 *
 * `loadGitHubLinkPreview` resolves a `github.com/{owner}/{repo}/(pull|issues)/{n}`
 * URL to its details through the `AppClient` integrations seam, with one
 * shared in-flight promise per item (concurrent hovers de-dupe to one
 * request). Resolved previews are NOT cached here: the daemon's shared PR
 * cache (`prCache.maxAgeSeconds`) is the single cache, so every hover asks
 * the daemon and a failed request is retried on the next hover. Failures
 * propagate: the card keeps the reference and explains the failure. `createPreviewRequest`
 * is the stale-response guard for the singleton tooltip: a late response for
 * a previous hover must never overwrite the current one.
 *
 * `$lib/client` is imported lazily on the first fetch: this module is reached
 * from the tooltip barrel, and a static import would make every barrel
 * consumer eagerly load the live client and its transitive dependencies.
 */
import type { GitHubIssueDetails, GitHubPullRequestDetails, IntegrationsClient } from '$lib/client';
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import { captureIntegrationContext } from '$features/integrations-request-context';
import type { GitHubIssueOrPrRef } from '$shared/utils/link-helpers';
import {
  isGitLabResourceCandidate,
  parseGitLabResourceLink,
} from '$shared/utils/gitlab-resource-link';
import type {
  RepositoryResourceFailure,
  RepositoryResourceSession,
  RepositoryResourceTarget,
} from '$shared/types/repository-resource-read';

/** Discriminated details for one hovered GitHub link. */
export type GitHubLinkPreview =
  ({ kind: 'pr' } & GitHubPullRequestDetails) | ({ kind: 'issue' } & GitHubIssueDetails);

export type GitHubLinkPreviewFailure = 'rate-limited' | 'unavailable';

interface GitLabLinkPreview {
  provider: 'gitlab';
  resource: RepositoryResourceTarget;
  kind: 'pr' | 'issue';
  number: number;
  title: string;
  state: string;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string;
  headRef: string | null;
  baseRef: string | null;
}
export type GitLabPreviewUpdate =
  | { status: 'idle' }
  | { status: 'loading'; resource: RepositoryResourceTarget }
  | { status: 'ready'; data: GitLabLinkPreview }
  | { status: 'error'; resource: RepositoryResourceTarget; reason: RepositoryResourceFailure };

/** One mounted hover owns its original read lifetime, including settled display. */
export function observeGitLabLinkPreview(
  url: string,
  workspaceId: string | undefined,
  handler: (update: GitLabPreviewUpdate) => void,
  injected?: Pick<IntegrationsClient, 'captureRepositoryResource'>,
): () => void {
  let active = true;
  let session: RepositoryResourceSession | undefined;
  let stop: (() => void) | undefined;
  let resource: RepositoryResourceTarget | null = null;
  const close = () => {
    if (!active) return;
    active = false;
    stop?.();
    void session?.release();
  };
  if (!workspaceId || !isGitLabResourceCandidate(url)) {
    handler({ status: 'idle' });
    return close;
  }
  void (async () => {
    const client = injected ?? (await import('$lib/client')).appClient.integrations;
    if (!active) return;
    session = await client.captureRepositoryResource(workspaceId);
    if (!active) {
      await session.release();
      return;
    }
    stop = session.onRetired(() => {
      if (!active) return;
      handler({ status: 'idle' });
      close();
    });
    if (!active) {
      stop();
      return;
    }
    resource = parseGitLabResourceLink(url, session.capture.instances);
    if (!resource) {
      handler({ status: 'idle' });
      close();
      return;
    }
    handler({ status: 'loading', resource });
    const result = await session.detail(resource);
    if (!active) return;
    const outcome = result.outcome;
    if (outcome.kind === 'failure') {
      handler({ status: 'error', resource, reason: outcome.code });
      return;
    }
    if (outcome.kind === 'issue') {
      handler({
        status: 'ready',
        data: {
          ...outcome.issue,
          provider: 'gitlab',
          resource,
          kind: 'issue',
          headRef: null,
          baseRef: null,
        },
      });
      return;
    }
    const details = outcome.snapshot.details;
    handler({
      status: 'ready',
      data: {
        provider: 'gitlab',
        resource,
        kind: 'pr',
        number: resource.number,
        title: details.title,
        url: details.url,
        state:
          details.state === 'open' && details.draft === true
            ? 'draft'
            : (details.state ?? 'unknown'),
        author: details.author,
        createdAt: details.createdAt,
        updatedAt: details.updatedAt,
        headRef: details.sourceBranch,
        baseRef: details.targetBranch,
      },
    });
  })().catch(() => {
    if (!active) return;
    handler(resource ? { status: 'error', resource, reason: 'unavailable' } : { status: 'idle' });
    close();
  });
  return close;
}

/** Use the daemon's structured discriminator, never its raw error prose. */
export function classifyGitHubLinkPreviewError(error: unknown): GitHubLinkPreviewFailure {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'code' in data && data.code === 'rate-limited') {
      return 'rate-limited';
    }
  }
  return 'unavailable';
}

/** The slice of the integrations seam the preview loader depends on. */
export type GitHubLinkPreviewClient = Pick<IntegrationsClient, 'githubPullRequest' | 'githubIssue'>;

export interface LoadGitHubLinkPreviewOptions {
  /** Rejects the caller's promise on abort; the shared request keeps running for the other hovers sharing it. */
  signal?: AbortSignal;
  workspaceId?: string;
  /** Injection seam (tests); defaults to the process-wide `appClient.integrations`. */
  client?: GitHubLinkPreviewClient;
}

const clientIds = new WeakMap<GitHubLinkPreviewClient, number>();
let nextClientId = 0;
const inFlight = new Map<string, Promise<GitHubLinkPreview>>();

function requestKey(ref: GitHubIssueOrPrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}/${ref.kind}`;
}

async function fetchPreview(
  ref: GitHubIssueOrPrRef,
  injected: GitHubLinkPreviewClient | undefined,
  workspaceId?: string,
): Promise<GitHubLinkPreview> {
  const client = injected ?? (await import('$lib/client')).appClient.integrations;
  if (ref.kind === 'pr') {
    const details = await client.githubPullRequest(
      ref.owner,
      ref.repo,
      ref.number,
      ...(workspaceId === undefined ? [] : [workspaceId]),
    );
    return { kind: 'pr', ...details };
  }
  const details = await client.githubIssue(
    ref.owner,
    ref.repo,
    ref.number,
    ...(workspaceId === undefined ? [] : [workspaceId]),
  );
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

  const context = captureIntegrationContext(options.workspaceId);
  const client = options.client ?? (await import('$lib/client')).appClient.integrations;
  let clientId = clientIds.get(client);
  if (clientId === undefined) {
    clientId = ++nextClientId;
    clientIds.set(client, clientId);
  }
  const key = JSON.stringify([context.key, clientId, requestKey(ref)]);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchPreview(ref, client, context.workspaceId).finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }

  return options.signal ? raceAbort(pending, options.signal) : pending;
}

/** Drop every in-flight handle (tests). */
export function clearGitHubLinkPreviewCache(): void {
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
