/**
 * Phase 2.4: Integration Tests for Complete Choice Block
 *
 * Tests all three nodes working together:
 * - ChoiceBlock (container)
 * - ChoiceQuestion (editable question)
 * - ChoiceOption (editable options with selection)
 *
 * This validates the full V2 architecture.
 */

import {
  test,
  expect,
} from '@playwright/experimental-ct-svelte';
import ChoiceBlockIntegrationHarness from './ChoiceBlockIntegrationHarness.svelte';

test.describe('Phase 2.4: Choice Block Integration (TDD)', () => {
  test.describe('Full Structure', () => {
    test('should render complete choice block with question and options', async ({ mount }) => {
      const component = await mount(ChoiceBlockIntegrationHarness, {
        props: {
          question: 'What is your favorite color?',
          options: [
            { text: 'Red', selected: false },
            { text: 'Blue', selected: true },
            { text: 'Green', selected: false },
          ],
        },
      });

      // Should show question
      await expect(component.getByText('What is your favorite color?')).toBeVisible();

      // Should show all options
      await expect(component.getByText('Red')).toBeVisible();
      await expect(component.getByText('Blue')).toBeVisible();
      await expect(component.getByText('Green')).toBeVisible();

      // Should show selection state
      const buttons = component.locator('.selection-button');
      await expect(buttons).toHaveCount(3);
    });
  });

  test.describe('Question Editing', () => {
    test('should allow editing question text', async ({ mount, page }) => {
      const component = await mount(ChoiceBlockIntegrationHarness, {
        props: {
          question: 'Original question',
          options: [{ text: 'Option A', selected: false }],
        },
      });

      // Click question to edit
      const question = component.locator('[data-type="choice-question"]');
      await question.click();

      // Add text
      await page.keyboard.press('Meta+ArrowRight');
      await page.keyboard.type(' modified');

      await expect(component.getByText(/Original question modified/)).toBeVisible();
    });
  });

  test.describe('Option Editing', () => {
    test('should allow editing option text', async ({ mount, page }) => {
      const component = await mount(ChoiceBlockIntegrationHarness, {
        props: {
          question: 'Test question',
          options: [{ text: 'Original option', selected: false }],
        },
      });

      // Click option text to edit
      const optionText = component.locator(
        '[data-type="choice-option"] [data-testid="editable-content"]',
      );
      await optionText.click();

      // Wait for selection transaction and restore focus
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const editor = (window as any).testEditor;
        if (editor) {
          editor.commands.focus('end');
        }
      });

      // Add text
      await page.keyboard.press('Meta+ArrowRight');
      await page.keyboard.type(' modified');

      await expect(component.getByText(/Original option modified/)).toBeVisible();
    });
  });

  test.describe('Selection Management', () => {
    test('should toggle option selection', async ({ mount }) => {
      const component = await mount(ChoiceBlockIntegrationHarness, {
        props: {
          question: 'Test question',
          options: [
            { text: 'Option A', selected: false },
            { text: 'Option B', selected: true },
          ],
        },
      });

      // Find first option's button
      const buttons = component.locator('.selection-button');
      const firstButton = buttons.first();

      // Should be unselected
      await expect(firstButton).toContainText('○');

      // Click to select
      await firstButton.click();

      // Should now be selected
      await expect(firstButton).toContainText('●');
    });

    test('CRITICAL: should enforce exclusive selection (radio button behavior)', async ({
      mount,
    }) => {
      const component = await mount(ChoiceBlockIntegrationHarness, {
        props: {
          question: 'Pick one color',
          options: [
            { text: 'Red', selected: false },
            { text: 'Blue', selected: true },
            { text: 'Green', selected: false },
          ],
        },
      });

      const buttons = component.locator('.selection-button');

      // Initially: Red=○, Blue=●, Green=○
      await expect(buttons.nth(0)).toContainText('○');
      await expect(buttons.nth(1)).toContainText('●');
      await expect(buttons.nth(2)).toContainText('○');

      // Click Red (first option)
      await buttons.nth(0).click();

      // Now: Red=●, Blue=○, Green=○ (Blue should be deselected)
      await expect(buttons.nth(0)).toContainText('●');
      await expect(buttons.nth(1)).toContainText('○');
      await expect(buttons.nth(2)).toContainText('○');

      // Click Green (third option)
      await buttons.nth(2).click();

      // Now: Red=○, Blue=○, Green=● (Red should be deselected)
      await expect(buttons.nth(0)).toContainText('○');
      await expect(buttons.nth(1)).toContainText('○');
      await expect(buttons.nth(2)).toContainText('●');

      // Click Blue (second option)
      await buttons.nth(1).click();

      // Now: Red=○, Blue=●, Green=○ (Green should be deselected)
      await expect(buttons.nth(0)).toContainText('○');
      await expect(buttons.nth(1)).toContainText('●');
      await expect(buttons.nth(2)).toContainText('○');
    });

    test('CRITICAL: should preserve all text when toggling selections', async ({ mount, page }) => {
      const component = await mount(ChoiceBlockIntegrationHarness, {
        props: {
          question: 'Important question',
          options: [
            { text: 'Option A', selected: false },
            { text: 'Option B', selected: true },
          ],
        },
      });

      // Edit question - click at the end of the text
      const question = component.locator('[data-type="choice-question"]');
      const questionBox = await question.boundingBox();
      if (questionBox) {
        // Click near the end of the question text
        await page.mouse.click(
          questionBox.x + questionBox.width - 10,
          questionBox.y + questionBox.height / 2,
        );
      }

      await page.waitForTimeout(100);
      await page.keyboard.type(' edited');

      // Edit first option - use triple-click to select all, then type
      const firstOption = component.locator('[data-type="choice-option"]').first();
      const firstOptionText = firstOption.locator('[data-testid="editable-content"]');
      await firstOptionText.click({ clickCount: 3 }); // Triple-click to select all text

      // Wait for selection transaction
      await page.waitForTimeout(200);

      // Type the new text (will replace selected text)
      await page.keyboard.type('Option A edited');

      // Toggle selection on first option
      const firstButton = component.locator('.selection-button').first();
      await firstButton.click();

      // All text should still be there
      await expect(component.getByText(/Important question edited/)).toBeVisible();
      await expect(component.getByText(/Option A edited/)).toBeVisible();
      await expect(component.getByText('Option B')).toBeVisible();
    });
  });

  test.describe('Multiple Options', () => {
    test('should handle many options', async ({ mount }) => {
      const component = await mount(ChoiceBlockIntegrationHarness, {
        props: {
          question: 'Pick one',
          options: [
            { text: 'Option 1', selected: false },
            { text: 'Option 2', selected: false },
            { text: 'Option 3', selected: true },
            { text: 'Option 4', selected: false },
            { text: 'Option 5', selected: false },
          ],
        },
      });

      // Should show all options
      await expect(component.getByText('Option 1')).toBeVisible();
      await expect(component.getByText('Option 2')).toBeVisible();
      await expect(component.getByText('Option 3')).toBeVisible();
      await expect(component.getByText('Option 4')).toBeVisible();
      await expect(component.getByText('Option 5')).toBeVisible();

      // Should have 5 selection buttons
      const buttons = component.locator('.selection-button');
      await expect(buttons).toHaveCount(5);
    });
  });
});
