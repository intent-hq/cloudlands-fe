/**
 * E2E Test Helper Utilities
 *
 * Common utilities and helpers for E2E tests
 */

import { Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Launch Electron application for testing
 */
export async function launchApp(
  options: {
    workspaceDir?: string;
    extraArgs?: string[];
    extraEnv?: Record<string, string>;
  } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [
      join(__dirname, '../dist/main/index.js'),
      '--no-sandbox',
      '--disable-gpu-sandbox',
      ...(options.extraArgs || []),
    ],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TESTING: 'true',
      TEST_WORKSPACE_DIR: options.workspaceDir || path.join(process.cwd(), '.test-workspaces'),
      ...(options.extraEnv || {}),
    },
  });

  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });

  return { app, page };
}

/**
 * Create a test workspace
 */
export async function createTestWorkspace(
  page: Page,
  name: string,
  workspacePath: string,
): Promise<void> {
  await page.click('[data-testid="new-workspace-btn"]');
  await page.fill('[data-testid="workspace-name-input"]', name);
  await page.fill('[data-testid="workspace-path-input"]', workspacePath);
  await page.click('[data-testid="create-workspace-btn"]');
  await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });
}

/**
 * Create a test agent
 */
export async function createTestAgent(
  page: Page,
  name: string,
  model: string = 'sonnet4.5',
): Promise<void> {
  await page.click('[data-testid="new-agent-btn"]');
  await page.fill('[data-testid="agent-name-input"]', name);
  await page.selectOption('[data-testid="agent-model-select"]', model);
  await page.click('[data-testid="create-agent-confirm-btn"]');
  await page.waitForTimeout(500); // Wait for agent to be created
}

/**
 * Send a message to the current agent
 */
export async function sendMessage(
  page: Page,
  message: string,
  waitForResponse: boolean = true,
): Promise<void> {
  const messageInput = page.locator('[data-testid="message-input"]');
  await messageInput.fill(message);
  await messageInput.press('Enter');

  if (waitForResponse) {
    await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });
    await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });
  }
}

/**
 * Wait for agent to start streaming
 */
export async function waitForStreaming(page: Page, timeout: number = 5000): Promise<void> {
  await page.waitForSelector('[data-streaming="true"]', { timeout });
}

/**
 * Wait for agent to finish streaming
 */
export async function waitForStreamingComplete(page: Page, timeout: number = 30000): Promise<void> {
  await page.waitForSelector('[data-streaming="false"]', { timeout });
}

/**
 * Get all messages from the current agent
 */
export async function getMessages(page: Page): Promise<string[]> {
  const messages = await page.locator('[data-message-id]').allTextContents();
  return messages;
}

/**
 * Switch to a specific agent by name
 */
export async function switchToAgent(page: Page, agentName: string): Promise<void> {
  const agentItem = page.locator('[data-testid="agent-list-item"]').filter({ hasText: agentName });
  await agentItem.click();
  await page.waitForTimeout(200); // Wait for UI to update
}

/**
 * Get performance metrics from the app
 */
export async function getPerformanceMetrics(page: Page): Promise<any> {
  return await page.evaluate(() =>
    // @ts-expect-error - Electron API not typed in test context
    window.electronAPI?.getPerformanceMetrics?.() || {},
  );
}

/**
 * Simulate network conditions
 */
export async function simulateNetworkCondition(
  page: Page,
  condition: 'offline' | 'slow' | 'fast',
): Promise<void> {
  switch (condition) {
    case 'offline':
      await page.context().setOffline(true);
      break;
    case 'slow':
      await page.context().setOffline(false);
      // Simulate slow 3G
      await page.evaluate(() => {
        // @ts-expect-error - Electron API not typed in test context
        window.electronAPI?.setNetworkThrottling?.({
          downloadThroughput: 50 * 1024, // 50 KB/s
          uploadThroughput: 20 * 1024, // 20 KB/s
          latency: 2000, // 2 seconds
        });
      });
      break;
    case 'fast':
    default:
      await page.context().setOffline(false);
      // Reset network throttling
      await page.evaluate(() => {
        // @ts-expect-error - Electron API not typed in test context
        window.electronAPI?.setNetworkThrottling?.(null);
      });
      break;
  }
}

