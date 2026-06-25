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
  GitFileStatus,
  LineType,
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
  DiffChunk,
  FileGitStatus,
  FileNode,
  FileStatus,
  GitStatus,
  Note,
  Workspace,
  WorkspaceTask,
} from "$shared/types";
import { ChangeStage } from "$features/file-tracking/types";
import type { CommitInfo, TrackedChange } from "$features/file-tracking/types";
import { WorkspaceEventType } from "$features/events/types";
import type { WorkspaceEvent } from "$features/events/types";
import type { PrStatusSummary } from "../../app-client";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import type { CommentV2 } from "$features/comments/comment-types-v2";
import type { TerminalTab } from "$store/renderer/slices/terminals/terminals-slice";
import type { ScriptWithState } from "$store/renderer/slices/scripts/scripts-types";
import type { SetupScript } from "$store/renderer/slices/setup-scripts/setup-scripts-types";
import type { SkillInfo } from "$store/renderer/slices/skills/skills-types";
import type { CustomSpecialist } from "$store/renderer/slices/specialists/specialists-slice";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import type { RecentUrl } from "$store/renderer/slices/browser/browser-types";
import type { ReleaseNotes } from "$store/renderer/slices/release-notes/release-notes-types";
import type { SystemStatusState } from "$store/renderer/slices/system-status/system-status-slice";
import type { ProviderSettingsState } from "$store/renderer/slices/provider-settings/provider-settings-slice";
import type { SingleWorkspaceSettings } from "$store/renderer/slices/workspace-settings/workspace-settings-slice";
import type { UserPreferencesState } from "$store/renderer/slices/user-preferences/user-preferences-slice";
import type { BackgroundAgentSettingsState } from "$store/renderer/slices/background-agent-settings/background-agent-settings-slice";
import type { McpServerConfig } from "$store/renderer/slices/mcp-settings/mcp-settings-types";
import type { GitHubUser } from "$features/github-auth/types";
import type { LinearIssueResult } from "$features/linear-auth/renderer/linear-auth.client";
import type { SentryIssueResult } from "$features/sentry-auth/types";

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

/** Working-tree file statuses for the dark-mode workspace (ws-mock-1). */
const mockGitFiles: FileStatus[] = [
  { path: "src/lib/theme.ts", status: GitFileStatus.Added, staged: true },
  { path: "src/lib/ThemeToggle.svelte", status: GitFileStatus.Added, staged: true },
  { path: "src/routes/settings/+page.svelte", status: GitFileStatus.Modified, staged: false },
  { path: "src/lib/theme.test.ts", status: GitFileStatus.Untracked, staged: false },
];

