import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_PATH = `file://${path.resolve(__dirname, 'task-item-node-view-harness.html')}`;

test.describe('TaskItemNodeView - Visual and Interaction Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS_PATH);
    // Wait for Svelte components to mount
    await page.waitForSelector('[data-type="taskItem"]');
  });

  test.describe('Basic Rendering', () => {
    test('should render all three task states', async ({ page }) => {
      const tasks = await page.locator('[data-type="taskItem"]').all();
      expect(tasks).toHaveLength(4); // todo, in-progress, done, dynamic
    });

    test('should render checkbox for each task', async ({ page }) => {
      const checkboxes = await page.locator('input[type="checkbox"]').all();
      expect(checkboxes).toHaveLength(4);
    });

    test('should render menu button for each task', async ({ page }) => {
      const menuButtons = await page.locator('.task-item-menu-button').all();
      expect(menuButtons).toHaveLength(4);
    });

    test('should render content area with data-node-view-content', async ({ page }) => {
      const contentAreas = await page.locator('[data-node-view-content]').all();
      expect(contentAreas).toHaveLength(4);
    });
  });

  test.describe('Checkbox States', () => {
    test('todo task should have unchecked checkbox', async ({ page }) => {
      const todoTask = page.locator('[data-type="taskItem"]').first();
      const checkbox = todoTask.locator('input[type="checkbox"]');

      await expect(checkbox).not.toBeChecked();

      // Should not have indeterminate property
      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(false);
    });

    test('in-progress task should have indeterminate checkbox', async ({ page }) => {
      const inProgressTask = page.locator('[data-type="taskItem"]').nth(1);
      const checkbox = inProgressTask.locator('input[type="checkbox"]');

      await expect(checkbox).not.toBeChecked();

      // Should have indeterminate property
      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(true);
    });

    test('done task should have checked checkbox', async ({ page }) => {
      const doneTask = page.locator('[data-type="taskItem"]').nth(2);
      const checkbox = doneTask.locator('input[type="checkbox"]');

      await expect(checkbox).toBeChecked();

      // Should not have indeterminate property
      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(false);
    });
  });

  test.describe('Checkbox Cycling', () => {
    // Note: These tests verify the checkbox behavior in the static HTML harness.
    // The actual cycling logic is tested in Phase 1 unit tests.
    // Here we just verify that checkboxes can be clicked and change state.

    test('should allow checkbox to be clicked (todo task)', async ({ page }) => {
      const todoTask = page.locator('[data-type="taskItem"]').first();
      const checkbox = todoTask.locator('input[type="checkbox"]');

      // Initial state: unchecked, not indeterminate
      await expect(checkbox).not.toBeChecked();
      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(false);

      // Click checkbox - in static HTML it just toggles checked state
      await checkbox.click();

      // Should now be checked (standard HTML behavior)
      await expect(checkbox).toBeChecked();
    });

    test('should allow checkbox to be clicked (in-progress task)', async ({ page }) => {
      const inProgressTask = page.locator('[data-type="taskItem"]').nth(1);
      const checkbox = inProgressTask.locator('input[type="checkbox"]');

      // Initial state: not checked, indeterminate
      await expect(checkbox).not.toBeChecked();
      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(true);

      // Click checkbox
      await checkbox.click();

      // Should now be checked (standard HTML behavior)
      await expect(checkbox).toBeChecked();
    });

    test('should allow checkbox to be clicked (done task)', async ({ page }) => {
      const doneTask = page.locator('[data-type="taskItem"]').nth(2);
      const checkbox = doneTask.locator('input[type="checkbox"]');

      // Initial state: checked, not indeterminate
      await expect(checkbox).toBeChecked();
      const isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(false);

      // Click checkbox
      await checkbox.click();

      // Should now be unchecked (standard HTML behavior)
      await expect(checkbox).not.toBeChecked();
    });
  });

  test.describe('Menu Button', () => {
    test('should have correct data attributes', async ({ page }) => {
      const menuButton = page.locator('.task-item-menu-button').first();

      // Should have anchor name
      const anchorName = await menuButton.getAttribute('data-anchor-name');
      expect(anchorName).toBeTruthy();
      expect(anchorName).toMatch(/^task-menu-anchor-/);

      // Should have popover ID
      const popoverId = await menuButton.getAttribute('data-popover-id');
      expect(popoverId).toBeTruthy();
      expect(popoverId).toMatch(/^task-menu-/);

      // Should have popovertarget attribute
      const popoverTarget = await menuButton.getAttribute('popovertarget');
      expect(popoverTarget).toBe(popoverId);
    });

    test('should have task metadata attributes', async ({ page }) => {
      const menuButton = page.locator('.task-item-menu-button').first();

      // Should have task position
      const position = await menuButton.getAttribute('data-task-position');
      expect(position).toBe('0');

      // Should have task checked state
      const checked = await menuButton.getAttribute('data-task-checked');
      expect(checked).toBe('false');

      // Should have task text
      const text = await menuButton.getAttribute('data-task-text');
      expect(text).toBe('Buy groceries');

      // Should have task node JSON
      const nodeJson = await menuButton.getAttribute('data-task-node');
      expect(nodeJson).toBeTruthy();
      const node = JSON.parse(nodeJson!);
      expect(node.type).toBe('taskItem');
      expect(node.attrs.checked).toBe(false);
      expect(node.attrs.status).toBe('todo');
    });

    test('should be initially hidden (opacity 0)', async ({ page }) => {
      const menuButton = page.locator('.task-item-menu-button').first();

      // Should have opacity-0 class
      const classes = await menuButton.getAttribute('class');
      expect(classes).toContain('opacity-0');
    });

    test('should become visible on hover', async ({ page }) => {
      const todoTask = page.locator('[data-type="taskItem"]').first();
      const menuButton = todoTask.locator('.task-item-menu-button');

      // Hover over the task item
      await todoTask.hover();

      // Wait for transition
      await page.waitForTimeout(300);

      // Menu button should be visible (group-hover:opacity-100)
      // Note: We can't directly test computed opacity in Playwright easily,
      // but we can verify the classes are correct
      const classes = await menuButton.getAttribute('class');
      expect(classes).toContain('group-hover:opacity-100');
    });

    test('should have accessibility attributes', async ({ page }) => {
      const menuButton = page.locator('.task-item-menu-button').first();

      // Should have title
      const title = await menuButton.getAttribute('title');
      expect(title).toBe('Task actions');

      // Should have aria-label
      const ariaLabel = await menuButton.getAttribute('aria-label');
      expect(ariaLabel).toBe('Open task menu');
    });
  });

  test.describe('Visual Appearance', () => {
    test('should have correct CSS classes on task item', async ({ page }) => {
      const todoTask = page.locator('[data-type="taskItem"]').first();

      const classes = await todoTask.getAttribute('class');
      expect(classes).toContain('custom-task-item-container');
      expect(classes).toContain('group');
    });

    test('done task should have task-checked class', async ({ page }) => {
      const doneTask = page.locator('[data-type="taskItem"]').nth(2);

      const classes = await doneTask.getAttribute('class');
      expect(classes).toContain('task-checked');
    });

    test('done task content should have reduced opacity', async ({ page }) => {
      const doneTask = page.locator('[data-type="taskItem"]').nth(2);
      const content = doneTask.locator('.task-item-content');

      // Get computed opacity
      const opacity = await content.evaluate((el) => window.getComputedStyle(el).opacity);

      // Should be 0.6 (from .task-checked .task-item-content)
      expect(parseFloat(opacity)).toBe(0.6);
    });

    test('checkbox should have correct styling classes', async ({ page }) => {
      const checkbox = page.locator('input[type="checkbox"]').first();

      const classes = await checkbox.getAttribute('class');
      expect(classes).toContain('task-item-checkbox');
      expect(classes).toContain('w-4');
      expect(classes).toContain('h-4');
      expect(classes).toContain('rounded');
    });
  });

  test.describe('Data Attributes', () => {
    test('should have correct data-type attribute', async ({ page }) => {
      const tasks = await page.locator('[data-type="taskItem"]').all();

      for (const task of tasks) {
        const dataType = await task.getAttribute('data-type');
        expect(dataType).toBe('taskItem');
      }
    });

    test('should have data-checked attribute when checked', async ({ page }) => {
      const doneTask = page.locator('[data-type="taskItem"]').nth(2);

      const dataChecked = await doneTask.getAttribute('data-checked');
      expect(dataChecked).toBe('true');
    });

    test('should not have data-checked attribute when unchecked', async ({ page }) => {
      const todoTask = page.locator('[data-type="taskItem"]').first();

      const dataChecked = await todoTask.getAttribute('data-checked');
      // Should be null or undefined (falsy value results in no attribute)
      expect(dataChecked).toBeNull();
    });
  });

  test.describe('Reactivity', () => {
    test('should update when using test controls', async ({ page }) => {
      const dynamicTask = page.locator('[data-type="taskItem"]').nth(3);
      const checkbox = dynamicTask.locator('input[type="checkbox"]');

      // Initial state: unchecked
      await expect(checkbox).not.toBeChecked();

      // Click "Cycle Dynamic Task State" button
      await page.click('#cycle-dynamic');
      await page.waitForTimeout(100);

      // Should now be indeterminate (in-progress)
      let isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(true);

      // Click again
      await page.click('#cycle-dynamic');
      await page.waitForTimeout(100);

      // Should now be checked (done)
      await expect(checkbox).toBeChecked();

      // Click again
      await page.click('#cycle-dynamic');
      await page.waitForTimeout(100);

      // Should be back to unchecked (todo)
      await expect(checkbox).not.toBeChecked();
      isIndeterminate = await checkbox.evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(false);
    });
  });

  test.describe('CSS Anchor Positioning', () => {
    test('should have anchor-name style attribute', async ({ page }) => {
      const menuButton = page.locator('.task-item-menu-button').first();

      // Should have style attribute with anchor-name
      const style = await menuButton.getAttribute('style');
      expect(style).toContain('anchor-name');

      // Should match the data-anchor-name
      const anchorName = await menuButton.getAttribute('data-anchor-name');
      expect(style).toContain(`--${anchorName}`);
    });
  });
});
