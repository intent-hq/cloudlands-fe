/**
 * Performance Under Load E2E Tests
 *
 * Tests the application's performance characteristics under various load conditions
 * including stress testing, memory usage, and response times
 */

import { test, expect, Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { promises as fs } from 'fs';
import * as path from 'path';

let app: ElectronApplication;
let page: Page;

const TEST_WORKSPACE_DIR = path.join(process.cwd(), '.test-workspaces-perf');

// Performance thresholds
const PERF_THRESHOLDS = {
  agentCreationTime: 2000, // 2 seconds
  messageResponseTime: 1000, // 1 second to start streaming
  workspaceLoadTime: 5000, // 5 seconds
  maxMemoryMB: 500, // 500MB max memory
  maxCPUPercent: 80, // 80% CPU usage
};

test.beforeAll(async () => {
  // Clean up test workspace directory
  try {
    await fs.rm(TEST_WORKSPACE_DIR, { recursive: true, force: true });
  } catch (e) {
    // Directory might not exist
  }
  await fs.mkdir(TEST_WORKSPACE_DIR, { recursive: true });

  // Launch Electron app with performance monitoring
  app = await electron.launch({
    args: [
      join(__dirname, '../dist/main/index.js'),
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--enable-precise-memory-info',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TESTING: 'true',
      TEST_WORKSPACE_DIR,
      ENABLE_PERFORMANCE_MONITORING: 'true',
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

test.describe('Performance Under Load', () => {
  test('should maintain performance with many agents', async () => {
    const startTime = Date.now();

    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Performance Test');
    await page.fill('[data-testid="workspace-path-input"]', path.join(TEST_WORKSPACE_DIR, 'perf'));
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    const workspaceLoadTime = Date.now() - startTime;
    expect(workspaceLoadTime).toBeLessThan(PERF_THRESHOLDS.workspaceLoadTime);

    // Open agent panel
    await page.click('[data-testid="agent-panel-toggle"]');

    // Create 50 agents and measure performance
    const agentCreationTimes: number[] = [];

    for (let i = 0; i < 50; i++) {
      const createStart = Date.now();

      await page.click('[data-testid="new-agent-btn"]');
      await page.fill('[data-testid="agent-name-input"]', `Perf Agent ${i}`);
      await page.click('[data-testid="create-agent-confirm-btn"]');

      // Wait for agent to be created
      await page.waitForSelector(`[data-testid="agent-list-item"]:nth-child(${i + 2})`, {
        timeout: 5000,
      });

      const createTime = Date.now() - createStart;
      agentCreationTimes.push(createTime);

      // Every 10 agents, check performance doesn't degrade
      if (i % 10 === 9) {
        const avgTime = agentCreationTimes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        expect(avgTime).toBeLessThan(PERF_THRESHOLDS.agentCreationTime);
      }
    }

    // Check memory usage
    const memoryUsage = await page.evaluate(() => {
      // @ts-expect-error - Electron API not typed in test context
      if (window.performance && window.performance.memory) {
        // @ts-expect-error - Electron API not typed in test context
        return window.performance.memory.usedJSHeapSize / 1024 / 1024; // Convert to MB
      }
      return 0;
    });

    expect(memoryUsage).toBeLessThan(PERF_THRESHOLDS.maxMemoryMB);

    // Test message sending performance with many agents
    const messageResponseTimes: number[] = [];

    // Send messages to 10 random agents
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * 50) + 1;
      const agent = page.locator('[data-testid="agent-list-item"]').nth(randomIndex);
      await agent.click();

      const messageStart = Date.now();
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill(`Performance test message ${i}`);
      await messageInput.press('Enter');

      // Measure time to start streaming
      await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });
      const responseTime = Date.now() - messageStart;
      messageResponseTimes.push(responseTime);

      // Don't wait for completion, move to next
      await page.waitForTimeout(100);
    }

    // Check average response time
    const avgResponseTime =
      messageResponseTimes.reduce((a, b) => a + b, 0) / messageResponseTimes.length;
    expect(avgResponseTime).toBeLessThan(PERF_THRESHOLDS.messageResponseTime);
  });

  test('should handle large message volumes', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Volume Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'volume'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Open agent panel
    await page.click('[data-testid="agent-panel-toggle"]');

    // Send 100 messages rapidly
    const messageInput = page.locator('[data-testid="message-input"]');
    const sendTimes: number[] = [];

    for (let i = 0; i < 100; i++) {
      const sendStart = Date.now();

      await messageInput.fill(`Message ${i}: Quick test`);
      await messageInput.press('Enter');

      // Just wait for message to be accepted, not completed
      await page.waitForSelector(`[data-message-id]:nth-child(${(i + 1) * 2})`, { timeout: 2000 });

      const sendTime = Date.now() - sendStart;
      sendTimes.push(sendTime);

      // Small delay between messages
      await page.waitForTimeout(50);
    }

    // Check that send times don't degrade
    const firstTenAvg = sendTimes.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const lastTenAvg = sendTimes.slice(-10).reduce((a, b) => a + b, 0) / 10;

    // Last messages shouldn't be more than 2x slower than first
    expect(lastTenAvg).toBeLessThan(firstTenAvg * 2);

    // UI should still be responsive
    await page.click('[data-testid="workspace-settings-btn"]');
    await page.waitForSelector('[data-testid="settings-panel"]', { timeout: 1000 });
    await page.click('[data-testid="close-settings-btn"]');
  });

  test('should maintain scroll performance with long conversations', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Scroll Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'scroll'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Open agent panel
    await page.click('[data-testid="agent-panel-toggle"]');

    // Create a long conversation
    const messageInput = page.locator('[data-testid="message-input"]');

    for (let i = 0; i < 50; i++) {
      await messageInput.fill(
        `Message ${i}: This is a longer message to create more content for scrolling performance testing`,
      );
      await messageInput.press('Enter');

      // Wait for response to start
      await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });

      // Skip some responses to save time
      if (i % 5 === 0) {
        await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });
      }
    }

    // Measure scroll performance
    const scrollContainer = page.locator('[data-scroll-container]');

    // Scroll to bottom
    const scrollToBottomTime = await page.evaluate(async (selector) => {
      const container = document.querySelector(selector);
      if (!container) return 0;

      const start = performance.now();
      container.scrollTop = container.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for render
      return performance.now() - start;
    }, '[data-scroll-container]');

    expect(scrollToBottomTime).toBeLessThan(200); // Should scroll smoothly in under 200ms

    // Scroll to top
    const scrollToTopTime = await page.evaluate(async (selector) => {
      const container = document.querySelector(selector);
      if (!container) return 0;

      const start = performance.now();
      container.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for render
      return performance.now() - start;
    }, '[data-scroll-container]');

    expect(scrollToTopTime).toBeLessThan(200);

    // Test smooth scrolling
    const smoothScrollTime = await page.evaluate(async (selector) => {
      const container = document.querySelector(selector);
      if (!container) return 0;

      const start = performance.now();
      container.scrollTo({ top: container.scrollHeight / 2, behavior: 'smooth' });
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for smooth scroll
      return performance.now() - start;
    }, '[data-scroll-container]');

    expect(smoothScrollTime).toBeLessThan(600); // Smooth scroll should complete quickly
  });

  test('should handle concurrent operations efficiently', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Concurrent Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'concurrent'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Open agent panel
    await page.click('[data-testid="agent-panel-toggle"]');

    // Create 10 agents
    for (let i = 0; i < 10; i++) {
      await page.click('[data-testid="new-agent-btn"]');
      await page.fill('[data-testid="agent-name-input"]', `Concurrent Agent ${i}`);
      await page.click('[data-testid="create-agent-confirm-btn"]');
    }

    // Send messages to all agents concurrently
    const concurrentStart = Date.now();
    const messagePromises = [];

    for (let i = 0; i < 10; i++) {
      const agent = page.locator('[data-testid="agent-list-item"]').nth(i + 1);
      await agent.click();

      const messageInput = page.locator('[data-testid="message-input"]');
      messagePromises.push(
        messageInput.fill(`Concurrent message ${i}`).then(() => messageInput.press('Enter')),
      );
    }

    await Promise.all(messagePromises);

    // All should start streaming within reasonable time
    await page.waitForFunction(
      () => document.querySelectorAll('[data-agent-streaming="true"]').length >= 5,
      { timeout: 10000 },
    );

    const concurrentTime = Date.now() - concurrentStart;
    expect(concurrentTime).toBeLessThan(10000); // Should handle concurrent ops in under 10s
  });

  test('should track and report performance metrics', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'Metrics Test');
    await page.fill(
      '[data-testid="workspace-path-input"]',
      path.join(TEST_WORKSPACE_DIR, 'metrics'),
    );
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Enable performance monitoring
    await page.evaluate(() => {
      // @ts-expect-error - Electron API not typed in test context
      window.electronAPI?.enablePerformanceMonitoring?.(true);
    });

    // Perform various operations
    await page.click('[data-testid="agent-panel-toggle"]');

    // Create agents
    for (let i = 0; i < 5; i++) {
      await page.click('[data-testid="new-agent-btn"]');
      await page.fill('[data-testid="agent-name-input"]', `Metrics Agent ${i}`);
      await page.click('[data-testid="create-agent-confirm-btn"]');
    }

    // Send messages
    const messageInput = page.locator('[data-testid="message-input"]');
    for (let i = 0; i < 10; i++) {
      await messageInput.fill(`Metrics test message ${i}`);
      await messageInput.press('Enter');
      await page.waitForTimeout(100);
    }

    // Get performance metrics
    const metrics = await page.evaluate(() =>
      // @ts-expect-error - Electron API not typed in test context
      window.electronAPI?.getPerformanceMetrics?.(),
    );

    // Verify metrics are collected
    expect(metrics).toBeDefined();
    expect(metrics).toHaveProperty('agentCreationTime');
    expect(metrics).toHaveProperty('messageProcessingTime');
    expect(metrics).toHaveProperty('memoryUsage');
    expect(metrics).toHaveProperty('cpuUsage');

    // Check metrics are within acceptable ranges
    if (metrics) {
      expect(metrics.agentCreationTime).toBeLessThan(PERF_THRESHOLDS.agentCreationTime);
      expect(metrics.messageProcessingTime).toBeLessThan(PERF_THRESHOLDS.messageResponseTime);
      expect(metrics.memoryUsage).toBeLessThan(PERF_THRESHOLDS.maxMemoryMB);
      expect(metrics.cpuUsage).toBeLessThan(PERF_THRESHOLDS.maxCPUPercent);
    }
  });

  test('should handle file operations under load', async () => {
    // Create workspace
    await page.click('[data-testid="new-workspace-btn"]');
    await page.fill('[data-testid="workspace-name-input"]', 'File Load Test');
    await page.fill('[data-testid="workspace-path-input"]', path.join(TEST_WORKSPACE_DIR, 'files'));
    await page.click('[data-testid="create-workspace-btn"]');
    await page.waitForSelector('[data-testid="workspace-loaded"]', { timeout: 10000 });

    // Create many files
    const fileCount = 100;
    const fileCreationStart = Date.now();

    for (let i = 0; i < fileCount; i++) {
      await page.click('[data-testid="new-file-btn"]');
      await page.fill('[data-testid="file-name-input"]', `test-file-${i}.ts`);
      await page.fill(
        '[data-testid="file-content-input"]',
        `// Test file ${i}\nconst value = ${i};`,
      );
      await page.click('[data-testid="save-file-btn"]');

      // Quick check every 20 files
      if (i % 20 === 19) {
        const elapsed = Date.now() - fileCreationStart;
        const avgTime = elapsed / (i + 1);
        expect(avgTime).toBeLessThan(100); // Should create files quickly
      }
    }

    // Test file tree performance
    await page.click('[data-testid="file-tree-toggle"]');
    const treeLoadStart = Date.now();
    await page.waitForSelector('[data-testid="file-tree-loaded"]', { timeout: 5000 });
    const treeLoadTime = Date.now() - treeLoadStart;

    expect(treeLoadTime).toBeLessThan(2000); // Tree should load quickly even with many files

    // Test file search performance
    const searchStart = Date.now();
    await page.fill('[data-testid="file-search-input"]', 'test-file-50');
    await page.waitForSelector('[data-testid="search-results"]', { timeout: 2000 });
    const searchTime = Date.now() - searchStart;

    expect(searchTime).toBeLessThan(500); // Search should be fast

    // Test opening multiple files
    const openStart = Date.now();
    for (let i = 0; i < 10; i++) {
      const fileItem = page.locator(`[data-testid="file-item"][data-name="test-file-${i}.ts"]`);
      await fileItem.click();
      await page.waitForSelector('[data-testid="file-editor-loaded"]', { timeout: 1000 });
    }
    const openTime = Date.now() - openStart;

    expect(openTime).toBeLessThan(5000); // Should open 10 files in under 5 seconds
  });
});
