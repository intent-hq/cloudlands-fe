# Note Read Tracking Implementation Plan

## Overview

Add `lastRead` metadata tracking for notes to enable showing "unread" indicators when a note has been updated since the user last viewed it.

**Key Design Decision**: Store user activity data separately from notes to support future multi-user scenarios.

## Data Format

**File location**: `~/.workspaces/{workspace-id}/.workspace/user-activity.json`

```typescript
interface NoteReadRecord {
  lastReadAt: string;  // ISO timestamp
  readCount?: number;  // Optional: track frequency
}

interface UserActivityData {
  version: 1;
  userId: string;  // 'local-user' for now, multi-user ready
  noteReads: Record<string, NoteReadRecord>;  // NoteId -> read record
  lastUpdated: string;
}
```

## API Surface

### Backend Service

```typescript
interface UserActivityService {
  markNoteRead(workspaceId: WorkspaceId, noteId: NoteId): Promise<void>;
  getNoteReadStatus(workspaceId: WorkspaceId, noteId: NoteId): Promise<NoteReadRecord | null>;
  getUnreadNoteIds(workspaceId: WorkspaceId, notes: Array<{ id: NoteId; updatedAt: string }>): Promise<NoteId[]>;
}
```

### IPC Channels

```typescript
export const USER_ACTIVITY_CHANNELS = {
  MARK_NOTE_READ: 'user-activity:mark-note-read',
  GET_NOTE_READ_STATUS: 'user-activity:get-note-read-status',
  GET_UNREAD_NOTES: 'user-activity:get-unread-notes',
} as const;
```

### Frontend Store

```typescript
class NoteReadTrackingStore {
  hasUnreadChanges(workspaceId: WorkspaceId, noteId: NoteId): boolean;
  markAsRead(workspaceId: WorkspaceId, noteId: NoteId): Promise<void>;
  refreshUnreadStatus(workspaceId: WorkspaceId, notes: Note[]): Promise<void>;
}
```

## Implementation Phases

### Phase 1: Types & Repository Layer
- Create types in `src/shared/types/user-activity.types.ts`
- Create repository in `src/features/user-activity/main/user-activity.repository.ts`
- TDD: Write tests first for save, load, missing file, corrupted file

### Phase 2: Service Layer
- Create service in `src/features/user-activity/main/user-activity.service.ts`
- Methods: `markNoteRead()`, `getNoteReadStatus()`, `getUnreadNoteIds()`
- TDD: Write tests for service logic

### Phase 3: IPC Layer
- Add channels to `src/shared/ipc/channels.ts`
- Create IPC handlers in `src/features/user-activity/main/user-activity.ipc.ts`
- Register in `src/main/index.ts`

### Phase 4: Frontend Store + Demo
- Create store in `src/lib/stores/note-read-tracking.store.svelte.ts`
- Add debug display in `TasksOverview.svelte` showing lastReadAt

### Phase 5: Polish UI
- Add `hasUnreadChanges()` comparison logic
- Add visual unread indicator
- Hook up `markAsRead` on note open

## Files to Create/Modify

| File | Action | Phase |
|------|--------|-------|
| `src/shared/types/user-activity.types.ts` | Create | 1 |
| `src/features/user-activity/main/user-activity.repository.ts` | Create | 1 |
| `src/features/user-activity/main/__tests__/user-activity.repository.test.ts` | Create | 1 |
| `src/features/user-activity/main/user-activity.service.ts` | Create | 2 |
| `src/features/user-activity/main/__tests__/user-activity.service.test.ts` | Create | 2 |
| `src/shared/ipc/channels.ts` | Modify | 3 |
| `src/features/user-activity/main/user-activity.ipc.ts` | Create | 3 |
| `src/main/index.ts` | Modify | 3 |
| `src/lib/stores/note-read-tracking.store.svelte.ts` | Create | 4 |
| `src/lib/components/workspace/TasksOverview.svelte` | Modify | 4, 5 |
| Note page route | Modify | 5 |

## Integration Points

### When to mark as read
- When user opens a note (in note page route on mount)
- When note is displayed in drawer

### Unread indicator display
- TasksOverview: small dot or border highlight
- Note list sidebar (future)
