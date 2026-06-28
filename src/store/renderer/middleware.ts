/*
  List of middlewares to run, order in this list
  defines order of execution
*/

import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import {
  REDUX_DEBUG_LS_KEY,
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from "./constants";
import { createBatchingMiddleware } from "./middlewares/batch";
import { createLoggerMiddleware } from "./middlewares/logger";
import { createSentryBreadcrumbsMiddleware } from "./middlewares/sentry-breadcrumbs";
import { createReferenceChangeDetectorMiddleware } from "./middlewares/state-reference-checks";
import { createStructuredCloneCheckerMiddleware } from "./middlewares/structured-clone-checker";
import { createStoreGuardMiddleware } from "../../store/utils/store-guard-middleware";
import { createGitReadMiddleware } from "$features/git/git-read-service";
import { createAgentReadMiddleware } from "$features/agent/agent-read-service";
import { createChatReadMiddleware } from "$features/agent/chat-read-service";
import { createAgentCreationMiddleware } from "$features/agent/agent-creation-service";
import { createAppLayoutNavigationMiddleware } from "$features/layout/app-layout-navigation-service";
import { createFileExplorerReadMiddleware } from "$features/file-explorer/file-explorer-read-service";
import { createGitHubAuthMiddleware } from "$features/github-auth/github-auth-store-service";
import { createSentryAuthMiddleware } from "$features/sentry-auth/sentry-auth-store-service";
import { createLinearAuthMiddleware } from "$features/linear-auth/linear-auth-store-service";
import { createMcpManagementMiddleware } from "$features/mcp/mcp-management-service";
import { createWorkspaceOperationsMiddleware } from "$features/workspace/workspace-operations-service";
import { createLifecycleReadMiddleware } from "./middlewares/lifecycle-read-service";
import { createLifecycleIpcReadMiddleware } from "./middlewares/lifecycle-ipc-read-service";
import { createUiLayoutPersistenceMiddleware } from "./middlewares/ui-layout-persistence-service";
import { createUnreadTrackingPersistenceMiddleware } from "./middlewares/unread-tracking-persistence-service";
import { safeLocalStorage } from "$lib/utils/safe-storage";

const isDevBuild = (): boolean => Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

/**
 * Get Redux logger configuration from localStorage for manual debugging.
 */
function getReduxLoggerConfig(): { enabled: boolean; webviewName?: string } {
  if (typeof window === "undefined") {
    return { enabled: false };
  }

  const globallyEnabled = (window as any).intentFlags?.enableReduxLogger;

  let localStorageEnabled: boolean | undefined;
  const { value: localStorageValue, hadError } = safeLocalStorage.getItemWithStatus(REDUX_DEBUG_LS_KEY);

  if (hadError) {
    localStorageEnabled = false;
  } else if (localStorageValue != null && localStorageValue !== "undefined") {
    try {
      localStorageEnabled = !!JSON.parse(localStorageValue);
    } catch (error) {
      console.warn(`Failed to parse ${REDUX_DEBUG_LS_KEY} from localStorage:`, error);
      localStorageEnabled = false;
    }
  }

  const enableReduxLogger = globallyEnabled ?? localStorageEnabled ?? isDevBuild();
  const webviewName = globallyEnabled ? (window as any).intentFlags?.webviewName : "";

  return { enabled: enableReduxLogger, webviewName };
}

function buildMiddleware(): StoreMiddleware[] {
  const baseMiddleware: StoreMiddleware[] = [
    // Guard must be first — reject actions tagged for the wrong store immediately
    createStoreGuardMiddleware("renderer"),
    // No action types to batch yet — add action types here as slices are added
    createBatchingMiddleware([]),
    // Add Sentry breadcrumbs middleware to track Redux actions
    createSentryBreadcrumbsMiddleware(),
    // Give the (post-saga) `loadGitStatus` action a real read handler so the
    // ~13 dispatch sites refresh git status on demand again.
    createGitReadMiddleware(),
    // Give the (post-saga) `ensureAgentSessionLoaded` action a real read handler
    // so a selected agent's session/conversation hydrates on demand again.
    createAgentReadMiddleware(),
    // Give the (post-saga) `initializeChatRequested` action a real read handler
    // so opening an agent loads its full retained transcript via
    // `agents.getConversation` instead of showing an empty conversation.
    createChatReadMiddleware(),
    // Give the (post-saga) agent-creation triggers (create / create-with-
    // specialist / run-for-note / activate-initial) real handlers so Cmd/Ctrl+T,
    // the New-agent / specialist UI, the NoteMetadataBar run button, and fresh-
    // workspace initial-agent activation create an agent via `agentFactory` and
    // open its tab again.
    createAgentCreationMiddleware(),
    // Give the (post-saga) `openAgentTabRequested` action a real handler so
    // clicking an agent opens (or focuses) its conversation tab again.
    createAppLayoutNavigationMiddleware(),
    // Give the (post-saga) file-explorer toggle/expand/refresh triggers a real
    // read handler so directories list their children via `files.list` again.
    createFileExplorerReadMiddleware(),
    // Give the (post-saga) GitHub / Sentry / Linear OAuth connect/status/logout
    // triggers real handlers so the settings buttons run their auth flows again.
    createGitHubAuthMiddleware(),
    createSentryAuthMiddleware(),
    createLinearAuthMiddleware(),
    // Give the (post-saga) MCP settings triggers (loadServers + add/remove/
    // update/toggle/import/restart) real handlers so the MCP panel loads and
    // persists servers via the `appClient.settings` seam again.
    createMcpManagementMiddleware(),
    // Give the (post-saga) workspace-operation triggers (archive / unarchive /
    // delete + bulk archive/delete) real handlers so the card/page buttons run
    // their operations via the `workspaceClient` seam again.
    createWorkspaceOperationsMiddleware(),
    // Give the (post-saga) Cluster C lifecycle refresh triggers (workspaces /
    // tasks / events / skills / scripts / PR status) real read handlers so the
    // list rows, hover cards, panels, and refresh buttons refetch via the
    // `appClient` seam again instead of staying stale until restart.
    createLifecycleReadMiddleware(),
    // Give the (post-saga) raw-IPC-backed Cluster C triggers real read handlers:
    // `loadGithubRepos` refetches the repo cache via the github-auth IPC client
    // and `fetchEditors` re-detects installed editors via the external-editors
    // IPC client (honoring its cache guard) instead of staying stale until restart.
    createLifecycleIpcReadMiddleware(),
    // Give the (post-saga) ui-layout persistence triggers real handlers so panel
    // sizes / group layouts / collapsed state read on mount and persist on change
    // across sessions via localStorage again.
    createUiLayoutPersistenceMiddleware(),
    // Give the (post-saga) unread-tracking triggers real handlers so unread state
    // hydrates/persists across sessions and `clearWorkspaceUnread` clears the
    // workspace's agents via `clearAgentsUnread` again.
    createUnreadTrackingPersistenceMiddleware(),
  ];

  // Debug middlewares need to be added AFTER batching middleware
  // so they see the actual state changes, not the batched actions
  const debugMiddlewares: StoreMiddleware[] = [];

  if (typeof window !== "undefined") {
    if (safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY)) {
      debugMiddlewares.push(createReferenceChangeDetectorMiddleware());
    }

    if (isDevBuild() || safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY)) {
      debugMiddlewares.push(createStructuredCloneCheckerMiddleware());
    }

    const { enabled: enableReduxLogger, webviewName } = getReduxLoggerConfig();

    if (enableReduxLogger) {
      debugMiddlewares.push(createLoggerMiddleware(webviewName));
    }
  }

  return [...baseMiddleware, ...debugMiddlewares];
}

export const middleware: StoreMiddleware[] = buildMiddleware();
