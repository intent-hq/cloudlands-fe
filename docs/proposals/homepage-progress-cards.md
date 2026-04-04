# Homepage Progress Cards

## Problem Statement

The workspace sidebar has a `WorkspaceProgressCard` component that shows real-time task progress with:
- Task statistics (completed/in-progress/total)
- Visual FlameGraph showing per-task status
- Git/PR status and action buttons

This proposal originally targeted a `HomeGrid.svelte` homepage component, but that file has since been removed from `src/lib/components/home/`. The homepage-card variant now lives in `WorkspaceProgressCard`'s `compact` mode, and any future homepage wiring should target the current home route (`src/routes/+page.svelte`) rather than `src/lib/components/home/HomeGrid.svelte`.

### Current Gap

| Data | Available on the current home route? | Where it lives now |
|------|-------------------------------------|-------------------|
| `Workspace` metadata | ✅ Yes | `workspaceStore.items` in `src/routes/+page.svelte` |
| `notes[]` / task data | ⚠️ Infrastructure exists, but homepage rendering is not wired up | `workspaceNotesStore` + `notesClient.batchList()` |
| `gitStatus` | ❌ Intentionally skipped in homepage mode | `WorkspaceProgressCard` avoids Git status loading when `compact` is enabled |

## Goals

1. **Reuse existing UI components** - `WorkspaceProgressCard` compact mode and `FlameGraph`
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
│                                    │ Redux Store      │         │
│                                    │ (main process,   │         │
│                                    │  sagas broadcast  │         │
│                                    │  to all windows) │         │
│                                    └────────┬─────────┘         │
│                                             │                   │
│  ┌──────────────────┐                       │                   │
│  │ notes.ipc.ts     │◄─ notes:batch-list ───┤                   │
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
│  │         workspaceNotesStore                                │ │
│  │                                                            │ │
│  │  State: Record<workspaceId, Note[]>                       │ │
│  │                                                            │ │
│  │  • loadForWorkspaces(ids[]) - batch load on mount         │ │
│  │  • getNotes(workspaceId) - get notes for a workspace      │ │
│  │  • Listens for note/task events to update in place        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    src/routes/+page.svelte                 ││
│  │  ┌─────────────────┐  ┌─────────────────┐                   ││
│  │  │WorkspaceProgress│  │WorkspaceProgress│  ...              ││
│  │  │ Card (compact)  │  │ Card (compact)  │                   ││
│  │  │ notes={store.   │  │ notes={store.   │                   ││
│  │  │   getNotes(id)} │  │   getNotes(id)} │                   ││
│  │  └─────────────────┘  └─────────────────┘                   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Backend - Batch Notes Endpoint

Add a new IPC endpoint to load notes for multiple workspaces in one call. This has since landed as `notes:batch-list`, exposed in the renderer as `notesClient.batchList()`:

```typescript
// Channel: 'notes:batch-list'
// Input: { workspaceIds: string[] }
// Output: { [workspaceId: string]: Note[] }
```

**Relevant files:**
- `src/shared/ipc/channels.ts` - `NOTES_CHANNELS.BATCH_LIST`
- `src/features/notes/main/notes.ipc.ts` - Batch notes handler
- `src/features/notes/notes.client.ts` - `batchList()` client method

### Phase 2: Frontend - Workspace Notes Store

Create a store to manage notes across workspaces on the homepage. The current implementation uses a reactive record rather than a `Map`:

> Transitional note: Per `docs/STATE_MANAGEMENT.md`, `WorkspaceNotesStore` and other `.store.svelte.ts` shared-state modules are transitional; new shared state should use Redux slices in `src/lib/store/`.

```typescript
// src/features/workspace/workspace-notes.store.svelte.ts
class WorkspaceNotesStore {
  notesByWorkspace: Record<string, Note[]> = $state({});

  async loadForWorkspaces(workspaceIds: WorkspaceId[]): Promise<void>;
  getNotes(workspaceId: WorkspaceId | string): Note[];

  // Real-time update handlers
  private handleTaskStatusChanged(payload: any): void;
  private handleNoteCreated(payload: any): void;
  private handleNoteDeleted(payload: any): void;
  private handleNoteUpdated(payload: any): void;
}
```

**Implemented file:**
- `src/features/workspace/workspace-notes.store.svelte.ts`

### Phase 3: Homepage Integration

If homepage cards are rendered again, the integration target is now the home route, using `WorkspaceProgressCard` in `compact` mode:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { workspaceNotesStore } from '$features/workspace/workspace-notes.store.svelte';
  import WorkspaceProgressCard from '$lib/components/workspace/sidebar/WorkspaceProgressCard.svelte';

  onMount(async () => {
    const workspaceIds = workspaces.map((w) => w.id);
    await workspaceNotesStore.loadForWorkspaces(workspaceIds);
  });
</script>

{#each workspaces as workspace}
  <WorkspaceProgressCard
    compact
    workspace={workspace}
    workspaceId={workspace.id}
    notes={workspaceNotesStore.getNotes(workspace.id)}
    onClick={() => openWorkspace(workspace)}
  />
{/each}
```

**Files to modify:**
- `src/routes/+page.svelte` (or a dedicated home-view component rendered from it)

### Phase 4: Real-time Event Subscription

Wire up event listeners for live updates:

1. Listen for `task:status-changed` events
2. Update the specific note's status in the store
3. Svelte reactivity propagates to UI

**Events to handle:**
- `task:status-changed` - Update note status
- `note:created` - Add new note (if it's a task)
- `note:deleted` - Remove note from store
- `note:updated` - Refresh note data already loaded on the homepage

## Data Flow: Task Status Change

```
1. Agent completes a task
   │
2. notes.service.ts calls updateTaskStatus()
   │
3. Dispatches `mainDispatch(noteEventAction(...))` to Redux store
   │
4. Redux saga broadcasts state update to all windows via IPC
   │
5. UI components update via Redux selectors
   │
6. `WorkspaceProgressCard` compact mode re-renders with new state
   │
7. FlameGraph re-renders with new status color
```

## Future Enhancements (Out of Scope)

- **Git status on homepage** - Expensive (GitHub API), defer to later
- **Lazy loading** - Only load notes for visible cards
- **Persistence** - Cache notes to disk for faster startup

## Testing Strategy

1. **Unit tests** for `workspaceNotesStore`
   - `loadForWorkspaces()` populates the workspace record correctly
   - `handleTaskStatusChanged()` updates correct note

2. **Integration test** for batch endpoint
   - Returns notes grouped by workspace
   - Handles non-existent workspaces gracefully

3. **Manual testing**
   - Render compact `WorkspaceProgressCard` instances from the current home route
   - Change task status in one workspace
   - Verify the corresponding card updates immediately
