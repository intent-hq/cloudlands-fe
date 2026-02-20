# Session Comment Agent Linking - Implementation Proposal

## Overview

Session comments currently mark where agent sessions were launched, but they don't link back to the agent that was launched. This proposal outlines how to store agent metadata in session comments and make them clickable to navigate to the agent's chat.

---

## Current State

### What Works
- ✅ Session comments are created when agents are launched from BubbleMenu (text selection)
- ✅ Session comments are created when agents are launched from TaskMenu (task assignment)
- ✅ Session comments have proper anchors in markdown
- ✅ Session comments have distinct visual styling (sky-blue, paper plane icon)

### What's Missing
- ❌ No link between session comment and the agent that was launched
- ❌ No way to navigate from session comment to agent chat
- ❌ No agent metadata stored in the comment

---

## Proposed Solution

### 1. Store Agent Metadata in Comment

**Add agent metadata to session comments when they're created:**

```typescript
// In NoteWithComments.svelte - handleCreateSessionComment()
await commentManager.addComment(
  `Agent session: ${agentData.name || "Untitled"}`,
  "session",
  {
    agentId: agentData.id,           // Agent's unique ID
    agentName: agentData.name,       // Agent's display name
    sessionId: agentData.sessionId,  // Session ID (if available)
    launchedAt: new Date().toISOString()
  }
);
```

**Schema Changes Required:**

The comment schema already supports a generic `metadata` field, but we need to ensure it's properly typed and persisted. Looking at the current schema:

```typescript
// Current: src/shared/schemas.ts - NoteCommentSchema
export const NoteCommentSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  author: z.string(),
  authorType: z.enum(["user", "agent"]),
  type: z.enum(["comment", "suggestion", "change-request", "question", "session"]),
  content: z.string(),
  // ... other fields ...
  // NO METADATA FIELD CURRENTLY!
});
```

**We need to add:**
```typescript
metadata: z.record(z.unknown()).optional(), // Generic metadata storage
```

This allows storing arbitrary metadata without breaking existing comments.

---

## 2. Make Session Comments Clickable

### Option A: Click Entire Comment (Recommended)

**Pros:**
- Larger click target (better UX)
- Clear affordance (entire comment is interactive)
- Consistent with LineAttributionGutter pattern

**Implementation:**
```typescript
// In ResponsiveCommentThread.svelte
function handleSessionCommentClick(comment: CommentLike) {
  if (comment.type === "session" && comment.metadata?.agentId) {
    navigateToAgent(comment.metadata.agentId);
  }
}
```

### Option B: Add "View Agent" Button

**Pros:**
- More explicit action
- Doesn't interfere with comment selection/editing
- Can show additional info (agent status, turn count)

**Implementation:**
```svelte
{#if comment.type === "session" && comment.metadata?.agentId}
  <Button
    size="xs"
    variant="ghost"
    onclick={() => navigateToAgent(comment.metadata.agentId)}
  >
    <Fa icon={faRobot} size="xs" />
    View Agent
  </Button>
{/if}
```

**Recommendation:** Start with Option A (click entire comment), add Option B button if users need more explicit affordance.

---

## 3. Visual Indicators

### Cursor Change
```css
.comment-type-session {
  cursor: pointer;
}

.comment-type-session:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  transition: all 0.2s ease;
}
```

### Agent Avatar
Show agent avatar in session comment header (similar to LineAttributionGutter):

```svelte
{#if comment.type === "session" && comment.metadata?.agentId}
  <div class="flex items-center gap-2">
    <AuggieAvatar
      size={20}
      faceSeed={comment.metadata.agentId}
      colorSeed={comment.metadata.agentId}
    />
    <span>{comment.metadata.agentName}</span>
  </div>
{/if}
```

---

## 4. Implementation Steps

### Phase 1: Schema & Data Storage
1. ✅ Add `metadata` field to `NoteCommentSchema`
2. ✅ Update `AddCommentRequestSchema` to accept metadata
3. ✅ Update backend comment service to persist metadata
4. ✅ Update `CommentManagerV2.addComment()` to accept metadata parameter

