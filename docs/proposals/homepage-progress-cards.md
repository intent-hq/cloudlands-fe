# Homepage Progress Cards

## Problem Statement

The workspace sidebar has a `WorkspaceProgressCard` component that shows real-time task progress with:
- Task statistics (completed/in-progress/total)
- Visual FlameGraph showing per-task status
- Git/PR status and action buttons

We want to display this same progress information on the **homepage** (`HomeGrid.svelte`) for all workspaces, with real-time updates when task statuses change.

### Current Gap

| Data | Available in HomeGrid? | Where it lives now |
|------|----------------------|-------------------|
| `Workspace` metadata | ✅ Yes | `workspaceStore.items` |
| `notes[]` / task data | ❌ No | Loaded per-workspace via IPC on open |
| `gitStatus` | ❌ No | Computed on-demand via `AcceptChangesClient` |

## Goals

1. **Reuse existing UI components** - `WorkspaceProgressCard` and `FlameGraph` unchanged
2. **Real-time updates** - Task status changes reflect immediately on homepage
3. **Efficient loading** - Don't load full notes for archived/inactive workspaces
4. **Minimal new infrastructure** - Leverage existing event system

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS                                │
│                                                                  │
│  ┌──────────────────┐      task:status-changed                  │
│  │ notes.service.ts │ ────────────────────────┐                 │
│  └──────────────────┘                         │                 │
│                                               ▼                 │
│                                    ┌──────────────────┐         │
│                                    │ UnifiedEventBus  │         │
│                                    │ (broadcasts to   │         │
│                                    │  all windows)    │         │
│                                    └────────┬─────────┘         │
│                                             │                   │
│  ┌──────────────────┐                       │                   │
│  │ notes.ipc.ts     │◄──── NEW: batchGet ───┤                   │
│  │ (batch endpoint) │                       │                   │
│  └──────────────────┘                       │                   │
└─────────────────────────────────────────────┼───────────────────┘
                                              │
                     ┌────────────────────────┘
                     │ IPC: task:status-changed
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     RENDERER (HOMEPAGE)                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         workspaceNotesStore (NEW)                          │ │
│  │                                                            │ │
│  │  State: Map<workspaceId, Note[]>                          │ │
│  │                                                            │ │
│  │  • loadForWorkspaces(ids[]) - batch load on mount         │ │
│  │  • getNotes(workspaceId) - get notes for a workspace      │ │
│  │  • Listens for task:status-changed to update in place     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     HomeGrid.svelte                         ││
│  │  ┌─────────────────┐  ┌─────────────────┐                   ││
│  │  │WorkspaceProgress│  │WorkspaceProgress│  ...              ││
│  │  │     Card        │  │     Card        │                   ││
│  │  │ notes={store.   │  │ notes={store.   │                   ││
│  │  │   getNotes(id)} │  │   getNotes(id)} │                   ││
│  │  └─────────────────┘  └─────────────────┘                   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Backend - Batch Notes Endpoint

Add a new IPC endpoint to load notes for multiple workspaces in one call:

```typescript
// Channel: 'notes:batch-get'
// Input: { workspaceIds: string[] }
// Output: { [workspaceId: string]: Note[] }
```

**Files to modify:**
- `src/shared/ipc/channels.ts` - Add `NOTES_CHANNELS.BATCH_GET`
- `src/features/notes/main/notes.ipc.ts` - Implement handler
- `src/features/notes/notes.client.ts` - Add client method

### Phase 2: Frontend - Workspace Notes Store

Create a new store to manage notes across workspaces on the homepage:

```typescript
// src/features/workspace/workspace-notes.store.svelte.ts
class WorkspaceNotesStore {
  #notesByWorkspace = $state<Map<WorkspaceId, Note[]>>(new Map());

  async loadForWorkspaces(workspaceIds: WorkspaceId[]): Promise<void>;
  getNotes(workspaceId: WorkspaceId): Note[];

  // Real-time update handlers
  private handleTaskStatusChanged(event: TaskStatusChangedEvent): void;
  private handleNoteCreated(event: NoteCreatedEvent): void;
  private handleNoteDeleted(event: NoteDeletedEvent): void;
}
```

**Files to create:**
- `src/features/workspace/workspace-notes.store.svelte.ts`

### Phase 3: Homepage Integration

Update `HomeGrid.svelte` to use `WorkspaceProgressCard`:

```svelte
<script>
  import { workspaceNotesStore } from '$features/workspace/workspace-notes.store.svelte';

  onMount(async () => {
    const workspaceIds = workspaces.map(w => w.id);
    await workspaceNotesStore.loadForWorkspaces(workspaceIds);
  });
</script>

{#each workspaces as workspace}
  <WorkspaceProgressCard
    notes={workspaceNotesStore.getNotes(workspace.id)}
    workspace={workspace}
    workspaceId={workspace.id}
  />
{/each}
```

**Files to modify:**
- `src/lib/components/home/HomeGrid.svelte`

### Phase 4: Real-time Event Subscription

Wire up event listeners for live updates:

1. Listen for `task:status-changed` events
2. Update the specific note's status in the store
3. Svelte reactivity propagates to UI

**Events to handle:**
- `task:status-changed` - Update note status
- `note:created` - Add new note (if it's a task)
- `note:deleted` - Remove note from store

## Data Flow: Task Status Change

```
1. Agent completes a task
   │
2. notes.service.ts calls updateTaskStatus()
   │
3. Emits 'task:status-changed' to WorkspaceEventBus
   │
4. WorkspaceEventBus → UnifiedEventBus → broadcasts to all windows
   │
5. Homepage receives event via IPC listener
   │
6. workspaceNotesStore updates the note in its Map
   │
7. $derived reactivity updates WorkspaceProgressCard
   │
8. FlameGraph re-renders with new status color
```

## Future Enhancements (Out of Scope)

- **Git status on homepage** - Expensive (GitHub API), defer to later
- **Lazy loading** - Only load notes for visible cards
- **Persistence** - Cache notes to disk for faster startup

## Testing Strategy

1. **Unit tests** for `workspaceNotesStore`
   - `loadForWorkspaces()` populates map correctly
   - `handleTaskStatusChanged()` updates correct note

2. **Integration test** for batch endpoint
   - Returns notes grouped by workspace
   - Handles non-existent workspaces gracefully

3. **Manual testing**
   - Open homepage with multiple workspaces
   - Change task status in one workspace
   - Verify homepage card updates immediately
