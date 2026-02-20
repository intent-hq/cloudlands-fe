# TaskItemNodeView TDD Plan

## Overview

Test-driven development plan for migrating CustomTaskItem to svelte-tiptap. We'll develop `TaskItemNodeView.svelte` in isolation using unit tests and Playwright tests before integration.

---

## Testing Strategy

### Phase 1: Component Unit Tests (Vitest + @testing-library/svelte)
Test the Svelte component in isolation with mocked TipTap props.

### Phase 2: Playwright "Unit" Tests
Test DOM rendering, measurements, and interactions in a real browser with minimal TipTap setup.

### Phase 3: Integration Tests (Vitest + TipTap)
Test the full extension with TipTap editor, markdown round-trips, and keyboard shortcuts.

---

## Phase 1: Component Unit Tests (Vitest)

**File**: `src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts`

### Test Setup Pattern
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TaskItemNodeView from '../TaskItemNodeView.svelte';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// Mock TipTap props
function createMockProps(overrides = {}) {
  return {
    node: {
      attrs: {
        checked: false,
        status: 'todo',
      },
      nodeSize: 10,
      toJSON: () => ({ type: 'taskItem', attrs: { checked: false, status: 'todo' } }),
    } as unknown as ProseMirrorNode,
    editor: {
      state: {
        doc: {
          textBetween: vi.fn(() => 'Task text'),
        },
      },
      isEditable: true,
    } as any,
    getPos: vi.fn(() => 0),
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    ...overrides,
  };
}
```

### Test Cases

#### 1.1 Basic Rendering
```typescript
describe('TaskItemNodeView - Basic Rendering', () => {
  it('should render a list item with checkbox', () => {
    const props = createMockProps();
    const { container } = render(TaskItemNodeView, { props });

    const listItem = container.querySelector('li.custom-task-item-container');
    expect(listItem).toBeTruthy();

    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
  });

  it('should render unchecked checkbox for todo status', () => {
    const props = createMockProps();
    const { container } = render(TaskItemNodeView, { props });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(false);
  });

  it('should render checked checkbox for done status', () => {
    const props = createMockProps({
      node: {
        attrs: { checked: true, status: 'done' },
        nodeSize: 10,
        toJSON: () => ({ type: 'taskItem', attrs: { checked: true, status: 'done' } }),
      },
    });
    const { container } = render(TaskItemNodeView, { props });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('should render indeterminate checkbox for in-progress status', () => {
    const props = createMockProps({
      node: {
        attrs: { checked: false, status: 'in-progress' },
        nodeSize: 10,
        toJSON: () => ({ type: 'taskItem', attrs: { checked: false, status: 'in-progress' } }),
      },
    });
    const { container } = render(TaskItemNodeView, { props });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.indeterminate).toBe(true);
  });

  it('should render contentDOM placeholder', () => {
    const props = createMockProps();
    const { container } = render(TaskItemNodeView, { props });

    const contentDOM = container.querySelector('[data-node-view-content]');
    expect(contentDOM).toBeTruthy();
  });

  it('should render menu button', () => {
    const props = createMockProps();
    const { container } = render(TaskItemNodeView, { props });

    const menuButton = container.querySelector('.task-item-menu-button');
    expect(menuButton).toBeTruthy();
  });
});
```

#### 1.2 Checkbox State Cycling
```typescript
describe('TaskItemNodeView - Checkbox Cycling', () => {
  it('should cycle from todo to in-progress on click', async () => {
    const updateAttributes = vi.fn();
    const props = createMockProps({ updateAttributes });
    const { container } = render(TaskItemNodeView, { props });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await fireEvent.click(checkbox);

    expect(updateAttributes).toHaveBeenCalledWith({
      checked: false,
      status: 'in-progress',
    });
  });

  it('should cycle from in-progress to done on click', async () => {
    const updateAttributes = vi.fn();
    const props = createMockProps({
      updateAttributes,
      node: {
        attrs: { checked: false, status: 'in-progress' },
        nodeSize: 10,
        toJSON: () => ({ type: 'taskItem', attrs: { checked: false, status: 'in-progress' } }),
      },
    });
    const { container } = render(TaskItemNodeView, { props });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await fireEvent.click(checkbox);

    expect(updateAttributes).toHaveBeenCalledWith({
      checked: true,
      status: 'done',
    });
  });

  it('should cycle from done to todo on click', async () => {
    const updateAttributes = vi.fn();
    const props = createMockProps({
      updateAttributes,
      node: {
        attrs: { checked: true, status: 'done' },
        nodeSize: 10,
        toJSON: () => ({ type: 'taskItem', attrs: { checked: true, status: 'done' } }),
      },
    });
    const { container } = render(TaskItemNodeView, { props });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await fireEvent.click(checkbox);

    expect(updateAttributes).toHaveBeenCalledWith({
      checked: false,
      status: 'todo',
    });
  });
});
```

#### 1.3 Menu Button Data Attributes
```typescript
describe('TaskItemNodeView - Menu Button', () => {
  it('should set popover attributes on menu button', () => {
    const props = createMockProps();
    const { container } = render(TaskItemNodeView, { props });

    const menuButton = container.querySelector('.task-item-menu-button') as HTMLElement;
    expect(menuButton.getAttribute('popovertarget')).toBeTruthy();
    expect(menuButton.getAttribute('data-anchor-name')).toBeTruthy();
    expect(menuButton.getAttribute('data-popover-id')).toBeTruthy();
  });

  it('should include task data in menu button attributes', () => {
    const props = createMockProps();
    const { container } = render(TaskItemNodeView, { props });

    const menuButton = container.querySelector('.task-item-menu-button') as HTMLElement;
    expect(menuButton.getAttribute('data-task-position')).toBe('0');
    expect(menuButton.getAttribute('data-task-checked')).toBe('false');
    expect(menuButton.getAttribute('data-task-text')).toBe('Task text');
  });
});
```

#### 1.4 Reactivity Tests
```typescript
describe('TaskItemNodeView - Reactivity', () => {
  it('should update checkbox when node attrs change', async () => {
    const props = createMockProps();
    const { container, component } = render(TaskItemNodeView, { props });

    // Update props
    await component.$set({
      node: {
        attrs: { checked: true, status: 'done' },
        nodeSize: 10,
        toJSON: () => ({ type: 'taskItem', attrs: { checked: true, status: 'done' } }),
      },
    });

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
```

**Run Tests**:
```bash
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts --reporter=verbose
```

---

## Phase 2: Playwright "Unit" Tests

**File**: `test/task-item-node-view.spec.ts`
**Harness**: `test/task-item-node-view-harness.html`

### Why Playwright for Component Tests?
- Test real DOM rendering (not jsdom)
- Test CSS Anchor Positioning (not available in jsdom)
- Test Popover API (not available in jsdom)
- Test visual appearance and measurements
- Test hover states and transitions

### Test Harness Pattern
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TaskItemNodeView Test Harness</title>
  <script type="module">
    import { mount } from 'svelte';
    import TaskItemNodeView from '../src/lib/components/tiptap/TaskItemNodeView.svelte';

    // Expose mount function for tests
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

### Playwright Test Cases

```typescript
import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('TaskItemNodeView - Browser Tests', () => {
  test.beforeEach(async ({ page }) => {
    const harnessPath = path.join(__dirname, 'task-item-node-view-harness.html');
    await page.goto(`file://${harnessPath}`);
  });

  test('should render with correct visual appearance', async ({ page }) => {
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

    const checkbox = page.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
  });

  test('should show menu button on hover', async ({ page }) => {
    await page.evaluate(() => {
      window.mountTaskItem({
        node: { attrs: { checked: false, status: 'todo' } },
        editor: { state: { doc: { textBetween: () => 'Test task' } } },
        getPos: () => 0,
        updateAttributes: () => {},
      });
    });

    const listItem = page.locator('li.custom-task-item-container');
    const menuButton = page.locator('.task-item-menu-button');

    // Menu button should be hidden initially
    await expect(menuButton).toHaveCSS('opacity', '0');

    // Hover over list item
    await listItem.hover();

    // Menu button should become visible
    await expect(menuButton).toHaveCSS('opacity', '1');
  });

  test('should apply CSS anchor positioning', async ({ page }) => {
    await page.evaluate(() => {
      window.mountTaskItem({
        node: { attrs: { checked: false, status: 'todo' } },
        editor: { state: { doc: { textBetween: () => 'Test task' } } },
        getPos: () => 0,
        updateAttributes: () => {},
      });
    });

    const menuButton = page.locator('.task-item-menu-button');
    const anchorName = await menuButton.evaluate((el) =>
      getComputedStyle(el).anchorName
    );

    expect(anchorName).toMatch(/--task-menu-anchor-/);
  });

  test('should handle checkbox click interaction', async ({ page }) => {
    let updateCalled = false;

    await page.exposeFunction('onUpdate', (attrs) => {
      updateCalled = true;
      return attrs;
    });

    await page.evaluate(() => {
      window.mountTaskItem({
        node: { attrs: { checked: false, status: 'todo' } },
        editor: { state: { doc: { textBetween: () => 'Test task' } } },
        getPos: () => 0,
        updateAttributes: (attrs) => window.onUpdate(attrs),
      });
    });

    const checkbox = page.locator('input[type="checkbox"]');
    await checkbox.click();

    // Wait for update to be called
    await page.waitForFunction(() => window.updateCalled === true);
  });
});
```

**Run Tests**:
```bash
pnpm playwright test test/task-item-node-view.spec.ts
```

---

## Phase 3: Integration Tests (Vitest + TipTap)

**File**: `src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts`

### Test Setup Pattern
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { CustomTaskItem } from '../CustomTaskItem';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';

describe('CustomTaskItem - Integration', () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    const container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    document.body.innerHTML = '';
  });

  // Tests...
});
```

### Integration Test Cases

#### 3.1 Basic Editor Integration
```typescript
it('should render task items in editor', () => {
  const container = document.body.querySelector('div')!;

  editor = new Editor({
    element: container,
    extensions: [
      StarterKit,
      TaskList,
      CustomTaskItem,
    ],
    content: '<ul data-type="taskList"><li data-type="taskItem">Task 1</li></ul>',
  });

  const taskItem = container.querySelector('li[data-type="taskItem"]');
  expect(taskItem).toBeTruthy();

  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox).toBeTruthy();
});
```

#### 3.2 Checkbox Click Updates Node
```typescript
it('should update node attributes on checkbox click', () => {
  const container = document.body.querySelector('div')!;

  editor = new Editor({
    element: container,
    extensions: [StarterKit, TaskList, CustomTaskItem],
    content: '<ul data-type="taskList"><li data-type="taskItem" data-status="todo">Task</li></ul>',
  });

  const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
  checkbox.click();

  // Check that node attributes updated
  const taskNode = editor.state.doc.firstChild?.firstChild;
  expect(taskNode?.attrs.status).toBe('in-progress');
  expect(taskNode?.attrs.checked).toBe(false);
});
```

#### 3.3 Markdown Round-Trip
```typescript
it('should preserve task status through markdown round-trip', async () => {
  const markdown = '- [ ] Todo task\n- [~] In-progress task\n- [x] Done task';
  const html = await processMarkdownToHTML(markdown);

  const container = document.body.querySelector('div')!;
  editor = new Editor({
    element: container,
    extensions: [StarterKit, TaskList, CustomTaskItem],
    content: html,
  });

  // Check that all three states are preserved
  const taskItems = container.querySelectorAll('li[data-type="taskItem"]');
  expect(taskItems).toHaveLength(3);

  const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
  expect(checkboxes[0].checked).toBe(false);
  expect(checkboxes[0].indeterminate).toBe(false);

  expect(checkboxes[1].checked).toBe(false);
  expect(checkboxes[1].indeterminate).toBe(true);

  expect(checkboxes[2].checked).toBe(true);
});
```

#### 3.4 Keyboard Shortcuts
```typescript
it('should toggle task with Mod-Enter', () => {
  const container = document.body.querySelector('div')!;

  editor = new Editor({
    element: container,
    extensions: [StarterKit, TaskList, CustomTaskItem],
    content: '<ul data-type="taskList"><li data-type="taskItem">Task</li></ul>',
  });

  // Focus editor and position cursor in task
  editor.commands.focus();
  editor.commands.setTextSelection(1);

  // Simulate Mod-Enter
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    metaKey: true,
    bubbles: true,
  });
  editor.view.dom.dispatchEvent(event);

  // Check that task toggled
  const taskNode = editor.state.doc.firstChild?.firstChild;
  expect(taskNode?.attrs.status).toBe('in-progress');
});
```

**Run Tests**:
```bash
pnpm vitest run src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts --reporter=verbose
```

---

## TDD Workflow

### Step 1: Write Component Unit Tests (Red)
```bash
# Create test file
touch src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts

# Write tests (they will fail - component doesn't exist yet)
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts
```

### Step 2: Create Component (Green)
```bash
# Create component file
touch src/lib/components/tiptap/TaskItemNodeView.svelte

# Implement component to pass tests
pnpm vitest run src/lib/components/tiptap/__tests__/TaskItemNodeView.test.ts
```

### Step 3: Write Playwright Tests (Red)
```bash
# Create harness and test
touch test/task-item-node-view-harness.html
touch test/task-item-node-view.spec.ts

# Run tests (may fail on CSS/visual aspects)
pnpm playwright test test/task-item-node-view.spec.ts
```

### Step 4: Refine Component (Green)
```bash
# Fix CSS, hover states, anchor positioning
pnpm playwright test test/task-item-node-view.spec.ts
```

### Step 5: Write Integration Tests (Red)
```bash
# Create integration test
touch src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts

# Write tests (will fail - extension not updated yet)
pnpm vitest run src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts
```

### Step 6: Update Extension (Green)
```bash
# Update CustomTaskItem.ts to use SvelteNodeViewRenderer
# Run integration tests
pnpm vitest run src/lib/components/tiptap/__tests__/CustomTaskItem.integration.test.ts
```

### Step 7: Run All Tests
```bash
# Run all tests to ensure nothing broke
pnpm test:run
pnpm playwright test
```

---

## Success Criteria

- [ ] All component unit tests pass (Phase 1)
- [ ] All Playwright tests pass (Phase 2)
- [ ] All integration tests pass (Phase 3)
- [ ] Existing CustomTaskItem tests still pass
- [ ] Markdown round-trip works
- [ ] Keyboard shortcuts work
- [ ] Visual appearance matches current implementation
- [ ] No performance regression

---

## Next Steps

1. **Review this TDD plan** with team
2. **Start with Phase 1** - Component unit tests
3. **Iterate through phases** following TDD workflow
4. **Document learnings** for future migrations
