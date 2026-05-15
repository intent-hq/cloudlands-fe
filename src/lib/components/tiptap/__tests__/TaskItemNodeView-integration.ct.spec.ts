import {
  test,
  expect,
} from '@playwright/experimental-ct-svelte';
import TipTapEditorTestHarness from './TipTapEditorTestHarness.svelte';

/**
 * Integration tests for TaskItemNodeView with real TipTap editor
 *
 * These tests mount a real TipTap editor in the browser and verify that:
 * 1. Task items render with visible text content
 * 2. Checkboxes are interactive and update state
 * 3. The 3-state cycle works (todo → in-progress → done → todo)
 */

test.describe('TaskItemNodeView Integration', () => {
  test('should render task items with visible text content', async ({ mount }) => {
    // Mount the TipTap editor with default content (3 task items)
    const component = await mount(TipTapEditorTestHarness);

    // Wait for editor to render
    await component.page().waitForTimeout(200);

    // Check that all task items are rendered
    const taskItems = component.locator('[data-type="taskItem"]');
    await expect(taskItems).toHaveCount(3);

    // Check that text content is visible
    const contentDivs = component.locator('.task-item-content');
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
              <p>Click me</p>
            </li>
          </ul>
        `,
      },
    });

    // Wait for editor to render
    await component.page().waitForTimeout(200);

    // Find the checkbox
    const checkbox = component.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible();

    // Verify initial state (todo = unchecked, not indeterminate)
    await expect(checkbox).not.toBeChecked();

    // Click checkbox (todo → in-progress)
    await checkbox.click();

    // Wait for the data-status attribute to update
    await component.page().waitForTimeout(100);

    const taskItem = component.locator('[data-type="taskItem"]').first();
    const dataStatus = await taskItem.getAttribute('data-status');
    const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);

    expect(dataStatus).toBe('in-progress');
    expect(isIndeterminate).toBe(true);
  });

  test('should cycle through 3 states on checkbox clicks', async ({ mount }) => {
    const component = await mount(TipTapEditorTestHarness, {
      props: {
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false" data-status="todo">
              <p>Cycle me</p>
            </li>
          </ul>
        `,
      },
    });

    await component.page().waitForTimeout(200);

    const checkbox = component.locator('input[type="checkbox"]').first();

    // Initial state: todo (unchecked, not indeterminate)
    await expect(checkbox).not.toBeChecked();
    let isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
    expect(isIndeterminate).toBe(false);

    // Click 1: todo → in-progress (unchecked, indeterminate)
    await checkbox.click();
    await component.page().waitForTimeout(100);
    await expect(checkbox).not.toBeChecked();
    isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
    expect(isIndeterminate).toBe(true);

    // Click 2: in-progress → done (checked, not indeterminate)
    await checkbox.click();
    await component.page().waitForTimeout(100);
    await expect(checkbox).toBeChecked();
    isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
    expect(isIndeterminate).toBe(false);

    // Click 3: done → todo (unchecked, not indeterminate)
    await checkbox.click();
    await component.page().waitForTimeout(100);
    await expect(checkbox).not.toBeChecked();
    isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
    expect(isIndeterminate).toBe(false);
  });

  test('should preserve text content after checkbox clicks', async ({ mount }) => {
    const component = await mount(TipTapEditorTestHarness, {
      props: {
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false" data-status="todo">
              <p>Important task text that should not disappear</p>
            </li>
          </ul>
        `,
      },
    });

    await component.page().waitForTimeout(200);

    const checkbox = component.locator('input[type="checkbox"]').first();
    const contentDiv = component.locator('.task-item-content').first();

    // Verify initial text is present
    await expect(contentDiv).toContainText('Important task text that should not disappear');

    // Click 1: todo → in-progress
    await checkbox.click();
    await component.page().waitForTimeout(100);

    // Text should still be there!
    await expect(contentDiv).toContainText('Important task text that should not disappear');

    // Click 2: in-progress → done
    await checkbox.click();
    await component.page().waitForTimeout(100);

    // Text should STILL be there!
    await expect(contentDiv).toContainText('Important task text that should not disappear');

    // Click 3: done → todo
    await checkbox.click();
    await component.page().waitForTimeout(100);

    // Text should STILL be there!
    await expect(contentDiv).toContainText('Important task text that should not disappear');
  });
});