export const mockGitStatus: GitStatus = {
  branch: "feat/dark-mode-toggle",
  ahead: 2,
  behind: 0,
  diverged: false,
  files: mockGitFiles,
  hasUncommittedChanges: true,
  hasUntrackedFiles: true,
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

// ============================================================================
// Terminals & scripts
// ============================================================================

const MOCK_DEFAULT_TERMINAL_ID = `terminal-${MOCK_WORKSPACE_ID}-default`;
const MOCK_SECOND_TERMINAL_ID = `terminal-${MOCK_WORKSPACE_ID}-2`;

/** Terminal tabs for the dark-mode workspace (ws-mock-1). */
export const mockTerminals: TerminalTab[] = [
  {
    id: MOCK_DEFAULT_TERMINAL_ID,
    name: "Terminal",
    type: "terminal",
    workspaceId: String(MOCK_WORKSPACE_ID),
    createdAt: ISO,
  },
  {
    id: MOCK_SECOND_TERMINAL_ID,
    name: "Terminal 2",
    type: "terminal",
    workspaceId: String(MOCK_WORKSPACE_ID),
    createdAt: ISO,
  },
];

/** Restored scrollback buffers keyed by terminal ID (raw xterm bytes). */
export const mockTerminalBuffers: Record<string, string> = {
  [MOCK_DEFAULT_TERMINAL_ID]:
    "$ pnpm run dev\r\n\x1b[32m➜\x1b[0m  Local:   http://localhost:5173/\r\n$ ",
  [MOCK_SECOND_TERMINAL_ID]: "$ git status\r\nOn branch feat/dark-mode-toggle\r\n$ ",
};

/** Workspace scripts for the dark-mode workspace (ws-mock-1). */
export const mockScripts: ScriptWithState[] = [
  {
    id: "script-mock-dev",
    workspaceId: String(MOCK_WORKSPACE_ID),
    name: "Dev server",
    command: "pnpm run dev",
    mode: "service",
    category: "dev",
    source: "auto-detected",
    autoStart: true,
    createdAt: ISO,
    runtime: {
      status: "running",
      pid: 4242,
      restartCount: 0,
      detectedUrl: "http://localhost:5173",
    },
  },
  {
    id: "script-mock-test",
    workspaceId: String(MOCK_WORKSPACE_ID),
    name: "Unit tests",
    command: "pnpm run test:unit",
    mode: "command",
    category: "test",
    source: "auto-detected",
    createdAt: ISO,
    runtime: { status: "idle", restartCount: 0 },
  },
];

export const mockSkills: SkillInfo[] = [
  {
    name: "ag-redux-toolkit",
    description: "Redux + redux-saga conventions for this codebase.",
    location: ".agents/skills/ag-redux-toolkit/SKILL.md",
    scope: "project",
  },
  {
    name: "electron",
    description: "Automate Electron desktop apps over the Chrome DevTools Protocol.",
    location: ".agents/skills/electron/SKILL.md",
    scope: "project",
  },
  {
    name: "redux-saga",
    description: "Generic redux-saga API reference for agents.",
    location: ".agents/skills/redux-saga/SKILL.md",
    scope: "user",
  },
];

export const mockSetupScripts: SetupScript[] = [
  {
    id: "setup-mock-1",
    name: "Install dependencies",
    content: "pnpm install",
    projectType: "node",
    lastUsedAt: ISO,
    usageCount: 3,
    createdAt: ISO,
  },
];

export const mockModels: AuggieModel[] = [
  {
    value: "opus4.7",
    label: "Claude Opus 4.7",
    description: "Most capable model for complex coding and reasoning.",
    modelGroupPriority: 1,
    costTier: 3,
    isDefault: true,
  },
  {
    value: "opus4.6",
    label: "Claude Opus 4.6",
    description: "Previous-generation Opus, strong general-purpose model.",
    modelGroupPriority: 1,
    costTier: 3,
  },
  {
    value: "sonnet4.5",
    label: "Claude Sonnet 4.5",
    description: "Balanced speed and capability for everyday tasks.",
    modelGroupPriority: 2,
    costTier: 2,
  },
  {
    value: "gpt5.4",
    label: "GPT-5.4",
    description: "OpenAI flagship model.",
    modelGroupPriority: 2,
    costTier: 3,
  },
  {
    value: "haiku4.5",
    label: "Claude Haiku 4.5",
    description: "Fast, low-cost model for background work.",
    modelGroupPriority: 3,
    costTier: 1,
  },
];

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
  {
    url: "http://localhost:5173/settings",
    title: "Settings · Dark mode toggle",
    favicon: "http://localhost:5173/favicon.ico",
    lastVisited: "2026-01-02T14:25:00.000Z",
  },
  {
    url: "https://github.com/acme/web-app/pull/42",
    title: "Add dark mode toggle by octocat · Pull Request #42",
    favicon: "https://github.com/favicon.ico",
    lastVisited: "2026-01-02T13:55:00.000Z",
  },
  {
    url: "https://svelte.dev/docs/svelte/what-are-runes",
    title: "Runes • Svelte docs",
    favicon: "https://svelte.dev/favicon.png",
    lastVisited: "2026-01-01T16:10:00.000Z",
  },
];

export const mockReleaseNotes: ReleaseNotes = {
  version: "1.8.0",
  date: "2026-01-01",
  highlights: [
    "Dark mode is here — toggle it from the settings panel.",
    "Faster workspace switching with cached file trees.",
    "Improved agent activity stream with richer event details.",
  ],
};

export const mockSystemStatus: SystemStatusState = {
  nodeVersionOk: true,
  nodeVersion: "v20.0.0",
  auggieInstalled: true,
  binaryInstallAvailable: false,
};

export const mockProviderSettings: ProviderSettingsState = {
  activeProviderId: "auggie",
  enabledProviders: { auggie: true, "claude-code": false, codex: false },
};

export const mockWorkspaceSettings: SingleWorkspaceSettings = {
  autoCommitEnabled: true,
};

// ============================================================================
// Settings — user preferences, MCP servers & background agents
// ============================================================================

