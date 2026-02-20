# Component Responsibilities Guide

**Version**: 2.1
**Date**: 2026-01-07
**Purpose**: Clear definition of what each component is responsible for

## Architecture Overview

The change tracking system is organized into five layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Layer                                  │
│  CodeChangesPanel, FileChangesList, ActivityLog                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Renderer Stores                               │
│  FileTrackingStore, GitStore, LineChangesStore                  │
│  (Svelte 5 runes, reactive state, optimistic updates)           │
└─────────────────────────────────────────────────────────────────┘
                              │ IPC
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    IPC Handlers                                  │
│  file-tracking.ipc.ts, git.ipc.ts, events.ipc.ts                │
│  (Zod validation, channel routing)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Main Process Services                         │
│  FileTrackingService, GitService, GitIntegrationService         │
│  (Business logic, git commands, storage)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Change Detection                              │
│  ChangeDetector, ChangeProcessor, EventCoordinator              │
│  (File watching, git polling, event emission)                   │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Staging a File

```
User clicks "Stage" in CodeChangesPanel
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. CodeChangesPanel.handleStageChange(change)                   │
│    - Calls fileTrackingStore.stageChanges([change.id], [change])│
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. FileTrackingStore.stageChanges()                             │
│    - Adds IDs to pendingStageOperations Set                     │
│    - Performs OPTIMISTIC UPDATE (immediate UI change)           │
│    - Fires IPC call WITHOUT awaiting (non-blocking)             │
│    - Returns { ok: true } immediately                           │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (async, non-blocking)
┌─────────────────────────────────────────────────────────────────┐
│ 3. IPC: file-tracking:stage-changes                             │
│    - Validates with FileTrackingStageChangesSchema              │
│    - Gets FileTrackingService for workspace                     │
│    - Calls service.stageChanges(changeIds)                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. FileTrackingService.stageChanges()                           │
│    - Extracts file paths from changeIds                         │
│    - Handles synthetic IDs (git-{index}-{path})                 │
│    - Executes: git add <files>                                  │
│    - Updates storage with new stage                             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Background Sync (non-blocking)                               │
│    - GitIntegrationService.syncCurrentState(false, false)       │
│    - Syncs git state with file tracking                         │
│    - Emits 'changes-tracked' event                              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. On IPC Success/Failure                                       │
│    - Clears pendingStageOperations                              │
│    - On failure: ROLLBACK optimistic update                     │
└─────────────────────────────────────────────────────────────────┘
```

## ID Lifecycle

Changes go through different ID formats as they progress:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. SYNTHETIC ID (Frontend-generated)                            │
│    Format: git-{index}-{path}                                   │
│    Example: git-0-src/app.ts                                    │
│    Created: When gitStore has status but FileTrackingService    │
│             hasn't created a TrackedChange yet                  │
│    Used by: CodeChangesPanel fallback to gitStore               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (on stage/unstage or sync)
┌─────────────────────────────────────────────────────────────────┐
│ 2. UUID (Backend-generated)                                     │
│    Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx                 │
│    Example: 550e8400-e29b-41d4-a716-446655440000                │
│    Created: FileTrackingService.trackChange()                   │
│    Stored: FileTrackingStorage                                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (on commit)
┌─────────────────────────────────────────────────────────────────┐
│ 3. COMMIT HASH (Git-generated)                                  │
│    Format: 40-character SHA-1                                   │
│    Example: a1b2c3d4e5f6...                                     │
│    Added: TrackedChange.commitHash field                        │
│    Used for: Grouping changes by commit                         │
└─────────────────────────────────────────────────────────────────┘
```

## IPC Channel Reference

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `file-tracking:init` | Renderer → Main | Initialize file tracking for workspace |
| `file-tracking:sync` | Renderer → Main | Sync git state with file tracking |
| `file-tracking:load` | Renderer → Main | Load tracked changes |
| `file-tracking:load-transitions` | Renderer → Main | Load stage transitions |
| `file-tracking:save` | Renderer → Main | Save tracked changes |
| `file-tracking:track-change` | Renderer → Main | Track a new change |
| `file-tracking:stage-changes` | Renderer → Main | Stage changes (git add) |
| `file-tracking:unstage-changes` | Renderer → Main | Unstage changes (git reset) |
| `file-tracking:get-changes` | Renderer → Main | Get filtered changes |
| `file-tracking:clear` | Renderer → Main | Clear all tracked changes |
| `file-tracking:changes-updated` | Main → Renderer | Notify of change updates |
| `workspace-changes` | Main → Renderer | Notify of workspace changes |
| `git:status` | Renderer → Main | Get git status |
| `git:stage` | Renderer → Main | Stage files |
| `git:unstage` | Renderer → Main | Unstage files |
| `git:commit` | Renderer → Main | Create commit |
| `git:push` | Renderer → Main | Push to remote |
| `git:pull` | Renderer → Main | Pull from remote |
| `git:diff` | Renderer → Main | Get diff |
| `git:history` | Renderer → Main | Get commit history |

## Optimistic Update Pattern

The staging/unstaging operations use an optimistic update pattern for snappy UX:

```typescript
// FileTrackingStore.stageChanges() pattern:

