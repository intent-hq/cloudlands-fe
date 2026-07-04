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
import { createChatSendMiddleware } from "$features/agent/chat-send-service";
import { createPermissionResponseMiddleware } from "$features/permission/permission-response-service";
import { createDaemonEventsBridgeMiddleware } from "$features/events/daemon-events-bridge";
import { createSettingsHydrationMiddleware } from "$features/settings/settings-hydration-service";
import { createModelSelectionPersistenceMiddleware } from "$features/settings/model-selection-persistence-service";
import { createModelReloadMiddleware } from "$features/settings/model-reload-service";
import { createProviderSettingsPersistenceMiddleware } from "$features/settings/provider-settings-persistence-service";
import { createProviderAvailabilityCheckMiddleware } from "$features/providers/provider-availability-check-service";
import { createAgentStreamMiddleware } from "$features/agent/agent-stream-service";
import { createAgentCreationMiddleware } from "$features/agent/agent-creation-service";
import { createAgentMutationMiddleware } from "$features/agent/agent-mutation-service";
import { createAppLayoutNavigationMiddleware } from "$features/layout/app-layout-navigation-service";
import { createWorkspaceNavigationTabMiddleware } from "$features/layout/workspace-navigation-tab-service";
import { createFileExplorerReadMiddleware } from "$features/file-explorer/file-explorer-read-service";
import { createFilesReadMiddleware } from "$features/files/files-read-service";
import { createFilesWriteMiddleware } from "$features/files/files-write-service";
import { createNotesWriteMiddleware } from "$features/notes/notes-write-service";
import { createNotesVersionsMiddleware } from "$features/notes/notes-versions-service";
import { createGitHubAuthMiddleware } from "$features/github-auth/github-auth-store-service";
import { createSentryAuthMiddleware } from "$features/sentry-auth/sentry-auth-store-service";
import { createLinearAuthMiddleware } from "$features/linear-auth/linear-auth-store-service";
import { createMcpManagementMiddleware } from "$features/mcp/mcp-management-service";
import { createWorkspaceOperationsMiddleware } from "$features/workspace/workspace-operations-service";
import { createDirectoryPickerReadMiddleware } from "$features/onboarding/directory-picker-read-service";
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
    // Give the (post-saga) `loadFileContentRequested` action a real read handler
    // so file tabs and the diff viewer fetch content via `appClient.files.read`
    // and clear the loading skeleton (or surface an error) instead of hanging
    // forever.
    createFilesReadMiddleware(),
    // Give the (post-saga) `initializeChatRequested` action a real read handler
    // so opening an agent loads its full retained transcript via
    // `agents.getConversation` instead of showing an empty conversation.
    createChatReadMiddleware(),
    // Give the (post-saga) `sendMessage` / `sendInitialMessageRequested`
    // actions a real consumer so pressing Send in ChatPanel routes through
    // `agent-stream-lifecycle.sendMessage()` again — producing a user message
    // and a live-streaming assistant response — instead of being a no-op.
    createChatSendMiddleware(),
    // Give the (post-saga) permission triggers (`approvePermission` /
    // `denyPermission` / `cancelPermission` / `selectPermissionOption`) a real
    // consumer so `InlinePermissionRequest` clicks route to `agent.respondPermission`
    // (PROTOCOL §8) and the chosen outcome unblocks the agent instead of
    // waiting out the 5-minute timeout.
    createPermissionResponseMiddleware(),
    // Wire daemon `events.event` notifications (PROTOCOL §7) into the
    // `workspaceEvents/eventReceived` action so the `agentSession` reducer
    // can faithfully clear optimistic `isStreaming`/`isProcessing`/
    // `isResponding` flags on `agent:idle` — without this the "Thinking"
    // spinner stays stuck after a turn ends.
    createDaemonEventsBridgeMiddleware(),
    // Boot-hydrate the BE-owned settings slices (providers, background-agents,
    // MCP, model overrides) by calling `settings.list` once on first dispatched
    // action, then keep them in sync via the `settings:changed` routing the
    // daemon-events bridge above plugs into. The hydration is fire-and-forget
    // so dispatch stays synchronous and unaffected.
    createSettingsHydrationMiddleware(),
    // Give the (post-saga) `selectModel` trigger a real handler (map to
    // `setSelectedModel` for the active provider) and persist model picks to
    // the daemon settings catalog (`model.providerDefaults` /
    // `model.workspaceOverrides`, PROTOCOL §5.12) so the selection survives a
    // reload — the hydration middleware above reads the same paths on boot.
    createModelSelectionPersistenceMiddleware(),
    // Give the (post-saga) `setActiveProvider` trigger a real handler so
    // switching providers writes `providers.active` (PROTOCOL §5.12) back
    // through the `appClient.settings` seam. Without this the pick lives only
    // in the local slice and every restart reverts to whatever the daemon
    // still had persisted.
    createProviderSettingsPersistenceMiddleware(),
    // Give the (post-saga) `reloadModelsForProvider` trigger a real handler so
    // provider switches refetch the daemon catalog (`models.list`, PROTOCOL
    // §5.30) and drive the loading → success/error transitions in the model
    // slice. Without this the picker keeps showing the previous provider's
    // catalog until the next full reload.
    createModelReloadMiddleware(),
    // Give the (post-saga) agent-availability triggers (`ensureProvidersChecked`,
    // `checkAllProvidersRequested`, `checkSingleProviderRequested`) a real
    // handler so onboarding/settings provider cards resolve to a terminal
    // installed / not-installed / error state (and `hasCheckedOnce` flips)
    // instead of spinning on "Checking…" forever.
    createProviderAvailabilityCheckMiddleware(),
    // Give the (post-saga) `agentStreamUpdateReceived` action a real consumer
    // so a streaming agent's text/tool blocks grow live in the chat panel
    // (placeholder on first event, in-place block update on subsequent events,
    // finalize on complete/error/timeout) instead of staying invisible until
    // the conversation is re-fetched.
    createAgentStreamMiddleware(),
    // Give the (post-saga) agent-creation triggers (create / create-with-
    // specialist / run-for-note / activate-initial) real handlers so Cmd/Ctrl+T,
    // the New-agent / specialist UI, the NoteMetadataBar run button, and fresh-
    // workspace initial-agent activation create an agent via `agentFactory` and
    // open its tab again.
    createAgentCreationMiddleware(),
    // Give the (post-saga) agent-session mutation triggers (restore / activate
    // / save) real handlers so `agent-stream-lifecycle.sendMessage()` — which
    // awaits each `action.promise` before dispatching the user message and
    // opening the stream — can resolve again instead of hanging. Restore reads
    // via `appClient.agents.get`; activate marks the session ACTIVE and
    // refetches; save is a no-op on the mock seam (Redux IS the state).
    createAgentMutationMiddleware(),
    // Give the (post-saga) `openAgentTabRequested` action a real handler so
    // clicking an agent opens (or focuses) its conversation tab again.
    createAppLayoutNavigationMiddleware(),
    // Give the (post-saga) `openWorkspaceCommitChangeset` action a real handler
    // so clicking a commit in the Changes / Code-Changes / Overview panels
    // opens (or focuses) a `changes` tab keyed by `commitHash` instead of just
    // updating the navigation slice's `mainPanel.type`.
    createWorkspaceNavigationTabMiddleware(),
    // Give the (post-saga) file-explorer toggle/expand/refresh triggers a real
    // read handler so directories list their children via `files.list` again.
    createFileExplorerReadMiddleware(),
    // Give the (post-saga) `createFileRequested` trigger a real write handler so
    // the "New file" command palette / sidebar action creates a file via
    // `appClient.files.write` and refreshes the tree again instead of being a
    // no-op.
    createFilesWriteMiddleware(),
    // Give the (post-saga) `createNoteRequested` trigger a real write handler so
    // the Context tab "Add new note" action and the command palette "New note"
    // command create a note via `appClient.notes.create` and open it in the
    // main panel again instead of being a no-op.
    createNotesWriteMiddleware(),
    // Give the (post-saga) `fetchNoteVersions` / `restoreNoteVersion` triggers
    // real handlers so the note-history panel loads the version list via
    // `notes.listVersions` (+ per-version `note.getVersion`) and the Restore
    // button forwards to `notes.restoreVersion` + refreshes the editor and
    // versions list. Without this the panel stays empty and Restore is a no-op.
    createNotesVersionsMiddleware(),
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
    // Give the BE-driven onboarding folder picker (`DirectoryPickerModal`) a real
    // read handler so `loadDirectoryRequested` fetches via
    // `backendRequest('host.listDirectory', ...)` and dispatches the result back
    // to the `directoryPicker` slice — keeping `backendRequest` out of the Svelte
    // component (per the `intent/no-component-async-data-fetch` rule).
    createDirectoryPickerReadMiddleware(),
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
