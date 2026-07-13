/**
 * Phase 2.3: TDD Tests for choiceQuestion Node
 *
 * This node represents the question text in a choice block.
 * It's simpler than choiceOption - just editable text, no selection state.
 *
 * Should reuse the same patterns from choiceOption.
 */

import {
  test,
  expect,
} from '@playwright/experimental-ct-svelte';
import ChoiceQuestionHarness from './ChoiceQuestionHarness.svelte';

test.describe('Phase 2.3: ChoiceQuestion Node (TDD)', () => {
  test.describe('Inline Text Editing', () => {
    test('should render with editable text content', async ({ mount }) => {
      const component = await mount(ChoiceQuestionHarness, {
        props: {
          initialText: 'What is your favorite color?',
        },
      });

      // Should show the question text
      await expect(component.getByText('What is your favorite color?')).toBeVisible();
    });

    test('CRITICAL: should NOT lose focus when typing', async ({ mount, page }) => {
      const component = await mount(ChoiceQuestionHarness, {
        props: {
          initialText: 'Original question',
        },
      });

      // Click the text to focus
      const editableText = component.locator('[data-testid="editable-content"]');
      await editableText.click();

      // Type some text
      await page.keyboard.type(' modified');

      // Verify text was added (focus was NOT lost)
      await expect(component.getByText(/Original question modified/)).toBeVisible();
    });

    test('should allow cursor positioning within text', async ({ mount, page }) => {
      const component = await mount(ChoiceQuestionHarness, {
        props: {
          initialText: 'Test question',
        },
      });

      const editableText = component.locator('[data-testid="editable-content"]');
      await editableText.click();

      // Move cursor to start
      await page.keyboard.press('Meta+ArrowLeft');
      await page.keyboard.type('Start: ');

      await expect(component.getByText(/Start: Test question/)).toBeVisible();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should support text selection with keyboard', async ({ mount, page }) => {
      const component = await mount(ChoiceQuestionHarness, {
        props: {
          initialText: 'Select this question',
        },
      });

      const editableText = component.locator('[data-testid="editable-content"]');
      await editableText.click();

      // Select all text
      await page.keyboard.press('Meta+a');

      // Type to replace
      await page.keyboard.type('New question');

      await expect(component.getByText('New question')).toBeVisible();
    });
  });

  test.describe('Undo/Redo', () => {
    test('should support undo/redo for text editing', async ({ mount, page }) => {
      const component = await mount(ChoiceQuestionHarness, {
        props: {
          initialText: 'Original',
        },
      });

      const editableText = component.locator('[data-testid="editable-content"]');
      await editableText.click();

      // Add text
      await page.keyboard.type(' added');
      await expect(component.getByText(/Original added/)).toBeVisible();

      // Undo
      await page.keyboard.press('Meta+z');
      await expect(component.getByText('Original')).toBeVisible();

      // Redo
      await page.keyboard.press('Meta+Shift+z');
      await expect(component.getByText(/Original added/)).toBeVisible();
    });
  });

  test.describe('Styling', () => {
    test('should render with question styling', async ({ mount }) => {
      const component = await mount(ChoiceQuestionHarness, {
        props: {
          initialText: 'Styled question',
        },
      });

      // Should have the choice-question class
      const questionElement = component.locator('[data-type="choice-question"]');
      await expect(questionElement).toBeVisible();
    });
  });
});
