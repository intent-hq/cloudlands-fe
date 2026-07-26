/**
 * Live integrations domain backed by the intentd daemon
 * (PROTOCOL §5.27 `github.*`, §5.28 `linear.*`, §5.29 `sentry.*`).
 *
 * Backs the connections/Add-context seeding through the `AppClient` seam.
 * Issue reads are gated on the namespace auth probes (`linear.authStatus` /
 * `sentry.authStatus`) so an unconfigured integration degrades to an empty
 * list instead of surfacing the daemon's "not configured" RPC error;
 * `github.getUser` maps the daemon's camelCase derived identity to the FE's
 * snake_case `GitHubUser`. Every failure folds to null/empty so the pane
 * renders its auth-hint empty state — never mock fixtures.
 */
import type {
  AppClient,
  GitHubBranchListing,
  GitHubRepoConfigResult,
  IntegrationsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import type { GitHubUser } from "$features/github-auth/types";
import type { LinearIssueResult } from "$features/linear-auth/renderer/linear-auth.client";
import type { SentryIssueResult } from "$features/sentry-auth/types";
import { backendRequest } from "./backend-transport";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("LiveIntegrationsClient");

/** Daemon `github.getUser` result — derived identity only, never the PAT. */
interface GithubGetUserResult {
  user?: { login?: string; avatarUrl?: string; htmlUrl?: string } | null;
}

/** Shared `authenticated` probe shape of `linear.authStatus` / `sentry.authStatus`. */
interface IntegrationAuthStatus {
  authenticated?: boolean;
}

export class LiveIntegrationsClient implements IntegrationsClient {
  async githubUser(): Promise<GitHubUser | null> {
    try {
      const result = await backendRequest<GithubGetUserResult>("github.getUser");
      const user = result?.user;
      if (!user || typeof user.login !== "string" || user.login.length === 0) return null;
      // The wire carries login/avatarUrl/htmlUrl only; name/email have no
      // daemon source in the PAT-from-env model.
      return {
        login: user.login,
        name: null,
        email: null,
        avatar_url: typeof user.avatarUrl === "string" ? user.avatarUrl : "",
      };
    } catch {
      return null;
    }
  }

  /**
   * `github.branches.list` (§5.27) for the branch names plus `github.repos.get`
   * for the repo's default branch. Unlike the issue reads, branch-list failures
   * PROPAGATE: the BranchSelector must render an explicit error/auth state,
   * never an empty-or-fabricated list. The default-branch read is best-effort —
   * its failure degrades to `undefined`.
   */
  async githubBranches(owner: string, repo: string): Promise<GitHubBranchListing> {
    const result = await backendRequest<{ branches?: unknown }>("github.branches.list", {
      owner,
      repo,
    });
    const branches = Array.isArray(result?.branches)
      ? result.branches.filter((branch): branch is string => typeof branch === "string")
      : [];
    let defaultBranch: string | undefined;
    try {
      const repoResult = await backendRequest<{ repo?: { defaultBranch?: unknown } | null }>(
        "github.repos.get",
        { owner, repo },
      );
      const value = repoResult?.repo?.defaultBranch;
      if (typeof value === "string" && value.length > 0) defaultBranch = value;
    } catch {
      // Default branch is a nicety; the branch list alone is sufficient.
    }
    return { branches, defaultBranch };
  }

  /**
   * `github.repoConfig.get` (§5.27 v2.4) — the repo's committed
   * `.intent/config.json` read via the contents API, no clone. `ref` is only
   * sent when provided (daemon defaults to the repo's default branch).
   * Failures PROPAGATE; the setup-script probe folds them to "no script".
   */
  async githubRepoConfig(
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<GitHubRepoConfigResult> {
    const result = await backendRequest<{ config?: unknown; exists?: unknown }>(
      "github.repoConfig.get",
      ref ? { owner, repo, ref } : { owner, repo },
    );
    const config =
      result?.config && typeof result.config === "object" && !Array.isArray(result.config)
        ? (result.config as Record<string, unknown>)
        : null;
    // §5.27 never pairs a non-object config with exists=true — surface a
    // daemon wire regression instead of silently degrading to "no script".
    if (config === null && result?.config != null) {
      logger.warn("github.repoConfig.get returned a non-object config; treating as null", {
        owner,
        repo,
      });
    }
    return { config, exists: result?.exists === true };
  }

  async linearIssues(): Promise<LinearIssueResult[]> {
    try {
      const status = await backendRequest<IntegrationAuthStatus>("linear.authStatus");
      if (status?.authenticated !== true) return [];
      // §5.28: cursor-paginated `{ issues, nextToken }` envelope; the pane
      // consumes the first page only.
      const result = await backendRequest<{ issues: LinearIssueResult[] }>("linear.listIssues");
      return result.issues;
    } catch {
      return [];
    }
  }

  async sentryIssues(): Promise<SentryIssueResult[]> {
    try {
      const status = await backendRequest<IntegrationAuthStatus>("sentry.authStatus");
      if (status?.authenticated !== true) return [];
      // §5.29: cursor-paginated `{ issues, nextToken }` envelope; the pane
      // consumes the first page only.
      const result = await backendRequest<{ issues: SentryIssueResult[] }>("sentry.listIssues");
      return result.issues;
    } catch {
      return [];
    }
  }

  subscribe(handler: SubscriptionHandler<{ githubUser: GitHubUser | null }>): Unsubscribe {
    // No `github:*` change events exist on the wire yet (PROTOCOL §6), so the
    // subscription is a one-shot snapshot of the current derived identity.
    let cancelled = false;
    void this.githubUser().then((githubUser) => {
      if (!cancelled) handler({ githubUser });
    });
    return () => {
      cancelled = true;
    };
  }
}

// Tied to AppClient["integrations"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["integrations"] | undefined = undefined as
  | LiveIntegrationsClient
  | undefined;
void _interfaceCheck;
