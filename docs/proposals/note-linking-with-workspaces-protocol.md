# Note Linking with `intent://` Protocol

## Goal
Enable linking between notes using the `intent://` protocol in markdown, e.g.:
```markdown
[Link to spec](intent://workspace-id/note/spec)
```

## Current State

### What Exists
- ✅ `intent://` protocol registered in `electron-builder.yml`
- ✅ `DeepLinkHandler` class that parses and routes protocol URLs
- ✅ `deepLinkStore` that handles deep link actions in renderer
- ✅ Tiptap Link extension configured in editor
- ✅ Navigation utilities (`navigateToNote()`, etc.)

### What's Missing
- ❌ Protocol handler registration in main process (`app.setAsDefaultProtocolClient()`)
- ❌ `open-url` event handler for macOS
- ❌ `second-instance` handler for Windows/Linux
- ❌ "note" action type in `DeepLinkAction`
- ❌ Note URL parsing in `DeepLinkHandler.parseDeepLink()`
- ❌ Note navigation handler in `deepLinkStore`

## Proposed URL Format

### Option A: Path-based (Recommended)
```
intent://workspace-id/note/note-id
```

Examples:
- `intent://abc-123/note/spec`
- `intent://abc-123/note/meeting-notes-456`

**Pros:**
- Clean, hierarchical structure
- Clearly shows workspace → note relationship
- Extensible for future resource types (files, agents, etc.)

**Cons:**
- Slightly longer than query param approach

### Option B: Query param-based
```
intent://note?workspace=workspace-id&id=note-id
```

**Pros:**
- Consistent with existing `intent://open?id=workspace-id` pattern

**Cons:**
- Less intuitive hierarchy
- Harder to extend for nested resources

**Recommendation:** Go with Option A (path-based)

## Implementation Plan

### 1. Main Process Changes (`src/main/index.ts`)

Add protocol handler registration and event listeners:

```typescript
import { DeepLinkHandler } from "../features/deeplink/deep-link-handler";

const deepLinkHandler = new DeepLinkHandler();

// Register protocol (before app.whenReady())
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('intent', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('intent');
}

// Handle macOS open-url events
app.on('open-url', (event, url) => {
  event.preventDefault();
  logger.info('Received open-url event:', url);
  deepLinkHandler.handleDeepLink(url, mainWindow);
});

// Handle Windows/Linux second-instance events
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith('intent://'));
    if (url) {
      logger.info('Received protocol URL from second instance:', url);
      deepLinkHandler.handleDeepLink(url, mainWindow);
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
```

### 2. Deep Link Handler Changes (`src/features/deeplink/deep-link-handler.ts`)

**Update `DeepLinkAction` type:**
```typescript
export interface DeepLinkAction {
  type: "open" | "create" | "clone" | "note";
  params: Record<string, string>;
}
```

**Update `parseDeepLink()` method:**
```typescript
parseDeepLink(url: string): DeepLinkAction | null {
  try {
    const urlWithoutProtocol = url.replace("intent://", "http://");
    const parsed = new URL(urlWithoutProtocol);

    // Parse path segments for note navigation
    // Format: intent://workspace-id/note/note-id
    const pathSegments = parsed.pathname.replace(/^\/+/, "").split("/");

    if (pathSegments.length >= 3 && pathSegments[1] === "note") {
      return {
        type: "note",
        params: {
          workspaceId: pathSegments[0],
          noteId: pathSegments[2],
        },
      };
    }

    // ... existing logic for open/create/clone ...
  }
}
```

### 3. Deep Link Store Changes (`src/features/deeplink/deeplink.store.svelte.ts`)

**Add handler in `handleDeepLink()`:**
```typescript
switch (action.type) {
  case "open":
    await this.handleOpenWorkspace(action.params);
    break;
  case "create":
    await this.handleCreateWorkspace(action.params);
    break;
  case "clone":
    await this.handleCloneRepository(action.params);
    break;
  case "note":
    await this.handleOpenNote(action.params);
    break;
  default:
    throw new Error(`Unknown action type: ${action.type}`);
}
```

**Add `handleOpenNote()` method:**
```typescript
private async handleOpenNote(params: Record<string, string>) {
  const { workspaceId, noteId } = params;

  if (!workspaceId || !noteId) {
    throw new Error("Workspace ID and Note ID are required");
  }

  // First open the workspace
  await workspaceStore.open(workspaceId);

  // Then navigate to the note
  const { navigateToNote } = await import("$lib/utils/workspace-navigation");
  await navigateToNote(noteId);

  this.#state = { ...this.#state, pendingAction: null, processing: false };
}
```

**Add helper to generate note links:**
```typescript
generateNoteLink(workspaceId: string, noteId: string): string {
  return `intent://${workspaceId}/note/${noteId}`;
}
```

## How It Works

1. User writes `[Link](intent://abc-123/note/spec)` in markdown
2. Tiptap renders it as a normal `<a href="intent://abc-123/note/spec">` link
3. User clicks the link
4. OS intercepts the `intent://` URL and sends it to the Electron app
5. Main process receives `open-url` event (macOS) or `second-instance` event (Windows/Linux)
6. `DeepLinkHandler.handleDeepLink()` parses the URL
7. Parsed action is sent to renderer via IPC (`deep-link` event)
8. `deepLinkStore.handleDeepLink()` processes the action
9. `handleOpenNote()` opens the workspace and navigates to the note

## Benefits

✅ **No Tiptap modifications needed** - Uses standard link rendering
✅ **Works everywhere** - Notes, comments, chat, anywhere markdown is rendered
✅ **External linking** - Links work from outside the app (Slack, email, etc.)
✅ **Consistent with existing patterns** - Uses the same `intent://` protocol
✅ **Extensible** - Easy to add more resource types (files, agents, etc.)

## Considerations

### Cross-workspace linking
The proposed format supports linking to notes in different workspaces:
```markdown
[Other workspace's spec](intent://other-workspace-id/note/spec)
```

This will:
1. Switch to the other workspace
2. Navigate to the note

### Relative linking
For same-workspace links, we could support a shorthand:
```markdown
[Same workspace note](intent:///note/note-id)
```
Where empty workspace-id means "current workspace". This would require additional logic to resolve the current workspace ID.

**Recommendation:** Start with explicit workspace IDs only. Add relative linking later if needed.

### Link validation
Should we validate that the workspace/note exists before rendering the link?

**Recommendation:** No. Keep links simple. If a link is broken, show an error when clicked.

## Testing Plan

1. **Unit tests** for `parseDeepLink()` with note URLs
2. **Integration tests** for note navigation flow
3. **Manual testing:**
   - Click note link within app
   - Click note link from external source (terminal, browser)
   - Test on macOS, Windows, Linux
   - Test with workspace that doesn't exist
   - Test with note that doesn't exist

## Future Extensions

Once this is working, we can extend to other resource types:

- **Files:** `intent://workspace-id/file/path/to/file.ts`
- **Agents:** `intent://workspace-id/agent/agent-id`
- **Comments:** `intent://workspace-id/note/note-id/comment/comment-id`
- **Line numbers:** `intent://workspace-id/file/path/to/file.ts#L42`
