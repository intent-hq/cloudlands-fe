/**
 * Deterministic in-memory fixtures backing the MockAppClient.
 *
 * Each export is a stable, side-effect-free constant so mock queries and the
 * initial subscription snapshot return identical data on every call. Later
 * waves seed richer per-domain fixtures; this module only needs to be enough
 * for the AppClient seam to be exercised.
 */
import { createAgentId, createNoteId, createWorkspaceId } from "$shared/types";
import type { AgentMessage, ContentBlock } from "$shared/types";
import { WorkspaceEventType } from "$features/events/types";
import type { WorkspaceEvent } from "$features/events/types";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import type { TerminalTab } from "$store/renderer/slices/terminals/terminals-slice";
import type { ScriptWithState } from "$store/renderer/slices/scripts/scripts-types";
import type { SetupScript } from "$store/renderer/slices/setup-scripts/setup-scripts-types";
import type { SkillInfo } from "$store/renderer/slices/skills/skills-types";
import type { SpecialistDef } from "../../app-client";
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

// The mock workspace ID anchors the not-yet-migrated mock domains (chat,
// events, terminals, etc.). The workspaces, agents, notes, tasks, comments,
// git, and files domains are now served by the live daemon (see ../../live/*),
// so their fixtures were removed with those migrations.
export const MOCK_WORKSPACE_ID = createWorkspaceId("ws-mock-1");

// ============================================================================
// Shared note/agent IDs still referenced by the mock chat & event fixtures
// ============================================================================

/** Task note ID still referenced by the workspace-event fixtures below. */
export const MOCK_TASK_NOTE_ID_1 = createNoteId("00000000-0000-4000-8000-000000000010");

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

// PROTOCOL §5.11 `SpecialistDef` shape: a user-tier file definition, so the
// mock exercises the seeder's bundled/file split (bundled falls back to the
// hardcoded SPECIALISTS constant when the list carries no bundled entries).
export const mockSpecialists: SpecialistDef[] = [
  {
    id: "spec-mock-1",
    name: "Mock Specialist",
    description: "A mock specialist",
    model: "mock-model",
    prompt: "",
    behaviorPrompt: "",
    source: "user",
    isCustomized: true,
    path: "/home/mock/.augment/specialists/spec-mock-1.md",
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
// Workspace event stream
// ============================================================================

/** Absolute root path still referenced by the workspace-event fixtures below. */
export const MOCK_WORKSPACE_PATH = "/mock/web-app/ws-mock-1";

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
