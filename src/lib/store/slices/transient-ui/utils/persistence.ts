import {
  createEmptyWorkspaceTransientUiState,
  STORAGE_KEY_PREFIX,
  type SidebarTabId,
  type TransientUiWorkspaceState,
} from "../transient-ui-slice";

const sidebarTabs = new Set<SidebarTabId>([
  "notes",
  "changes",
  "files",
  "agents",
  "terminals",
  "browser",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function normalizeSidebarTab(value: unknown): SidebarTabId {
  if (value === "activity") {
    return "agents";
  }

  return typeof value === "string" && sidebarTabs.has(value as SidebarTabId)
    ? (value as SidebarTabId)
    : "notes";
}

export function getTransientUiStorageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}${workspaceId}`;
}

export function sanitizePersistedTransientUiState(
  persisted: unknown,
  now: number = Date.now()
): { state: TransientUiWorkspaceState | null; removeStorage: boolean; persistSanitized: boolean } {
  if (!isRecord(persisted)) {
    return { state: null, removeStorage: true, persistSanitized: false };
  }

  const state: TransientUiWorkspaceState = {
    chatDrafts: normalizeStringRecord(persisted.chatDrafts),
    sidebarActiveTab: normalizeSidebarTab(persisted.sidebarActiveTab),
    viewedFiles: normalizeStringRecord(persisted.viewedFiles),
    timestamp: typeof persisted.timestamp === "number" ? persisted.timestamp : now,
  };

  const originalSerialized = JSON.stringify(persisted);

  const sanitizedSerialized = JSON.stringify({
    ...createEmptyWorkspaceTransientUiState(),
    ...state,
  });

  return {
    state,
    removeStorage: false,
    persistSanitized: sanitizedSerialized !== originalSerialized,
  };
}