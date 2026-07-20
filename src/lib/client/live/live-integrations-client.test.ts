/**
 * Wire-contract tests for the live integrations domain
 * (PROTOCOL §5.27 github.*, §5.28 linear.*, §5.29 sentry.*).
 *
 * Regression: the Add-context pane (Linear / Sentry / GH tabs) rendered mock
 * fixtures because live-app-client delegated `integrations` to the mock.
 * Asserts (a) the exact JSON-RPC requests the client emits, (b) PROTOCOL-shaped
 * responses surface through the seam, (c) unauthenticated integrations degrade
 * to null/empty (auth-hint state — never fixtures), and (d) the
 * settings-integrations seeder hydrates the pane's store slices from the
 * daemon-backed answers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveIntegrationsClient } from "./live-integrations-client";
import type { AppClient } from "../app-client";
// Importing the seeder module registers "settings-integrations" with the
// bootstrap registry so `seedMockStore` below drives the real seeder
// end-to-end (its import-time fixture stubs are gone — the daemon bridge in
// integrations-bridge-seeder.ts serves the direct IPC reads now).
import "$store/renderer/seeders/settings-integrations-seeder";
import { seedMockStore } from "$store/renderer/mock-bootstrap";
import { setGitHubAuthState } from "$store/renderer/slices/github-auth/github-auth-slice";
import {
  setLinearAuthState,
  setLinearIssues,
} from "$store/renderer/slices/linear-auth/linear-auth-slice";
import {
  setSentryConnected,
  setSentryIssues,
} from "$store/renderer/slices/sentry-auth/sentry-auth-slice";

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.27 `github.getUser` result — derived identity only. */
const GITHUB_USER_WIRE = {
  user: {
    login: "octocat",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
    htmlUrl: "https://github.com/octocat",
  },
};

/** PROTOCOL §5.28 flattened LinearIssueResult. */
const LINEAR_ISSUE = {
  id: "uuid-1",
  identifier: "ENG-123",
  title: "Fix the flux capacitor",
  state: "In Progress",
  teamKey: "ENG",
};

/** PROTOCOL §5.29 flattened SentryIssueResult. */
const SENTRY_ISSUE = {
  id: "1",
  shortId: "WEB-1",
  title: "TypeError: foo is not a function",
  status: "unresolved",
  level: "error",
  count: "12",
  userCount: 3,
  firstSeen: "2026-01-01T00:00:00Z",
  lastSeen: "2026-01-02T00:00:00Z",
  projectName: "Web",
  projectSlug: "web",
};

describe("LiveIntegrationsClient (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("githubUser forwards github.getUser and maps the wire identity to the FE snake_case shape", async () => {
    mockedRequest.mockResolvedValueOnce(GITHUB_USER_WIRE);
    const client = new LiveIntegrationsClient();

    const user = await client.githubUser();

    expect(mockedRequest).toHaveBeenCalledWith("github.getUser");
    expect(user).toEqual({
      login: "octocat",
      name: null,
      email: null,
      avatar_url: "https://avatars.githubusercontent.com/u/1",
    });
  });

  it("githubUser folds a null wire user and a transport failure to null (auth hint state)", async () => {
    const client = new LiveIntegrationsClient();
    mockedRequest.mockResolvedValueOnce({ user: null });
    expect(await client.githubUser()).toBeNull();

    mockedRequest.mockRejectedValueOnce(new Error("GitHub is not configured."));
    expect(await client.githubUser()).toBeNull();
  });

  it("linearIssues gates on linear.authStatus and returns linear.listIssues verbatim", async () => {
    mockedRequest
      .mockResolvedValueOnce({ authenticated: true, login: "Ada Lovelace", scopes: [] })
      .mockResolvedValueOnce([LINEAR_ISSUE]);
    const client = new LiveIntegrationsClient();

    const issues = await client.linearIssues();

    expect(mockedRequest).toHaveBeenNthCalledWith(1, "linear.authStatus");
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "linear.listIssues");
    expect(issues).toEqual([LINEAR_ISSUE]);
  });

  it("linearIssues returns [] without calling listIssues when the auth probe reports unauthenticated", async () => {
    mockedRequest.mockResolvedValueOnce({ authenticated: false, scopes: [] });
    const client = new LiveIntegrationsClient();

    expect(await client.linearIssues()).toEqual([]);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("linear.authStatus");
  });

  it("sentryIssues gates on sentry.authStatus and returns sentry.listIssues verbatim", async () => {
    mockedRequest
      .mockResolvedValueOnce({ authenticated: true, organization: "acme" })
      .mockResolvedValueOnce([SENTRY_ISSUE]);
    const client = new LiveIntegrationsClient();

    const issues = await client.sentryIssues();

    expect(mockedRequest).toHaveBeenNthCalledWith(1, "sentry.authStatus");
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "sentry.listIssues");
    expect(issues).toEqual([SENTRY_ISSUE]);
  });

  it("sentryIssues folds a transport failure to an empty list", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("Sentry is not configured."));
    const client = new LiveIntegrationsClient();

    expect(await client.sentryIssues()).toEqual([]);
  });

  it("subscribe emits one snapshot of the current GitHub identity", async () => {
    mockedRequest.mockResolvedValueOnce(GITHUB_USER_WIRE);
    const client = new LiveIntegrationsClient();

    const handler = vi.fn();
    client.subscribe(handler);
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledWith({
        githubUser: {
          login: "octocat",
          name: null,
          email: null,
          avatar_url: "https://avatars.githubusercontent.com/u/1",
        },
      }),
    );
  });
});

