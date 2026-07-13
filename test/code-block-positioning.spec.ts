/**
 * Playwright test for code block line positioning
 *
 * This test verifies that the Range API correctly measures line positions
 * in syntax-highlighted code blocks, including handling of line wrapping.
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Code Block Line Positioning', () => {
  test('should accurately measure line positions in syntax-highlighted code blocks', async ({
    page,
  }) => {
    // Navigate to the test harness page
    const testPagePath = path.join(__dirname, 'code-block-positioning-harness.html');
    await page.goto(`file://${testPagePath}`);

    // Wait for the editor to be ready
    await page.waitForSelector('.tiptap');

    // Wait for syntax highlighting to be applied
    await page.waitForSelector('code .hljs-keyword', { timeout: 5000 });

    // Get the code block element
    const codeBlock = await page.locator('pre code').first();
    expect(await codeBlock.isVisible()).toBe(true);

    // Call the test function that's exposed on the page
    const result = await page.evaluate(() =>
      // @ts-expect-error - testCodeBlockPositioning is defined in the harness
      window.testCodeBlockPositioning(),
    );

    // Verify we got line positions
    expect(result.lineCount).toBeGreaterThan(0);
    expect(result.positions).toHaveLength(result.lineCount);

    // Verify each line has valid position data
    for (let i = 0; i < result.positions.length; i++) {
      const pos = result.positions[i];
      expect(pos.lineIndex).toBe(i);
      expect(pos.top).toBeGreaterThanOrEqual(0);
      expect(pos.height).toBeGreaterThan(0);

      // Verify lines are stacked vertically (each line starts after the previous)
      if (i > 0) {
        const prevPos = result.positions[i - 1];
        expect(pos.top).toBeGreaterThanOrEqual(prevPos.top);
      }
    }
  });

  test('should handle line wrapping correctly', async ({ page }) => {
    const testPagePath = path.join(__dirname, 'code-block-positioning-harness.html');
    await page.goto(`file://${testPagePath}`);

    await page.waitForSelector('.tiptap');
    await page.waitForSelector('code .hljs-keyword', { timeout: 5000 });

    // Resize the window to force line wrapping
    await page.setViewportSize({ width: 500, height: 800 });

    // Wait a bit for reflow
    await page.waitForTimeout(200);

    // Test the second code block which has a very long line
    const result = await page.evaluate(() =>
      // @ts-expect-error - Test harness function not typed
      window.testCodeBlockPositioning(1), // Second code block
    );

    // We should have 3 logical lines (from the source code)
    expect(result.lineCount).toBe(3);
    expect(result.positions).toHaveLength(3);

    // The key test: the middle line (index 1) should be TALLER than the others
    // because it wraps to multiple visual lines
    const line0 = result.positions[0]; // "const shortLine = "short";"
    const line1 = result.positions[1]; // Very long line that wraps
    const line2 = result.positions[2]; // "const anotherShortLine = "short";"

    // The wrapped line should be taller than the non-wrapped lines
    expect(line1.height).toBeGreaterThan(line0.height);
    expect(line1.height).toBeGreaterThan(line2.height);

    // Lines should still be stacked vertically
    expect(line1.top).toBeGreaterThan(line0.top);
    expect(line2.top).toBeGreaterThan(line1.top);

    // Line 2 should start after line 1 ends (accounting for wrapping)
    expect(line2.top).toBeGreaterThanOrEqual(line1.top + line1.height);
  });

  test('should handle SQL code block with -- comments', async ({ page }) => {
    const testPagePath = path.join(__dirname, 'code-block-positioning-harness.html');
    await page.goto(`file://${testPagePath}`);

    await page.waitForSelector('.tiptap');
    await page.waitForSelector('code', { timeout: 5000 });

    // Test the third code block (SQL)
    const result = await page.evaluate(() =>
      // @ts-expect-error - Test harness function not typed
      window.testCodeBlockPositioning(2), // Third code block
    );

    // Count the actual lines in the SQL code
    const sqlLines = `-- Get all meal plans for a date range
SELECT * FROM entries
WHERE type = 'meal_plan'
  AND date BETWEEN '2025-11-08' AND '2025-11-15'
ORDER BY date, json_extract(metadata, '$.meal_type');

-- Get recent meals (past 7 days, eaten status)
SELECT * FROM entries
WHERE type = 'meal_plan'
  AND date >= date('now', '-7 days')
  AND status = 'eaten'
ORDER BY date DESC;

-- Search recipes by tag
SELECT * FROM entries
WHERE type = 'recipe'
  AND tags LIKE '%chicken%'
ORDER BY json_extract(metadata, '$.name');

-- Get all timeless background entries (recipes, preferences, etc.)
SELECT * FROM entries
WHERE date IS NULL
ORDER BY type, created_at;`.split('\n');

    // We should have all the lines including those starting with --
    expect(result.lineCount).toBe(sqlLines.length);
    expect(result.positions).toHaveLength(sqlLines.length);

    // All lines should have valid positions
    for (let i = 0; i < result.positions.length; i++) {
      const pos = result.positions[i];
      expect(pos.lineIndex).toBe(i);
      expect(pos.top).toBeGreaterThanOrEqual(0);
      expect(pos.height).toBeGreaterThan(0);
    }
  });

  test('should handle code block with no attribution gracefully', async ({ page }) => {
    const testPagePath = path.join(__dirname, 'code-block-positioning-harness.html');
    await page.goto(`file://${testPagePath}`);

    await page.waitForSelector('.tiptap');
    await page.waitForSelector('code', { timeout: 5000 });

    // Test the fourth code block (no attribution)
    const result = await page.evaluate(() =>
      // @ts-expect-error - Test harness function not typed
      window.testCodeBlockPositioning(3), // Fourth code block
    );

    // Should still measure all lines correctly even without attribution
    expect(result.lineCount).toBe(4); // 4 lines in the code
    expect(result.positions).toHaveLength(4);

    // All lines should have valid positions
    for (let i = 0; i < result.positions.length; i++) {
      const pos = result.positions[i];
      expect(pos.lineIndex).toBe(i);
      expect(pos.top).toBeGreaterThanOrEqual(0);
      expect(pos.height).toBeGreaterThan(0);
    }
  });

  test('should reproduce and demonstrate sparse attribution bug', async ({ page }) => {
    const testPagePath = path.join(__dirname, 'code-block-positioning-harness.html');
    await page.goto(`file://${testPagePath}`);

    await page.waitForSelector('.tiptap');
    await page.waitForSelector('code', { timeout: 5000 });

    // Test the fifth code block (sparse attribution - missing first line)
    const result = await page.evaluate(() => {
      // Code block has 7 lines (0-6)
      // But line 0 is missing attribution
      // So we only have attribution for lines 1, 2, 3, 4, 5, 6
      const attributedLines = [1, 2, 3, 4, 5, 6]; // Missing line 0

      // @ts-expect-error - Test harness function not typed
      return window.testSparseAttribution(4, attributedLines); // Fifth code block
    });

    // This test demonstrates the bug by simulating what the old code did:
    // Using sequential index (0, 1, 2, 3, 4, 5) instead of actual line numbers (1, 2, 3, 4, 5, 6)

    expect(result.sparsePositions).toHaveLength(6);

    // The simulated bug: lineIndex is sequential (0, 1, 2, 3, 4, 5)
    expect(result.sparsePositions[0].lineIndex).toBe(0); // BUG: Should be 1
    expect(result.sparsePositions[1].lineIndex).toBe(1); // BUG: Should be 2
    expect(result.sparsePositions[2].lineIndex).toBe(2); // BUG: Should be 3

    // But the actual line numbers are 1, 2, 3, 4, 5, 6
    expect(result.sparsePositions[0].lineNum).toBe(1);
    expect(result.sparsePositions[1].lineNum).toBe(2);
    expect(result.sparsePositions[2].lineNum).toBe(3);
  });
});
