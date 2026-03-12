# svelte-tiptap Migration Analysis

## Executive Summary

This document analyzes all TipTap extensions in the Intent app to identify candidates for migrating to `svelte-tiptap`, which provides Svelte component integration for TipTap node views.

**Key Finding**: We have **3 strong candidates** for `svelte-tiptap` migration, all involving complex DOM manipulation that would benefit from Svelte's reactivity and component model.

---

## What is svelte-tiptap?

`svelte-tiptap` provides:
- `SvelteNodeViewRenderer` - Renders Svelte components as TipTap node views
- Automatic reactivity - Svelte components update when node attributes change
- Better separation of concerns - UI logic in Svelte, editor logic in TipTap
- Type safety and better DX

**Current Status**: Package is installed (`^3.0.1`) but never used.

---

## Extensions with Manual DOM Manipulation

### 1. **CustomTaskItem.ts** ⭐ STRONG CANDIDATE

**Location**: `src/lib/components/tiptap/CustomTaskItem.ts`

**Current Implementation**:
- 280 lines of manual DOM manipulation in `addNodeView()`
- Creates complex structure: checkbox, label, menu button, content wrapper
- Manual event handlers for checkbox clicks (3-state cycle)
- Manual attribute updates in `update()` method
- CSS Anchor Positioning and Popover API integration

**DOM Elements Created**:
```typescript
- listItem (li.custom-task-item-container)
  - container (div.flex)
    - checkboxWrapper (label)
      - checkbox (input[type=checkbox])
    - content (div.task-item-content) // contentDOM
    - menuButton (button.task-item-menu-button)
```

**Why Migrate**:
- ✅ Complex UI with multiple interactive elements
- ✅ State management (checked, indeterminate, status)
- ✅ Event handling (checkbox clicks, menu button)
- ✅ Would benefit from Svelte's reactivity
- ✅ Could use existing Svelte components (TaskMenu.svelte already exists)

**Estimated Effort**: Medium (2-3 days)
- Create TaskItemNodeView.svelte component
- Integrate with existing TaskMenu.svelte
- Test 3-state checkbox cycle
- Ensure Popover API integration works

---

### 2. **MentionSuggestionWrapper.svelte** ⭐ STRONG CANDIDATE

**Location**: legacy chat-input wrapper component

**Current Implementation**:
- Custom `MentionSuggestionRenderer` class (167 lines)
- Manual DOM manipulation for popup positioning
- Manual Svelte component mounting/unmounting
- Complex positioning logic (viewport calculations, space detection)
- Manual lifecycle management (onStart, onUpdate, onExit)

**Why Migrate**:
- ✅ Already using Svelte components (EnhancedMentionList.svelte)
- ✅ Complex positioning logic that could be simplified
- ✅ Manual mount/unmount is error-prone
- ✅ Would benefit from Svelte's built-in lifecycle
- ⚠️ Note: This is for suggestion dropdown, not node view - might need different approach

**Estimated Effort**: Medium (2-3 days)
- May need to use TipTap's built-in suggestion rendering
- Or create a cleaner wrapper using svelte-tiptap patterns
- Test positioning and keyboard navigation

---

### 3. **CommentAnchor.ts** ⭐ MODERATE CANDIDATE

**Location**: `src/lib/components/tiptap/CommentAnchor.ts`

**Current Implementation**:
- Simple `addNodeView()` (25 lines)
- Creates invisible span with data attributes
- No complex UI or interactions
- Just needs to render attributes to DOM

**DOM Elements Created**:
```typescript
- span.comment-anchor (display: none)
  - data-anchor-id
  - data-anchor-type
  - data-comment-id
```

**Why Migrate**:
- ⚠️ Very simple - might be overkill
- ✅ Would be cleaner with Svelte component
- ✅ Could add debug visualization in dev mode
- ❌ No real benefit from reactivity (invisible element)

