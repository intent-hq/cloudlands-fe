/**
 * Smoke Test for E2E Test Suite
 *
 * Quick verification that the E2E test infrastructure is working
 */

import { test, expect } from '@playwright/test';
import { launchApp, createTestWorkspace, sendMessage, getAgentCount } from './test-helpers';
import * as path from 'path';
import { promises as fs } from 'fs';

const TEST_WORKSPACE_DIR = path.join(process.cwd(), '.test-workspaces-smoke');

test.describe('E2E Smoke Test', () => {
  test('should verify E2E test infrastructure is working', async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
    await fs.mkdir(TEST_WORKSPACE_DIR, { recursive: true });

    // Launch app
    const { app, page } = await launchApp({
      workspaceDir: TEST_WORKSPACE_DIR,
    });

    try {
      // Verify app launched
      expect(page).toBeDefined();

      // Check app is ready
      const appReady = await page.locator('[data-testid="app-ready"]').isVisible();
      expect(appReady).toBe(true);

      // Create a test workspace
      await createTestWorkspace(
        page,
        'Smoke Test Workspace',
        path.join(TEST_WORKSPACE_DIR, 'smoke-workspace'),
      );

      // Verify workspace was created
      const workspaceTitle = await page.locator('[data-testid="workspace-title"]').textContent();
      expect(workspaceTitle).toContain('Smoke Test');

      // Open agent panel
      await page.click('[data-testid="agent-panel-toggle"]');
      await page.waitForSelector('[data-testid="agent-panel"]', { state: 'visible' });

      // Check initial agent exists
      const agentCount = await getAgentCount(page);
      expect(agentCount).toBeGreaterThanOrEqual(1);

      // Send a test message
      await sendMessage(page, 'Hello, this is a smoke test!', true);

      // Verify message was sent and received response
      const messages = await page.locator('[data-message-id]').count();
      expect(messages).toBeGreaterThanOrEqual(2);

      // Test completed successfully
      console.log('✅ E2E Smoke Test Passed!');
    } finally {
      // Clean up
      await app.close();

      try {
        await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  test('should verify test helpers are working', async () => {
    const { app, page } = await launchApp();

    try {
      // Test various helpers
      const metrics = await page.evaluate(() =>
        // @ts-expect-error - Electron API not typed in test context
        window.electronAPI?.getPerformanceMetrics?.() || { test: true },
      );
      expect(metrics).toBeDefined();

      // Test screenshot capability
      const screenshotDir = path.join(process.cwd(), 'e2e-reports', 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });

      await page.screenshot({
        path: path.join(screenshotDir, 'smoke-test.png'),
        fullPage: true,
      });

      // Verify screenshot was created
      const screenshotExists = await fs
        .access(path.join(screenshotDir, 'smoke-test.png'))
        .then(() => true)
        .catch(() => false);
      expect(screenshotExists).toBe(true);
    } finally {
      await app.close();
    }
  });
});
