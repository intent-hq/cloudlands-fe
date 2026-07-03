/**
 * Wire-contract tests for the integrations IPC bridge seeder.
 *
 * Regression: the Add-context pane's direct `invoke()` reads (Linear/Sentry
 * auth + issues, GitHub identity/repos, git-tracking GH issue/PR search)
 * resolved to boot-time mock fixtures, so every tab rendered mock data in the
 * live app. Asserts each legacy channel (a) forwards to the canonical daemon
 * JSON-RPC method with the right params (PROTOCOL §5.27–5.29) and (b) maps
 * the PROTOCOL-shaped response to the exact legacy envelope the call sites
 * (IssueSuggestions, linear/sentry/github auth clients) already consume.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { GITHUB_AUTH_CHANNELS } from "$features/github-auth/constants";
import { LINEAR_AUTH_CHANNELS } from "$features/linear-auth/constants";
import { SENTRY_AUTH_CHANNELS } from "$features/sentry-auth/constants";

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.27 wire GithubUser — derived identity only. */
const WIRE_USER = {
  login: "octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
  htmlUrl: "https://github.com/octocat",
};

describe("integrations-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./integrations-bridge-seeder");
  });

  afterEach(() => vi.clearAllMocks());

  describe("linear-auth:* → daemon linear.* (PROTOCOL §5.28 — bare results)", () => {
    it("get-auth-state reports the linear.authStatus probe (env-key model: no oauth, no Augment auth)", async () => {
      mockedRequest.mockResolvedValueOnce({ authenticated: true, login: "Ada", scopes: [] });

      const state = await mockInvoke(LINEAR_AUTH_CHANNELS.GET_AUTH_STATE, true);

      expect(mockedRequest).toHaveBeenCalledWith("linear.authStatus");
      expect(state).toEqual({ isAuthenticated: true, requiresAugmentAuth: false });
    });

    it("get-auth-state folds a failed probe (key absent → -32603) to unauthenticated", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("Linear is not configured."));

      expect(await mockInvoke(LINEAR_AUTH_CHANNELS.GET_AUTH_STATE)).toEqual({
        isAuthenticated: false,
        requiresAugmentAuth: false,
      });
    });

    it("fetch-my-issues forwards the positional filter as { filter } and returns the flattened issues verbatim", async () => {
      const issue = { id: "u1", identifier: "ENG-123", title: "Fix flux", teamKey: "ENG" };
      mockedRequest.mockResolvedValueOnce([issue]);

      const issues = await mockInvoke(LINEAR_AUTH_CHANNELS.FETCH_MY_ISSUES, "assigned");

      expect(mockedRequest).toHaveBeenCalledWith("linear.listIssues", { filter: "assigned" });
      expect(issues).toEqual([issue]);
    });

    it("search-issues forwards { query } and folds a daemon failure to []", async () => {
      mockedRequest.mockResolvedValueOnce([]);
      await mockInvoke(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, "flux");
      expect(mockedRequest).toHaveBeenCalledWith("linear.searchIssues", { query: "flux" });

      mockedRequest.mockRejectedValueOnce(new Error("boom"));
      expect(await mockInvoke(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, "flux")).toEqual([]);
    });
  });

  describe("sentry-auth:* → daemon sentry.* (PROTOCOL §5.29 — bare results)", () => {
    it("get-auth-state maps the probe to { isAuthenticated, organization } (derived identity only)", async () => {
      mockedRequest.mockResolvedValueOnce({ authenticated: true, organization: "acme" });

      const state = await mockInvoke(SENTRY_AUTH_CHANNELS.GET_AUTH_STATE);

      expect(mockedRequest).toHaveBeenCalledWith("sentry.authStatus");
      expect(state).toEqual({
        isAuthenticated: true,
        organization: "acme",
        error: undefined,
      });
    });

    it("fetch-issues forwards the FetchIssuesRequest fields onto sentry.listIssues", async () => {
      const issue = { id: "1", shortId: "WEB-1", title: "TypeError", status: "unresolved" };
      mockedRequest.mockResolvedValueOnce([issue]);

      const issues = await mockInvoke(SENTRY_AUTH_CHANNELS.FETCH_ISSUES, {
        status: "unresolved",
        limit: 50,
      });

      expect(mockedRequest).toHaveBeenCalledWith("sentry.listIssues", {
        status: "unresolved",
        limit: 50,
      });
      expect(issues).toEqual([issue]);
    });

    it("fetch-issues with no request forwards empty params and folds failures to []", async () => {
      mockedRequest.mockResolvedValueOnce([]);
      await mockInvoke(SENTRY_AUTH_CHANNELS.FETCH_ISSUES);
      expect(mockedRequest).toHaveBeenCalledWith("sentry.listIssues", {});

      mockedRequest.mockRejectedValueOnce(new Error("Sentry is not configured."));
      expect(await mockInvoke(SENTRY_AUTH_CHANNELS.FETCH_ISSUES)).toEqual([]);
    });

    it("search-issues forwards { query, project? } onto sentry.searchIssues", async () => {
      mockedRequest.mockResolvedValueOnce([]);

      await mockInvoke(SENTRY_AUTH_CHANNELS.SEARCH_ISSUES, { query: "TypeError", project: "web" });

      expect(mockedRequest).toHaveBeenCalledWith("sentry.searchIssues", {
        query: "TypeError",
        project: "web",
      });
    });
  });

  describe("github-auth:* → daemon github.* (PROTOCOL §5.27 auth & identity)", () => {
    it("get-auth-state composes github.authStatus + github.getUser into the legacy GitHubAuthState", async () => {
      mockedRequest
        .mockResolvedValueOnce({
          isConfigured: true,
          oauthUrl: "",
          configuredButNeedsUpdate: false,
          updatedScopes: "",
        })
        .mockResolvedValueOnce({ user: WIRE_USER });

      const state = await mockInvoke(GITHUB_AUTH_CHANNELS.GET_AUTH_STATE);

      expect(mockedRequest).toHaveBeenNthCalledWith(1, "github.authStatus");
      expect(mockedRequest).toHaveBeenNthCalledWith(2, "github.getUser");
      expect(state).toEqual({
        isAuthenticated: true,
        requiresAugmentAuth: false,
        user: {
          login: "octocat",
          name: null,
          email: null,
          avatar_url: "https://avatars.githubusercontent.com/u/1",
        },
        needsScopeUpdate: false,
        oauthUrl: undefined,
      });
    });

    it("get-auth-state skips getUser and reports unauthenticated when the PAT probe fails", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("GitHub is not configured."));

      const state = await mockInvoke<{ isAuthenticated: boolean; user: unknown }>(
        GITHUB_AUTH_CHANNELS.GET_AUTH_STATE,
      );

      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it("get-status surfaces github.authStatus verbatim (FE shape parity fields included)", async () => {
      const status = {
        isConfigured: true,
        oauthUrl: "",
        configuredButNeedsUpdate: false,
        updatedScopes: "",
      };
      mockedRequest.mockResolvedValueOnce(status);

      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.GET_STATUS)).toEqual(status);
    });

    it("list-repos and search-repos map the wire camelCase GithubRepo to the legacy snake_case envelope", async () => {
      const wireRepo = {
        owner: "octocat",
        name: "hello",
        htmlUrl: "https://github.com/octocat/hello",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        defaultBranch: "main",
      };
      mockedRequest.mockResolvedValueOnce({ repos: [wireRepo] });
      const listResponse = await mockInvoke(GITHUB_AUTH_CHANNELS.LIST_REPOS, { page: 1 });
      expect(mockedRequest).toHaveBeenCalledWith("github.repos.list");
      expect(listResponse).toEqual({
        success: true,
        data: [
          {
            owner: "octocat",
            name: "hello",
            html_url: "https://github.com/octocat/hello",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
            default_branch: "main",
          },
        ],
      });

      mockedRequest.mockResolvedValueOnce({ repos: [] });
      await mockInvoke(GITHUB_AUTH_CHANNELS.SEARCH_REPOS, { query: "hello" });
      expect(mockedRequest).toHaveBeenCalledWith("github.repos.search", { query: "hello" });
    });
  });

  describe("git-tracking search → daemon github.issues/pulls.search (Add-context GH tabs)", () => {
    it("search-github-issues forwards owner/repo + options and maps GithubIssue to the pane shape", async () => {
      mockedRequest.mockResolvedValueOnce({
        issues: [
          {
            number: 7,
            title: "Bug in flux",
            body: "It breaks",
            state: "open",
            htmlUrl: "https://github.com/octocat/hello/issues/7",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
            user: WIRE_USER,
            labels: ["bug"],
          },
        ],
      });

      const response = await mockInvoke(IPC_CHANNELS.GIT_TRACKING.SEARCH_GITHUB_ISSUES, {
        owner: "octocat",
        repo: "hello",
        options: { state: "open", per_page: 20, filter: "all" },
      });

      expect(mockedRequest).toHaveBeenCalledWith("github.issues.search", {
        owner: "octocat",
        repo: "hello",
        filter: "all",
        state: "open",
        limit: 20,
      });
      expect(response).toEqual({
        success: true,
        data: [
          {
            id: "7",
            number: 7,
            title: "Bug in flux",
            body: "It breaks",
            htmlUrl: "https://github.com/octocat/hello/issues/7",
            state: "open",
            owner: "octocat",
            repo: "hello",
            author: { login: "octocat" },
            labels: ["bug"],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
          },
        ],
      });
    });

    it("search-pull-requests maps merged/draft booleans into the pane's single state field", async () => {
      mockedRequest.mockResolvedValueOnce({
        pulls: [
          {
            number: 42,
            title: "Add feature",
            body: "…",
            state: "open",
            htmlUrl: "https://github.com/octocat/hello/pull/42",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
            user: WIRE_USER,
            headRef: "feature/x",
            baseRef: "main",
            merged: false,
            draft: true,
            assignees: [WIRE_USER],
          },
        ],
      });

      const response = await mockInvoke<{ success: boolean; data: { state: string }[] }>(
        IPC_CHANNELS.GIT_TRACKING.SEARCH_PULL_REQUESTS,
        { owner: "octocat", repo: "hello", options: { state: "open", per_page: 50, filter: "all" } },
      );

      expect(mockedRequest).toHaveBeenCalledWith("github.pulls.search", {
        owner: "octocat",
        repo: "hello",
        filter: "all",
        state: "open",
        limit: 50,
      });
      expect(response.success).toBe(true);
      expect(response.data[0]).toMatchObject({
        id: "42",
        state: "draft",
        author: { login: "octocat" },
        assignees: ["octocat"],
        sourceBranch: "feature/x",
        targetBranch: "main",
        description: "…",
      });
    });

    it("folds a daemon failure to the { success:false, error } envelope the pane tolerates", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("GitHub is not configured."));

      expect(
        await mockInvoke(IPC_CHANNELS.GIT_TRACKING.SEARCH_GITHUB_ISSUES, {
          owner: "octocat",
          repo: "hello",
          options: {},
        }),
      ).toEqual({ success: false, error: "GitHub is not configured." });
    });
  });
});