describe("LiveIntegrationsClient.githubBranches (github.branches.list + github.repos.get, §5.27)", () => {
  afterEach(() => vi.clearAllMocks());

  it("lists remote branch names and the repo's default branch", async () => {
    // PROTOCOL §5.27: { branches: string[], nextToken? } then { repo: GithubRepo | null }.
    mockedRequest
      .mockResolvedValueOnce({ branches: ["main", "feat/x"], nextToken: null })
      .mockResolvedValueOnce({ repo: { name: "intent", defaultBranch: "main" } });
    const client = new LiveIntegrationsClient();

    const listing = await client.githubBranches("octo", "intent");

    expect(mockedRequest).toHaveBeenNthCalledWith(1, "github.branches.list", {
      owner: "octo",
      repo: "intent",
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "github.repos.get", {
      owner: "octo",
      repo: "intent",
    });
    expect(listing).toEqual({ branches: ["main", "feat/x"], defaultBranch: "main" });
  });

  it("degrades the default branch to undefined when github.repos.get fails", async () => {
    mockedRequest
      .mockResolvedValueOnce({ branches: ["main"] })
      .mockRejectedValueOnce(new Error("boom"));
    const client = new LiveIntegrationsClient();

    expect(await client.githubBranches("octo", "intent")).toEqual({
      branches: ["main"],
      defaultBranch: undefined,
    });
  });

  it("propagates a branch-list failure so the caller renders an error/auth state", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("GitHub is not configured."));
    const client = new LiveIntegrationsClient();

    await expect(client.githubBranches("octo", "intent")).rejects.toThrow(
      "GitHub is not configured.",
    );
  });
});

describe("settings-integrations seeder hydrates the connections slices from the daemon", () => {
  afterEach(() => vi.clearAllMocks());

  it("connected integrations: dispatches the mapped GitHub identity, the probe-backed Linear auth state and the daemon issue lists (real Sentry org — no fixture)", async () => {
    mockedRequest.mockImplementation(async (method) => {
      switch (method) {
        case "github.getUser":
          return GITHUB_USER_WIRE;
        case "linear.authStatus":
          return { authenticated: true, login: "Ada Lovelace", scopes: [] };
        case "linear.listIssues":
          return [LINEAR_ISSUE];
        case "sentry.authStatus":
          return { authenticated: true, organization: "real-org" };
        case "sentry.listIssues":
          return [SENTRY_ISSUE];
        default:
          throw new Error(`unexpected daemon method: ${method}`);
      }
    });
    const dispatch = vi.fn();
    await runSeeder(dispatch);

    expect(actionOf(dispatch, setGitHubAuthState.type)?.payload).toEqual({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user: {
        login: "octocat",
        name: null,
        email: null,
        avatar_url: "https://avatars.githubusercontent.com/u/1",
      },
      needsScopeUpdate: false,
      oauthUrl: null,
    });
    expect(actionOf(dispatch, setLinearAuthState.type)?.payload).toEqual({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      oauthUrl: null,
    });
    expect(actionOf(dispatch, setLinearIssues.type)?.payload).toEqual([[LINEAR_ISSUE]]);
    expect(actionOf(dispatch, setSentryConnected.type)?.payload).toEqual({
      organization: "real-org",
    });
    expect(actionOf(dispatch, setSentryIssues.type)?.payload).toEqual([[SENTRY_ISSUE]]);
  });

  it("unconfigured integrations: dispatches disconnected states and never a connected fixture", async () => {
    mockedRequest.mockImplementation(async (method) => {
      switch (method) {
        case "github.getUser":
        case "linear.authStatus":
        case "sentry.authStatus":
          throw new Error("not configured");
        default:
          throw new Error(`unexpected daemon method: ${method}`);
      }
    });
    const dispatch = vi.fn();
    await runSeeder(dispatch);

    expect(actionOf(dispatch, setGitHubAuthState.type)?.payload).toMatchObject({
      isAuthenticated: false,
      user: null,
    });
    expect(actionOf(dispatch, setLinearAuthState.type)?.payload).toMatchObject({
      isAuthenticated: false,
    });
    expect(actionOf(dispatch, setLinearIssues.type)).toBeUndefined();
    expect(actionOf(dispatch, setSentryConnected.type)).toBeUndefined();
    expect(actionOf(dispatch, setSentryIssues.type)).toBeUndefined();
  });
});

/** Run the registered settings-integrations seeder with the LIVE integrations client. */
async function runSeeder(dispatch: ReturnType<typeof vi.fn>): Promise<void> {
  const client = {
    settings: {
      getUserPreferences: async () => null,
      getProviderSettings: async () => null,
      getMcpServers: async () => [],
      getBackgroundAgentSettings: async () => null,
      getWorkspaceSettings: async () => null,
    },
    workspaces: { list: async () => [] },
    integrations: new LiveIntegrationsClient(),
  } as unknown as AppClient;
  await seedMockStore({ state: {}, dispatch } as never, client);
}

/** First dispatched action with the given type, if any. */
function actionOf(
  dispatch: ReturnType<typeof vi.fn>,
  type: string,
): { type?: string; payload?: unknown } | undefined {
  return dispatch.mock.calls
    .map((call) => call[0] as { type?: string; payload?: unknown })
    .find((action) => action?.type === type);
}
