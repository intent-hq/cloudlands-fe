# TaskItemNodeView TDD - Quick Start Guide

## Overview

This guide walks you through the TDD process for migrating CustomTaskItem to svelte-tiptap. Follow these steps in order.

---

## Prerequisites

```bash
# Ensure dependencies are installed
pnpm install

# Verify test setup works
pnpm test:run --reporter=verbose
pnpm playwright test --list
```

---

## Phase 1: Component Unit Tests (30 minutes)

### 1.1 Create Test File

```bash
touch src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts
```

### 1.2 Write First Test (Red)

Copy this starter test:

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import TaskItemNodeView from '../TaskItemNodeView.svelte';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

function createMockProps(overrides = {}) {
  return {
    node: {
      attrs: { checked: false, status: 'todo' },
      nodeSize: 10,
      toJSON: () => ({ type: 'taskItem', attrs: { checked: false, status: 'todo' } }),
    } as unknown as ProseMirrorNode,
    editor: {
      state: { doc: { textBetween: vi.fn(() => 'Task text') } },
      isEditable: true,
    } as any,
    getPos: vi.fn(() => 0),
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    ...overrides,
  };
}

describe('TaskItemNodeView - Basic Rendering', () => {
  it('should render a list item with checkbox', () => {
    const props = createMockProps();
    const { container } = render(TaskItemNodeView, { props });

    const listItem = container.querySelector('li.custom-task-item-container');
    expect(listItem).toBeTruthy();

    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
  });
});
```

### 1.3 Run Test (Should Fail)

```bash
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts --reporter=verbose
```

Expected: ❌ Test fails because component doesn't exist

### 1.4 Create Component Skeleton (Green)

```bash
touch src/lib/components/tiptap/TaskItemNodeView.svelte
```

Minimal implementation:

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

  let checked = $derived(node.attrs.checked);
  let status = $derived(node.attrs.status || "todo");
</script>

<li class="custom-task-item-container">
  <div class="flex items-start gap-2 py-1">
    <label class="task-item-checkbox-wrapper">
      <input type="checkbox" {checked} class="task-item-checkbox" />
    </label>

    <div class="task-item-content" data-node-view-content />

    <button class="task-item-menu-button">⋮</button>
  </div>
</li>
```

### 1.5 Run Test Again (Should Pass)

```bash
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts --reporter=verbose
```

Expected: ✅ Test passes

### 1.6 Add More Tests

Add tests from the full TDD plan (see `task-item-tdd-plan.md`):
- Checkbox states (unchecked, checked, indeterminate)
- Checkbox cycling (todo → in-progress → done → todo)
- Menu button attributes
- Reactivity

Run tests after each addition:
```bash
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts --reporter=verbose
```

---

## Phase 2: Playwright Tests (45 minutes)

### 2.1 Create Test Harness

```bash
touch test/task-item-node-view-harness.html
```

Copy harness template from `task-item-tdd-plan.md` or use this minimal version:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TaskItemNodeView Test Harness</title>
  <link rel="stylesheet" href="../src/app.css">
  <script type="module">
    import { mount } from 'svelte';
    import TaskItemNodeView from '../src/lib/components/tiptap/TaskItemNodeView.svelte';

    window.mountTaskItem = (props) => {
      const target = document.getElementById('app');
      target.innerHTML = '';
      return mount(TaskItemNodeView, { target, props });
    };
  </script>
</head>
<body>
  <div id="app"></div>
</body>
</html>
```

### 2.2 Create Playwright Test

```bash
touch test/task-item-node-view.spec.ts
```

Start with one test:

```typescript
import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('TaskItemNodeView - Browser Tests', () => {
  test('should render with correct visual appearance', async ({ page }) => {
    const harnessPath = path.join(__dirname, 'task-item-node-view-harness.html');
    await page.goto(`file://${harnessPath}`);

    await page.evaluate(() => {
      window.mountTaskItem({
        node: { attrs: { checked: false, status: 'todo' } },
        editor: { state: { doc: { textBetween: () => 'Test task' } } },
        getPos: () => 0,
        updateAttributes: () => {},
      });
    });

    const listItem = page.locator('li.custom-task-item-container');
    await expect(listItem).toBeVisible();
  });
});
```

### 2.3 Run Playwright Test

```bash
pnpm playwright test test/task-item-node-view.spec.ts
```

### 2.4 Add Visual Tests

Add tests for:
- Hover states (menu button visibility)
- CSS Anchor Positioning
- Checkbox interactions

---

## Phase 3: Integration Tests (1 hour)

### 3.1 Update Extension to Use svelte-tiptap

```typescript
// src/lib/components/tiptap/CustomTaskItem.ts
import { TaskItem } from "@tiptap/extension-task-item";
import { SvelteNodeViewRenderer } from "svelte-tiptap";
import TaskItemNodeView from "./TaskItemNodeView.svelte";

export const CustomTaskItem = TaskItem.extend({
  name: "taskItem",

  addNodeView() {
    return SvelteNodeViewRenderer(TaskItemNodeView);
  },

  // Keep all existing: addOptions, addAttributes, addCommands, addKeyboardShortcuts
});
```

### 3.2 Create Integration Test

```bash
touch src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts
```

Start with basic editor integration test (see full plan for complete tests).

### 3.3 Run Integration Tests

```bash
pnpm vitest run src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts --reporter=verbose
```

### 3.4 Run Existing Tests

Make sure existing CustomTaskItem tests still pass:

```bash
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemInProgress.test.ts --reporter=verbose
```

---

## Verification Checklist

After completing all phases:

```bash
# Run all unit tests
pnpm test:run --reporter=verbose

# Run all Playwright tests
pnpm playwright test

# Run specific test files
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts
pnpm vitest run src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemInProgress.test.ts
```

### Success Criteria

- [ ] All new unit tests pass
- [ ] All Playwright tests pass
- [ ] All integration tests pass
- [ ] Existing TaskItemInProgress tests pass
- [ ] No console errors in Playwright tests
- [ ] Visual appearance matches current implementation

---

## Troubleshooting

### Test fails with "Cannot find module"
```bash
# Check import paths
# Ensure aliases are configured in vitest.config.ts
```

### Playwright test fails to load harness
```bash
# Check file path in test
# Ensure harness HTML is valid
# Check browser console for errors
```

### Component doesn't render in tests
```bash
# Check that props match expected interface
# Verify mock functions are properly typed
# Check for console errors
```

### svelte-tiptap not working
```bash
# Verify svelte-tiptap is installed
pnpm list svelte-tiptap

# Check import path
# Ensure SvelteNodeViewRenderer is imported correctly
```

---

## Next Steps After TDD

1. **Manual testing** - Test in actual app
2. **Performance testing** - Compare before/after
3. **Documentation** - Update component docs
4. **Code review** - Get team feedback
5. **Merge** - Create PR with test results

---

## Resources

- Full TDD Plan: `task-item-tdd-plan.md`
- Migration Proposal: `custom-task-item-migration-proposal.md`
- Analysis: `svelte-tiptap-migration-analysis.md`
