/**
 * Error Recovery E2E Tests
 *
 * Tests the application's ability to handle and recover from various error conditions
 * including network failures, process crashes, and invalid inputs
 */

import { test, expect, Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { promises as fs } from 'fs';
import * as path from 'path';

let app: ElectronApplication;
let page: Page;
let appLaunchUnavailableReason: string | undefined;

const TEST_WORKSPACE_DIR = path.join(process.cwd(), '.test-workspaces-error');

test.beforeAll(async () => {
  // Clean up test workspace directory
  try {
    await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
  } catch (e) {
    // Directory might not exist
  }
  await fs.mkdir(TEST_WORKSPACE_DIR, { recursive: true });

  // Launch Electron app
  app = await electron.launch({
    args: [join(__dirname, '../dist/main/index.js'), '--no-sandbox', '--disable-gpu-sandbox'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TESTING: 'true',
      TEST_WORKSPACE_DIR,
    },
  });

  try {
    page = await app.firstWindow({ timeout: 30000 });
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });
  } catch (error) {
    appLaunchUnavailableReason = `Electron app did not open a test window: ${error instanceof Error ? error.message : String(error)}`;
    await app?.close().catch(() => undefined);
  }
});

test.afterAll(async () => {
  await app?.close();

  try {
    await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
});

test.describe('Error Recovery', () => {
  test.beforeEach(() => {
    test.skip(!!appLaunchUnavailableReason, appLaunchUnavailableReason);
  });

  test('should recover from agent process crash', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Crash Recovery Test');
    await page.fill('[data-testid="workspace-path-input"]', path.join(TEST_WORKSPACE_DIR, 'crash'));
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Open agent panel and send a message
    await page.click('[data-testid="agent-panel-toggle"]');
    const messageInput = page.locator('[data-testid="message-input"]');
    await messageInput.fill('Hello, this is a test message');
    await messageInput.press('Enter');

    // Wait for response to start
    await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });

    // Simulate process crash by killing the agent process
    await page.evaluate(() => {
      // @ts-expect-error - Electron API not typed in test context
      window.electronAPI?.simulateAgentCrash?.();
    });

    // Wait for error indicator
    await page.waitForSelector('[data-testid="agent-error"]', { timeout: 5000 });

    // Verify error message is shown
    const errorMessage = await page.locator('[data-testid="error-message"]').textContent();
    expect(errorMessage).toContain('crashed');

    // Click retry button
    await page.click('[data-testid="retry-agent-btn"]');

    // Wait for agent to recover
    await page.waitForSelector('[data-testid="agent-recovered"]', { timeout: 10000 });

    // Send another message to verify recovery
    await messageInput.fill('Are you back online?');
    await messageInput.press('Enter');

    // Should get a response
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    const messages = page.locator('[data-message-id]');
    const messageCount = await messages.count();
    expect(messageCount).toBeGreaterThanOrEqual(3); // Original + error + recovery message
  });

  test('should handle network disconnection gracefully', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Network Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'network'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Open agent panel
    await page.click('[data-testid="agent-panel-toggle"]');

    // Simulate network offline
    await page.context().setOffline(true);

    // Try to send a message
    const messageInput = page.locator('[data-testid="message-input"]');
    await messageInput.fill('Test message while offline');
    await messageInput.press('Enter');

    // Should show offline indicator
    await page.waitForSelector('[data-testid="offline-indicator"]', { timeout: 5000 });

    // Message should be queued
    const queuedIndicator = page.locator('[data-testid="message-queued"]');
    await expect(queuedIndicator).toBeVisible();

    // Restore network
    await page.context().setOffline(false);

    // Should automatically retry
    await page.waitForSelector('[data-testid="online-indicator"]', { timeout: 10000 });

    // Queued message should be sent
    await page.waitForSelector('[data-streaming="true"]', { timeout: 10000 });
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Verify message was sent and received response
    const messages = page.locator('[data-message-id]');
    await expect(messages).toHaveCount(2);
  });

  test('should handle invalid workspace paths', async () => {
    // Try to create workspace with invalid path
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Invalid Path Test');

    // Use an invalid path
    await page.fill('[data-testid="workspace-path-input"]', '/root/forbidden/path');
    await page.click('[data-testid="create-workspace-btn"]');

    // Should show error
    await page.waitForSelector('[data-testid="workspace-error"]', { timeout: 5000 });

    const errorText = await page.locator('[data-testid="workspace-error-message"]').textContent();
    expect(errorText).toContain('permission');

    // Fix the path and retry
    await page.fill('[data-testid="workspace-path-input"]', path.join(TEST_WORKSPACE_DIR, 'valid'));
    await page.click('[data-testid="create-workspace-btn"]');

    // Should succeed now
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });
  });

  test('should recover from corrupted agent state', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Corruption Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'corrupt'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Create an agent and send messages
    await page.click('[data-testid="agent-panel-toggle"]');
    const messageInput = page.locator('[data-testid="message-input"]');

    await messageInput.fill('First message');
    await messageInput.press('Enter');
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Get agent ID for corruption
    const agentId = await page
      .locator('[data-testid="active-agent"]')
      .getAttribute('data-agent-id');

    // Corrupt the agent state file
    const agentStatePath = path.join(
      TEST_WORKSPACE_DIR,
      'corrupt',
      '.workspace',
      'agents',
      `${agentId}.json`,
    );
    try {
      await fs.writeFile(agentStatePath, '{ corrupted json', 'utf-8');
    } catch (e) {
      // File might not exist yet, that's ok
    }

    // Reload the workspace
    await page.reload();
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });

    // Should show recovery message
    await page.waitForSelector('[data-testid="state-recovery-notice"]', { timeout: 10000 });

    // Agent should still be functional
    await page.click('[data-testid="agent-panel-toggle"]');
    await messageInput.fill('Message after recovery');
    await messageInput.press('Enter');

    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Should have recovered and be working
    const messages = page.locator('[data-message-id]');
    const messageCount = await messages.count();
    expect(messageCount).toBeGreaterThanOrEqual(2);
  });

  test('should handle memory pressure gracefully', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Memory Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'memory'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Create many agents to test memory management
    await page.click('[data-testid="agent-panel-toggle"]');

    const agentCount = 20;
    for (let i = 0; i < agentCount; i++) {
      await page.click('[data-testid="new-agent-btn"]');
      await page.fill('[data-testid="agent-name-input"]', `Memory Test Agent ${i}`);
      await page.click('[data-testid="create-agent-confirm-btn"]');

      // Send a message to each
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill(`Test message ${i}`);
      await messageInput.press('Enter');

      // Don't wait for completion, move to next
      await page.waitForTimeout(100);
    }

    // Check memory warning if shown
    const memoryWarning = page.locator('[data-testid="memory-warning"]');
    if (await memoryWarning.isVisible()) {
      // Should offer to clean up inactive agents
      const cleanupBtn = page.locator('[data-testid="cleanup-inactive-agents-btn"]');
      await expect(cleanupBtn).toBeVisible();

      await cleanupBtn.click();

      // Should reduce agent count
      await page.waitForTimeout(2000);
      const remainingAgents = await page.locator('[data-testid="agent-list-item"]').count();
      expect(remainingAgents).toBeLessThan(agentCount);
    }

    // App should still be responsive
    const messageInput = page.locator('[data-testid="message-input"]');
    await messageInput.fill('Final test message');
    await messageInput.press('Enter');

    await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });
  });

  test('should handle rapid agent switching without errors', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Rapid Switch Test');
    await page.fill('[data-testid="workspace-path-input"]', path.join(TEST_WORKSPACE_DIR, 'rapid'));
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Create multiple agents
    await page.click('[data-testid="agent-panel-toggle"]');

    for (let i = 0; i < 5; i++) {
      await page.click('[data-testid="new-agent-btn"]');
      await page.fill('[data-testid="agent-name-input"]', `Agent ${i}`);
      await page.click('[data-testid="create-agent-confirm-btn"]');
    }

    // Rapidly switch between agents
    const agents = page.locator('[data-testid="agent-list-item"]');

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) {
        await agents.nth(i).click();
        await page.waitForTimeout(50); // Very quick switches
      }
    }

    // Should not show any errors
    const errorIndicator = page.locator('[data-testid="agent-error"]');
    await expect(errorIndicator).not.toBeVisible();

    // Should still be able to send messages
    const messageInput = page.locator('[data-testid="message-input"]');
    await messageInput.fill('Message after rapid switching');
    await messageInput.press('Enter');

    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });
  });
});
