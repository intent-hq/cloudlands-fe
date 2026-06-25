/**
 * Deterministic in-memory fixtures backing the MockAppClient.
 *
 * Each export is a stable, side-effect-free constant so mock queries and the
 * initial subscription snapshot return identical data on every call. Later
 * waves seed richer per-domain fixtures; this module only needs to be enough
 * for the AppClient seam to be exercised.
 */
import {
  AgentStatus,
  ContentType,
  NoteVisibility,
  WorkspaceStatus,
  createAgentId,
  createNoteId,
  createWorkspaceId,
} from "$shared/types";
import type {
  AgentMessage,
  AgentSession,
  ContentBlock,
  GitStatus,
  Note,
  Workspace,
  WorkspaceTask,
} from "$shared/types";
import type { TerminalTab } from "$store/renderer/slices/terminals/terminals-slice";
import type { SetupScript } from "$store/renderer/slices/setup-scripts/setup-scripts-types";
import type { SkillInfo } from "$store/renderer/slices/skills/skills-types";
import type { CustomSpecialist } from "$store/renderer/slices/specialists/specialists-slice";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import type { RecentUrl } from "$store/renderer/slices/browser/browser-types";
import type { ReleaseNotes } from "$store/renderer/slices/release-notes/release-notes-types";
import type { SystemStatusState } from "$store/renderer/slices/system-status/system-status-slice";
import type { ProviderSettingsState } from "$store/renderer/slices/provider-settings/provider-settings-slice";
import type { SingleWorkspaceSettings } from "$store/renderer/slices/workspace-settings/workspace-settings-slice";

const ISO = "2026-01-01T00:00:00.000Z";

export const MOCK_WORKSPACE_ID = createWorkspaceId("ws-mock-1");
export const MOCK_WORKSPACE_ID_2 = createWorkspaceId("ws-mock-2");
export const MOCK_WORKSPACE_ID_3 = createWorkspaceId("ws-mock-3");

export const mockWorkspaces: Workspace[] = [
  {
    id: MOCK_WORKSPACE_ID,
    title: "Dark mode toggle",
    branch: "feat/dark-mode-toggle",
    baseRef: "main",
    statusMessage: "Implementing the theme toggle button and persisting the preference.",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    repositoryOwner: "acme",
    repositoryName: "web-app",
    path: "/mock/web-app/ws-mock-1",
    tags: ["frontend", "ui"],
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-02T14:30:00.000Z",
    lastActivity: "2026-01-02T14:30:00.000Z",
  },
  {
    id: MOCK_WORKSPACE_ID_2,
    title: "API rate limiting",
    branch: "feat/rate-limiting",
    baseRef: "main",
    statusMessage: "Ready for review — added token-bucket middleware and tests.",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    repositoryOwner: "acme",
    repositoryName: "api-server",
    path: "/mock/api-server/ws-mock-2",
    tags: ["backend"],
    createdAt: "2026-01-03T10:15:00.000Z",
    updatedAt: "2026-01-04T11:45:00.000Z",
    lastActivity: "2026-01-04T11:45:00.000Z",
  },
  {
    id: MOCK_WORKSPACE_ID_3,
    title: "Docs cleanup",
    branch: "chore/docs-cleanup",
    baseRef: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Inactive,
    repositoryOwner: "acme",
    repositoryName: "web-app",
    path: "/mock/web-app/ws-mock-3",
    tags: ["docs"],
    createdAt: "2025-12-20T08:00:00.000Z",
    updatedAt: "2025-12-28T16:20:00.000Z",
    lastActivity: "2025-12-28T16:20:00.000Z",
  },
];

/** Last-viewed timestamps (epoch ms) keyed by workspace ID for recency ordering. */
export const mockWorkspaceRecentViews: Record<string, number> = {
  [MOCK_WORKSPACE_ID]: Date.parse("2026-01-02T14:30:00.000Z"),
  [MOCK_WORKSPACE_ID_2]: Date.parse("2026-01-04T11:45:00.000Z"),
  [MOCK_WORKSPACE_ID_3]: Date.parse("2025-12-28T16:20:00.000Z"),
};

export const mockGitStatus: GitStatus = {
  branch: "mock/main",
  ahead: 0,
  behind: 0,
  diverged: false,
  files: [],
  hasUncommittedChanges: false,
  hasUntrackedFiles: false,
};

export const mockNotes: Note[] = [
  {
    id: createNoteId("00000000-0000-4000-8000-000000000001"),
    workspaceId: MOCK_WORKSPACE_ID,
    title: "Mock Spec",
    content: "# Mock Spec\n",
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: ISO,
    updatedAt: ISO,
  },
];

export const mockTasks: WorkspaceTask[] = [
  { id: "task-mock-1", title: "Mock Task", status: "not_started", updatedAt: ISO },
];

export const mockTerminals: TerminalTab[] = [{ id: "term-mock-1", name: "Mock Terminal" }];

export const mockSkills: SkillInfo[] = [
  { name: "mock-skill", description: "A mock skill", location: "/mock/skill" },
];

export const mockSetupScripts: SetupScript[] = [
  {
    id: "setup-mock-1",
    name: "Mock Setup",
    content: "echo mock",
    lastUsedAt: ISO,
    usageCount: 0,
    createdAt: ISO,
  },
];

