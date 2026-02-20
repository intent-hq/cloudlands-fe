# Intent Link Handler

## Overview

The intent link handler enables internal navigation using `intent://` protocol links. This allows agents and users to create clickable links to notes that work in both chat messages and note editors.

## URL Format

```
intent://local/note/{note-id}
```

### Components

- **Protocol**: `intent://`
- **Org ID**: `local` (placeholder for future organization support)
- **Resource Type**: `note` (currently only notes are supported)
- **Resource ID**: The note ID (e.g., `spec`, `meeting-2024-01-15`, UUIDs)

### Examples

```markdown
[Spec Note](intent://local/note/spec)
[Meeting Notes](intent://local/note/meeting-2024-01-15)
[UUID Note](intent://local/note/550e8400-e29b-41d4-a716-446655440000)
```

## Implementation

### Core Module

**File**: `src/lib/utils/workspaces-link-handler.ts`

**Exports**:
- `parseIntentLink(url: string)` - Parse an intent:// URL
- `generateNoteLink(noteId: string)` - Generate an intent:// URL for a note
- `handleIntentLink(url: string)` - Navigate to an intent:// URL
- `createIntentLinkClickHandler()` - Create a Tiptap click handler

### Integration Points

1. **MarkdownViewer.svelte** (Chat)
   - Intercepts clicks on intent:// links in chat messages
   - Uses `createIntentLinkClickHandler()` in `editorProps.handleClick`

2. **editor-config.ts** (Notes Editor)
   - Intercepts clicks on intent:// links in note editor
   - Checks for intent:// links before other click handlers

## Behavior

### Successful Navigation

When a valid intent:// link is clicked:
1. URL is parsed to extract org-id and note-id
2. System checks if note exists in current workspace
3. If note exists, navigates to it
4. If note doesn't exist, shows error toast

### Error Handling

- **Invalid URL format**: Shows toast with error message
- **Note not found**: Shows "Note not found in current workspace" toast
- **No workspace open**: Shows "No workspace is currently open" toast
- **Unknown resource type**: Shows "Cannot handle {type} links yet" toast

### Cross-Workspace Navigation

Currently **not supported**. Links only work within the current workspace. Attempting to navigate to a note in a different workspace will show a "not found" error.

This is intentional - cross-workspace navigation is reserved for future enhancement.

## Testing

### Test Files

- `src/lib/utils/workspaces-link-handler.test.ts` - Unit tests (12 tests)
- `src/lib/utils/workspaces-link-handler.integration.test.ts` - Integration tests (9 tests)

### Running Tests

```bash
# Run all workspaces link handler tests
pnpm test src/lib/utils/workspaces-link-handler --run

# Run with verbose output
pnpm test src/lib/utils/workspaces-link-handler --run --reporter=verbose
```

### Test Coverage

- ✅ URL parsing (valid and invalid formats)
- ✅ Link generation
- ✅ Round-trip parsing/generation
- ✅ Tiptap click handler integration
- ✅ Error handling
- ✅ Edge cases (empty IDs, unknown types, etc.)

## Usage

### For Agents

Agents can generate links to notes using the `generateNoteLink()` function:

```typescript
import { generateNoteLink } from '$lib/utils/workspaces-link-handler';

const link = generateNoteLink('spec');
// Returns: "intent://local/note/spec"

// Use in markdown
const markdown = `See the [spec note](${link}) for details.`;
```

### For Users

Users can manually create links in markdown:

```markdown
Check out the [spec](intent://local/note/spec) for requirements.
```

## Future Enhancements

### Planned

1. **Organization Support**: Replace `local` placeholder with actual org-id
2. **Cross-Workspace Navigation**: Navigate to notes in other workspaces
3. **Additional Resource Types**: Support for files, agents, etc.
4. **Deep Linking**: Link to specific sections within notes

### URL Format Evolution

Future URL formats might look like:

```
intent://augment-org/note/spec
intent://augment-org/file/src/main.ts
intent://augment-org/agent/session-123
intent://augment-org/note/spec#section-2
```

## Design Decisions

### Why `local` as Placeholder?

The `local` placeholder reserves the org-id slot in the URL structure without requiring organization infrastructure today. This makes the URLs forward-compatible.

### Why Not OS-Level Protocol Handling?

We chose to handle links at the application level (Tiptap click handlers) rather than OS-level protocol registration because:
- Faster to implement
- No platform-specific code needed
- Works immediately without OS configuration
- Can be upgraded to OS-level later if needed

### Why Fire-and-Forget for Async Handlers?

Tiptap's `handleClick` doesn't support async functions. We call the async handler without awaiting to avoid blocking the UI thread. This is acceptable because:
- Navigation happens quickly
- Errors are shown via toast notifications
- User gets immediate feedback

## Troubleshooting

### Links Not Working

1. Check that the note exists in the current workspace
2. Verify the URL format is correct
3. Check browser console for errors
4. Ensure a workspace is currently open

### Tests Failing

1. Run `pnpm test src/lib/utils/workspaces-link-handler --run`
2. Check for import errors or missing dependencies
3. Verify workspace store is properly mocked in tests
