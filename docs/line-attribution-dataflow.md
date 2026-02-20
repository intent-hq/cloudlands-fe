# Line Attribution Data Flow: User Edit to UI Update

This document describes the complete data flow for the line attribution system, from when a user makes an edit to when the UI displays the attribution indicators with author information.

## Overview

The line attribution system tracks which user or agent last modified each line in a note, and displays visual indicators in the editor gutter. The system uses event-driven architecture to automatically update the UI when new attributions are computed.

## Complete Data Flow

### 1. User Makes an Edit

**Location**: `NoteWithComments.svelte` (TipTap editor)

- User types in the editor
- TipTap's `onUpdate` callback fires
- Debounced save triggers `notesStore.updateNote()`

### 2. Note Update Request

**Location**: `notes.store.svelte.ts`

```typescript
await window.electronAPI.invoke('notes:update', {
  id: noteId,
  workspaceId: workspaceId,
  content: newContent,
});
```

### 3. IPC Handler Receives Request

**Location**: `notes.ipc.ts`

- `notes:update` IPC handler receives the request
- Calls `NotesService.updateNote()`

### 4. NotesService Processes Update

**Location**: `notes.service.ts` (lines 227-350)

**Key Steps**:

a. **Get Current Actor** (lines 277-279):

```typescript
const provenanceManager = getProvenanceContextManager();
const currentActor = provenanceManager.getCurrentActor();
```

b. **Create Author Info** (lines 281-293):

```typescript
// For version (using AuthorType enum)
const versionAuthor = {
  id: currentActor?.id || 'user',
  name: currentActor?.name || 'User',
  type: currentActor?.type === 'agent' ? AuthorType.Agent : AuthorType.User,
};

// For edit event (using string literals)
const editAuthor = {
  id: currentActor?.id || 'user',
  name: currentActor?.name || 'User',
  type: (currentActor?.type === 'agent' ? 'agent' : 'user') as 'user' | 'agent' | 'system',
};
```

c. **Create Version with Author** (lines 295-303):

```typescript
const version = {
  versionId: randomUUID(),
  versionNumber: (existingNote.versions?.length || 0) + 1,
  content: request.content,
  title: request.title || existingNote.title,
  author: versionAuthor, // ← Author info attached here
  createdAt: new Date().toISOString(),
  changeSummary: 'Content updated',
};
```

d. **Capture Edit Event** (lines 310-318):

```typescript
const editEvent = editEventsCapturer.captureEdit(
  existingNote.workspaceId,
  existingNote.id,
  existingNote.content || '',
  request.content,
  editAuthor, // ← Author info for edit log
  version.versionNumber
);
```

e. **Emit note:updated Event** (line 350+):

```typescript
this.eventBus.emitEvent('note:updated', {
  workspaceId: existingNote.workspaceId,
  noteId: existingNote.id,
  // ...
});
```

### 5. LineAttributionService Listens for Updates

**Location**: `line-attribution.service.ts` (lines 60-80)

**Event Listener Setup**:

```typescript
this.eventBus.on('note:updated', (data) => {
  const { workspaceId, noteId } = data;
  this.scheduleComputation(workspaceId, noteId);
});
```

**Debounced Computation** (2 second delay):

- Prevents excessive computation during rapid edits
- Batches multiple edits into single computation

### 6. Compute Line Attributions

**Location**: `line-attribution.service.ts` (lines 100-174)

**Key Steps**:

a. **Load Note and Versions**:

```typescript
const note = await this.notesRepository.getNote(workspaceId, noteId);
const versions = note.versions || [];
```

b. **Run Attribution Algorithm**:

```typescript
const attributions = attributeLines(
  note.content || '',
  versions.map((v) => ({
    content: v.content,
    timestamp: new Date(v.createdAt).getTime(),
    author: v.author, // ← Author info from version
  }))
);
```

c. **Build Attribution Map**:

```typescript
const attributionMap: Record<number, LineAttributionInfo> = {};
for (const attr of attributions) {
  const timestamp = attr.version.timestamp;
  const author: LineAuthor | undefined = attr.version.author
    ? {
        id: attr.version.author.id,
        name: attr.version.author.name,
        type: attr.version.author.type as 'user' | 'agent' | 'system',
      }
    : undefined;

  attributionMap[attr.lineNumber] = {
    timestamp,
    author, // ← Author info stored in attribution
  };
}
```