export const mockModels: AuggieModel[] = [{ value: "mock-model", label: "Mock Model" }];

export const mockSpecialists: CustomSpecialist[] = [
  {
    id: "spec-mock-1",
    name: "Mock Specialist",
    description: "A mock specialist",
    model: "mock-model",
    behaviorPrompt: "",
  },
];

export const mockRecentUrls: RecentUrl[] = [
  { url: "https://example.com", title: "Example", lastVisited: ISO },
];

export const mockReleaseNotes: ReleaseNotes = {
  version: "0.0.0-mock",
  date: "2026-01-01",
  highlights: ["Mock release"],
};

export const mockSystemStatus: SystemStatusState = {
  nodeVersionOk: true,
  nodeVersion: "v20.0.0",
  auggieInstalled: true,
  binaryInstallAvailable: false,
};

export const mockProviderSettings: ProviderSettingsState = {
  activeProviderId: "mock-provider",
  enabledProviders: {},
};

export const mockWorkspaceSettings: SingleWorkspaceSettings = {
  autoCommitEnabled: true,
};

// ============================================================================
// Agents & chat
// ============================================================================

export const MOCK_AGENT_ID = createAgentId("agent-mock-1");
export const MOCK_AGENT_ID_2 = createAgentId("agent-mock-2");

function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

const coordinatorMessages: AgentMessage[] = [
  {
    id: "msg-mock-1",
    role: "user",
    contentBlocks: [
      text("Add a dark mode toggle to the settings page and persist the choice across reloads."),
    ],
    timestamp: "2026-01-01T09:00:00.000Z",
    turnNumber: 1,
  },
  {
    id: "msg-mock-2",
    role: "assistant",
    contentBlocks: [
      text(
        "I'll add a theme toggle to the settings page, wire it to a `theme` store, and persist the selection. Starting with the toggle component now.",
      ),
    ],
    timestamp: "2026-01-01T09:01:00.000Z",
    turnNumber: 1,
  },
  {
    id: "msg-mock-3",
    role: "user",
    contentBlocks: [text("Looks good. Can you also default to the system preference?")],
    timestamp: "2026-01-01T09:05:00.000Z",
    turnNumber: 2,
  },
  {
    id: "msg-mock-4",
    role: "assistant",
    contentBlocks: [
      text(
        "Done — the toggle now falls back to `prefers-color-scheme` when no saved preference exists, and persists the user's choice to localStorage.",
      ),
    ],
    timestamp: "2026-01-01T09:06:00.000Z",
    turnNumber: 2,
  },
];

const backgroundMessages: AgentMessage[] = [
  {
    id: "msg-mock-b1",
    role: "user",
    contentBlocks: [text("Persist the theme choice in localStorage under the `theme` key.")],
    timestamp: "2026-01-01T10:00:00.000Z",
    turnNumber: 1,
  },
  {
    id: "msg-mock-b2",
    role: "assistant",
    contentBlocks: [
      text("Stored the selection under `theme` and hydrate it on startup before first paint."),
    ],
    timestamp: "2026-01-01T10:01:00.000Z",
    turnNumber: 1,
  },
];

export const mockAgents: AgentSession[] = [
  {
    id: MOCK_AGENT_ID,
    backendSessionId: MOCK_AGENT_ID,
    workspaceId: MOCK_WORKSPACE_ID,
    name: "Dark mode toggle",
    model: "mock-model",
    provider: "mock-provider",
    status: AgentStatus.RuntimeIdle,
    isBackground: false,
    isInitialAgent: true,
    digest: "Added dark mode toggle with persistence and system-preference fallback.",
    messages: coordinatorMessages,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:06:00.000Z",
    lastActivity: "2026-01-01T09:06:00.000Z",
    currentTurnNumber: 2,
    metadata: { specialist: "coordinator" },
  },
  {
    id: MOCK_AGENT_ID_2,
    backendSessionId: MOCK_AGENT_ID_2,
    workspaceId: MOCK_WORKSPACE_ID,
    name: "Theme persistence",
    model: "mock-model",
    provider: "mock-provider",
    status: AgentStatus.RuntimeIdle,
    isBackground: true,
    digest: "Persisted theme selection in localStorage.",
    messages: backgroundMessages,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:01:00.000Z",
    lastActivity: "2026-01-01T10:01:00.000Z",
    currentTurnNumber: 1,
    metadata: { isBackground: true, specialist: "implementor" },
  },
];

/** Chat transcript blocks keyed by agent ID for the chat seam. */
export const mockChatHistory: Record<string, ContentBlock[]> = {
  [MOCK_AGENT_ID]: coordinatorMessages.flatMap((message) => message.contentBlocks ?? []),
  [MOCK_AGENT_ID_2]: backgroundMessages.flatMap((message) => message.contentBlocks ?? []),
};

/** Token usage keyed by agent ID for the chat seam. */
export const mockTokenUsage: Record<string, { input: number; output: number }> = {
  [MOCK_AGENT_ID]: { input: 1280, output: 640 },
  [MOCK_AGENT_ID_2]: { input: 420, output: 210 },
};
