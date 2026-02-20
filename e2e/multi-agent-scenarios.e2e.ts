/**
 * Multi-Agent Scenarios E2E Tests
 *
 * Tests complex scenarios involving multiple agents working together,
 * concurrent operations, and agent coordination
 */

import { test, expect, Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { promises as fs } from 'fs';
import * as path from 'path';

let app: ElectronApplication;
let page: Page;

const TEST_WORKSPACE_DIR = path.join(process.cwd(), '.test-workspaces-multi');

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

  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });
});

test.afterAll(async () => {
  await app.close();

  try {
    await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
});

test.describe('Multi-Agent Scenarios', () => {
  test('should handle multiple agents concurrently', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Multi-Agent Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'multi-agent'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Open agent panel
    await page.click('[data-testid="agent-panel-toggle"]');
    await page.waitForSelector('[data-testid="agent-panel"]', { state: 'visible' });

    // Create multiple agents quickly
    const agentNames = ['Code Reviewer', 'Test Writer', 'Documentation', 'Performance Analyzer'];

    for (const name of agentNames) {
      await page.click('[data-testid="new-agent-btn"]');
      await page.fill('[data-testid="agent-name-input"]', name);
      await page.selectOption('[data-testid="agent-model-select"]', 'sonnet4.5');
      await page.click('[data-testid="create-agent-confirm-btn"]');
      await page.waitForTimeout(500); // Small delay between creations
    }

    // Verify all agents are created
    const agentList = page.locator('[data-testid="agent-list-item"]');
    await expect(agentList).toHaveCount(agentNames.length + 1); // +1 for initial agent

    // Send messages to multiple agents concurrently
    const messagePromises = [];

    for (let i = 0; i < agentNames.length; i++) {
      const agentItem = page.locator('[data-testid="agent-list-item"]').nth(i + 1);
      await agentItem.click();

      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill(
        `Agent ${i + 1}: Analyze the codebase for ${agentNames[i]} perspective`,
      );

      // Don't wait for response, just send
      messagePromises.push(messageInput.press('Enter'));
    }

    // Send all messages
    await Promise.all(messagePromises);

    // Wait for all agents to start streaming
    const streamingIndicators = page.locator('[data-agent-streaming="true"]');
    await expect(streamingIndicators).toHaveCount(agentNames.length, { timeout: 10000 });

    // Monitor concurrent streaming
    let maxConcurrent = 0;
    for (let i = 0; i < 10; i++) {
      const currentStreaming = await page.locator('[data-agent-streaming="true"]').count();
      maxConcurrent = Math.max(maxConcurrent, currentStreaming);
      await page.waitForTimeout(1000);
    }

    // Should handle at least 3 concurrent streams
    expect(maxConcurrent).toBeGreaterThanOrEqual(3);

    // Wait for all to complete
    await page.waitForFunction(
      () => document.querySelectorAll('[data-agent-streaming="true"]').length === 0,
      { timeout: 60000 },
    );

    // Verify all agents have responses
    for (let i = 0; i < agentNames.length; i++) {
      const agentItem = page.locator('[data-testid="agent-list-item"]').nth(i + 1);
      await agentItem.click();

      const messages = page.locator('[data-message-id]');
      const messageCount = await messages.count();
      expect(messageCount).toBeGreaterThanOrEqual(2); // At least user + assistant
    }
  });

  test('should coordinate agents with shared context', async () => {
    // Create a new workspace for this test
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Coordinated Agents');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'coordinated'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Create a code file first
    await page.click('[data-testid="new-file-btn"]');
    await page.fill('[data-testid="file-name-input"]', 'example.ts');
    await page.fill(
      '[data-testid="file-content-input"]',
      `
      function calculateSum(a: number, b: number): number {
        return a + b;
      }
    `,
    );
    await page.click('[data-testid="save-file-btn"]');

    // Create first agent to analyze the code
    await page.click('[data-testid="agent-panel-toggle"]');
    await page.click('[data-testid="new-agent-btn"]');
    await page.fill('[data-testid="agent-name-input"]', 'Code Analyzer');
    await page.click('[data-testid="create-agent-confirm-btn"]');

    // Analyze the file
    const messageInput = page.locator('[data-testid="message-input"]');
    await messageInput.fill('Analyze example.ts and identify potential improvements');
    await messageInput.press('Enter');
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Get the analysis result
    const analysisMessage = await page
      .locator('[data-message-role="assistant"]')
      .last()
      .textContent();
    expect(analysisMessage).toContain('function');

    // Create second agent that uses first agent's analysis
    await page.click('[data-testid="new-agent-btn"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Generator');

    // Add reference to first agent's analysis
    await page.click('[data-testid="add-context-reference"]');
    await page.selectOption('[data-testid="context-type-select"]', 'agent-message');
    await page.selectOption('[data-testid="agent-select"]', 'Code Analyzer');
    await page.click('[data-testid="confirm-context-btn"]');

    await page.click('[data-testid="create-agent-confirm-btn"]');

    // Ask second agent to create tests based on first agent's analysis
    await messageInput.fill('Based on the code analysis, write comprehensive unit tests');
    await messageInput.press('Enter');
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Verify second agent references first agent's work
    const testMessage = await page.locator('[data-message-role="assistant"]').last().textContent();
    expect(testMessage).toContain('test');
    expect(testMessage).toContain('calculateSum');

    // Create third agent that coordinates both
    await page.click('[data-testid="new-agent-btn"]');
    await page.fill('[data-testid="agent-name-input"]', 'Project Coordinator');
    await page.click('[data-testid="create-agent-confirm-btn"]');

    // Ask coordinator to summarize work from both agents
    await messageInput.fill('Summarize the work done by Code Analyzer and Test Generator agents');
    await messageInput.press('Enter');
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

    // Verify coordinator can see both agents' work
    const coordinatorMessage = await page
      .locator('[data-message-role="assistant"]')
      .last()
      .textContent();
    expect(coordinatorMessage?.toLowerCase()).toContain('analyzer');
    expect(coordinatorMessage?.toLowerCase()).toContain('test');
  });

  test('should handle agent switching during streaming', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Switch Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'switch'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Create two agents
    await page.click('[data-testid="agent-panel-toggle"]');

    await page.click('[data-testid="new-agent-btn"]');
    await page.fill('[data-testid="agent-name-input"]', 'Agent A');
    await page.click('[data-testid="create-agent-confirm-btn"]');

    await page.click('[data-testid="new-agent-btn"]');
    await page.fill('[data-testid="agent-name-input"]', 'Agent B');
    await page.click('[data-testid="create-agent-confirm-btn"]');

    // Start streaming on Agent A
    const agentA = page.locator('[data-testid="agent-list-item"]').filter({ hasText: 'Agent A' });
    await agentA.click();

    const messageInput = page.locator('[data-testid="message-input"]');
    await messageInput.fill('Write a long story about software development');
    await messageInput.press('Enter');

    // Wait for streaming to start
    await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });

    // Switch to Agent B while A is streaming
    const agentB = page.locator('[data-testid="agent-list-item"]').filter({ hasText: 'Agent B' });
    await agentB.click();

    // Verify Agent A continues streaming in background
    const agentAStreaming = await page
      .locator('[data-agent-id][data-agent-streaming="true"]')
      .first()
      .getAttribute('data-agent-id');
    expect(agentAStreaming).toBeTruthy();

    // Send message to Agent B
    await messageInput.fill('Quick calculation: what is 2+2?');
    await messageInput.press('Enter');

    // Both should be streaming
    const streamingAgents = await page.locator('[data-agent-streaming="true"]').count();
    expect(streamingAgents).toBe(2);

    // Switch back to Agent A
    await agentA.click();

    // Verify streaming indicator is still visible
    const streamingIndicator = page.locator('[data-streaming="true"]');
    await expect(streamingIndicator).toBeVisible();

    // Wait for both to complete
    await page.waitForFunction(
      () => document.querySelectorAll('[data-agent-streaming="true"]').length === 0,
      { timeout: 60000 },
    );

    // Verify both agents have complete messages
    await agentA.click();
    let messages = await page.locator('[data-message-id]').count();
    expect(messages).toBeGreaterThanOrEqual(2);

    await agentB.click();
    messages = await page.locator('[data-message-id]').count();
    expect(messages).toBeGreaterThanOrEqual(2);
  });
});
