import { test, expect } from '@playwright/experimental-ct-svelte';
import TaskItemNodeView from '../TaskItemNodeView.svelte';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';

// Helper to create a mock ProseMirror node. `content` needs a forEach so the
// linked-task-note-id derivation can walk it (empty = plain inline task).
function createMockNode(attrs: Record<string, unknown> = { checked: false, status: 'todo' }) {
  return {
    attrs,
    nodeSize: 10,
    textContent: 'Task text',
    content: { size: 0, forEach: () => {} },
    toJSON: () => ({ type: 'taskItem', attrs }),
  } as unknown as ProseMirrorNode;
}

// Helper to create mock props
function createMockProps(overrides: any = {}) {
  const defaultEditor = {
    state: {
      doc: {
        textBetween: () => 'Task text',
      },
    },
    isEditable: true,
  } as unknown as Editor;

  return {
    node: overrides.node || createMockNode(),
    editor: overrides.editor || defaultEditor,
    getPos: overrides.getPos || (() => 0),
    updateAttributes: overrides.updateAttributes || (() => {}),
    deleteNode: overrides.deleteNode || (() => {}),
  };
}

test.describe('TaskItemNodeView - Playwright Component Tests', () => {
  test.describe('Basic Rendering', () => {
    test('should render task item with checkbox', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps(),
      });

      // The component itself is the <li> with data-type="taskItem"
      await expect(component).toHaveAttribute('data-type', 'taskItem');
      await expect(component.locator('[role="checkbox"]')).toBeVisible();
    });

    test('should render content area with data-node-view-content', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps(),
      });

      // The content area exists but might be empty (no actual content in test)
      const contentArea = component.locator('[data-node-view-content]');
      await expect(contentArea).toBeAttached();
    });

    test('should render convert-to-task-note action for unchecked tasks', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps(),
      });

      await expect(component.getByRole('button', { name: 'Convert to Task Note' })).toBeAttached();
    });
  });

  test.describe('Checkbox States', () => {
    test('todo task should have unchecked checkbox', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps({ node: createMockNode({ checked: false, status: 'todo' }) }),
      });

      await expect(component).toHaveAttribute('data-status', 'todo');
      await expect(component.locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'false');
    });

    test('in-progress task should stay unchecked with in-progress status', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps({
          node: createMockNode({ checked: false, status: 'in-progress' }),
        }),
      });

      await expect(component).toHaveAttribute('data-status', 'in-progress');
      await expect(component.locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'false');
    });

    test('done task should have checked checkbox', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps({ node: createMockNode({ checked: true, status: 'done' }) }),
      });

      await expect(component).toHaveAttribute('data-status', 'done');
      await expect(component.locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'true');
    });
  });

  test.describe('Checkbox Toggling', () => {
    test('should move from todo to in-progress on check', async ({ mount }) => {
      let currentAttrs: Record<string, unknown> = { checked: false, status: 'todo' };

      const component = await mount(TaskItemNodeView, {
        props: createMockProps({
          node: createMockNode(currentAttrs),
          updateAttributes: (attrs: any) => {
            currentAttrs = { ...currentAttrs, ...attrs };
          },
        }),
      });
      const checkbox = component.locator('[role="checkbox"]');

      // Initial state
      await expect(checkbox).toHaveAttribute('aria-checked', 'false');

      // Click checkbox
      await checkbox.click();

      // Verify updateAttributes was called with correct values
      await expect.poll(() => currentAttrs.status).toBe('in-progress');
      expect(currentAttrs.checked).toBe(true);
    });

    test('should move from in-progress to in-progress checked on check', async ({ mount }) => {
      let currentAttrs: Record<string, unknown> = { checked: false, status: 'in-progress' };

      const component = await mount(TaskItemNodeView, {
        props: createMockProps({
          node: createMockNode(currentAttrs),
          updateAttributes: (attrs: any) => {
            currentAttrs = { ...currentAttrs, ...attrs };
          },
        }),
      });
      const checkbox = component.locator('[role="checkbox"]');

      await expect(checkbox).toHaveAttribute('aria-checked', 'false');
      await checkbox.click();

      await expect.poll(() => currentAttrs.checked).toBe(true);
      expect(currentAttrs.status).toBe('in-progress');
    });

    test('should move from done back to todo on uncheck', async ({ mount }) => {
      let currentAttrs: Record<string, unknown> = { checked: true, status: 'done' };

      const component = await mount(TaskItemNodeView, {
        props: createMockProps({
          node: createMockNode(currentAttrs),
          updateAttributes: (attrs: any) => {
            currentAttrs = { ...currentAttrs, ...attrs };
          },
        }),
      });
      const checkbox = component.locator('[role="checkbox"]');

      // Initial state: checked
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');

      // Click checkbox
      await checkbox.click();

      // Verify updateAttributes was called with correct values
      await expect.poll(() => currentAttrs.status).toBe('todo');
      expect(currentAttrs.checked).toBe(false);
    });
  });

  test.describe('Visual Appearance', () => {
    test('done task should have task-checked class', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps({ node: createMockNode({ checked: true, status: 'done' }) }),
      });

      await expect(component).toHaveClass(/task-checked/);
    });

    test('checked task should not offer the convert-to-task-note action', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps({ node: createMockNode({ checked: true, status: 'done' }) }),
      });

      await expect(
        component.getByRole('button', { name: 'Convert to Task Note' }),
      ).not.toBeAttached();
    });
  });
});