d. **Persist to Disk**:

```typescript
await this.lineAttributionStore.saveAttributions(workspaceId, noteId, {
  noteId,
  workspaceId,
  computedAt: new Date().toISOString(),
  attributions: attributionMap,
});
```

e. **Emit line-attribution:updated Event** (line 174):

```typescript
this.eventBus.emitEvent('line-attribution:updated', {
  workspaceId,
  noteId,
  attributions: attributionMap,
});
```

### 7. EventBus Broadcasts to Renderer

**Location**: `event-bus.ts` (lines 208-227)

**Automatic Broadcasting**:

```typescript
// Override emit to add broadcasting
this.emit = function (event: string | symbol, ...args: any[]): boolean {
  const eventName = event.toString();
  const data = args[0];

  // Broadcast to all renderer windows
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(eventName, data); // ← IPC send to renderer
    }
  });

  return originalEmit.call(this, event, ...args);
};
```

### 8. Preload Script Filters Event

**Location**: `preload/index.ts` (lines 443-450)

**Security Whitelist**:

```typescript
const allowedChannels = [
  // ... other channels
  'line-attribution:updated', // ← Must be whitelisted!
  // ...
];

if (allowedChannels.includes(channel)) {
  ipcRenderer.on(channel, (event, ...args) => callback(...args));
}
```

**Critical**: Without this whitelist entry, events are blocked from reaching the renderer.

### 9. UI Component Receives Event

**Location**: `LineAttributionGutter.svelte` (lines 220-245)

**Event Listener**:

```typescript
$effect(() => {
  let unsubscribe: (() => void) | null = null;

  listen('line-attribution:updated', (event) => {
    const payload = (event as any).payload || {};
    const { workspaceId: eventWorkspaceId, noteId: eventNoteId } = payload;

    // Only reload if it's for this workspace and note
    if (eventWorkspaceId === workspaceId && eventNoteId === noteId) {
      loadAttributions(); // ← Reload attribution data
    }
  }).then((unsub) => {
    unsubscribe = unsub;
  });

  return () => {
    if (unsubscribe) {
      unsubscribe();
    }
  };
});
```

### 10. Load Attribution Data via IPC

**Location**: `LineAttributionGutter.svelte` (lines 85-105)

```typescript
async function loadAttributions() {
  const result = await window.electronAPI.invoke('line-attribution:get-attributions', {
    workspaceId,
    noteId,
  });

  if (result.ok && result.data) {
    const lineAttributions = new Map<number, AttributionInfo>();

    for (const [lineNum, attrInfo] of Object.entries(result.data.attributions)) {
      lineAttributions.set(parseInt(lineNum), {
        timestamp: attrInfo.timestamp,
        author: attrInfo.author, // ← Author info loaded
      });
    }

    attributions = lineAttributions;
  }
}
```

### 11. Map Line Attributions to Blocks

**Location**: `line-to-block-mapper.ts` (lines 50-120)

**Process**:

- Convert markdown line numbers to ProseMirror block positions
- Handle multi-line blocks (use latest attribution by timestamp)
- Return `Map<position, AttributionInfo>` with author data

### 12. Update Visual Indicators

**Location**: `LineAttributionGutter.svelte` (lines 115-170)

**Key Steps**:

a. **Calculate Indicator Positions**:

```typescript
for (const [position, attrInfo] of blockAttributions) {
  const domNode = view.domAtPos(position);
  const element = domNode.node as HTMLElement;
  const rect = element.getBoundingClientRect();
  const editorRect = editorElement.getBoundingClientRect();

  const top = rect.top - editorRect.top;
  const height = rect.height;
  // ...
}
```

b. **Build Tooltip with Author**:

```typescript
let tooltip = `Edited ${formatTimestamp(attrInfo.timestamp)}`;
if (attrInfo.author) {
  const authorLabel = attrInfo.author.type === 'agent' ? 'Agent' : 'User';
  tooltip += ` by ${authorLabel}: ${attrInfo.author.name}`;
}
```

c. **Create Indicator Object**:

```typescript
newIndicators.push({
  position,
  timestamp: attrInfo.timestamp,
  author: attrInfo.author, // ← Author info in indicator
  top,
  height,
  color: getColorForRecency(attrInfo.timestamp),
  tooltip, // ← Tooltip includes author
});
```

d. **Render Indicators**:

```svelte
{#each indicators as indicator (indicator.position)}
  <div
    class="line-attribution-indicator"
    style="top: {indicator.top}px; height: {indicator.height}px; background-color: {indicator.color};"
    title={indicator.tooltip}
  />
{/each}
```

## Data Structures

### LineAuthor

```typescript
interface LineAuthor {
  id: string; // "user" or agent ID
  name: string; // "User" or agent name
  type: 'user' | 'agent' | 'system';
}
```

### AttributionInfo

```typescript
interface AttributionInfo {
  timestamp: number; // milliseconds since epoch
  author?: LineAuthor; // optional author metadata
}
```

### LineAttributionData (Persisted)

```typescript
interface LineAttributionData {
  noteId: string;
  workspaceId: string;
  computedAt: string;
  attributions: Record<number, LineAttributionInfo>; // line number → attribution
}
```

## Event Flow Summary

```
User Edit
  ↓
TipTap onUpdate
  ↓
notesStore.updateNote()
  ↓
IPC: notes:update
  ↓
NotesService.updateNote()
  ├─→ ProvenanceContextManager.getCurrentActor() → Get author
  ├─→ Create NoteVersion with author
  ├─→ Capture EditEvent with author
  └─→ EventBus.emit('note:updated')
       ↓
LineAttributionService (listener)
  ├─→ Debounce (2 seconds)
  ├─→ attributeLines() algorithm
  ├─→ Extract author from NoteVersion
  ├─→ Save to .line-attribution.json
  └─→ EventBus.emit('line-attribution:updated')
       ↓
EventBus (automatic broadcast)
  └─→ BrowserWindow.webContents.send()
       ↓
Preload Script (security filter)
  └─→ Check allowedChannels whitelist
       ↓
Renderer Process
  └─→ ipcRenderer.on('line-attribution:updated')
       ↓
LineAttributionGutter (event listener)
  ├─→ Check if event is for current note
  ├─→ loadAttributions() via IPC
  ├─→ mapLineAttributionsToBlocks()
  └─→ updateIndicators()
       ↓
Visual Indicators Rendered
  └─→ Tooltips show: "Edited X ago by User/Agent: Name"
```

## Key Design Decisions

1. **Provenance at Version Creation**: Author info is captured when the version is created, not later during attribution computation. This ensures accurate tracking even if provenance context changes.

2. **Dual Author Types**:
   - `AuthorType` enum for `NoteVersion` (type safety)
   - String literals for `EditEvent` (compatibility with existing code)

3. **Event-Driven Updates**: The UI automatically updates when new attributions are computed, without polling or manual refresh.

4. **Preload Security**: Events must be explicitly whitelisted in the preload script to pass from main process to renderer.

5. **Debounced Computation**: 2-second delay prevents excessive computation during rapid typing, improving performance.

6. **Real-time Sync**: The event listener ensures the UI stays in sync with backend computations, even if multiple windows are open.

## Testing the Flow

To verify the complete flow:

1. Open a workspace and note in the UI
2. Make an edit (add/modify text)
3. Wait 2 seconds for debounced computation
4. Check console logs for:
   - `[LineAttributionService] Line attributions computed and persisted`
   - `[LineAttributionGutter] Received line-attribution:updated event`
   - `[LineAttributionGutter] Reloading attributions due to backend update`
5. Hover over yellow indicators to see tooltip with author info
6. Verify tooltip shows "Edited X ago by User: User" (not "System")

## Troubleshooting

**Problem**: Indicators show "System" instead of "User"

- **Cause**: `NotesService` not using `ProvenanceContextManager`
- **Fix**: Ensure version author is set from `currentActor`, not `existingNote.metadata.author`

**Problem**: UI doesn't update after edit

- **Cause**: Event not reaching renderer
- **Fix**: Check `line-attribution:updated` is in preload script's `allowedChannels`

**Problem**: Indicators don't appear

- **Cause**: Attribution computation failed or data not loaded
- **Fix**: Check backend logs for computation errors, verify IPC handler is registered
