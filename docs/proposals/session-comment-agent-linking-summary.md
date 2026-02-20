# Session Comment Agent Linking - Quick Summary

## Goal
Make session comments clickable to navigate to the agent that was launched, providing a visual link between the task/text and the agent working on it.

---

## Key Findings from Research

### 1. Navigation API Exists ✅
The app has a `navigateToAgent(agentId: string)` utility in `src/lib/utils/workspace-navigation.ts` that:
- Opens the drawer
- Sets drawer type to "agent"
- Displays the specified agent's chat
- Updates URL for deep linking and browser history

**Usage:**
```typescript
import { navigateToAgent } from "$lib/utils/workspace-navigation";
await navigateToAgent("agent-123");
```

### 2. Similar Pattern in LineAttributionGutter ✅
The `LineAttributionGutter.svelte` component already implements clickable indicators that navigate to agents:

```typescript
function handleIndicatorClick(indicator: Indicator) {
  if (indicator.author?.type === "agent" && indicator.author.id) {
    navigateToAgent(indicator.author.id);
  }
}
```

This proves the pattern works and is already in use!

### 3. ActivityLog Also Uses This Pattern ✅
The `ActivityLog.svelte` component has "Show Agent" buttons that navigate to agents:

```typescript
async function showAgent(agentId: string) {
  await navigateToAgent(agentId);
  logger.info("[ActivityLog] Showing agent:", agentId);
}
```

---

## What We Need to Add

### 1. Metadata Field in Comment Schema
**Current schema does NOT have a metadata field!**

```typescript
// src/shared/schemas.ts - Need to add:
export const NoteCommentSchema = z.object({
  // ... existing fields ...
  metadata: z.record(z.unknown()).optional(), // ADD THIS
});
```

### 2. Pass Agent Data When Creating Session Comments
```typescript
// In NoteWithComments.svelte
await commentManager.addComment(
  `Agent session: ${agentData.name}`,
  "session",
  {
    agentId: agentData.id,
    agentName: agentData.name,
    sessionId: agentData.sessionId,
    launchedAt: new Date().toISOString()
  }
);
```

### 3. Update CommentManagerV2 to Accept Metadata
```typescript
// src/features/comments/comment-manager-v2.ts
async addComment(
  content: string,
  type: CommentType = "comment",
  metadata?: Record<string, unknown> // ADD THIS PARAMETER
): Promise<void>
```

### 4. Make Session Comments Clickable
```typescript
// In ResponsiveCommentThread.svelte
function handleSessionCommentClick(comment: CommentLike) {
  if (comment.type === "session" && comment.metadata?.agentId) {
    navigateToAgent(comment.metadata.agentId);
  }
}
```

### 5. Add Visual Indicators
```css
.comment-type-session {
  cursor: pointer;
}

.comment-type-session:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
```

---

## Implementation Order

### Phase 1: Schema & Storage (Backend)
1. Add `metadata` field to `NoteCommentSchema`
2. Update `AddCommentRequestSchema`
3. Update backend comment service to persist metadata
4. Update `CommentManagerV2.addComment()` signature

### Phase 2: Store Agent Data (Frontend)
5. Update `handleCreateSessionComment()` to pass metadata
6. Update TaskMenu handler to pass metadata
7. Test that metadata persists to disk

### Phase 3: Make Clickable (UI)
8. Add click handler to `ResponsiveCommentThread`
9. Import `navigateToAgent` utility
10. Add hover styles and cursor pointer
11. Add agent avatar display

### Phase 4: Polish
12. Add tooltip "Click to view agent chat"
13. Add keyboard accessibility
14. Test end-to-end flow
15. Update tests

---

## Example Metadata Structure

```json
{
  "id": "comment-123",
  "type": "session",
  "content": "Agent session: Task Agent",
  "metadata": {
    "agentId": "agent-abc-123",
    "agentName": "Task Agent",
    "sessionId": "session-xyz-789",
    "launchedAt": "2025-11-12T05:30:00.000Z"
  }
}
```

---

## User Experience Flow

1. User launches agent from text selection or task
2. Session comment appears with sky-blue styling
3. User hovers → cursor changes to pointer, tooltip appears
4. User clicks → drawer opens showing agent chat
5. User can see agent's progress and conversation

---

## References

- **Navigation Utility:** `src/lib/utils/workspace-navigation.ts`
- **Similar Pattern:** `src/lib/components/tiptap/LineAttributionGutter.svelte` (lines 86-91)
- **Activity Log Example:** `src/features/log/ActivityLog.svelte` (lines 777-781)
- **Comment Schema:** `src/shared/schemas.ts` (lines 187-212)
- **Comment Display:** `src/lib/components/tiptap/comments/ResponsiveCommentThread.svelte`

---

## Next Steps

See the full proposal document for detailed implementation steps:
`.augment/notes/session-comment-agent-linking-proposal.md`