### Phase 2: Store Agent Data
5. ✅ Update `handleCreateSessionComment()` in NoteWithComments to pass agent metadata
6. ✅ Update TaskMenu handler to pass agent metadata
7. ✅ Test that metadata is persisted to disk

### Phase 3: Make Clickable
8. ✅ Add click handler to ResponsiveCommentThread for session comments
9. ✅ Import and use `navigateToAgent()` utility
10. ✅ Add visual indicators (cursor, hover state)
11. ✅ Add agent avatar to session comment display

### Phase 4: Polish
12. ✅ Add tooltip showing "Click to view agent chat"
13. ✅ Add keyboard accessibility (Enter/Space to activate)
14. ✅ Test navigation flow end-to-end
15. ✅ Update tests to verify metadata storage

---

## 5. Files to Modify

### Schema & Types
- `src/shared/schemas.ts` - Add metadata field to comment schemas
- `src/features/notes/notes.service.ts` - Update NoteComment interface

### Comment Creation
- `src/lib/components/workspace/NoteWithComments.svelte` - Pass agent metadata
- `src/features/comments/comment-manager-v2.ts` - Accept metadata parameter

### Comment Display
- `src/lib/components/tiptap/comments/ResponsiveCommentThread.svelte` - Add click handler
- `src/lib/styles/comments.css` - Add hover styles for session comments

### Tests
- `src/features/comments/__tests__/comment-manager-v2.test.ts` - Test metadata storage
- `src/features/mcp/__tests__/comment-id-consistency.test.ts` - Test MCP with metadata

---

## 6. Example User Flow

1. **User selects text** in a note
2. **Clicks paper plane** icon to launch agent
3. **Agent launches** successfully
4. **Session comment appears** with sky-blue styling and agent avatar
5. **User hovers** over session comment → cursor changes to pointer, tooltip shows "Click to view agent chat"
6. **User clicks** session comment
7. **Drawer opens** showing the agent's chat interface
8. **User can see** the agent's conversation and progress

---

## 7. Edge Cases to Handle

### Agent No Longer Exists
- Show session comment but disable click
- Display "(Agent no longer available)" in tooltip
- Gray out the avatar

### Multiple Sessions for Same Agent
- Each session comment links to its specific agent instance
- Use `sessionId` if available for more precise navigation

### Session Comment Created Before This Feature
- Old session comments won't have metadata
- Handle gracefully: show comment but don't make clickable
- Could add migration script to backfill metadata from activity log

---

## 8. Future Enhancements

### Show Agent Status
Display agent status badge in session comment:
- 🟢 Active (agent still running)
- ✅ Completed
- ❌ Failed
- ⏸️ Paused

### Show Turn Count
Display how many turns the agent has taken:
"Agent session: Task Agent (12 turns)"

### Link to Specific Turn
If agent made changes at this location, link to the specific turn:
`metadata.turnNumber` → navigate to agent + scroll to turn

---

## 9. Testing Strategy

### Unit Tests
- Test metadata is stored correctly in comment
- Test click handler calls `navigateToAgent()` with correct ID
- Test graceful handling of missing metadata

### Integration Tests
- Launch agent from BubbleMenu → verify session comment has metadata
- Launch agent from TaskMenu → verify session comment has metadata
- Click session comment → verify drawer opens with correct agent

### Manual Testing
- Test with multiple agents in same note
- Test with agent that completes vs fails
- Test navigation back/forward after clicking session comment
- Test keyboard navigation (Tab to comment, Enter to activate)

---

## 10. Open Questions

1. **Should we show agent status in the comment?**
   - Pro: Provides more context at a glance
   - Con: Requires polling/subscription to agent state

2. **Should we link to a specific turn if available?**
   - Pro: More precise navigation to relevant context
   - Con: Requires storing turn number, more complex navigation

3. **Should we backfill metadata for existing session comments?**
   - Pro: Consistent experience for all session comments
   - Con: Requires migration script, may not have all data

**Recommendation:** Start simple (just agentId + agentName), add enhancements based on user feedback.
