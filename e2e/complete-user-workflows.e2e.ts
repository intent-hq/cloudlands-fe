/**
 * Complete User Workflow E2E Tests
 *
 * Tests end-to-end user journeys through the application
 * including workspace creation, agent interactions, and persistence
 */

import { test, expect, Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { promises as fs } from 'fs';
import * as path from 'path';

let app: ElectronApplication;
let page: Page;

const TEST_WORKSPACE_DIR = path.join(process.cwd(), '.test-workspaces');

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

  // Wait for the first window
  page = await app.firstWindow();

  // Wait for app to be ready
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });
});

test.afterAll(async () => {
  await app.close();

  // Clean up test workspace directory
  try {
    await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
});

test.describe('Complete User Workflows', () => {
  test('should complete full workspace creation and agent interaction workflow', async () => {
    // Step 1: Create a new workspace
    await page.click('[data-testid="new-workspace-btn"]');

    const workspaceName = `Test Workspace ${Date.now()}`;
    await page.fill('[data-testid="workspace-name-input"]', workspaceName);
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'workspace1'),
    );
    await page.click('[data-testid="create-workspace-btn"]');

    // Wait for workspace to load
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Verify workspace is created
    const workspaceTitle = await page.locator('[data-testid="workspace-title"]').textContent();
    expect(workspaceTitle).toContain(workspaceName);

    // Step 2: Create an initial agent
    await page.click('[data-testid="agent-panel-toggle"]');
    await page.waitForSelector('[data-testid="agent-panel"]', { state: 'visible' });

    // Verify initial agent is created automatically
    const agentList = page.locator('[data-testid="agent-list-item"]');
    await expect(agentList).toHaveCount(1);

    // Step 3: Send a message to the agent
    const messageInput = page.locator('[data-testid="message-input"]');
    await messageInput.fill('Hello, can you help me understand this workspace?');
    await messageInput.press('Enter');

    // Wait for response
    await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Verify message and response
    const messages = page.locator('[data-message-id]');
    await expect(messages).toHaveCount(2); // User message + assistant response

    // Step 4: Create a second agent from contextual menu
    await page.click('[data-testid="file-tree-toggle"]');
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible' });

    // Right-click on a file (simulate contextual menu)
    const fileItem = page.locator('[data-testid="file-item"]').first();
    await fileItem.click({ button: 'right' });

    await page.waitForSelector('[data-testid="context-menu"]', { state: 'visible' });
    await page.click('[data-testid="context-menu-create-agent"]');

    // Wait for new agent to be created
    await page.waitForTimeout(1000);
    const agentListAfter = page.locator('[data-testid="agent-list-item"]');
    await expect(agentListAfter).toHaveCount(2);

    // Step 5: Switch between agents
    const secondAgent = page.locator('[data-testid="agent-list-item"]').nth(1);
    await secondAgent.click();

    // Verify active agent changed
    await expect(secondAgent).toHaveAttribute('data-active', 'true');

    // Step 6: Send message to second agent
    await messageInput.fill('Analyze this file for potential improvements');
    await messageInput.press('Enter');

    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Step 7: Navigate back to workspace list
    await page.click('[data-testid="workspace-list-btn"]');
    await page.waitForSelector('[data-testid="workspace-list"]', { state: 'visible' });

    // Verify workspace appears in list
    const workspaceItem = page.locator(
      `[data-testid="workspace-item"][data-name="${workspaceName}"]`,
    );
    await expect(workspaceItem).toBeVisible();

    // Step 8: Reopen the workspace
    await workspaceItem.click();
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Step 9: Verify agents and messages are persisted
    const persistedAgents = page.locator('[data-testid="agent-list-item"]');
    await expect(persistedAgents).toHaveCount(2);

    // Check messages are restored
    const restoredMessages = page.locator('[data-message-id]');
    const messageCount = await restoredMessages.count();
    expect(messageCount).toBeGreaterThanOrEqual(4); // At least 2 exchanges

    // Step 10: Clean up - delete workspace
    await page.click('[data-testid="workspace-settings-btn"]');
    await page.click('[data-testid="delete-workspace-btn"]');
    await page.click('[data-testid="confirm-delete-btn"]');

    // Verify workspace is deleted
    await page.waitForSelector('[data-testid="workspace-list"]', { state: 'visible' });
    const deletedWorkspace = page.locator(
      `[data-testid="workspace-item"][data-name="${workspaceName}"]`,
    );
    await expect(deletedWorkspace).not.toBeVisible();
  });
});
