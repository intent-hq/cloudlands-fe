import { test, expect } from '@playwright/experimental-ct-svelte';
import TaskItemNodeView from '../TaskItemNodeView.svelte';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';

// Helper to create mock props
function createMockProps(overrides: any = {}) {
  const defaultNode = {
    attrs: { checked: false, status: 'todo' },
    nodeSize: 10,
    toJSON: () => ({ type: 'taskItem', attrs: { checked: false, status: 'todo' } }),
  } as unknown as ProseMirrorNode;

  const defaultEditor = {
    state: {
      doc: {
        textBetween: () => 'Task text',
      },
    },
    isEditable: true,
  } as unknown as Editor;

  return {
    node: overrides.node || defaultNode,
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
      await expect(component.locator('input[type="checkbox"]')).toBeVisible();
    });

    test('should render content area with data-node-view-content', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps(),
      });

      // The content area exists but might be empty (no actual content in test)
      const contentArea = component.locator('[data-node-view-content]');
      await expect(contentArea).toBeAttached();
    });

    test('should render menu button', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps(),
      });

      await expect(component.locator('.task-item-menu-button')).toBeVisible();
    });
  });

  test.describe('Checkbox States', () => {
    test('todo task should have unchecked checkbox', async ({ mount }) => {
      const props = createMockProps({
        node: {
          attrs: { checked: false, status: 'todo' },
          nodeSize: 10,
          toJSON: () => ({ type: 'taskItem', attrs: { checked: false, status: 'todo' } }),
        },
      });

      const component = await mount(TaskItemNodeView, { props });
      const checkbox = component.locator('input[type="checkbox"]');

      await expect(checkbox).not.toBeChecked();

      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(false);
    });

    test('in-progress task should have indeterminate checkbox', async ({ mount }) => {
      const props = createMockProps({
        node: {
          attrs: { checked: false, status: 'in-progress' },
          nodeSize: 10,
          toJSON: () => ({ type: 'taskItem', attrs: { checked: false, status: 'in-progress' } }),
        },
      });

      const component = await mount(TaskItemNodeView, { props });
      const checkbox = component.locator('input[type="checkbox"]');

      await expect(checkbox).not.toBeChecked();

      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(true);
    });

    test('done task should have checked checkbox', async ({ mount }) => {
      const props = createMockProps({
        node: {
          attrs: { checked: true, status: 'done' },
          nodeSize: 10,
          toJSON: () => ({ type: 'taskItem', attrs: { checked: true, status: 'done' } }),
        },
      });

      const component = await mount(TaskItemNodeView, { props });
      const checkbox = component.locator('input[type="checkbox"]');

      await expect(checkbox).toBeChecked();

      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(false);
    });
  });

  test.describe('Checkbox Cycling', () => {
    test('should cycle from todo to in-progress on click', async ({ mount }) => {
      let currentAttrs = { checked: false, status: 'todo' };

      const props = createMockProps({
        node: {
          attrs: currentAttrs,
          nodeSize: 10,
          toJSON: () => ({ type: 'taskItem', attrs: currentAttrs }),
        },
        updateAttributes: (attrs: any) => {
          currentAttrs = { ...currentAttrs, ...attrs };
        },
      });

      const component = await mount(TaskItemNodeView, { props });
      const checkbox = component.locator('input[type="checkbox"]');

      // Initial state
      await expect(checkbox).not.toBeChecked();

      // Click checkbox
      await checkbox.click();

      // Verify updateAttributes was called with correct values
      expect(currentAttrs.status).toBe('in-progress');
      expect(currentAttrs.checked).toBe(false);
    });

    test('should cycle from in-progress to done on click', async ({ mount }) => {
      let currentAttrs = { checked: false, status: 'in-progress' };

      const props = createMockProps({
        node: {
          attrs: currentAttrs,
          nodeSize: 10,
          toJSON: () => ({ type: 'taskItem', attrs: currentAttrs }),
        },
        updateAttributes: (attrs: any) => {
          currentAttrs = { ...currentAttrs, ...attrs };
        },
      });

      const component = await mount(TaskItemNodeView, { props });
      const checkbox = component.locator('input[type="checkbox"]');

      // Initial state: indeterminate
      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(true);

      // Click checkbox
      await checkbox.click();

      // Verify updateAttributes was called with correct values
      expect(currentAttrs.status).toBe('done');
      expect(currentAttrs.checked).toBe(true);
    });

    test('should cycle from done to todo on click', async ({ mount }) => {
      let currentAttrs = { checked: true, status: 'done' };

      const props = createMockProps({
        node: {
          attrs: currentAttrs,
          nodeSize: 10,
          toJSON: () => ({ type: 'taskItem', attrs: currentAttrs }),
        },
        updateAttributes: (attrs: any) => {
          currentAttrs = { ...currentAttrs, ...attrs };
        },
      });

      const component = await mount(TaskItemNodeView, { props });
      const checkbox = component.locator('input[type="checkbox"]');

      // Initial state: checked
      await expect(checkbox).toBeChecked();

      // Click checkbox
      await checkbox.click();

      // Verify updateAttributes was called with correct values
      expect(currentAttrs.status).toBe('todo');
      expect(currentAttrs.checked).toBe(false);
    });
  });

  test.describe('Visual Appearance', () => {
    test('done task should have task-checked class', async ({ mount }) => {
      const props = createMockProps({
        node: {
          attrs: { checked: true, status: 'done' },
          nodeSize: 10,
          toJSON: () => ({ type: 'taskItem', attrs: { checked: true, status: 'done' } }),
        },
      });

      const component = await mount(TaskItemNodeView, { props });

      await expect(component).toHaveClass(/task-checked/);
    });

    test('menu button should have correct popover attributes', async ({ mount }) => {
      const component = await mount(TaskItemNodeView, {
        props: createMockProps(),
      });

      const menuButton = component.locator('.task-item-menu-button');

      // Should have popovertarget attribute
      const popovertarget = await menuButton.getAttribute('popovertarget');
      expect(popovertarget).toBeTruthy();
      expect(popovertarget).toMatch(/^task-menu-/);
    });
  });
});
