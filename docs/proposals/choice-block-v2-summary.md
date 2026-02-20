# Choice Block V2: Non-Atomic Architecture Summary

## Why V2?

**V1 Problem**: Atomic node with text in attributes
- Every keystroke updates attributes → ProseMirror transaction → full re-render → **focus loss**
- Workarounds (blur-based editing) provide poor UX
- Spaces don't work (likely event propagation issue)

**V2 Solution**: Non-atomic node with nested content (like TaskItem)
- Text lives in nested `paragraph` nodes with `contentDOM`
- TipTap manages editing directly → **no focus loss**
- Proper cursor positioning, selection, undo/redo

## Architecture Comparison

### V1 (Deprecated)
```
choiceBlock (atom)
├── question: string (attribute)
└── options: Array<{id, text, selected}> (attribute)
```

### V2 (New)
```
choiceBlock (container)
├── choiceQuestion
│   └── paragraph (editable)
└── choiceOption (repeatable)
    ├── selected: boolean (attribute)
    └── paragraph (editable)
```

## Key Architectural Decisions

1. **Three separate node types** instead of one
   - `choiceBlock`: Container
   - `choiceQuestion`: Question text
   - `choiceOption`: Each option

2. **NodeView only for `choiceOption`** (not `choiceBlock`)
   - Adds radio button indicator
   - Handles selection logic
   - Uses `NodeViewContent` for editable text

3. **Radio button for selection**
   - Clicking radio button → selects option
   - Clicking text → focuses for editing
   - Clear separation of concerns

## Top 7 Challenges (Ranked by Difficulty)

### 1. Markdown Parsing Complexity ⚠️ HIGH
- Must generate nested HTML structure instead of flat attributes
- HTML must match `parseHTML()` rules of all three node types
- **Estimated**: 3-4 hours

### 2. Selection Behavior with contentDOM ⚠️ HIGH
- Distinguish "click to select" vs "click to edit"
- Solution: Explicit radio button indicator
- **Estimated**: 2-3 hours (part of NodeView work)

### 3. Ensuring Mutual Exclusion ⚠️ MEDIUM
- Selecting one option must deselect all siblings
- Must traverse parent's children and update all
- **Estimated**: 2-3 hours (part of NodeView work)

### 4. NodeView with Multiple contentDOM Areas ⚠️ MEDIUM
- Can't use NodeView for `choiceBlock` (only one contentDOM allowed)
- Solution: NodeView only for `choiceOption`
- **Estimated**: 1-2 hours (architectural decision)

### 5. Markdown Serialization Complexity ⚠️ MEDIUM
- Must traverse nested DOM to extract text
- More complex than V1's attribute access
- **Estimated**: 2-3 hours

### 6. Testing Complexity ⚠️ MEDIUM
- More nodes = more test cases
- Must test nested structure, contentDOM editing
- **Estimated**: 2-3 hours

### 7. CSS Styling ⚠️ LOW
- Update selectors for nested structure
- Straightforward, not a major challenge
- **Estimated**: 1-2 hours

## Implementation Phases

1. **Phase 1**: Define node schema (1-2 hours)
2. **Phase 2**: Update markdown parser (3-4 hours)
3. **Phase 3**: Update markdown serializer (2-3 hours)
4. **Phase 4**: Create ChoiceOption NodeView (4-6 hours)
5. **Phase 5**: Styling and polish (1-2 hours)
6. **Phase 6**: Integration testing (2-3 hours)

**Total Estimated**: 13-20 hours

## What We're Throwing Away

From V1 (completed):
- ✅ Markdown parsing (needs rewrite for nested structure)
- ✅ Markdown serialization (needs rewrite for nested structure)
- ✅ TipTap extension (needs rewrite for three nodes)
- ✅ Svelte NodeView (needs rewrite for contentDOM)
- ✅ All 14 tests (need updates for new architecture)

**But**: The learning and patterns are valuable! We understand:
- How marked.js custom renderers work
- How TipTap node attributes work
- How svelte-tiptap utilities work
- What doesn't work (atomic nodes with editable text)

## Next Steps

1. Review this summary and the updated proposal doc
2. Decide: proceed with V2 or explore other options?
3. If proceeding: Start with Phase 1 (schema definition)
4. Follow TDD approach: write tests first, then implementation

## References

- **Full V2 Proposal**: `docs/proposals/choices-markdown-block.md`
- **V1 Implementation**: `src/lib/components/tiptap/ChoiceBlock*.ts` (to be replaced)
- **TaskItem Reference**: `src/lib/components/tiptap/CustomTaskItem.ts` (similar pattern)
