/**
 * In-memory AppClient implementation.
 *
 * Every query resolves to a deterministic fixture and every `subscribe()`
 * emits the initial snapshot synchronously, then stays idle (returns a no-op
 * disposer). Domains whose rich fixtures land in later waves resolve to empty
 * collections / `null` for now. Mutations are accepted no-ops.
 */
import type { AppClient, MutationResult, SubscriptionHandler, Unsubscribe } from "../app-client";
import * as fx from "./fixtures";

const OK: MutationResult = { success: true };

/** Emit the snapshot once, then return an idle disposer. */
function emitOnce<T>(handler: SubscriptionHandler<T>, snapshot: T): Unsubscribe {
  handler(snapshot);
  return () => {};
}

export class MockAppClient implements AppClient {
  readonly workspaces: AppClient["workspaces"] = {
    list: async () => fx.mockWorkspaces,
    get: async (id) => fx.mockWorkspaces.find((w) => w.id === id) ?? null,
    create: async () => OK,
    delete: async () => OK,
    setActive: async () => OK,
    recentViews: async () => fx.mockWorkspaceRecentViews,
    subscribe: (handler) => emitOnce(handler, fx.mockWorkspaces),
  };

  readonly agents: AppClient["agents"] = {
    list: async (workspaceId) =>
      fx.mockAgents.filter((agent) => String(agent.workspaceId) === workspaceId),
    get: async (agentId) => fx.mockAgents.find((agent) => String(agent.id) === agentId) ?? null,
    create: async () => OK,
    send: async () => OK,
    queue: async () => OK,
    setAvailability: async () => OK,
    follow: async () => OK,
    lock: async () => OK,
    subscribe: (handler) => emitOnce(handler, fx.mockAgents),
  };

  readonly chat: AppClient["chat"] = {
    history: async (agentId) => fx.mockChatHistory[agentId] ?? [],
    tokenUsage: async (agentId) => fx.mockTokenUsage[agentId] ?? { input: 0, output: 0 },
    subscribe: (agentId, handler) => emitOnce(handler, fx.mockChatHistory[agentId] ?? []),
  };

  readonly terminals: AppClient["terminals"] = {
    list: async () => fx.mockTerminals,
    create: async () => OK,
    write: async () => OK,
    output: async () => "",
    subscribe: (handler) => emitOnce(handler, fx.mockTerminals),
  };

  readonly settings: AppClient["settings"] = {
    getUserPreferences: async () => null,
    setUserPreferences: async () => OK,
    getProviderSettings: async () => fx.mockProviderSettings,
    setProviderSettings: async () => OK,
    getMcpServers: async () => [],
    setMcpServers: async () => OK,
    getWorkspaceSettings: async () => fx.mockWorkspaceSettings,
    setWorkspaceSettings: async () => OK,
    getBackgroundAgentSettings: async () => null,
    setBackgroundAgentSettings: async () => OK,
    subscribe: (handler) => emitOnce(handler, null),
  };

  readonly files: AppClient["files"] = {
    list: async () => [],
    read: async () => null,
    explorerTree: async () => [],
    subscribe: (handler) => emitOnce(handler, []),
  };

  readonly git: AppClient["git"] = {
    status: async () => fx.mockGitStatus,
    changes: async () => fx.mockGitStatus,
    prStatus: async () => null,
    subscribe: (handler) => emitOnce(handler, fx.mockGitStatus),
  };

  readonly notes: AppClient["notes"] = {
    list: async (workspaceId) =>
      fx.mockNotes.filter((note) => String(note.workspaceId) === workspaceId),
    get: async (noteId) => fx.mockNotes.find((n) => String(n.id) === noteId) ?? null,
    subscribe: (handler) => emitOnce(handler, fx.mockNotes),
  };

  readonly tasks: AppClient["tasks"] = {
    list: async (workspaceId) =>
      workspaceId === String(fx.MOCK_WORKSPACE_ID) ? fx.mockTasks : [],
    get: async (taskId) => fx.mockTasks.find((t) => t.id === taskId) ?? null,
    subscribe: (handler) => emitOnce(handler, fx.mockTasks),
  };

  readonly comments: AppClient["comments"] = {
    list: async (noteId) => fx.mockComments.filter((c) => String(c.noteId) === noteId),
    subscribe: (noteId, handler) =>
      emitOnce(
        handler,
        fx.mockComments.filter((c) => String(c.noteId) === noteId),
      ),
  };

  readonly scripts: AppClient["scripts"] = {
    list: async () => [],
    subscribe: (handler) => emitOnce(handler, []),
  };

  readonly setupScripts: AppClient["setupScripts"] = {
    list: async () => fx.mockSetupScripts,
    subscribe: (handler) => emitOnce(handler, fx.mockSetupScripts),
  };

  readonly skills: AppClient["skills"] = {
    list: async () => fx.mockSkills,
    subscribe: (handler) => emitOnce(handler, fx.mockSkills),
  };

  readonly specialists: AppClient["specialists"] = {
    listCustom: async () => fx.mockSpecialists,
    listFile: async () => [],
    subscribe: (handler) => emitOnce(handler, fx.mockSpecialists),
  };

  readonly models: AppClient["models"] = {
    list: async () => fx.mockModels,
    subscribe: (handler) => emitOnce(handler, fx.mockModels),
  };

  readonly browser: AppClient["browser"] = {
    recentUrls: async () => fx.mockRecentUrls,
    subscribe: (handler) => emitOnce(handler, fx.mockRecentUrls),
  };

  readonly integrations: AppClient["integrations"] = {
    githubUser: async () => null,
    linearIssues: async () => [],
    sentryIssues: async () => [],
    subscribe: (handler) => emitOnce(handler, { githubUser: null }),
  };

  readonly system: AppClient["system"] = {
    status: async () => fx.mockSystemStatus,
    releaseNotes: async () => fx.mockReleaseNotes,
    autoUpdate: async () => null,
    subscribe: (handler) => emitOnce(handler, fx.mockSystemStatus),
  };

  readonly events: AppClient["events"] = {
    list: async () => [],
    subscribe: (_workspaceId, handler) => emitOnce(handler, []),
  };
}
