# svelte-tiptap Utilities Implementation Summary

**Date**: November 19, 2025
**Status**: ✅ Complete

## Overview

Successfully implemented 5 reusable utilities for svelte-tiptap node views and refactored `TaskItemNodeView.svelte` to use them. This establishes a solid foundation for migrating other TipTap extensions to svelte-tiptap.

---

## 🎯 Results

### Code Reduction
- **TaskItemNodeView.svelte**: 222 → 177 lines (**20% reduction, 45 lines saved**)
- **Boilerplate eliminated**: ~72 lines of repetitive code replaced with utility calls
- **Test coverage**: 42 tests, all passing

### Utilities Created

All utilities are fully implemented with comprehensive tests and JSDoc documentation:

1. **`generateUniqueId()` / `generateUniqueIds()`** (10 tests ✅)
   - Location: `src/lib/utils/tiptap/unique-id.ts`
   - Purpose: Generate stable unique IDs for Popover API, CSS Anchor Positioning, ARIA attributes
   - Saves: ~2 lines per component

2. **`updateNodeAttributes()`** (6 tests ✅)
   - Location: `src/lib/utils/tiptap/node-attributes.ts`
   - Purpose: Clean API for updating node attributes via ProseMirror transactions
   - Saves: ~15 lines per component

3. **`useNodeTextContent()`** (7 tests ✅)
   - Location: `src/lib/utils/tiptap/use-node-text-content.svelte.ts`
   - Purpose: Reactive utility for extracting text content from ProseMirror nodes
   - Saves: ~10 lines per component
   - Implementation: Uses `$state` + `$effect` pattern (not `$derived.by()` since it can't be returned from functions)

4. **`useOptimisticState()`** (12 tests ✅)
   - Location: `src/lib/utils/tiptap/use-optimistic-state.svelte.ts`
   - Purpose: Optimistic UI updates for immediate feedback during async operations
   - Saves: ~15 lines per component
   - Features: Auto-clear after configurable delay, get/set/clear/has methods

5. **`useReactiveNode()`** (7 tests ✅) ⭐ **CRITICAL**
   - Location: `src/lib/utils/tiptap/use-reactive-node.svelte.ts`
   - Purpose: Workaround for svelte-tiptap's reactivity bug
   - Saves: ~40 lines per component
   - **Most important utility** - fixes core issue where Svelte components don't re-render when node attributes change

---

## 📊 Before/After Comparison

### Before (222 lines)
```svelte
<script lang="ts">
  import { onMount } from "svelte";

  // 40 lines of manual reactivity workaround
  let currentNode = $state<ProseMirrorNode>(node);
  let updateCounter = $state(0);

  onMount(() => {
    const handleUpdate = () => {
      const pos = getPos();
      if (typeof pos === "number") {
        try {
          const updatedNode = editor.state.doc.nodeAt(pos);
          if (updatedNode && updatedNode.type === currentNode.type) {
            if (updatedNode.attrs.checked !== currentNode.attrs.checked ||
                updatedNode.attrs.status !== currentNode.attrs.status) {
              currentNode = updatedNode;
              updateCounter++;
            }
          }
        } catch (e) {}
      }
    };
    editor.on("update", handleUpdate);
    return () => editor.off("update", handleUpdate);
  });

  // 10 lines for text content extraction
  let taskText = $derived.by(() => {
    const pos = getPos();
    if (typeof pos !== "number") return "";
    try {
      return editor.state.doc.textBetween(pos, pos + node.nodeSize, " ", " ");
    } catch {
      return "";
    }
  });

  // 2 lines for unique IDs
  let anchorName = $state(`task-menu-anchor-${Math.random().toString(36).substring(2, 11)}`);
  let popoverId = $state(`task-menu-${Math.random().toString(36).substring(2, 11)}`);

  // 15+ lines for attribute updates
  function handleCheckboxClick(event: MouseEvent) {
    const pos = getPos();
    if (typeof pos === "number") {
      editor.chain().focus().command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          checked: newChecked,
          status: newStatus,
        });
        return true;
      }).run();
    }
  }
</script>
```

### After (177 lines)
```svelte
<script lang="ts">
  import { useReactiveNode } from "$lib/utils/tiptap/use-reactive-node.svelte";
  import { useNodeTextContent } from "$lib/utils/tiptap/use-node-text-content.svelte";
  import { useOptimisticState } from "$lib/utils/tiptap/use-optimistic-state.svelte";
  import { updateNodeAttributes } from "$lib/utils/tiptap/node-attributes";
  import { generateUniqueIds } from "$lib/utils/tiptap/unique-id";

  // 1 line - reactive node
  const reactiveNode = useReactiveNode(node, editor, getPos, ["checked", "status"]);

  // 1 line - optimistic state
  const optimistic = useOptimisticState<{ checked: boolean; status: string }>();

  // Derive final state
  let checked = $derived(optimistic.get("checked") ?? reactiveNode.value.attrs.checked);
  let status = $derived(optimistic.get("status") ?? (reactiveNode.value.attrs.status || "todo"));

  // 1 line - text content
  const taskTextContent = useNodeTextContent(reactiveNode.value, editor, getPos);
  let taskText = $derived(taskTextContent.value);

  // 1 line - unique IDs
  const ids = generateUniqueIds(["task-menu-anchor", "task-menu"]);

  // Clean attribute updates
  function handleCheckboxClick(event: MouseEvent) {
    optimistic.set({ checked: newChecked, status: newStatus });
    updateNodeAttributes(editor, getPos, reactiveNode.value, {
      checked: newChecked,
      status: newStatus,
    });
  }
</script>
```

---

## ✅ Testing

All tests pass successfully:

```bash
pnpm test src/lib/utils/tiptap --run
```

**Results**:
- ✅ `unique-id.test.ts`: 10/10 passing
- ✅ `node-attributes.test.ts`: 6/6 passing
- ✅ `use-node-text-content.test.ts`: 7/7 passing
- ✅ `use-optimistic-state.test.ts`: 12/12 passing
- ✅ `use-reactive-node.test.ts`: 7/7 passing

**Total**: 42/42 tests passing ✅

---

## 🚀 Next Steps

These utilities are now ready to be used for migrating other TipTap extensions:

1. **MentionSuggestionWrapper.svelte** (MEDIUM priority)
   - 167 lines of manual component mounting
   - Could benefit from similar utility patterns

2. **CommentAnchor.ts** (LOW priority)
   - 25 lines, simple invisible span
   - May not need utilities

---

## 📁 Files Created/Modified

### New Utility Files
- `src/lib/utils/tiptap/unique-id.ts` (67 lines)
- `src/lib/utils/tiptap/node-attributes.ts` (68 lines)
- `src/lib/utils/tiptap/use-node-text-content.svelte.ts` (77 lines)
- `src/lib/utils/tiptap/use-optimistic-state.svelte.ts` (127 lines)
- `src/lib/utils/tiptap/use-reactive-node.svelte.ts` (106 lines)

### New Test Files
- `src/lib/utils/tiptap/__tests__/unique-id.test.ts`
- `src/lib/utils/tiptap/__tests__/node-attributes.test.ts`
- `src/lib/utils/tiptap/__tests__/use-node-text-content.test.ts`
- `src/lib/utils/tiptap/__tests__/TestUseNodeTextContent.test.svelte`
- `src/lib/utils/tiptap/__tests__/use-optimistic-state.test.ts`
- `src/lib/utils/tiptap/__tests__/use-reactive-node.test.ts`
- `src/lib/utils/tiptap/__tests__/TestUseReactiveNode.test.svelte`

### Modified Files
- `src/lib/components/tiptap/TaskItemNodeView.svelte` (222 → 177 lines)

---

## 🎓 Key Learnings

1. **`$derived.by()` limitations**: Can't be used in function returns - must use `$state` + `$effect` pattern instead
2. **Utility design**: Clean, focused utilities with single responsibilities are easier to test and maintain
3. **Test strategy**: Mock editor behavior for unit tests, use real editor for integration tests
4. **Reactivity workaround**: The `useReactiveNode()` utility is essential until svelte-tiptap fixes its reactivity bug

---

## 📚 Related Documentation

- **Original Analysis**: `docs/investigations/svelte-tiptap-migration-analysis.md`
- **Migration Proposal**: `docs/investigations/custom-task-item-migration-proposal.md`
- **Implementation Review**: `docs/investigations/svelte-tiptap-implementation-summary.md`
- **Utilities Proposal**: `docs/investigations/svelte-tiptap-utilities-proposal.md`
