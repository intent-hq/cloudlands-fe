# CustomTaskItem Migration to svelte-tiptap - Technical Proposal

## Overview

Migrate `CustomTaskItem.ts` from manual DOM manipulation to `svelte-tiptap`'s `SvelteNodeViewRenderer` pattern.

**Current**: 280 lines of imperative DOM code
**Proposed**: Declarative Svelte component with automatic reactivity

---

## Current Architecture Analysis

### File: `src/lib/components/tiptap/CustomTaskItem.ts`

**Key Components**:
1. **addNodeView()** - Returns node view object with manual DOM creation
2. **DOM Structure** - Complex nested elements (li > div > label+checkbox, content, button)
3. **Event Handlers** - Checkbox click (3-state cycle), menu button (Popover API)
4. **Update Logic** - Manual attribute syncing in `update()` method
5. **State Management** - Checked, indeterminate, status attributes

**Integration Points**:
- TaskMenu.svelte (via Popover API + CSS Anchor Positioning)
- ProseMirror transactions (checkbox state updates)
- Keyboard shortcuts (Mod-Enter to toggle)

---

## Proposed Architecture

### New File: `src/lib/components/tiptap/TaskItemNodeView.svelte`

```svelte
<script lang="ts">
  import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
  import type { Editor } from "@tiptap/core";

  interface Props {
    node: ProseMirrorNode;
    editor: Editor;
    getPos: () => number | undefined;
    updateAttributes: (attrs: Record<string, any>) => void;
    deleteNode: () => void;
  }

  let { node, editor, getPos, updateAttributes }: Props = $props();

  // Reactive state derived from node attributes
  let checked = $derived(node.attrs.checked);
  let status = $derived(node.attrs.status || "todo");
  let isIndeterminate = $derived(status === "in-progress");

  // Computed values
  let taskText = $derived.by(() => {
    const pos = getPos();
    if (typeof pos !== "number") return "";
    return editor.state.doc.textBetween(pos, pos + node.nodeSize, " ", " ");
  });

  // Generate unique IDs for Popover API
  let anchorName = $state(`task-menu-anchor-${Math.random().toString(36).substring(2, 11)}`);
  let popoverId = $state(`task-menu-${Math.random().toString(36).substring(2, 11)}`);

  function handleCheckboxClick(event: MouseEvent) {
    event.preventDefault();

    // Cycle through states: todo → in-progress → done → todo
    let newStatus: string;
    let newChecked: boolean;

    if (status === "todo") {
      newStatus = "in-progress";
      newChecked = false;
    } else if (status === "in-progress") {
      newStatus = "done";
      newChecked = true;
    } else {
      newStatus = "todo";
      newChecked = false;
    }

    // Update via TipTap
    updateAttributes({ checked: newChecked, status: newStatus });
  }
</script>

<li
  class="custom-task-item-container group"
  data-type="taskItem"
  data-checked={checked || undefined}
  class:task-checked={checked}
>
  <div class="flex items-start gap-2 py-1">
    <!-- Checkbox -->
    <label class="task-item-checkbox-wrapper flex-shrink-0 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        indeterminate={isIndeterminate}
        on:click={handleCheckboxClick}
        class="task-item-checkbox w-4 h-4 rounded border-2 border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
      />
    </label>

    <!-- Content (contentDOM will be inserted here) -->
    <div
      class="task-item-content flex-1 min-w-0 px-2"
      data-node-view-content
    />

    <!-- Menu Button -->
    <button
      class="task-item-menu-button opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0 p-1 rounded hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      style:anchor-name="--{anchorName}"
      popovertarget={popoverId}
      data-anchor-name={anchorName}
      data-popover-id={popoverId}
      data-task-position={getPos()?.toString() || ""}
      data-task-checked={checked.toString()}
      data-task-text={taskText}
      data-task-node={JSON.stringify(node.toJSON())}
      title="Task actions"
      aria-label="Open task menu"
    >
      <svg class="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
      </svg>
    </button>
  </div>
</li>
```

### Updated File: `src/lib/components/tiptap/CustomTaskItem.ts`