/** User-facing preferences surfaced by the settings panel. */
export const mockUserPreferences: UserPreferencesState = {
  betaUpdatesEnabled: false,
  spellcheckEnabled: true,
  zoomFactor: 1.0,
  showArchived: false,
  groupByRepo: true,
  hasCompletedProviderSetup: true,
  agentFontStyle: "sans",
  noteFontStyle: "sans",
  codeFontFamily: "JetBrains Mono",
  systemFonts: ["JetBrains Mono", "Fira Code", "SF Mono", "Menlo", "Monaco"],
  enabled: true,
  soundEnabled: true,
  soundOnlyWhenUnfocused: true,
  volume: 0.5,
  activityLogPresets: [],
  promoBannerInteractions: {},
};

/** Configured MCP servers for the MCP settings panel. */
export const mockMcpServers: McpServerConfig[] = [
  {
    name: "github",
    type: "http",
    url: "https://mcp.github.com/mcp",
    authType: "oauth",
  },
  {
    name: "filesystem",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/mock/web-app"],
  },
];

/** Raw contents of ~/.augment/settings.json for the MCP advanced editor. */
export const mockUserMcpSettingsContent = JSON.stringify(
  {
    mcpServers: {
      github: { type: "http", url: "https://mcp.github.com/mcp", authType: "oauth" },
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/mock/web-app"],
      },
    },
  },
  null,
  2,
);

/** Filesystem path shown for the MCP advanced editor. */
export const mockUserMcpSettingsPath = "/mock/home/.augment/settings.json";

/** Background-agent model assignments for the background-agent settings panel. */
export const mockBackgroundAgentSettings: BackgroundAgentSettingsState = {
  defaultModel: "mock-model",
  typeOverrides: { commit: "mock-model", pr: "mock-model", review: "", fast: "" },
  providerSettings: {},
};

// ============================================================================
// Integrations — GitHub, Linear & Sentry (connected mock state)
// ============================================================================

/** Fake connected GitHub user surfaced by the integrations panel. */
export const mockGitHubUser: GitHubUser = {
  login: "octocat",
  name: "Mona Octocat",
  email: "mona@example.com",
  avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
};

/** Assigned Linear issues for the connected Linear mock state. */
export const mockLinearIssues: LinearIssueResult[] = [
  {
    id: "linear-mock-1",
    identifier: "WEB-128",
    title: "Dark mode toggle flickers on first paint",
    description: "Theme is applied after hydration, causing a brief flash of light mode.",
    url: "https://linear.app/acme/issue/WEB-128",
    teamName: "Web",
    teamKey: "WEB",
    state: "In Progress",
    priority: 2,
    assignee: "Mona Octocat",
    labels: ["bug", "frontend"],
    project: "Dark mode",
    creator: "Alex",
    createdAt: "2026-01-02T09:00:00.000Z",
    updatedAt: "2026-01-02T14:00:00.000Z",
  },
  {
    id: "linear-mock-2",
    identifier: "WEB-131",
    title: "Persist theme preference across reloads",
    url: "https://linear.app/acme/issue/WEB-131",
    teamName: "Web",
    teamKey: "WEB",
    state: "Todo",
    priority: 3,
    assignee: "Mona Octocat",
    labels: ["feature"],
    project: "Dark mode",
    creator: "Alex",
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z",
  },
];

/** Recent Sentry issues for the connected Sentry mock state. */
export const mockSentryIssues: SentryIssueResult[] = [
  {
    id: "sentry-mock-1",
    shortId: "WEB-APP-1",
    title: "TypeError: Cannot read properties of undefined (reading 'theme')",
    culprit: "applyTheme(src/lib/theme.ts)",
    status: "unresolved",
    level: "error",
    count: "42",
    userCount: 7,
    firstSeen: "2026-01-02T08:00:00.000Z",
    lastSeen: "2026-01-02T15:00:00.000Z",
    projectName: "web-app",
    projectSlug: "web-app",
    url: "https://acme.sentry.io/issues/sentry-mock-1",
    type: "TypeError",
    value: "Cannot read properties of undefined (reading 'theme')",
    filename: "src/lib/theme.ts",
    function: "applyTheme",
  },
  {
    id: "sentry-mock-2",
    shortId: "API-SERVER-9",
    title: "RateLimitExceeded: too many requests",
    status: "unresolved",
    level: "warning",
    count: "13",
    userCount: 3,
    firstSeen: "2026-01-04T09:00:00.000Z",
    lastSeen: "2026-01-04T12:00:00.000Z",
    projectName: "api-server",
    projectSlug: "api-server",
    url: "https://acme.sentry.io/issues/sentry-mock-2",
    type: "RateLimitExceeded",
  },
];

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