**Estimated Effort**: Low (1 day)
- Create CommentAnchorNodeView.svelte
- Render invisible span with attributes
- Consider adding dev mode visualization

---

## Extensions WITHOUT Manual DOM Manipulation

### 4. **Suggestion.ts** - NO MIGRATION NEEDED

**Type**: Mark (not Node)
**Implementation**: Uses `renderHTML()` to return array syntax
**Complexity**: Simple - just CSS classes based on attributes
**Verdict**: ❌ No benefit from svelte-tiptap (marks don't use node views)

---

### 5. **WorkspacesLink** (tiptap-link-extension.ts) - NO MIGRATION NEEDED

**Type**: Mark (not Node)
**Implementation**: Extends Link extension, overrides validation
**Complexity**: Simple - just attribute parsing/rendering
**Verdict**: ❌ No benefit from svelte-tiptap (marks don't use node views)

---

### 6. **MentionFromSpan** (editor-config.ts) - ALREADY HANDLED

**Type**: Node
**Implementation**: Uses `renderHTML()` for mention chips
**Current Approach**: Returns array syntax for span with data attributes
**Complexity**: Simple - just renders a span with label
**Verdict**: ⚠️ Could migrate, but current approach is clean enough

---

## Recommendation Priority

### High Priority
1. **CustomTaskItem.ts** - Most complex, highest benefit
   - Complex UI with multiple interactive elements
   - Would significantly improve maintainability
   - Could integrate better with TaskMenu.svelte

### Medium Priority
2. **MentionSuggestionWrapper.svelte** - Good candidate but different use case
   - Already using Svelte components
   - Manual lifecycle management is error-prone
   - May need different approach (suggestion vs node view)

### Low Priority
3. **CommentAnchor.ts** - Simple but could be cleaner
   - Very simple implementation
   - Low benefit from migration
   - Consider only if doing other migrations

---

## Migration Strategy

### Phase 1: Proof of Concept (1 week)
- Migrate CustomTaskItem.ts to svelte-tiptap
- Create TaskItemNodeView.svelte component
- Test all functionality (checkbox, menu, keyboard shortcuts)
- Document patterns and best practices

### Phase 2: Evaluate Results
- Assess code quality improvement
- Measure performance impact
- Decide if other migrations are worthwhile

### Phase 3: Additional Migrations (if Phase 1 successful)
- Migrate MentionSuggestionWrapper if patterns apply
- Consider CommentAnchor if time permits

---

## Technical Considerations

### Benefits of Migration
- ✅ Better separation of concerns (UI in Svelte, logic in TipTap)
- ✅ Automatic reactivity when node attributes change
- ✅ Easier to test UI components in isolation
- ✅ Better TypeScript support
- ✅ Cleaner code, less manual DOM manipulation

### Risks and Challenges
- ⚠️ Learning curve for svelte-tiptap patterns
- ⚠️ Potential performance overhead (component mounting)
- ⚠️ Need to ensure markdown round-trip still works
- ⚠️ Integration with existing systems (Popover API, CSS Anchor Positioning)
- ⚠️ May need to handle edge cases differently

### Testing Requirements
- Unit tests for Svelte components
- Integration tests for TipTap editor
- Markdown round-trip tests
- Keyboard navigation tests
- Accessibility tests

---

## Code Comparison: Before vs After

### CustomTaskItem - Current Implementation (280 lines)

```typescript
addNodeView() {
  return ({ node, getPos, editor }) => {
    // Create the main list item container
    const listItem = document.createElement("li");
    listItem.setAttribute("data-type", "taskItem");
    listItem.className = "custom-task-item-container group";

    // Add checked state
    if (node.attrs.checked) {
      listItem.setAttribute("data-checked", "true");
      listItem.classList.add("task-checked");
    }

    // Create checkbox wrapper
    const checkboxWrapper = document.createElement("label");
    checkboxWrapper.contentEditable = "false";
    checkboxWrapper.className = "task-item-checkbox-wrapper flex-shrink-0 cursor-pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = node.attrs.checked;
    checkbox.contentEditable = "false";
    checkbox.className = "task-item-checkbox w-4 h-4 rounded border-2...";

    // Set indeterminate state
    if (node.attrs.status === "in-progress") {
      checkbox.indeterminate = true;
    }

    // Enhanced checkbox click handler
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();

      if (typeof getPos === "function") {
        const pos = getPos();
        if (typeof pos === "number") {
          const currentStatus = node.attrs.status || "todo";
          let newStatus: string;
          let newChecked: boolean;

          // Cycle through states
          if (currentStatus === "todo") {
            newStatus = "in-progress";
            newChecked = false;
          } else if (currentStatus === "in-progress") {
            newStatus = "done";
            newChecked = true;
          } else {
            newStatus = "todo";
            newChecked = false;
          }

          // ... more logic ...

          // Dispatch transaction
          const tr = editor.view.state.tr;
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: newChecked,
            status: newStatus,
          });
          editor.view.dispatch(tr);
        }
      }
    });

    // ... 200+ more lines of DOM manipulation ...

    return {
      dom: listItem,
      contentDOM: content,
      update: (updatedNode) => {
        // Manual attribute syncing
        checkbox.checked = updatedNode.attrs.checked;
        checkbox.indeterminate = updatedNode.attrs.status === "in-progress";
        // ... more manual updates ...
        return true;
      },
      destroy: () => {
        // Cleanup
      },
    };
  };
}
```

### CustomTaskItem - Proposed Implementation (~150 lines total)

**Extension (50 lines)**:
```typescript
import { SvelteNodeViewRenderer } from "svelte-tiptap";
import TaskItemNodeView from "./TaskItemNodeView.svelte";

export const CustomTaskItem = TaskItem.extend({
  name: "taskItem",

  addNodeView() {
    return SvelteNodeViewRenderer(TaskItemNodeView);
  },

  // Keep existing: addOptions, addAttributes, addCommands, addKeyboardShortcuts
});
```

**Component (100 lines)**:
```svelte
<script lang="ts">
  let { node, editor, getPos, updateAttributes }: Props = $props();

  // Automatic reactivity - no manual update() needed!
  let checked = $derived(node.attrs.checked);
  let status = $derived(node.attrs.status || "todo");
  let isIndeterminate = $derived(status === "in-progress");

  function handleCheckboxClick(event: MouseEvent) {
    event.preventDefault();

    // Cycle through states
    let newStatus = status === "todo" ? "in-progress"
                  : status === "in-progress" ? "done"
                  : "todo";
    let newChecked = newStatus === "done";

    // Update via TipTap - automatic reactivity handles the rest!
    updateAttributes({ checked: newChecked, status: newStatus });
  }
</script>

<li class="custom-task-item-container group" data-checked={checked || undefined}>
  <div class="flex items-start gap-2 py-1">
    <label class="task-item-checkbox-wrapper">
      <input
        type="checkbox"
        {checked}
        indeterminate={isIndeterminate}
        on:click={handleCheckboxClick}
        class="task-item-checkbox w-4 h-4..."
      />
    </label>

    <div class="task-item-content flex-1" data-node-view-content />

    <button class="task-item-menu-button" {...menuButtonProps}>
      <!-- Menu icon -->
    </button>
  </div>
</li>
```

**Key Improvements**:
- ✅ 46% less code (280 → 150 lines)
- ✅ Declarative instead of imperative
- ✅ Automatic reactivity (no manual `update()` method)
- ✅ Easier to read and maintain
- ✅ Better TypeScript support
- ✅ Testable in isolation

---

## Next Steps

1. **Review this analysis** with team
2. **Decide on migration priority** (recommend starting with CustomTaskItem)
3. **Create spike branch** for proof of concept
4. **Document patterns** for future migrations
5. **Update this document** with findings