```typescript
import { TaskItem } from "@tiptap/extension-task-item";
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

---

## Benefits of Migration

### 1. Code Reduction
- **Before**: 280 lines of imperative DOM code
- **After**: ~100 lines of declarative Svelte + ~50 lines of extension config
- **Savings**: ~130 lines (46% reduction)

### 2. Automatic Reactivity
- No manual `update()` method needed
- Svelte automatically updates DOM when `node.attrs` change
- Derived state (`$derived`) keeps UI in sync

### 3. Better Separation of Concerns
- **Extension** (CustomTaskItem.ts): TipTap integration, commands, keyboard shortcuts
- **Component** (TaskItemNodeView.svelte): UI rendering, event handling, styling

### 4. Easier Testing
- Can test Svelte component in isolation
- Can mock TipTap props (node, editor, getPos)
- Can use Testing Library for component tests

### 5. Better TypeScript Support
- Props interface with full type safety
- Editor autocomplete in component
- Compile-time checks for attribute access

---

## Migration Challenges

### 1. contentDOM Placement
**Challenge**: TipTap needs to know where to insert editable content

**Solution**: Use `data-node-view-content` attribute
```svelte
<div data-node-view-content />
```

svelte-tiptap automatically finds this element and uses it as contentDOM.

### 2. Event Handler Timing
**Challenge**: Checkbox click needs to update ProseMirror state

**Solution**: Use `updateAttributes()` prop provided by svelte-tiptap
```typescript
updateAttributes({ checked: newChecked, status: newStatus });
```

### 3. Popover API Integration
**Challenge**: Menu button needs CSS Anchor Positioning and Popover API

**Solution**: Keep same approach, just in Svelte template
- Generate unique IDs in component state
- Set `style:anchor-name` and `popovertarget` attributes
- TaskMenu.svelte already handles the popover side

### 4. Performance
**Challenge**: Component mounting might be slower than raw DOM

**Mitigation**:
- svelte-tiptap caches component instances
- Only re-renders when node attributes change
- Benchmark before/after to measure impact

---

## Implementation Plan

### Step 1: Setup (1 hour)
- [ ] Verify svelte-tiptap is installed and working
- [ ] Create TaskItemNodeView.svelte skeleton
- [ ] Import SvelteNodeViewRenderer in CustomTaskItem.ts

### Step 2: Basic Rendering (2 hours)
- [ ] Implement basic DOM structure in Svelte
- [ ] Add contentDOM placement with `data-node-view-content`
- [ ] Test that task items render correctly

### Step 3: Checkbox Logic (2 hours)
- [ ] Implement 3-state checkbox cycle
- [ ] Add indeterminate state handling
- [ ] Test checkbox interactions

### Step 4: Menu Button (2 hours)
- [ ] Add menu button with Popover API attributes
- [ ] Generate unique IDs for CSS Anchor Positioning
- [ ] Test menu button interactions with TaskMenu.svelte

### Step 5: Styling (1 hour)
- [ ] Port CSS classes from current implementation
- [ ] Ensure hover states work (group-hover)
- [ ] Test visual appearance matches current

### Step 6: Testing (3 hours)
- [ ] Write component tests for TaskItemNodeView.svelte
- [ ] Write integration tests for CustomTaskItem extension
- [ ] Test keyboard shortcuts (Mod-Enter)
- [ ] Test markdown round-trip

### Step 7: Documentation (1 hour)
- [ ] Document svelte-tiptap patterns used
- [ ] Add comments explaining contentDOM placement
- [ ] Update this proposal with findings

**Total Estimated Time**: 12 hours (1.5 days)

---

## Testing Strategy

### Unit Tests (TaskItemNodeView.svelte)
```typescript
import { render } from "@testing-library/svelte";
import TaskItemNodeView from "./TaskItemNodeView.svelte";

test("renders checkbox with correct state", () => {
  const mockNode = { attrs: { checked: true, status: "done" } };
  const { getByRole } = render(TaskItemNodeView, {
    props: { node: mockNode, editor: mockEditor, getPos: () => 0 }
  });

  const checkbox = getByRole("checkbox");
  expect(checkbox).toBeChecked();
});
```

### Integration Tests (CustomTaskItem.ts)
```typescript
import { Editor } from "@tiptap/core";
import { CustomTaskItem } from "./CustomTaskItem";

test("checkbox click updates node attributes", () => {
  const editor = new Editor({
    extensions: [CustomTaskItem],
    content: "<ul data-type='taskList'><li data-type='taskItem'>Task</li></ul>"
  });

  // Simulate checkbox click
  const checkbox = editor.view.dom.querySelector("input[type=checkbox]");
  checkbox.click();

  // Check that node attributes updated
  const taskNode = editor.state.doc.firstChild.firstChild;
  expect(taskNode.attrs.status).toBe("in-progress");
});
```

---

## Rollback Plan

If migration causes issues:

1. **Keep old implementation** in `CustomTaskItem.legacy.ts`
2. **Feature flag** to switch between implementations
3. **Gradual rollout** - test in dev/staging first
4. **Easy revert** - just change import in editor-config.ts

---

## Success Criteria

- [ ] All existing functionality works (checkbox, menu, keyboard shortcuts)
- [ ] Visual appearance matches current implementation
- [ ] Markdown round-trip still works
- [ ] Performance is acceptable (< 10% slower)
- [ ] Code is more maintainable (subjective but team agrees)
- [ ] Tests pass and coverage is maintained

---

## Next Steps

1. **Review this proposal** with team
2. **Get approval** to proceed
3. **Create feature branch** `feat/svelte-tiptap-task-item`
4. **Implement Step 1-7** following the plan
5. **Create PR** with before/after comparison
6. **Document learnings** for future migrations
