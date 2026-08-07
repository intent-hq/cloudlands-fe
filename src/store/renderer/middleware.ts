/*
  List of middlewares to run, order in this list
  defines order of execution
*/

import type { StoreMiddleware } from '$lib/store-shim/types';
import {
  REDUX_DEBUG_LS_KEY,
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from './constants';
import { createBatchingMiddleware } from './middlewares/batch';
import { createLoggerMiddleware } from './middlewares/logger';
import { createReferenceChangeDetectorMiddleware } from './middlewares/state-reference-checks';
import { createStructuredCloneCheckerMiddleware } from './middlewares/structured-clone-checker';
import { createStoreGuardMiddleware } from '../../store/utils/store-guard-middleware';
import { createGitReadMiddleware } from '$features/git/git-read-service';
import { createAgentReadMiddleware } from '$features/agent/agent-read-service';
import { createAgentSubscriptionReadMiddleware } from '$features/agent/agent-subscription-read-service';
import { createChatReadMiddleware } from '$features/agent/chat-read-service';
import { createChatSubscribeMiddleware } from '$features/agent/chat-subscribe-service';
import { createChatSendMiddleware } from '$features/agent/chat-send-service';
import {
  createMarkAgentSeenTriggerMiddleware,
  markAgentSeenAtBoundary,
} from '$features/agent/mark-agent-seen';
import { createPermissionResponseMiddleware } from '$features/permission/permission-response-service';
import { createDaemonEventsBridgeMiddleware } from '$features/events/daemon-events-bridge.client';
import { createAgentFailureToastMiddleware } from '$features/agent/agent-failure-toast-service';
import { createHardwareConsoleConnectionToastMiddleware } from '$features/hardware-console/connection-toast-service';
import { createHardwareConsoleIntegrationToggleMiddleware } from '$features/hardware-console/integration-toggle-service';
import { createHardwareConsoleKeyPinPersistenceMiddleware } from '$features/hardware-console/assignment/key-pin-persistence-service';
import { createHardwareConsoleKeySwitchMiddleware } from '$features/hardware-console/assignment/key-switch-service';
import { createHardwareConsoleLedStatusMiddleware } from '$features/hardware-console/led/led-status-service';
import { createHardwareConsolePromptPickerMiddleware } from '$features/hardware-console/prompt-picker/prompt-picker-service';
import { createHardwareConsoleActionKeyMiddleware } from '$features/hardware-console/actions/action-key-service';
import { createVoiceTranscriptionMiddleware } from '$features/hardware-console/voice/transcription-service';
import { createHardwareConsoleEncoderMiddleware } from '$features/hardware-console/encoder/encoder-service';
import { createSettingsHydrationMiddleware } from '$features/settings/settings-hydration-service';
import { createModelSelectionPersistenceMiddleware } from '$features/settings/model-selection-persistence-service';
import { createBackgroundAgentSettingsPersistenceMiddleware } from '$features/settings/background-agent-settings-persistence-service';
import { createModelReloadMiddleware } from '$features/settings/model-reload-service';
import { createProviderSettingsPersistenceMiddleware } from '$features/settings/provider-settings-persistence-service';
import { createProviderAvailabilityCheckMiddleware } from '$features/providers/provider-availability-check-service';
import { createHostRequirementsCheckMiddleware } from '$features/system/host-requirements-check-service';
import { createAgentCreationMiddleware } from '$features/agent/agent-creation-service';
import { createAgentMutationMiddleware } from '$features/agent/agent-mutation-service';
import { createEditRegenerateMiddleware } from '$features/agent/edit-regenerate-service';
import { createContextMutationMiddleware } from '$features/context/context-mutation-service';
import { createTaskAgentAssociationsMutationMiddleware } from '$features/tasks/task-agent-associations-mutation-service';
import { createAppLayoutNavigationMiddleware } from '$features/layout/app-layout-navigation-service';
import { createWorkspaceNavigationTabMiddleware } from '$features/layout/workspace-navigation-tab-service';
import { createWorkspaceNavigationLayoutMiddleware } from '$features/layout/workspace-navigation-layout-service';
import { createFileExplorerReadMiddleware } from '$features/file-explorer/file-explorer-read-service';
import { createFilesReadMiddleware } from '$features/files/files-read-service';
import { createFilesWriteMiddleware } from '$features/files/files-write-service';
import { createNotesWriteMiddleware } from '$features/notes/notes-write-service';
import { createNotesVersionsMiddleware } from '$features/notes/notes-versions-service';
import { createNotesReadMiddleware } from '$features/notes/notes-read-service';
import { createGitHubAuthMiddleware } from '$features/github-auth/github-auth-store-service';
import { createSentryAuthMiddleware } from '$features/sentry-auth/sentry-auth-store-service';
import { createLinearAuthMiddleware } from '$features/linear-auth/linear-auth-store-service';
import { createVoiceSettingsMiddleware } from '$features/voice/voice-settings-store-service';
import { createMcpManagementMiddleware } from '$features/mcp/mcp-management-service';
import { createWorkspaceOperationsMiddleware } from '$features/workspace/workspace-operations-service';
import { createDirectoryPickerReadMiddleware } from '$features/onboarding/directory-picker-read-service';
import { createLegacyImportMiddleware } from '$features/settings/legacy-import-service';
import { createStatsReadMiddleware } from '$features/stats/stats-read-service';
import { createBackgroundHooksMiddleware } from '$features/hooks/background-hooks-read-service';
import { createLifecycleReadMiddleware } from './middlewares/lifecycle-read-service';
import { createLifecycleIpcReadMiddleware } from './middlewares/lifecycle-ipc-read-service';
import { createUiLayoutPersistenceMiddleware } from './middlewares/ui-layout-persistence-service';
import { createTabStatePersistenceMiddleware } from './middlewares/tab-state-persistence-service';
import { createSidebarNavPersistenceMiddleware } from './middlewares/sidebar-nav-persistence-service';
import { createBrowserPersistenceMiddleware } from './middlewares/browser-persistence-service';
import { createPanelLayoutPersistenceMiddleware } from './middlewares/panel-layout-persistence-service';
import { createFileContentPruneService } from './middlewares/file-content-prune-service';
import { createDividerSessionBoundaryService } from './middlewares/divider-session-boundary-service';
import { createTerminalPersistenceMiddleware } from './middlewares/terminal-persistence-service';
import { createExternalEditorsPersistenceMiddleware } from './middlewares/external-editors-persistence-service';
import { createZoomSyncMiddleware } from './middlewares/zoom-sync-service';
import { createMenuIpcMiddleware } from './middlewares/menu-ipc-service';
import { createBrowserIpcMiddleware } from './middlewares/browser-ipc-service';
import { createNotificationIpcMiddleware } from './middlewares/notification-ipc-service';
import { createAgentEventsIpcMiddleware } from './middlewares/agent-events-ipc-service';
import { createGitEventsIpcMiddleware } from './middlewares/git-events-ipc-service';
import { createWebNotificationMiddleware } from '$features/notifications/web-notification-service';
import { createWorkspaceSettingsPersistenceMiddleware } from './middlewares/workspace-settings-persistence-service';
import { createUserPreferencesBetaPersistenceMiddleware } from './middlewares/user-preferences-beta-persistence-service';
import { createUserPreferencesNotificationPersistenceMiddleware } from './middlewares/user-preferences-notification-persistence-service';
import { createUserPreferencesPersistenceMiddleware } from './middlewares/user-preferences-persistence-service';
import { createWorkspaceInitializerPersistenceMiddleware } from './middlewares/workspace-initializer-persistence-service';
import { createThemeMutationMiddleware } from '$features/theme/theme-service';
import { createAutoUpdateMutationMiddleware } from '$features/auto-update/auto-update-mutation-service';
import { createReleaseNotesMutationMiddleware } from '$features/release-notes/release-notes-mutation-service';
import { createSpecialistsMutationMiddleware } from '$features/specialists/specialists-mutation-service';
import { createDaemonHealthMiddleware } from './middlewares/daemon-health-service';
import { createConnectionsMiddleware } from './middlewares/connections-service';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { isHudWindowRenderer } from '$lib/utils/navigation.client';

const isDevBuild = (): boolean =>
  Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

/**
 * Get Redux logger configuration from localStorage for manual debugging.
 */
function getReduxLoggerConfig(): { enabled: boolean; webviewName?: string } {
  if (typeof window === 'undefined') {
    return { enabled: false };
  }

  const globallyEnabled = (window as any).intentFlags?.enableReduxLogger;

  let localStorageEnabled: boolean | undefined;
  const { value: localStorageValue, hadError } =
    safeLocalStorage.getItemWithStatus(REDUX_DEBUG_LS_KEY);

  if (hadError) {
    localStorageEnabled = false;
  } else if (localStorageValue != null && localStorageValue !== 'undefined') {
    try {
      localStorageEnabled = !!JSON.parse(localStorageValue);
    } catch (error) {
      console.warn(`Failed to parse ${REDUX_DEBUG_LS_KEY} from localStorage:`, error);
      localStorageEnabled = false;
    }
  }

  const enableReduxLogger = globallyEnabled ?? localStorageEnabled ?? isDevBuild();
  const webviewName = globallyEnabled ? (window as any).intentFlags?.webviewName : '';

  return { enabled: enableReduxLogger, webviewName };
}

function buildMiddleware(): StoreMiddleware[] {
  // The chrome-less HUD pop-out window must be fully inert to Codex Micro /
  // Creator Micro 2 input: only the main window may open the device, decode
  // input, drive LEDs, or dispatch hardware-triggered effects. Skipping the
  // hardware-console middlewares here keeps the shared manager from ever
  // starting in the HUD renderer (and eliminates double-execution of actions
  // like new-workspace / stop-agent). This module loads in the renderer after
  // the page URL is set, so `window.location` is reliable at build time; in
  // non-window contexts the check is false and behavior is unchanged.
  const hardwareConsoleMiddleware: StoreMiddleware[] = isHudWindowRenderer()
    ? []
    : [
        // Surface connect/disconnect toasts with firmware, battery, transport,
        // and Codex-mode readiness for supported devices.
        createHardwareConsoleConnectionToastMiddleware(),
        // Hydrate the hardware-console integration enable/disable flag from the
        // shared `hardwareConsole.state` daemon settings bag, persist toggle
        // changes (read-modify-write so sibling fields survive), and stop/start
        // the shared manager to match the flag. Sole owner of the boot-time
        // manager start (WebHID; no-op where WebHID is unavailable): the manager
        // starts only after hydration settles with the flag on.
        createHardwareConsoleIntegrationToggleMiddleware(),
        // Hydrate the hardware-console agent-key pins from the shared
        // `hardwareConsole.state` daemon settings bag and persist pin changes
        // (read-modify-write so sibling fields in the bag survive).
        createHardwareConsoleKeyPinPersistenceMiddleware(),
        // Wire agent-key presses to workspace switching: first press navigates
        // to the resolved workspace and lands on the first agent tab requiring
        // attention (falling back to the current/first open tab); subsequent
        // presses cycle through that workspace's open tabs in order.
        createHardwareConsoleKeySwitchMiddleware(),
        // Drive the device LEDs from store state: per-key v.oai.thstatus frames
        // for the 6 assigned workspaces plus the v.oai.rgbcfg ambient state
        // (breath while running, blink-amber on attention, dark when idle);
        // frames replay on reconnect.
        createHardwareConsoleLedStatusMiddleware(),
        // Joystick radial prompt picker: track composer submissions in the
        // prompt-usage tracker (persisted in the shared hardwareConsole.state
        // bag, read-modify-write) and open a radial overlay of the top-N prompts
        // on joystick deflection; release inserts the highlighted prompt at the
        // cursor of the focused text input (never auto-sends).
        createHardwareConsolePromptPickerMiddleware(),
        // Wire action-key presses (ACT06-ACT12) to the mapped v1 actions
        // (cycle agents, stop agent, see spec, toggle sidebar tabs, new agent,
        // new workspace, ...); unavailable actions no-op with a subtle toast
        // hint. The mapping hydrates from the shared hardwareConsole.state bag
        // and persists changes (read-modify-write so sibling fields survive).
        createHardwareConsoleActionKeyMiddleware(),
        // Push-to-talk transcription: on `pttRecordingFinished`, call the
        // daemon's `voice.transcribe` (PROTOCOL §5.41) with lightweight
        // store-derived context and insert the transcript at the cursor of
        // the active agent's composer (insert-for-review, never auto-send).
        // HUD shows "Transcribing…" while in flight; errors surface as
        // toasts (no-key hint → Settings, provider failure → error).
        createVoiceTranscriptionMiddleware(),
        // Encoder behaviors: rotate cycles the active workspace by activity
        // (one step per detent, direction honored, clamped at the list ends,
        // small HUD while rotating); click opens the All-workspaces sidebar
        // panel, then cycles its view mode Recent → Repo → Status.
        createHardwareConsoleEncoderMiddleware(),
      ];

  const baseMiddleware: StoreMiddleware[] = [
    // Guard must be first — reject actions tagged for the wrong store immediately
    createStoreGuardMiddleware('renderer'),
    // No action types to batch yet — add action types here as slices are added
    createBatchingMiddleware([]),
    // Give the (post-saga) `loadGitStatus` action a real read handler so the
    // ~13 dispatch sites refresh git status on demand again.
    createGitReadMiddleware(),
    // Give the (post-saga) `ensureAgentSessionLoaded` action a real read handler
    // so a selected agent's session/conversation hydrates on demand again.
    createAgentReadMiddleware(),
    // Give the (post-saga) `requestSubscriptionFetch` action a real read handler
    // so the "Waiting for all N agents" row (AgentSubscriptions.svelte) populates
    // from `agent.getSubscriptions` (PROTOCOL §5.5 extensions) and resets on
    // `workspaceDeleted` (LEAK-1) instead of staying empty/stale.
    createAgentSubscriptionReadMiddleware(),
    // Give the (post-saga) `loadFileContentRequested` action a real read handler
    // so file tabs and the diff viewer fetch content via `appClient.files.read`
    // and clear the loading skeleton (or surface an error) instead of hanging
    // forever.
    createFilesReadMiddleware(),
    // Give the (post-saga) `initializeChatRequested` action a real read handler
    // so opening an agent loads its full retained transcript via
    // `agents.getConversation` instead of showing an empty conversation.
    createChatReadMiddleware(),
    // Keep the open chat's transcript live from the standing `chat.subscribe`
    // stream (PROTOCOL §7.1): on `initializeChatRequested` a per-agent
    // subscription reconciles snapshot+deltas into the agent-session slice,
    // swapping/tearing down on agent switch, chat close, and agent deletion.
    createChatSubscribeMiddleware(),
    // Give the (post-saga) `sendMessage` action a real consumer so pressing
    // Send in ChatPanel routes through `agent-send.sendMessage()` — producing
    // a user message and a live-streaming assistant response — instead of
    // being a no-op.
    createChatSendMiddleware(),
    // Advance the per-conversation seen marker (agent.markSeen, PROTOCOL §5.5)
    // at the two action-driven discrete triggers: turn finish (`streamEnded`,
    // gated on viewed tab + window focus at fire time) and user send
    // (`sendMessage`). The third trigger — stop-looking boundaries — is wired
    // through createDividerSessionBoundaryService's onBoundary seam below.
    createMarkAgentSeenTriggerMiddleware(),
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
    // Surface one persistent bottom-left toast per agent-failure group (from
    // the cross-workspace failure registry the events bridge above feeds) with
    // a Retry All action that redrives each failed agent via `agent.retry`.
    // Toasts update in place per group and auto-dismiss when a group empties.
    createAgentFailureToastMiddleware(),
    // Hardware-console middlewares (empty in the HUD pop-out window — see above).
    ...hardwareConsoleMiddleware,
    // Poll system.status periodically (~10s) and listen to backend:status
    // connection events to derive tri-state daemon health (healthy/degraded/down)
    // plus stats payload for the health indicator UI.
    createDaemonHealthMiddleware(),
    // Multi-backend connect: fetch the initial connections:list and subscribe
    // to connections:changed / connections:cert-mismatch pushes on first
    // dispatch, keeping the connections slice in sync with main.
    createConnectionsMiddleware(),
    // Boot-hydrate the BE-owned settings slices (providers, background-agents,
    // MCP, model overrides) by calling `settings.list` once on first dispatched
    // action, then keep them in sync via the `settings:changed` routing the
    // daemon-events bridge above plugs into. The hydration is fire-and-forget
    // so dispatch stays synchronous and unaffected.
    createSettingsHydrationMiddleware(),
    // Give the (post-saga) `selectModel` trigger a real handler (map to
    // `setSelectedModel` for the active provider) and persist model picks to
    // the daemon settings catalog (`model.providerDefaults`, PROTOCOL §5.12)
    // so the selection survives a reload — the hydration middleware above
    // reads the same path on boot.
    createModelSelectionPersistenceMiddleware(),
    // Persist background-agent settings (default model + per-type overrides)
    // to the daemon settings catalog (`backgroundAgents.defaultModel` /
    // `backgroundAgents.typeOverrides`, PROTOCOL §5.12) on every mutation
    // (setDefaultModel / setTypeOverride / clearTypeOverride / resetSettings)
    // so the values survive restart. The settings-hydration middleware above
    // reads and dispatches them on boot and on settings:changed events.
    createBackgroundAgentSettingsPersistenceMiddleware(),
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
    // Give the host-requirements triggers (`ensureHostRequirementsChecked`,
    // `checkHostRequirementsRequested`) a real handler so the git + node
    // probes (system:check-git / system:check-node → daemon host.*) land the
    // hostRequirements slice in a terminal state for the onboarding gate —
    // failures fold to not-available, never stuck on "checking".
    createHostRequirementsCheckMiddleware(),
    // Give the (post-saga) agent-creation triggers (create / create-with-
    // specialist / run-for-note / activate-initial) real handlers so Cmd/Ctrl+T,
    // the New-agent / specialist UI, the NoteMetadataBar run button, and fresh-
    // workspace initial-agent activation create an agent via `agentFactory` and
    // open its tab again.
    createAgentCreationMiddleware(),
    // Give the (post-saga) agent-session mutation triggers (restore / activate
    // / save) real handlers so `agent-send.sendMessage()` — which awaits each
    // `action.promise` before dispatching the user message and issuing the
    // wire send — can resolve again instead of hanging. Restore reads
    // via `appClient.agents.get`; activate marks the session ACTIVE and
    // refetches; save is a no-op on the mock seam (Redux IS the state).
    createAgentMutationMiddleware(),
    // Give the (post-saga) `agentSessionEditAndRegenerateRequested` trigger a
    // real handler so editing a past user message forwards to
    // `agent.editAndRegenerate` (PROTOCOL §5.5 extensions) — truncating the
    // transcript at the edited message and regenerating from there — instead
    // of being a no-op.
    createEditRegenerateMiddleware(),
    // Give the (post-saga) context slice's `addContextItem` /
    // `removeContextItem` / `updateContextItem` triggers a real write handler
    // so chat-context edits forward to `workspace.updateContext` (PROTOCOL
    // §5.1) instead of the removed `safeLocalStorage` persist. The daemon's
    // `workspace:context-changed` event (folded via daemon-events-bridge)
    // converges cross-window state.
    createContextMutationMiddleware(),
    // Give the (post-saga) taskAgentAssociations slice's mutation triggers
    // real write handlers so `addTaskAgentAssociation` /
    // `removeTaskAgentAssociation` / `pruneTaskAgentAssociationsForNote`
    // forward to `task.linkAgent` / `task.unlinkAgent` (PROTOCOL §5.4)
    // instead of the removed localStorage persist. Cross-window convergence
    // flows via the `task:agent-linked` / `task:agent-unlinked` events.
    createTaskAgentAssociationsMutationMiddleware(),
    // Give the (post-saga) `openAgentTabRequested` action a real handler so
    // clicking an agent opens (or focuses) its conversation tab again.
    createAppLayoutNavigationMiddleware(),
    // Give the (post-saga) `openWorkspaceCommitChangeset` action a real handler
    // so clicking a commit in the Changes / Code-Changes / Overview panels
    // opens (or focuses) a `changes` tab keyed by `commitHash` instead of just
    // updating the navigation slice's `mainPanel.type`.
    createWorkspaceNavigationTabMiddleware(),
    // Give the (post-saga) `hydrateWorkspaceNavigation` action a real handler
    // so the workspace-creation flow (CompactWorkspaceInitializer / OnboardingPage)
    // actually renders the pre-navigation intent (spec note in the main panel +
    // initial-agent conversation in the adjacent drawer panel) instead of
    // mounting the workspace page with an empty panel-layout.
    createWorkspaceNavigationLayoutMiddleware(),
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
    // Give `workspaceMounted` a notes hydration handler so a workspace
    // created/first-opened after boot fetches its notes (Spec included) via
    // `appClient.notes.list` and renders instead of showing an empty panel
    // until an app restart. Boot-seeded workspaces are unaffected — the
    // service skips when the workspace-notes slice is already initialized.
    createNotesReadMiddleware(),
    // Give the (post-saga) GitHub / Sentry / Linear OAuth connect/status/logout
    // triggers real handlers so the settings buttons run their auth flows again.
    createGitHubAuthMiddleware(),
    createSentryAuthMiddleware(),
    createLinearAuthMiddleware(),
    // Give the voice settings triggers (initialize + provider change +
    // save/clear API key) handlers that run against the daemon settings seam.
    createVoiceSettingsMiddleware(),
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
    // Route Settings legacy-import requests through the client service and
    // reflect the asynchronous result in the legacyImport slice.
    createLegacyImportMiddleware(),
    // Give the usage-stats overlay a real read handler so
    // `loadUsageStatsRequested` fetches via `stats.getUsage` and dispatches the
    // result back to the `stats` slice — keeping the wire call out of the
    // Svelte component (per the `intent/no-component-async-data-fetch` rule).
    createStatsReadMiddleware(),
    // Give the BackgroundHooksRow chip row a real live-read handler so
    // `backgroundHooksSubscribeRequested` opens the workspace's `hook:*`
    // events.subscribe + `hook.list` seed and run/cancel triggers forward to
    // `hook.runNow` / `hook.cancel` (PROTOCOL §5.40) — keeping the wire calls
    // out of the Svelte component (per the `intent/no-component-async-data-fetch`
    // rule).
    createBackgroundHooksMiddleware(),
    // Give the (post-saga) ui-layout persistence triggers real handlers so panel
    // sizes / group layouts / collapsed state read on mount and persist on change
    // across sessions via localStorage again.
    createUiLayoutPersistenceMiddleware(),
    // Give the (post-saga) tab-state persistence triggers real handlers so the
    // workspace-tab strip (order/pin/active tab) and per-tab scroll positions
    // hydrate on boot and persist on change across sessions via localStorage.
    createTabStatePersistenceMiddleware(),
    // Give the (post-saga) sidebar-nav persistence triggers real handlers so
    // pinned workspaces, view mode, panel state, and other sidebar UI state
    // hydrate on boot and persist on change across sessions via localStorage.
    createSidebarNavPersistenceMiddleware(),
    // Give the browser state persistence triggers real handlers so recent URLs
    // hydrate from localStorage on workspace mount and persist on change
    // (`addRecentUrl` / `updateUrlMetadata` / `removeRecentUrl` / `clearRecentUrls`).
    createBrowserPersistenceMiddleware(),
    // Give the (post-saga) panel-layout persistence triggers real handlers so
    // per-workspace panel tabs + split layouts hydrate from localStorage on
    // `workspaceMounted` (once per session), persist on layout-mutating actions,
    // and save layout history to disk (debounced) via IPC. Retroactively
    // restores the active workspace's layout on middleware creation.
    createPanelLayoutPersistenceMiddleware(),
    // Automatically remove file-content entries from the files slice when their
    // corresponding file tabs are closed. Reacts when the stale-path computation
    // changes (not on every action) to prune content entries no longer open in
    // any panel file tab, matching the deleted `cleanupClosedFileContentEntries`
    // saga behavior. Guards against empty payloads, invalid workspace IDs, and
    // self-retrigger loops.
    createFileContentPruneService(),
    // End latched "New messages" divider viewing sessions at stop-looking
    // boundaries: agent chat tab close, chief-card visibility loss (the
    // ChiefCard's equivalent of a tab close), and active-workspace switch for
    // non-chief sessions only. Same-workspace tab deactivation, cached panel
    // destroy, and chief-thread switching intentionally do NOT end sessions.
    // The onBoundary seam fires the third discrete agent.markSeen trigger for
    // the affected agents — the user was looking right up to the boundary.
    createDividerSessionBoundaryService({
      onBoundary: (boundary) => markAgentSeenAtBoundary(boundary.agentIds),
    }),
    // Give the (post-saga) terminal persistence triggers real handlers so terminal
    // overlay height, custom terminal names, terminal metadata, and per-workspace
    // overlay state (isOpen, activeTerminalId) hydrate on boot and persist on
    // change across sessions via localStorage (GAPs 2-5). Also restores saved
    // state when loadWorkspaceTerminals is dispatched by lifecycle-read-service.
    createTerminalPersistenceMiddleware(),
    // Give the (post-saga) external-editors persistence triggers real handlers so
    // Open-In action choices (setOpenAction → localStorage) and hidden-editor
    // preferences (toggleHiddenEditor → daemon settings) persist across sessions.
    // Hydrates hidden editor IDs from daemon settings on boot.
    createExternalEditorsPersistenceMiddleware(),
    // Restore the window zoom-factor listener (deleted user-preferences/sagas/
    // ipc-saga.ts) so zoom-level changes from the main process (Cmd/Ctrl+Plus/
    // Minus or View menu) dispatch setZoomFactor and reach the Redux store again.
    createZoomSyncMiddleware(),
    // Restore the menu bar IPC listeners (deleted app-layout/sagas/
    // app-layout-saga.ts) so `navigate` and the `menu:*` channels the main
    // process sends on menu clicks (Settings..., New Workspace, Open Recent,
    // New Agent/Note/Terminal/Browser, Close Tab, Reopen Closed Tab, Select
    // Previous/Next Tab, browser zoom) take effect in the renderer again.
    createMenuIpcMiddleware(),
    // Restore the browser:open-tab IPC listener (deleted app-layout/sagas/
    // app-layout-saga.ts → watchBrowserOpenTabSaga) so agent/MCP-triggered
    // browser tab opens forwarded by the main process take effect in the
    // renderer again (replace / adjacent / plain-open semantics).
    createBrowserIpcMiddleware(),
    // Restore the notification IPC listeners (deleted ui-notifications/sagas/
    // ui-notifications-saga.ts) so `notification:show` plays the notification
    // sound per the sound settings and `notification:navigate` (notification
    // click) navigates to the emitting workspace again.
    createNotificationIpcMiddleware(),
    // Restore the agent-events IPC listeners (deleted auth/sagas/auth-saga.ts)
    // so `agent:auth-required` shows a warning toast (with an Open Terminal
    // action) and `agent:plan-required` shows a plan-upgrade error toast again.
    createAgentEventsIpcMiddleware(),
    // Restore the git event IPC listeners (deleted git/sagas/git-operations-saga.ts
    // + auth/sagas/auth-saga.ts) so `git:op-completed` / `git:op-failed` update
    // lastGitOperation/lastGitError and show result toasts again, and
    // `git:auth-required` / `github:auth-required` open the git-credentials /
    // GitHub-auth modals again.
    createGitEventsIpcMiddleware(),
    // Web-platform substitute for the main-process NotificationService:
    // when `getPlatform() === 'web'` (no Electron main process), listen on
    // the relayed legacy `agent:idle` channel and show browser Notifications
    // with Electron-parity trigger/suppression rules, click-to-navigate, and
    // the shared sound gate. Registers nothing on Electron.
    createWebNotificationMiddleware(),
    // Give the (post-saga) workspace-settings persistence triggers real handlers
    // so the auto-commit toggle in CodeChangesPanel.svelte persists via IPC to
    // main (WORKSPACE_CHANNELS.UPDATE_SETTINGS) + electron-store (SETTINGS_CHANNELS.SET
    // key:"autoCommit") instead of silently having no effect. Matches deleted
    // workspace-settings/sagas/persistence-saga.ts behavior.
    createWorkspaceSettingsPersistenceMiddleware(),
    // Give the (post-saga) beta-updates persistence triggers real handlers so
    // setBetaUpdatesEnabled/toggleBetaUpdates from settings UI persists via IPC
    // (settings:set key:"betaUpdatesEnabled") AND applies the update channel
    // (autoUpdateClient.setChannel) instead of silently having no effect. Matches
    // deleted user-preferences/sagas/persistence-saga.ts → watchBetaUpdatesPersistence.
    createUserPreferencesBetaPersistenceMiddleware(),
    // Give the (post-saga) notification-settings persistence triggers real handlers
    // so setNotificationEnabled/setSoundEnabled/setSoundOnlyWhenUnfocused/setVolume/
    // resetNotificationSettings from settings UI persists via IPC (settings:set
    // key:"notificationSettings") with 100ms debounce instead of silently having no
    // effect. Matches deleted user-preferences/sagas/persistence-saga.ts →
    // watchNotificationSettingsPersistence.
    createUserPreferencesNotificationPersistenceMiddleware(),
    // Give the (post-saga) user-preferences persistence triggers real handlers
    // again: spellcheck, showArchived, groupByRepo, hasCompletedProviderSetup,
    // agent font style, note font style, code font family, activity-log presets,
    // and promo-banner interactions. Persists to localStorage on action and
    // hydrates from localStorage on boot (first action). Excludes beta-updates
    // and notification settings (handled by sibling middlewares above).
    createUserPreferencesPersistenceMiddleware(),
    // Give the (post-saga) workspace-initializer persistence triggers real
    // handlers: hydrate from daemon `workspaceInitializer.state` (§5.12) on boot,
    // persist state bag on mutating actions (compact form, onboarding form,
    // last repo, recent repos, remote setups, etc.), debounce onboarding form
    // drafts (300ms), and migrate legacy localStorage keys to daemon setting.
    // Restores the home-screen repo selector defaulting to the last selected repo.
    createWorkspaceInitializerPersistenceMiddleware(),
    // Give the (post-saga) theme triggers (`requestThemePreferenceChange` /
    // `selectThemePreset` / `importCustomTheme` / `clearThemeCustomization`)
    // real handlers so the Settings theme toggle and ColorThemeSettings
    // preset / import / clear buttons apply and persist through the
    // `ThemeManager` singleton again — and hydrate Redux from the manager's
    // snapshot on boot so the slice reflects the persisted preference.
    createThemeMutationMiddleware(),
    // Give the (post-saga) `initAutoUpdate` trigger a real handler so
    // UpdateNotification.svelte onMount registers `autoUpdateClient` IPC
    // listeners (status-changed / progress / error / show-toast / up-to-date)
    // and fetches initial state — making "Check for Updates" show UI feedback
    // (checking toast → up-to-date / available / error) instead of silently
    // running the check in main with zero renderer-side events.
    createAutoUpdateMutationMiddleware(),
    // Give the release-notes triggers real handlers: `initializeReleaseNotes`
    // registers the main → renderer "show release notes" push listener once
    // (startup-after-update and Help ▸ Show Release Notes), and
    // `showReleaseNotes` fetches the running version's notes on demand.
    createReleaseNotesMutationMiddleware(),
    // Give the (post-saga) specialist mutation triggers (`saveFileSpecialist` /
    // `deleteFileSpecialist` / `exportBuiltinToFile` / `loadFileSpecialists`)
    // real handlers so Settings specialist writes (model override for all
    // specialists, per-specialist prompt edits, create-new, delete, reset-to-
    // default) reach the daemon via `specialist.create`/`edit`/`delete` and
    // refetch `specialist.list` to update the store — making the "Use for all
    // specialists" button hide once all specialists use the selected model.
    createSpecialistsMutationMiddleware(),
  ];

  // Debug middlewares need to be added AFTER batching middleware
  // so they see the actual state changes, not the batched actions
  const debugMiddlewares: StoreMiddleware[] = [];

  if (typeof window !== 'undefined') {
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