// ============================================================================
// Files, git, changes & PR
// ============================================================================

/** Absolute root path of the dark-mode workspace (matches mockWorkspaces[0].path). */
export const MOCK_WORKSPACE_PATH = "/mock/web-app/ws-mock-1";

function dir(name: string, path: string, children: FileNode[]): FileNode {
  return { name, path, type: "directory", children };
}

function file(name: string, path: string, size: number): FileNode {
  return { name, path, type: "file", size, modified: ISO };
}

/** Deterministic file tree for the dark-mode workspace. */
export const mockFileTree: FileNode = dir("ws-mock-1", MOCK_WORKSPACE_PATH, [
  dir("src", `${MOCK_WORKSPACE_PATH}/src`, [
    dir("lib", `${MOCK_WORKSPACE_PATH}/src/lib`, [
      file("theme.ts", `${MOCK_WORKSPACE_PATH}/src/lib/theme.ts`, 1180),
      file("theme.test.ts", `${MOCK_WORKSPACE_PATH}/src/lib/theme.test.ts`, 860),
      file("ThemeToggle.svelte", `${MOCK_WORKSPACE_PATH}/src/lib/ThemeToggle.svelte`, 1520),
    ]),
    dir("routes", `${MOCK_WORKSPACE_PATH}/src/routes`, [
      dir("settings", `${MOCK_WORKSPACE_PATH}/src/routes/settings`, [
        file("+page.svelte", `${MOCK_WORKSPACE_PATH}/src/routes/settings/+page.svelte`, 2040),
      ]),
    ]),
  ]),
  file("package.json", `${MOCK_WORKSPACE_PATH}/package.json`, 640),
  file("README.md", `${MOCK_WORKSPACE_PATH}/README.md`, 410),
]);

/** Git status keyed by workspace-relative path, for the file-explorer overlay. */
export const mockFileGitStatusMap: Record<string, FileGitStatus> = {
  "src/lib/theme.ts": { status: "A ", additions: 48, deletions: 0 },
  "src/lib/ThemeToggle.svelte": { status: "A ", additions: 62, deletions: 0 },
  "src/lib/theme.test.ts": { status: "??", additions: 34, deletions: 0 },
  "src/routes/settings/+page.svelte": { status: " M", additions: 12, deletions: 3 },
};

/** Unified diffs surfaced by the git diff panel. */
export const mockGitDiffs: DiffChunk[] = [
  {
    file: "src/routes/settings/+page.svelte",
    chunks: [
      {
        oldStart: 18,
        oldLines: 4,
        newStart: 18,
        newLines: 7,
        lines: [
          { type: LineType.Context, content: "  <section class=\"appearance\">", oldNumber: 18, newNumber: 18 },
          { type: LineType.Deletion, content: "    <h2>Appearance</h2>", oldNumber: 19 },
          { type: LineType.Addition, content: "    <h2>Appearance</h2>", newNumber: 19 },
          { type: LineType.Addition, content: "    <ThemeToggle bind:value={theme} />", newNumber: 20 },
          { type: LineType.Addition, content: "    <p class=\"hint\">Choose light or dark mode.</p>", newNumber: 21 },
          { type: LineType.Context, content: "  </section>", oldNumber: 20, newNumber: 22 },
        ],
      },
    ],
  },
];

/** Tracked changes surfaced by the changes panel. */
export const mockTrackedChanges: TrackedChange[] = [
  {
    id: "change-mock-1",
    file: `${MOCK_WORKSPACE_PATH}/src/lib/theme.ts`,
    relativePath: "src/lib/theme.ts",
    stage: ChangeStage.Staged,
    stats: { additions: 48, deletions: 0 },
    status: "added",
    attribution: { manual: false, timestamp: Date.parse("2026-01-01T09:02:00.000Z") },
  },
  {
    id: "change-mock-2",
    file: `${MOCK_WORKSPACE_PATH}/src/lib/ThemeToggle.svelte`,
    relativePath: "src/lib/ThemeToggle.svelte",
    stage: ChangeStage.Staged,
    stats: { additions: 62, deletions: 0 },
    status: "added",
    attribution: { manual: false, timestamp: Date.parse("2026-01-01T09:03:00.000Z") },
  },
  {
    id: "change-mock-3",
    file: `${MOCK_WORKSPACE_PATH}/src/routes/settings/+page.svelte`,
    relativePath: "src/routes/settings/+page.svelte",
    stage: ChangeStage.Unstaged,
    stats: { additions: 12, deletions: 3 },
    status: "modified",
    attribution: { manual: true, timestamp: Date.parse("2026-01-02T13:40:00.000Z") },
  },
];

