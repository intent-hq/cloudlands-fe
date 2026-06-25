/**
 * Deterministic in-memory fixtures backing the MockAppClient.
 *
 * Each export is a stable, side-effect-free constant so mock queries and the
 * initial subscription snapshot return identical data on every call. Later
 * waves seed richer per-domain fixtures; this module only needs to be enough
 * for the AppClient seam to be exercised.
 */
import {
  ContentType,
  NoteVisibility,
  WorkspaceStatus,
  createNoteId,
  createWorkspaceId,
} from "$shared/types";
import type { GitStatus, Note, Workspace, WorkspaceTask } from "$shared/types";
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

export const mockWorkspaces: Workspace[] = [
  {
    id: MOCK_WORKSPACE_ID,
    title: "Mock Workspace",
    branch: "mock/main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: ISO,
    updatedAt: ISO,
  },
];

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
