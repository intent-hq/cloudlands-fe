/**
 * In-memory AppClient implementation for the not-yet-migrated domains.
 *
 * Every query resolves to a deterministic fixture and every `subscribe()`
 * emits the initial snapshot synchronously, then stays idle (returns a no-op
 * disposer). Domains whose rich fixtures land in later waves resolve to empty
 * collections / `null` for now. Mutations are accepted no-ops.
 *
 * The `workspaces` domain (Wave 6.0) and the `agents`, `notes`, `tasks`,
 * `comments`, `git`, and `files` domains (Wave 6.1) have been migrated to the
 * live daemon, so they are intentionally absent here; this class implements
 * `Omit<AppClient, ...migrated>` and is delegated to by `LiveAppClient` for the
 * remaining domains.
 */
import type { AppClient, MutationResult, SubscriptionHandler, Unsubscribe } from "../app-client";
import * as fx from "./fixtures";

const OK: MutationResult = { success: true };

/** Domains migrated to the live daemon and therefore not implemented here. */
type MigratedDomain =
  | "workspaces"
  | "agents"
  | "notes"
  | "tasks"
  | "comments"
  | "git"
  | "files";

/** Emit the snapshot once, then return an idle disposer. */
function emitOnce<T>(handler: SubscriptionHandler<T>, snapshot: T): Unsubscribe {
  handler(snapshot);
  return () => {};
}

export class MockAppClient implements Omit<AppClient, MigratedDomain> {
  readonly chat: AppClient["chat"] = {
    // Mock parity with the §7.1 seq-0 snapshot: an empty transcript is the
    // safe default since fixtures don't model turn-granular AgentMessage lists.
    subscribeSnapshot: async () => ({ messages: [], truncated: false, totalMessages: 0 }),
  };

  readonly terminals: AppClient["terminals"] = {
    list: async (workspaceId) =>
      fx.mockTerminals.filter((terminal) => terminal.workspaceId === workspaceId),
    create: async () => OK,
    write: async () => OK,
    resize: async () => OK,
    kill: async () => OK,
    getBuffer: async (terminalId) => fx.mockTerminalBuffers[terminalId] ?? "",
    output: async (terminalId) => fx.mockTerminalBuffers[terminalId] ?? "",
    subscribeEvents: () => () => {},
    subscribe: (handler) => emitOnce(handler, fx.mockTerminals),
  };

  readonly settings: AppClient["settings"] = {
    list: async () => [],
    get: async () => null,
    update: async (changes) => changes.map(({ path, value }) => ({ path, value })),
    reset: async (path) => ({ path, value: null }),
    getUserRule: async () => ({ enabled: true, content: "", updatedAt: 0 }),
    updateUserRule: async () => OK,
    getUserPreferences: async () => fx.mockUserPreferences,
    setUserPreferences: async () => OK,
    getProviderSettings: async () => fx.mockProviderSettings,
    setProviderSettings: async () => OK,
    getMcpServers: async () => fx.mockMcpServers,
    setMcpServers: async () => OK,
    getWorkspaceSettings: async () => fx.mockWorkspaceSettings,
    setWorkspaceSettings: async () => OK,
    getBackgroundAgentSettings: async () => fx.mockBackgroundAgentSettings,
    setBackgroundAgentSettings: async () => OK,
    subscribe: (handler) => emitOnce(handler, fx.mockUserPreferences),
  };

  readonly scripts: AppClient["scripts"] = {
    list: async (workspaceId) =>
      fx.mockScripts.filter((script) => script.workspaceId === workspaceId),
    create: async () => OK,
    remove: async () => OK,
    start: async () => OK,
    stop: async () => OK,
    restart: async () => OK,
    output: async () => "",
    status: async () => null,
    run: async () => null,
    subscribe: (handler) => emitOnce(handler, fx.mockScripts),
  };

  readonly setupScripts: AppClient["setupScripts"] = {
    list: async () => fx.mockSetupScripts,
    subscribe: (handler) => emitOnce(handler, fx.mockSetupScripts),
    get: async () => null,
    save: async () => null,
    detectProjectType: async () => null,
    generate: async () => null,
  };

  readonly skills: AppClient["skills"] = {
    list: async (workspaceId) =>
      workspaceId === String(fx.MOCK_WORKSPACE_ID) ? fx.mockSkills : [],
    subscribe: (handler) => emitOnce(handler, fx.mockSkills),
  };

  readonly specialists: AppClient["specialists"] = {
    list: async () => fx.mockSpecialists,
    subscribe: (handler) => emitOnce(handler, fx.mockSpecialists),
    create: async (id, spec) => spec,
    edit: async (id, spec) => spec,
    delete: async () => ({ success: true }),
  };

  readonly models: AppClient["models"] = {
    list: async () => fx.mockModels,
    subscribe: (handler) => emitOnce(handler, fx.mockModels),
  };

  readonly browser: AppClient["browser"] = {
    recentUrls: async (workspaceId) =>
      workspaceId === String(fx.MOCK_WORKSPACE_ID) ? fx.mockRecentUrls : [],
    subscribe: (handler) => emitOnce(handler, fx.mockRecentUrls),
  };

  readonly integrations: AppClient["integrations"] = {
    githubUser: async () => fx.mockGitHubUser,
    githubBranches: async () => ({ branches: [] }),
    linearIssues: async () => fx.mockLinearIssues,
    sentryIssues: async () => fx.mockSentryIssues,
    subscribe: (handler) => emitOnce(handler, { githubUser: fx.mockGitHubUser }),
  };

  readonly system: AppClient["system"] = {
    status: async () => fx.mockSystemStatus,
    releaseNotes: async () => fx.mockReleaseNotes,
    autoUpdate: async () => null,
    subscribe: (handler) => emitOnce(handler, fx.mockSystemStatus),
  };

  readonly server: AppClient["server"] = {
    pairingInfo: async () => ({
      token: "mock-token-1234567890abcdef",
      certFingerprint: "SHA256:ABCD1234EFGH5678IJKL9012MNOP3456QRST7890UVWX",
      port: 5181,
      path: "/ws",
      localIps: ["127.0.0.1", "192.168.1.100"],
      hostname: "localhost.local",
    }),
    rotateToken: async () => ({
      token: "mock-new-token-fedcba0987654321",
    }),
  };

  readonly events: AppClient["events"] = {
    list: async (workspaceId) =>
      workspaceId === String(fx.MOCK_WORKSPACE_ID) ? fx.mockWorkspaceEvents : [],
    // Mirrors `event.query` (PROTOCOL §5.10): exact-match filters, wire order
    // newest→oldest, daemon default limit of 50.
    query: async (workspaceId, options = {}) => {
      if (workspaceId !== String(fx.MOCK_WORKSPACE_ID)) return [];
      const matching = fx.mockWorkspaceEvents.filter(
        (event) =>
          (!options.eventType || event.type === options.eventType) &&
          (!options.actorType || event.actor?.type === options.actorType) &&
          (!options.actorId || event.actor?.id === options.actorId),
      );
      matching.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return matching.slice(0, options.limit || 50);
    },
    subscribe: (workspaceId, handler) =>
      emitOnce(handler, workspaceId === String(fx.MOCK_WORKSPACE_ID) ? fx.mockWorkspaceEvents : []),
  };
}