/** Commit boundary SHA for the changes timeline. */
export const mockCommitBoundarySha = "a1b2c3d4";

/** Commit history surfaced by the changes panel. */
export const mockCommits: CommitInfo[] = [
  {
    hash: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
    message: "Add theme toggle component and theme store",
    author: "Dark mode toggle",
    authorEmail: "agent@example.com",
    timestamp: Date.parse("2026-01-01T09:05:00.000Z"),
    date: "2026-01-01T09:05:00.000Z",
    files: [
      { path: "src/lib/theme.ts", additions: 48, deletions: 0, status: "added" },
      { path: "src/lib/ThemeToggle.svelte", additions: 62, deletions: 0, status: "added" },
    ],
    filesChanged: 2,
    stage: "pushed",
    isPushed: true,
    agentId: String(MOCK_AGENT_ID),
    linkedNoteId: String(MOCK_TASK_NOTE_ID_1),
  },
  {
    hash: "1a2b3c4d5e6f70819203a4b5c6d7e8f901234567",
    message: "Wire toggle into the settings page",
    author: "Alex",
    authorEmail: "alex@example.com",
    timestamp: Date.parse("2026-01-02T13:50:00.000Z"),
    date: "2026-01-02T13:50:00.000Z",
    files: [
      { path: "src/routes/settings/+page.svelte", additions: 12, deletions: 3, status: "modified" },
    ],
    filesChanged: 1,
    stage: "local",
  },
];

/** Pull-request summary surfaced by the git domain. */
export const mockPrStatusSummary: PrStatusSummary = {
  prNumber: 42,
  url: "https://github.com/acme/web-app/pull/42",
  state: "open",
};

// ============================================================================
// Workspace event stream
// ============================================================================

/** Recent workspace activity events for the dark-mode workspace (ws-mock-1). */
export const mockWorkspaceEvents: WorkspaceEvent[] = [
  {
    id: "evt-mock-1",
    workspaceId: String(MOCK_WORKSPACE_ID),
    timestamp: "2026-01-01T09:02:00.000Z",
    type: WorkspaceEventType.FileChanged,
    actor: { type: "agent", id: String(MOCK_AGENT_ID), name: "Dark mode toggle" },
    data: {
      path: `${MOCK_WORKSPACE_PATH}/src/lib/theme.ts`,
      relativePath: "src/lib/theme.ts",
      action: "create",
      additions: 48,
      deletions: 0,
      language: "typescript",
    },
  },
  {
    id: "evt-mock-2",
    workspaceId: String(MOCK_WORKSPACE_ID),
    timestamp: "2026-01-01T12:00:00.000Z",
    type: WorkspaceEventType.TaskStatusChanged,
    actor: { type: "agent", id: String(MOCK_AGENT_ID), name: "Dark mode toggle" },
    data: {
      noteId: String(MOCK_TASK_NOTE_ID_1),
      noteTitle: "Add the theme toggle component",
      previousStatus: "in_progress",
      newStatus: "complete",
      changedAt: "2026-01-01T12:00:00.000Z",
      agentId: String(MOCK_AGENT_ID),
    },
  },
  {
    id: "evt-mock-3",
    workspaceId: String(MOCK_WORKSPACE_ID),
    timestamp: "2026-01-02T13:50:00.000Z",
    type: WorkspaceEventType.NoteUpdated,
    actor: { type: "user", id: "user-alex", name: "Alex", email: "alex@example.com" },
    data: {
      noteId: SPEC_NOTE_ID,
      title: "Spec",
      path: "spec",
      action: "update",
    },
  },
  {
    id: "evt-mock-4",
    workspaceId: String(MOCK_WORKSPACE_ID),
    timestamp: "2026-01-01T09:06:00.000Z",
    type: WorkspaceEventType.AgentIdle,
    actor: { type: "agent", id: String(MOCK_AGENT_ID), name: "Dark mode toggle" },
    data: {
      agentId: String(MOCK_AGENT_ID),
      agentName: "Dark mode toggle",
      reason: "stream_complete",
      finishReason: "end_turn",
      status: "idle",
      activationState: null,
      isActive: false,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      stopReason: "end_turn",
    },
  },
];