/**
 * Clean up test workspace
 */
export async function cleanupTestWorkspace(workspacePath: string): Promise<void> {
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Take a screenshot with metadata
 */
export async function takeScreenshot(
  page: Page,
  name: string,
  metadata?: Record<string, any>,
): Promise<void> {
  const screenshotDir = path.join(process.cwd(), 'e2e-reports', 'screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${name}-${timestamp}.png`;
  const filepath = path.join(screenshotDir, filename);

  await page.screenshot({ path: filepath, fullPage: true });

  // Save metadata if provided
  if (metadata) {
    const metadataPath = filepath.replace('.png', '.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }
}

/**
 * Wait for a specific number of agents to be streaming
 */
export async function waitForConcurrentStreaming(
  page: Page,
  count: number,
  timeout: number = 10000,
): Promise<void> {
  await page.waitForFunction(
    (expectedCount) => {
      const streaming = document.querySelectorAll('[data-agent-streaming="true"]');
      return streaming.length >= expectedCount;
    },
    count,
    { timeout },
  );
}

/**
 * Get memory usage from the app
 */
export async function getMemoryUsage(page: Page): Promise<number> {
  return await page.evaluate(() => {
    // @ts-expect-error - Electron API not typed in test context
    if (window.performance && window.performance.memory) {
      // @ts-expect-error - Electron API not typed in test context
      return window.performance.memory.usedJSHeapSize / 1024 / 1024; // Convert to MB
    }
    return 0;
  });
}

/**
 * Simulate agent crash
 */
export async function simulateAgentCrash(page: Page, agentId?: string): Promise<void> {
  await page.evaluate((id) => {
    // @ts-expect-error - Electron API not typed in test context
    window.electronAPI?.simulateAgentCrash?.(id);
  }, agentId);
}

/**
 * Wait for error recovery
 */
export async function waitForErrorRecovery(page: Page, timeout: number = 10000): Promise<void> {
  await page.waitForSelector('[data-testid="agent-recovered"]', { timeout });
}

/**
 * Create test files in workspace
 */
export async function createTestFiles(
  page: Page,
  files: Array<{ name: string; content: string }>,
): Promise<void> {
  for (const file of files) {
    await page.click('[data-testid="new-file-btn"]');
    await page.fill('[data-testid="file-name-input"]', file.name);
    await page.fill('[data-testid="file-content-input"]', file.content);
    await page.click('[data-testid="save-file-btn"]');
    await page.waitForTimeout(200);
  }
}

/**
 * Measure operation time
 */
export async function measureTime<T>(
  operation: () => Promise<T>,
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await operation();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Assert performance threshold
 */
export function assertPerformance(actualTime: number, maxTime: number, operation: string): void {
  if (actualTime > maxTime) {
    throw new Error(
      `Performance threshold exceeded for ${operation}: ${actualTime}ms > ${maxTime}ms`,
    );
  }
}

/**
 * Get agent count
 */
export async function getAgentCount(page: Page): Promise<number> {
  const agents = page.locator('[data-testid="agent-list-item"]');
  return await agents.count();
}

/**
 * Check if agent is streaming
 */
export async function isAgentStreaming(page: Page, agentName?: string): Promise<boolean> {
  if (agentName) {
    const agent = page.locator('[data-testid="agent-list-item"]').filter({ hasText: agentName });
    const streaming = await agent.getAttribute('data-agent-streaming');
    return streaming === 'true';
  } else {
    const streaming = await page.locator('[data-streaming="true"]').isVisible();
    return streaming;
  }
}
