import { test, expect } from '@playwright/experimental-ct-svelte';
import TipTapEditorTestHarness from './TipTapEditorTestHarness.svelte';

/**
 * Integration tests for TaskItemNodeView with real TipTap editor
 *
 * These tests mount a real TipTap editor in the browser and verify that:
 * 1. Task items render with visible text content
 * 2. Checkboxes are interactive and update state
 * 3. The checkbox toggle works (todo → in-progress/checked → todo)
 */

test.describe('TaskItemNodeView Integration', () => {
  test('should render task items with visible text content', async ({ mount }) => {
    // Mount the TipTap editor with default content (3 task items)
    const component = await mount(TipTapEditorTestHarness);

    // Check that all task items are rendered
    const taskItems = component.locator('[data-type="taskItem"]');
    await expect(taskItems).toHaveCount(3);

    // Check that text content is rendered inside each node view content area
    const contentDivs = component.locator('[data-type="taskItem"] [data-node-view-content]');
    await expect(contentDivs).toHaveCount(3);

    // Verify each content div has visible text
    await expect(contentDivs.nth(0)).toContainText('Todo task');
    await expect(contentDivs.nth(1)).toContainText('In-progress task');
    await expect(contentDivs.nth(2)).toContainText('Done task');

    // Verify text is actually visible (not hidden by CSS)
    await expect(contentDivs.nth(0)).toBeVisible();
    await expect(contentDivs.nth(1)).toBeVisible();
    await expect(contentDivs.nth(2)).toBeVisible();
  });

  test('should have interactive checkboxes', async ({ mount }) => {
    const component = await mount(TipTapEditorTestHarness, {
      props: {
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false" data-status="todo">
              <div><p>Click me</p></div>
            </li>
          </ul>
        `,
      },
    });

    // Find the checkbox
    const checkbox = component.locator('[role="checkbox"]').first();
    await expect(checkbox).toBeVisible();

    // Verify initial state (todo = unchecked)
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');

    // Click checkbox (todo → in-progress, checked)
    await checkbox.click();

    const taskItem = component.locator('[data-type="taskItem"]').first();
    await expect(taskItem).toHaveAttribute('data-status', 'in-progress');
    await expect(component.locator('[role="checkbox"]').first()).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('should toggle between states on checkbox clicks', async ({ mount }) => {
    const component = await mount(TipTapEditorTestHarness, {
      props: {
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false" data-status="todo">
              <div><p>Toggle me</p></div>
            </li>
          </ul>
        `,
      },
    });

    const taskItem = component.locator('[data-type="taskItem"]').first();
    const checkbox = () => component.locator('[role="checkbox"]').first();

    // Initial state: todo (unchecked)
    await expect(checkbox()).toHaveAttribute('aria-checked', 'false');
    await expect(taskItem).toHaveAttribute('data-status', 'todo');

    // Click 1: todo → in-progress (checked)
    await checkbox().click();
    await expect(checkbox()).toHaveAttribute('aria-checked', 'true');
    await expect(taskItem).toHaveAttribute('data-status', 'in-progress');

    // Click 2: in-progress (checked) → todo (unchecked)
    await checkbox().click();
    await expect(checkbox()).toHaveAttribute('aria-checked', 'false');
    await expect(taskItem).toHaveAttribute('data-status', 'todo');
  });

  test('should preserve text content after checkbox clicks', async ({ mount }) => {
    const component = await mount(TipTapEditorTestHarness, {
      props: {
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false" data-status="todo">
              <div><p>Important task text that should not disappear</p></div>
            </li>
          </ul>
        `,
      },
    });

    const checkbox = () => component.locator('[role="checkbox"]').first();
    const contentDiv = component.locator('[data-type="taskItem"] [data-node-view-content]').first();

    // Verify initial text is present
    await expect(contentDiv).toContainText('Important task text that should not disappear');

    // Click 1: todo → in-progress (checked)
    await checkbox().click();

    // Text should still be there!
    await expect(contentDiv).toContainText('Important task text that should not disappear');

    // Click 2: in-progress (checked) → todo (unchecked)
    await checkbox().click();

    // Text should STILL be there!
    await expect(contentDiv).toContainText('Important task text that should not disappear');
  });
});
