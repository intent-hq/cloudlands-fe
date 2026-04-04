# Component Responsibilities Guide

Purpose: current ownership map for change tracking, event persistence, file tracking, and adjacent git/workspace helpers. This document intentionally lists only live code paths.

## Architecture Overview

Per `docs/STATE_MANAGEMENT.md`, Redux in `src/lib/store/` is the canonical home for shared or durable application state. Existing `.store.svelte.ts` files remain transitional adapters and migration targets toward Redux slices, selectors, and sagas.

```text
┌─────────────────────────────────────────────────────────────────┐
│ UI Layer                                                        │
│ CodeChangesPanel, FileChangesList, activity surfaces            │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ selectors + render
┌─────────────────────────────────────────────────────────────────┐
│ State Layer                                                     │
│ Redux in src/lib/store/ is canonical for shared/durable state   │
│ .store.svelte.ts files are transitional migration targets       │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Redux actions
┌─────────────────────────────────────────────────────────────────┐
│ Saga Event Channels                                             │
│ `takeEveryFromElectronChannel`, `takeEveryFromListenSync`,      │
│ and related saga watchers bridge IPC/window events into Redux   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ IPC
┌─────────────────────────────────────────────────────────────────┐
│ IPC Handlers                                                    │
│ src/features/file-tracking/main/file-tracking.ipc.ts            │
│ src/features/events/main/events.ipc.ts                          │
│ src/features/git/main/git.ipc.ts                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Main Services                                                   │
│ FileTrackingService, Redux Event Slices, GitService,            │
│ GitStateManager                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Change Detection + Persistence                                  │
│ ChangeDetectorRefactored, change-detection/*, provenance/*,     │
│ FileTrackingStorage, EventStore                                 │
└─────────────────────────────────────────────────────────────────┘
```

For IPC-driven updates, the ownership path is now: **Main Process → IPC → Saga Event Channels → Redux Actions → State → UI**.

## State Ownership Rules

- Put shared, durable, or workflow-driving state in Redux under `src/lib/store/`.
- Keep Svelte components focused on rendering, interaction, and minimal instance-local UI state.
- Treat `.store.svelte.ts` files such as file tracking and line changes as transitional rather than the long-term state architecture.
- Put cross-component async workflows and persistence logic in sagas or main-process services, not in component `$effect` chains.

## Redux Saga Domains

The root saga registry in `src/lib/store/sagas.ts` now owns many responsibilities that previously lived in components. Components should render state and dispatch user intent; sagas should own IPC listeners, workflow coordination, and persistence.

| Domain | Ownership |
| --- | --- |
| `app-layout-saga` | Menu events, navigation events, zoom, file creation, and dock navigation. |
| `workspace-agents-saga` | Agent creation, agent loading, lifecycle coordination, and delegation flows. |
| `workspace-terminals-saga` | Terminal creation, terminal loading, and terminal-related IPC event handling. |
| `git-operations-saga` | Git operation completed/failed toasts plus related analytics/reporting hooks. |
| `global-modals-saga` | GitHub auth, git credentials, and new space modal flows. In practice, the `global-modals` slice owns modal state while IPC-triggered watcher sagas dispatch into it. |
| `workspace-sync-saga` | `workspace:updated` IPC events and renderer-side workspace synchronization. |
| `user-preferences/ipc-saga` | Notification sound playback and IPC-based preference synchronization. |

## What Belongs Where

| Concern | Owner | NOT in |
| --- | --- | --- |
| IPC event listeners | Sagas (via `takeEveryFrom*`) | Components (`onMount`, `$effect`) |
| Modal open/close state | `global-modals` slice | Component `$state` |
| Agent lifecycle | `workspace-agents` saga | Page component |
| Terminal lifecycle | `workspace-terminals` saga | Page component |
| localStorage reads/writes | Saga helpers (`safe-local-storage-saga`) | Component code |
| Dock navigation (Alt+Up/Down) | `app-layout-saga` | Component composable |
| Deep link handling | `deep-links` slice + saga | Component `onMount` |

## Selector and Dispatch Lifecycle

Both `getDispatch()` and selector readable calls (`selectFoo()`) use Svelte's `getContext()` internally, which is **only available during component initialization** (synchronous top-level `<script>` execution).

**Rules:**
1. Call `getDispatch()` and selector readables at the top level of `<script>`, never inside event handlers, callbacks, or async functions
2. For one-time state reads inside event handlers, use `selector.select(getReduxStore().getState(), ...args)`
3. For dispatching inside event handlers, store the dispatch function at init: `const dispatch = getDispatch()`

## Current Component Map

### Event system

| Component | Location | Responsibility |
| --- | --- | --- |
| workspace-events slice | src/store/main/slices/workspace-events/ | Redux slice for workspace event state, deduplication, and emission via `emitWorkspaceEvent`. |
| domain-events actions | src/store/main/slices/domain-events/ | Redux actions + broadcast sagas for domain events (terminal, notes, git, etc.). |
| agent-subscriptions slice | src/store/main/slices/agent-subscriptions/ | Agent event filter state and subscription management. |
| EventStore | src/features/events/main/event-store.ts | Append-only JSONL persistence for workspace events (used by persistence saga). |
| EventQueryEngine | src/features/events/main/event-query-engine.ts | Filtering, sorting, pagination, and aggregation over stored events. |
| EventFilterEngine | src/features/events/event-filter-engine.ts | Pure filter matching logic for event subscriptions. |
| broadcast-saga | src/store/main/slices/workspace-events/sagas/broadcast-saga.ts | Broadcasts accepted workspace events to renderer windows and STDIO. |
| renderer-subscription-saga | src/store/main/slices/workspace-events/sagas/renderer-subscription-saga.ts | Delivers accepted events to matching renderer subscriptions. |
| renderer-subscription-registry | src/features/events/main/renderer-subscription-registry.ts | Holds active renderer event subscriptions. |

