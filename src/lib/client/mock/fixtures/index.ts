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
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import type { CommentV2 } from "$features/comments/comment-types-v2";
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

// ============================================================================
// Notes, tasks & comments
// ============================================================================

/** Task note IDs, shared between the note entities and the WorkspaceTask facts. */
export const MOCK_TASK_NOTE_ID_1 = createNoteId("00000000-0000-4000-8000-000000000010");
export const MOCK_TASK_NOTE_ID_2 = createNoteId("00000000-0000-4000-8000-000000000011");
export const MOCK_TASK_NOTE_ID_3 = createNoteId("00000000-0000-4000-8000-000000000012");
export const MOCK_DESIGN_NOTE_ID = createNoteId("00000000-0000-4000-8000-000000000020");

const SPEC_CONTENT = [
  "# Dark mode toggle",
  "",
  "## Goal",
  "Add a dark mode toggle to the settings page and persist the choice across reloads,",
  "defaulting to the operating system preference when nothing is saved.",
  "",
  "## Tasks",
  `- [x] [Add the theme toggle component](intent://local/task/${MOCK_TASK_NOTE_ID_1})`,
  `- [ ] [Persist the selected theme](intent://local/task/${MOCK_TASK_NOTE_ID_2})`,
  `- [ ] [Default to the system preference](intent://local/task/${MOCK_TASK_NOTE_ID_3})`,
  "",
  "## Notes",
  "The toggle lives in the settings panel and writes to a `theme` preference.",
].join("\n");

export const mockNotes: Note[] = [
  {
    id: SPEC_NOTE_ID,
    workspaceId: MOCK_WORKSPACE_ID,
    title: "Spec",
    content: SPEC_CONTENT,
    contentType: ContentType.Markdown,
    tags: ["spec"],
    isPinned: true,
    isArchived: false,
    isDefault: true,
    visibility: NoteVisibility.Workspace,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-02T14:30:00.000Z",
  },
  {
    id: MOCK_DESIGN_NOTE_ID,
    workspaceId: MOCK_WORKSPACE_ID,
    title: "Theme tokens",
    content:
      "# Theme tokens\n\nDark and light palettes share the same semantic token names so " +
      "components never reference raw colors directly.",
    contentType: ContentType.Markdown,
    tags: ["design"],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: "2026-01-01T11:00:00.000Z",
    updatedAt: "2026-01-01T11:30:00.000Z",
  },
  {
    id: MOCK_TASK_NOTE_ID_1,
    workspaceId: MOCK_WORKSPACE_ID,
    title: "Add the theme toggle component",
    content: "# Add the theme toggle component\n\nRender a toggle in the settings panel header.",
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    metadata: { task: { status: "complete", completedAt: "2026-01-01T12:00:00.000Z" } },
    createdAt: "2026-01-01T09:10:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
  },
  {
    id: MOCK_TASK_NOTE_ID_2,
    workspaceId: MOCK_WORKSPACE_ID,
    title: "Persist the selected theme",
    content: "# Persist the selected theme\n\nStore the choice under the `theme` preference key.",
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    metadata: { task: { status: "in_progress", startedAt: "2026-01-02T13:00:00.000Z" } },
    createdAt: "2026-01-01T09:11:00.000Z",
    updatedAt: "2026-01-02T13:00:00.000Z",
  },
  {
    id: MOCK_TASK_NOTE_ID_3,
    workspaceId: MOCK_WORKSPACE_ID,
    title: "Default to the system preference",
    content:
      "# Default to the system preference\n\nFall back to `prefers-color-scheme` when no " +
      "preference is saved.",
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    metadata: { task: { status: "not_started" } },
    createdAt: "2026-01-01T09:12:00.000Z",
    updatedAt: "2026-01-01T09:12:00.000Z",
  },
];

export const mockTasks: WorkspaceTask[] = [
  {
    id: MOCK_TASK_NOTE_ID_1,
    title: "Add the theme toggle component",
    status: "complete",
    updatedAt: "2026-01-01T12:00:00.000Z",
  },
  {
    id: MOCK_TASK_NOTE_ID_2,
    title: "Persist the selected theme",
    status: "in_progress",
    updatedAt: "2026-01-02T13:00:00.000Z",
  },
  {
    id: MOCK_TASK_NOTE_ID_3,
    title: "Default to the system preference",
    status: "not_started",
    updatedAt: "2026-01-01T09:12:00.000Z",
  },
];

/** Sample comment threads anchored to the spec note. */
export const mockComments: CommentV2[] = [
  {
    id: "comment-mock-1",
    threadId: "thread-mock-1",
    noteId: SPEC_NOTE_ID,
    type: "question",
    content: "Should the toggle also expose a 'system' option, or just light/dark?",
    author: "Alex",
    authorType: "user",
    status: "open",
    anchor: { type: "range", startId: "spec-goal", endId: "spec-goal" },
    anchorText: "defaulting to the operating system preference",
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z",
  },
  {
    id: "comment-mock-2",
    threadId: "thread-mock-1",
    noteId: SPEC_NOTE_ID,
    parentId: "comment-mock-1",
    type: "comment",
    content: "Light/dark for now; system default is covered by the third task.",
    author: "Dark mode toggle",
    authorType: "agent",
    status: "open",
    anchor: { type: "range", startId: "spec-goal", endId: "spec-goal" },
    createdAt: "2026-01-02T10:05:00.000Z",
    updatedAt: "2026-01-02T10:05:00.000Z",
  },
  {
    id: "comment-mock-3",
    threadId: "thread-mock-2",
    noteId: SPEC_NOTE_ID,
    type: "comment",
    content: "Resolved: token names are finalized in the Theme tokens note.",
    author: "Alex",
    authorType: "user",
    status: "resolved",
    anchor: { type: "point", pointId: "spec-notes" },
    anchorText: "writes to a `theme` preference",
    createdAt: "2026-01-02T11:00:00.000Z",
    updatedAt: "2026-01-02T11:30:00.000Z",
  },
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