1. Mark changes as pending (prevent reload from overwriting)
   pendingStageOperations.add(id)
   pendingStageOperationsByPath.add(path)

2. Apply optimistic update immediately
   this.#changes = updatedChanges  // UI updates instantly

3. Fire backend call WITHOUT awaiting
   invoke('file-tracking:stage-changes', {...})
     .then((response) => {
       clearPendingState()
       if (!response.ok) {
         // ROLLBACK on failure
         this.#changes = originalChanges
       }
     })
     .catch((error) => {
       clearPendingState()
       // ROLLBACK on error
       this.#changes = originalChanges
     })

4. Return immediately
   return { ok: true }
```

## Configuration

All timing constants are centralized in `tracking.config.ts`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `fileTracking.saveDebounce` | 1000ms | Debounce for bulk saves |
| `fileTracking.updateDebounce` | 100ms | Debounce for UI updates |
| `gitIntegration.minSyncInterval` | 1000ms | Minimum time between syncs |
| `gitIntegration.syncDebounce` | 2000ms | Debounce for batch sync requests |
| `gitIntegration.queueProcessDebounce` | 1000ms | Debounce for change queue processing |
| `events.deduplicationWindow` | 1000ms | Window for event deduplication |
| `changeDetection.gitPollingInterval` | 5000ms | Git status polling interval |

## Performance Optimizations

### 1. Batch Operations

**FileTrackingService.trackChangesBatch()**
- Single mutex acquisition for all changes instead of one per file
- Single storage read/write cycle for the entire batch
- Used by GitIntegrationService when processing git status changes

```typescript
// Before (slow): N mutex acquisitions, N storage operations
for (const change of changes) {
  await service.trackChange(change); // Each call acquires mutex
}

