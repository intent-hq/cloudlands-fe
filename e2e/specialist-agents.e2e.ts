/**
 * Specialist Agents E2E Tests
 *
 * NOTE: These tests are PLANNED but require data-testid attributes to be added
 * to the app components. Currently skipped.
 *
 * TODO: Add data-testid attributes to:
 * - [data-testid="app-ready"] - App ready state indicator
 * - [data-testid="new-workspace-btn"] - New workspace button
 * - [data-testid="workspace-name-input"] - Workspace name input
 * - [data-testid="workspace-path-input"] - Workspace path input
 * - [data-testid="create-workspace-btn"] - Create workspace button
 * - [data-testid="workspace-loaded"] - Workspace loaded indicator
 * - [data-testid="agent-panel-toggle"] - Agent panel toggle
 * - [data-testid="agent-panel"] - Agent panel container
 * - [data-testid="message-input"] - Message input field
 * - [data-testid="agent-list-item"] - Agent list items
 * - [data-testid="interrupt-btn"] - Interrupt button
 * - [data-testid="error-message"] - Error message container
 * - [data-streaming="true/false"] - Streaming state attribute
 * - [data-tool-executing="true/false"] - Tool execution state
 * - [data-message-id] - Message ID attribute
 * - [data-agent-model] - Agent model attribute
 *
 * Once these are added, remove the .skip from tests.
 */

import { test, expect, Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { promises as fs } from 'fs';
import * as path from 'path';

// Test configuration
const TEST_TIMEOUT = 60000;
const STREAMING_TIMEOUT = 30000;
const DELEGATION_TIMEOUT = 120000;

let app: ElectronApplication;
let page: Page;

const TEST_WORKSPACE_DIR = path.join(process.cwd(), '.test-workspaces-specialist');

// All tests are skipped until data-testid attributes are added to the app
test.describe.skip('Specialist Agent E2E Tests', () => {
  test.beforeAll(async () => {
    try {
      await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
    } catch (e) {
      // Directory might not exist
    }
    await fs.mkdir(TEST_WORKSPACE_DIR, { recursive: true });

    app = await electron.launch({
      args: [join(__dirname, '../dist/main/index.js'), '--no-sandbox', '--disable-gpu-sandbox'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TESTING: 'true',
        TEST_WORKSPACE_DIR,
      },
    });

    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }

    try {
      await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test.describe('Specialist Usage', () => {
    test('should default to implementor specialist for delegated tasks', async () => {
      await page.click('[data-testid="new-workspace-btn"]');
      await page.fill('[data-testid="workspace-name-input"]', 'Specialist Test');
      await page.fill(
        '[data-testid="workspace-path-input"]',
        path.join(TEST_WORKSPACE_DIR, 'specialist-test'),
      );
      await page.click('[data-testid="create-workspace-btn"]');
      await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

      await page.click('[data-testid="agent-panel-toggle"]');
      await page.waitForSelector('[data-testid="agent-panel"]', { state: 'visible' });

      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill(
        'Create a simple task and delegate it to a sub-agent. Use delegate_task with taskNoteId.',
      );
      await messageInput.press('Enter');

      await page.waitForSelector('[data-streaming="true"]', { timeout: 10000 });
      await page.waitForSelector('[data-streaming="false"]', { timeout: 60000 });

      const agentCount = await page.locator('[data-testid="agent-list-item"]').count();
      expect(agentCount).toBeGreaterThanOrEqual(1);

      if (agentCount > 1) {
        const delegatedAgent = page.locator('[data-testid="agent-list-item"]').nth(1);
        const agentModel = await delegatedAgent.getAttribute('data-agent-model');
        if (agentModel) {
          expect(agentModel.toLowerCase()).toContain('haiku');
        }
      }
    });

    test('should use verifier specialist for review tasks', async () => {
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill(
        'Create a verification task and delegate it using specialist="verifier".',
      );
      await messageInput.press('Enter');

      await page.waitForSelector('[data-streaming="true"]', { timeout: 10000 });
      await page.waitForSelector('[data-streaming="false"]', { timeout: 60000 });

      const hasError = await page.locator('[data-testid="error-message"]').isVisible();
      expect(hasError).toBe(false);
    });
  });

  test.describe('Stuck Prevention', () => {
    test('should not get stuck during delegation', async () => {
      const startTime = Date.now();
      const maxWaitTime = DELEGATION_TIMEOUT;

      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Simple delegation test: create a note and end turn.');
      await messageInput.press('Enter');

      let isComplete = false;
      while (Date.now() - startTime < maxWaitTime && !isComplete) {
        const streaming = await page.locator('[data-streaming="true"]').isVisible();
        if (!streaming) {
          isComplete = true;
        }
        await page.waitForTimeout(1000);
      }

      expect(isComplete).toBe(true);
      expect(Date.now() - startTime).toBeLessThan(maxWaitTime);
    });
  });

  test.describe('Interruption Handling', () => {
    test('should handle interruption during streaming', async () => {
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Write a very long response about the history of computing.');
      await messageInput.press('Enter');

      await page.waitForSelector('[data-streaming="true"]', { timeout: 10000 });
      await page.waitForTimeout(500);
      await page.click('[data-testid="interrupt-btn"]');

      await page.waitForSelector('[data-streaming="false"]', { timeout: 5000 });

      const hasError = await page.locator('[data-testid="error-message"]').isVisible();
      expect(hasError).toBe(false);

      await messageInput.fill('Are you still there?');
      await messageInput.press('Enter');

      await page.waitForSelector('[data-streaming="true"]', { timeout: 10000 });
      await page.waitForSelector('[data-streaming="false"]', { timeout: STREAMING_TIMEOUT });

      const messageCount = await page.locator('[data-message-id]').count();
      expect(messageCount).toBeGreaterThanOrEqual(3);
    });
  });

  test.describe('Wave-Based Delegation', () => {
    test('should support parallel delegation with wait_mode=after_all', async () => {
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill(
        'Create 3 independent tasks and delegate them all with wait_mode="after_all".',
      );
      await messageInput.press('Enter');

      await page.waitForSelector('[data-streaming="true"]', { timeout: 10000 });

      const startTime = Date.now();
      const maxWaitTime = 180000;

      let isComplete = false;
      while (Date.now() - startTime < maxWaitTime && !isComplete) {
        const streaming = await page.locator('[data-streaming="true"]').isVisible();
        if (!streaming) {
          isComplete = true;
        }
        await page.waitForTimeout(2000);
      }

      expect(isComplete).toBe(true);
    });
  });

  test.describe('Circular Delegation Prevention', () => {
    test('should not get stuck in circular delegation', async () => {
      const startTime = Date.now();
      const maxTestDuration = DELEGATION_TIMEOUT;

      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Create a complex task with subtasks. Delegate each appropriately.');
      await messageInput.press('Enter');

      await page.waitForSelector('[data-streaming="true"]', { timeout: 10000 });

      let completed = false;
      while (Date.now() - startTime < maxTestDuration) {
        const isStreaming = await page.locator('[data-streaming="true"]').isVisible();
        if (!isStreaming) {
          completed = true;
          break;
        }
        await page.waitForTimeout(2000);
      }

      expect(completed).toBe(true);
      expect(Date.now() - startTime).toBeLessThan(maxTestDuration);
    });
  });
});