### File tracking

| Component | Location | Responsibility |
| --- | --- | --- |
| FileTrackingService | src/features/file-tracking/main/file-tracking.service.ts | Core tracked-change lifecycle, staging/unstaging, and cleanup. |
| FileTrackingStore | src/features/file-tracking/file-tracking.store.svelte.ts | Transitional renderer store with optimistic updates for file-tracking UI. |
| FileTrackingStorage | src/features/file-tracking/main/file-tracking-storage.ts | Durable storage for tracked changes and stage transitions. |
| GitIntegrationService | src/features/file-tracking/main/git-integration.service.ts | Synchronizes git status with tracked-change state. |
| PerformanceMonitor | src/features/file-tracking/performance-monitor.ts | Performance counters and thresholds for the tracking pipeline. |

### Change detection and provenance

| Component | Location | Responsibility |
| --- | --- | --- |
| ChangeDetectorRefactored | src/features/workspace/main/change-detector-refactored.ts | Top-level coordinator for file watching, git polling, processing, emission, and cleanup. |
| ChangeProcessor | src/features/workspace/main/change-detection/change-processor.ts | Converts detected file and git changes into processed batches and workspace events. |
| EventCoordinator | src/features/workspace/main/change-detection/event-coordinator.ts | Queues and batches processed change events before emission. |
| SnapshotManager | src/features/workspace/main/change-detection/snapshot-manager.ts | In-memory file snapshots and snapshot diff support. |
| AdaptivePollingManager | src/features/workspace/main/change-detection/adaptive-polling-manager.ts | Adjusts git polling intervals based on recent activity and idle periods. |
| GitOperationsSafe | src/features/workspace/main/change-detection/git-operations-safe-wrapper.ts | Safe cached git-status and diff wrapper used by change detection. |
| safe-git-operations.ts | src/features/workspace/main/change-detection/safe-git-operations.ts | Low-level secure git command execution without shell composition. |
| AttributionEngine | src/features/workspace/main/provenance/attribution-engine.ts | Content-based attribution and persisted agent-write tracking. |
| ProvenanceContextManager | src/features/workspace/main/provenance/provenance-context-manager.ts | Stack-based execution context for user, agent, and system provenance. |

### Git, workspace, and line statistics

| Component | Location | Responsibility |
| --- | --- | --- |
| GitService | src/features/git/main/git.service.ts | High-level workspace git operations with caching and serialized writes. |
| GitStateManager | src/features/git-tracking/main/git-state-manager.ts | Full git state tracking for branches, commits, remotes, and PR metadata. |
| WorkspaceContentFileManager | src/features/workspace/workspace-content-file-manager.ts | Renderer-side file loading and saving for the workspace content panel. |
| LineChangesStore (main) | src/features/line-changes/line-changes.store.ts | Main-process cache for workspace and agent line-change statistics. |
| LineChangesStore (renderer) | src/features/line-changes/line-changes.store.svelte.ts | Transitional renderer-side reactive mirror of line-change stats. |
| LineChangesService | src/features/line-changes/line-changes.service.ts | Diff-based additions/deletions calculation and stat refresh. |

### IPC and compatibility items

| Item | Location | Responsibility |
| --- | --- | --- |
| Events IPC | src/features/events/main/events.ipc.ts | Validated renderer ↔ main bridge for emitting, subscribing, and querying events. |
| File Tracking IPC | src/features/file-tracking/main/file-tracking.ipc.ts | Validated renderer ↔ main bridge for tracked-change operations. |
| MonacoDiffViewer.svelte | src/lib/components/file-tracking/MonacoDiffViewer.svelte | Deprecated viewer still kept for legacy hunk-staging flows. |
| git-version.service.ts | src/features/notes/main/storage/git-version.service.ts | Deprecated notes versioning retained for compatibility. |
| version.service.ts | src/features/notes/main/storage/version.service.ts | Current JSONL-based notes versioning service. |
| ACTIVITY_LOG channels | src/shared/ipc-registry.ts | Backward-compat channel definitions; prefer EVENTS channels. |

## Key Runtime Flows

### Staging a file

1. The UI calls the file-tracking renderer store.
2. `src/features/file-tracking/file-tracking.store.svelte.ts` applies an optimistic update immediately.
3. `src/features/file-tracking/main/file-tracking.ipc.ts` validates the request and routes it to the main-process service.
4. `src/features/file-tracking/main/file-tracking.service.ts` performs the git write and updates tracked-change state.
5. `src/features/file-tracking/main/git-integration.service.ts` re-syncs git and tracked-change state after completion.

### Event persistence

1. Change detection emits `activity-log-event` which is bridged into Redux via `workspace.ipc.ts` → `mainDispatch(emitWorkspaceEvent(...))`.
2. The `workspace-events` slice accepts and deduplicates the event.
3. The persistence saga writes to `EventStore` (append-only JSONL).
4. The broadcast saga sends the event to renderer windows and STDIO.
5. The renderer-subscription saga delivers to matching subscriptions.
6. `EventQueryEngine` serves filtered historical reads via IPC.

### ID lifecycle in file tracking

- Synthetic IDs such as `git-{index}-{path}` exist in the renderer before a tracked change is persisted.
- Durable tracked changes receive UUIDs when written by the main-process file tracking service.
- Commit hashes become the durable grouping identifier once tracked changes are committed.