// After (fast): 1 mutex acquisition, 1 storage operation
await service.trackChangesBatch(changes);
```

### 2. Fast Storage Writes

**FileTrackingStorage._doSave(changes, durable)**
- Fast path (default): Atomic rename only, no fsync
- Durable path: Full fsync + backup for critical saves
- Fast path is safe because atomic rename prevents corruption

### 3. Optimized Derived State

**FileTrackingStore.workingChanges**
- Pre-computed stage Set for O(1) lookups
- Single pass through changes array
- Avoids creating new objects when stats haven't changed

### 4. UI Optimizations

**CodeChangesPanel.enhanceChangeWithStats()**
- Only creates new object if stats actually differ
- Reuses existing change object when possible
- Reduces garbage collection pressure

## Change Detection Components

### ChangeDetectorRefactored

**Location**: `src/features/workspace/change-detector-refactored.ts`
**Responsibilities**:

- Coordinate all change detection modules
- Manage polling timers
- Handle start/stop lifecycle
- Track agent changes
- Emit consolidated events

**Does NOT**:

- Directly execute git commands (uses GitOperations)
- Process individual changes (uses ChangeProcessor)
- Manage file watching (uses FileWatcher)

### GitOperations

**Location**: `src/features/workspace/change-detection/git-operations.ts`
**Responsibilities**:

- Execute all git commands
- Cache git status (1-second TTL)
- Handle git errors and recovery
- Parse git output
- Protect against command injection

**Does NOT**:

- Decide when to poll (managed by ChangeDetector)
- Process changes (handled by ChangeProcessor)
- Emit events (handled by EventCoordinator)

### ChangeProcessor

**Location**: `src/features/workspace/change-detection/change-processor.ts`
**Responsibilities**:

- Process file changes into events
- Deduplicate changes
- Create WorkspaceEvent objects
- Track processed changes
- Apply gitignore filtering

**Does NOT**:

- Execute git commands (uses GitOperations)
- Emit events (passes to EventCoordinator)
- Manage polling (handled by ChangeDetector)

### EventCoordinator

**Location**: `src/features/workspace/change-detection/event-coordinator.ts`
**Responsibilities**:

- Batch events for emission
- Handle event deduplication
- Track emission statistics
- Coordinate with WorkspaceEventBus
- Manage event timing

**Does NOT**:

- Create events (done by ChangeProcessor)
- Store events (done by EventStore)
- Query events (done by EventQueryEngine)

### SnapshotManager

**Location**: `src/features/workspace/change-detection/snapshot-manager.ts`
**Responsibilities**:

- Take file snapshots
- Calculate content hashes
- Detect file differences
- Manage snapshot cache (LRU)
- Import/export snapshots

**Does NOT**:

- Decide which files to snapshot (directed by ChangeDetector)
- Process changes (done by ChangeProcessor)
- Store snapshots permanently (memory only)

### AdaptivePollingManager

**Location**: `src/features/workspace/change-detection/adaptive-polling-manager.ts`
**Responsibilities**:

- Calculate optimal polling intervals
- Track activity patterns
- Adjust for CPU usage
- Boost responsiveness on user activity
- Provide polling statistics

**Does NOT**:

- Execute polling (done by ChangeDetector)
- Process changes (done by ChangeProcessor)
- Manage file watching (separate from polling)

## Event System Components

### WorkspaceEventBus

**Location**: `src/features/events/workspace-event-bus.ts`
**Responsibilities**:

- Route events to subscribers
- Manage subscriptions
- Deduplicate events
- Coordinate with EventStore
- Maintain event buffer

**Does NOT**:

- Create events (done by various sources)
- Process file changes (done by ChangeProcessor)
- Handle IPC (done by IPC handlers)

### WorkspaceEventService

**Location**: `src/features/events/workspace-event-service.ts`
**Responsibilities**:

- Initialize event system
- Integrate with ChangeDetector
- Handle note events
- Coordinate historical sync
- Manage event service lifecycle

**Does NOT**:

- Store events (done by EventStore)
- Route events (done by EventBus)
- Create file change events (done by ChangeProcessor)

### EventStore

**Location**: `src/features/events/event-store.ts`
**Responsibilities**:

- Persist events to disk
- Load historical events
- Maintain event indexes
- Compact event storage
- Enforce storage limits

**Does NOT**:

- Route events (done by EventBus)
- Create events (done by various sources)
- Query complex filters (done by QueryEngine)

### EventQueryEngine

**Location**: `src/features/events/event-query-engine.ts`
**Responsibilities**:

- Execute complex event queries
- Apply filters and sorting
- Aggregate event data
- Optimize query performance
- Cache query results

**Does NOT**:

- Store events (done by EventStore)
- Route events (done by EventBus)
- Create events (done by various sources)

### EventDeduplicationService

**Location**: `src/features/events/event-deduplication.service.ts`
**Responsibilities**:

- Detect duplicate events
- Maintain deduplication window
- Track event signatures
- Clean expired signatures
- Provide deduplication stats

**Does NOT**:

- Store events (done by EventStore)
- Route events (done by EventBus)
- Create events (done by various sources)

## File Tracking Components

### FileTrackingService

**Location**: `src/features/file-tracking/main/file-tracking.service.ts`
**Responsibilities**:

- Track new file changes
- Manage stage transitions
- Coordinate with git
- Handle commits
- Filter tracked changes

**Does NOT**:

- Store changes (done by FileTrackingStorage)
- Detect changes (done by ChangeDetector)
- Update UI (done by FileTrackingStore)

### FileTrackingStore

**Location**: `src/features/file-tracking/file-tracking.store.svelte.ts`
**Responsibilities**:

- Manage reactive UI state
- Coordinate with git store
- Provide derived state
- Handle UI interactions
- Sync with backend service

**Does NOT**:

- Persist data (done by FileTrackingStorage)
- Detect changes (done by ChangeDetector)
- Execute git commands (done by GitOperations)

### FileTrackingStorage

**Location**: `src/features/file-tracking/file-tracking-storage.ts`
**Responsibilities**:

- Persist tracked changes
- Manage file locking
- Handle atomic writes
- Create backups
- Optimize storage

**Does NOT**:

- Track new changes (done by FileTrackingService)
- Detect changes (done by ChangeDetector)
- Update UI (done by FileTrackingStore)

### GitIntegrationService

**Location**: `src/features/file-tracking/main/git-integration.service.ts`
**Responsibilities**:

- Bridge git and file tracking
- Sync git status
- Handle stage transitions
- Process commits
- Track git events

**Does NOT**:

- Execute git commands (done by GitOperations)
- Store changes (done by FileTrackingStorage)
- Detect changes (done by ChangeDetector)

## Line Statistics Components

> **Note**: Line changes use a dual-store pattern with separate stores for main and renderer processes. This is a common Electron architecture pattern where the main process maintains authoritative state and the renderer syncs via IPC.

### LineChangesStore (Main Process)

**Location**: `src/features/line-changes/line-changes.store.ts`
**Responsibilities**:

- Maintain authoritative line change statistics (EventEmitter-based)
- Cache data with automatic TTL-based invalidation
- Serve IPC requests from renderer
- Track changes from ChangeDetectorManager

**Used By**: IPC handlers, ChangeDetectorManager, LineChangesService

### LineChangesStore (Renderer/Client)

**Location**: `src/features/line-changes/line-changes.store.svelte.ts`
**Responsibilities**:

- Provide reactive UI state using Svelte 5 runes ($state)
- Sync with main process store via IPC
- Listen to workspace-changes events
- Provide getters for UI components

**Used By**: UI components (WorkspaceContent, FileExplorer, AgentNavRail, etc.)

**Does NOT**:

- Calculate diffs (done by GitOperations)
- Store permanently (done by LineChangesService)
- Detect changes (done by ChangeDetector)

### LineChangesService

**Location**: `src/features/line-changes/line-changes.service.ts`
**Responsibilities**:

- Persist line statistics
- Calculate aggregates
- Track agent contributions
- Provide historical data
- Optimize storage

**Does NOT**:

- Detect changes (done by ChangeDetector)
- Update UI (done by LineChangesStore)
- Calculate diffs (done by GitOperations)

## Attribution Components

### AttributionEngine

**Location**: `src/features/workspace/provenance/attribution-engine.ts`
**Responsibilities**:

- Track change attribution
- Manage actor context
- Create provenance records
- Link changes to actors
- Provide attribution queries

**Does NOT**:

- Detect changes (done by ChangeDetector)
- Store events (done by EventStore)
- Execute actions (just tracks)

### ProvenanceContextManager

**Location**: `src/features/workspace/provenance/provenance-context-manager.ts`
**Responsibilities**:

- Manage context stack
- Track current actor
- Handle session context
- Provide context for events
- Clean expired contexts

**Does NOT**:

- Create events (done by various sources)
- Store provenance (done by AttributionEngine)
- Detect changes (done by ChangeDetector)

## Performance Components

### PerformanceMonitor

**Location**: `src/features/file-tracking/performance-monitor.ts`
**Responsibilities**:

- Track timing metrics
- Monitor memory usage
- Calculate throughput
- Check thresholds
- Emit performance alerts

**Does NOT**:

- Optimize performance (just monitors)
- Make decisions (provides data)
- Store metrics long-term

## Manager Components

### ChangeDetectorManager

**Location**: `src/features/workspace/change-detector-manager.ts`
**Responsibilities**:

- Manage multiple detectors
- Handle workspace lifecycle
- Coordinate detector types
- Track detector state
- Route detector events

**Does NOT**:

- Detect changes (done by detectors)
- Process changes (done by processors)
- Store events (done by EventStore)

### WorkspaceFileManager

**Location**: `src/features/workspace/workspace-file-manager.ts`
**Responsibilities**:

- Handle file operations
- Coordinate file events
- Manage file handlers
- Debounce file changes
- Bridge with git store

**Does NOT**:

- Detect changes (done by ChangeDetector)
- Track changes (done by FileTrackingService)
- Store files (just manages)

## IPC Handlers

### Event System IPC

**Location**: `src/features/events/main/events.ipc.ts`
**Responsibilities**:

- Handle event IPC calls
- Initialize event services
- Query events
- Broadcast events
- Manage event lifecycle

**Does NOT**:

- Create events (done by sources)
- Store events (done by EventStore)
- Process changes (done by processors)

### File Tracking IPC

**Location**: `src/features/file-tracking/main/file-tracking.ipc.ts`
**Responsibilities**:

- Handle tracking IPC calls
- Initialize tracking services
- Sync with git
- Manage tracking lifecycle
- Coordinate with services

**Does NOT**:

- Detect changes (done by ChangeDetector)
- Store data (done by Storage)
- Create events (done by processors)

## Key Principles

1. **Single Responsibility**: Each component has one clear purpose
2. **Separation of Concerns**: Components don't overlap responsibilities
3. **Dependency Direction**: Dependencies flow downward in architecture
4. **Event-Driven**: Components communicate through events
5. **Testability**: Each component can be tested in isolation
6. **Performance**: Components optimize their specific operations
7. **Error Handling**: Each component handles its own errors
8. **Configuration**: Centralized in tracking.config.ts

## Common Patterns

### Event Creation Flow

1. Source detects change (ChangeDetector)
2. Processor creates event (ChangeProcessor)
3. Coordinator batches (EventCoordinator)
4. Bus routes (WorkspaceEventBus)
5. Store persists (EventStore)
6. UI updates (Components)

### Storage Pattern

1. Service manages logic
2. Storage handles persistence
3. Store manages UI state
4. IPC bridges communication

### Performance Pattern

1. Monitor tracks metrics
2. Adaptive manager adjusts
3. Components optimize locally
4. System maintains balance

## Deprecated Components

The following components are deprecated and should not be used in new code:

### MonacoDiffViewer.svelte
**Location**: `src/lib/components/file-tracking/MonacoDiffViewer.svelte`
**Status**: Deprecated, no active imports
**Replacement**: Use `DiffViewer` from `$lib/components/ui/diff`
**Notes**: Only use if you need hunk staging/unstaging with git integration

### SimpleDiffViewer.svelte
**Location**: `src/lib/components/shared/SimpleDiffViewer.svelte`
**Status**: Deprecated
**Replacement**: Use `DiffViewer` from `$lib/components/ui/diff`

### git-version.service.ts
**Location**: `src/features/notes/main/storage/git-version.service.ts`
**Status**: Deprecated, still used by some tests
**Replacement**: Use JSONL-based versioning via `version.service.ts`
**Notes**: Kept for backward compatibility with existing tests

### ACTIVITY_LOG IPC Channels
**Location**: Defined in `src/shared/ipc-registry.ts`
**Status**: Deprecated, no active handlers
**Replacement**: Use `EVENTS` channels
**Channels**:
- `activity-log:get-entries` → `events:query`
- `activity-log:add-entry` → `events:emit`
- `activity-log:clear` → `events:clear`

## Git Operations Architecture

The codebase has multiple git operation modules with distinct purposes:

### GitService
**Location**: `src/features/git/main/git.service.ts`
**Purpose**: High-level git operations for workspaces (status, commit, push, pull)
**Used by**: IPC handlers, workspace service

### GitOperationsSafe
**Location**: `src/features/workspace/main/change-detection/git-operations-safe-wrapper.ts`
**Purpose**: Safe wrapper for change detection git operations
**Features**: Command injection prevention, caching, error handling
**Used by**: ChangeDetectorRefactored

### safe-git-operations.ts
**Location**: `src/features/workspace/main/change-detection/safe-git-operations.ts`
**Purpose**: Low-level secure git command execution
**Features**: No shell execution, path sanitization, timeout handling
**Used by**: GitOperationsSafe wrapper

### GitStateManager
**Location**: `src/features/git-tracking/main/git-state-manager.ts`
**Purpose**: Complete git state tracking (branches, commits, PRs)
**Used by**: Git tracking feature, GitHub integration

### GitIntegrationService
**Location**: `src/features/file-tracking/main/git-integration.service.ts`
**Purpose**: Bridge between git and file tracking
**Used by**: File tracking feature
