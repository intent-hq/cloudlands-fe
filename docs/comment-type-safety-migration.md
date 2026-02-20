# Comment Type Safety Migration Plan

## Problem

Currently, comment types use a "bag of optional properties" approach where all type-specific fields (like `agentId` for session comments, `suggestionDiff` for suggestions) are optional on the base `CommentV2` type. This led to bugs where:

1. `agentId` was accidentally omitted during backend-to-store conversion
2. TypeScript didn't catch the error because the field is optional
3. The bug only manifested at runtime when the UI tried to render the link

## Solution: Discriminated Unions

Use TypeScript discriminated unions to enforce type-specific fields at compile time.

### New Type Structure

```typescript
// Base fields shared by all comments
interface BaseComment { ... }

// Type-specific interfaces
interface SessionComment extends BaseComment {
  type: "session";
  agentId: string; // REQUIRED for session comments
}

interface SuggestionComment extends BaseComment {
  type: "suggestion";
  suggestionDiff: { ... }; // REQUIRED for suggestions
}

// Union type
type CommentV2 = RegularComment | SuggestionComment | SessionComment | ...;
```

### Benefits

1. **Compile-time safety**: TypeScript will error if you create a session comment without `agentId`
2. **Type narrowing**: When you check `comment.type === "session"`, TypeScript knows `agentId` exists
3. **Self-documenting**: Clear which fields are required for each type
4. **Refactoring safety**: Adding new comment types or fields is safer

### Example Usage

```typescript
// Creating comments - TypeScript enforces required fields
const sessionComment = createSessionComment(baseFields, agentId); // ✅ Type-safe
const sessionComment = createSessionComment(baseFields); // ❌ Compile error

// Using comments - Type narrowing works automatically
if (comment.type === "session") {
  // TypeScript knows comment.agentId exists here
  navigateToAgent(comment.agentId); // ✅ No optional chaining needed
}

// Conversion - Runtime validation + compile-time safety
const v2Comment = convertBackendCommentToV2(backendComment, anchor, noteId);
// Throws error if session comment missing agentId
```

## Migration Steps

### Phase 1: Create New Types (✅ Done)
- Created `comment-types-v2.ts` with discriminated union types
- Added helper functions for type-safe comment creation
- Added conversion function with runtime validation

### Phase 2: Update Core Systems (To Do)
1. **Update `comments-v2.store.svelte.ts`**
   - Import `CommentV2` from `comment-types-v2.ts` instead of local definition
   - Update `addComment()` to use type-safe helpers
   - Update `loadComments()` to use conversion helper

2. **Update `comment-manager-v2.ts`**
   - Use `convertBackendCommentToV2()` helper in `loadComments()`
   - This will catch missing fields at runtime with clear error messages

3. **Update `notes.service.ts`**
   - Keep `NoteComment` interface for backend storage (it's fine as-is)
   - Add conversion helpers between `NoteComment` and `CommentV2`

### Phase 3: Update UI Components (To Do)
1. **Update `Comment.svelte`**
   - Use type guards instead of optional chaining
   - Example: `if (isSessionComment(comment))` instead of `if (comment.type === "session" && comment.agentId)`

2. **Update `CommentsSidebar.svelte`**
   - Use discriminated union type for better type inference

3. **Update `comment-types.ts` (CommentLike)**
   - Consider creating a discriminated union version for UI components too
   - Or keep it simple if UI doesn't need type-specific logic

### Phase 4: Add Tests (To Do)
1. Test conversion function with missing required fields
2. Test type guards work correctly
3. Test helper functions enforce required fields

## Backward Compatibility

The new types are **mostly compatible** with existing code:
- ✅ Reading comments works the same
- ✅ Type checks like `comment.type === "session"` work the same
- ⚠️ Creating comments needs to use helpers or ensure required fields are present
- ⚠️ Optional chaining (`comment.agentId?`) still works but is unnecessary after type narrowing

## Alternative: Gradual Migration

If full migration is too risky, we can:
1. Keep existing `CommentV2` type as-is
2. Use the conversion helper in critical paths (like `comment-manager-v2.ts`)
3. Add runtime validation without changing types
4. Gradually adopt discriminated unions in new code

## Recommendation

**Start with Phase 2, Step 2** - Update `comment-manager-v2.ts` to use the conversion helper. This gives us:
- ✅ Runtime validation catches missing fields immediately
- ✅ Clear error messages for debugging
- ✅ No breaking changes to existing code
- ✅ Can migrate other parts gradually

Then gradually adopt the discriminated union types in new code and refactor existing code as needed.
