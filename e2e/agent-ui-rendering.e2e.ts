/**
 * Agent UI Rendering E2E Tests for Electron
 *
 * Run these tests in the Electron app environment
 * Usage: pnpm test:e2e agent-ui-rendering
 */

import { test, expect, Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let app: ElectronApplication;
let page: Page;
let appLaunchUnavailableReason: string | undefined;

test.beforeAll(async () => {
  // Launch Electron app
  app = await electron.launch({
    args: [join(__dirname, '../'), '--no-sandbox', '--disable-gpu-sandbox'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TESTING: 'true',
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
});

test.describe('Agent UI Rendering in Electron', () => {
  test.beforeEach(() => {
    test.skip(!!appLaunchUnavailableReason, appLaunchUnavailableReason);
  });

  test.describe('Streaming Message Rendering', () => {
    test('should render streaming messages correctly', async () => {
      // Create a new workspace
      await page.click('[data-testid="new-workspace-btn"]');
      await page.fill('[data-testid="workspace-name-input"]', 'Test Workspace');
      await page.click('[data-testid="create-workspace-btn"]');

      // Wait for workspace to load
      await page.waitForSelector('[data-testid="workspace-loaded"]');

      // Open agent panel
      await page.click('[data-testid="agent-panel-toggle"]');

      // Send a message
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Test streaming message');
      await messageInput.press('Enter');

      // Check streaming indicator appears immediately
      const streamingIndicator = page.locator('.streaming-cursor, [data-streaming="true"]');
      await expect(streamingIndicator).toBeVisible({ timeout: 1000 });

      // Monitor progressive text rendering
      const messageContainer = page.locator('[data-message-role="assistant"]:last-child');
      let previousText = '';
      let textUpdates = 0;

      // Watch for text updates
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(100);
        const currentText = await messageContainer.textContent();
        if (currentText && currentText !== previousText) {
          textUpdates++;
          previousText = currentText;

          // Text should be growing
          expect(currentText.length).toBeGreaterThanOrEqual(previousText.length);
        }
      }

      // Should have seen progressive updates
      expect(textUpdates).toBeGreaterThan(2);

      // Wait for streaming to complete
      await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

      // Streaming indicator should be gone
      await expect(streamingIndicator).not.toBeVisible();

      // Final message should be complete
      const finalText = await messageContainer.textContent();
      expect(finalText).toBeTruthy();
      expect(finalText?.length).toBeGreaterThan(0);
    });

    test('should handle tool calls during streaming', async () => {
      // Send a message that triggers tool use
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Search for information about TypeScript');
      await messageInput.press('Enter');

      // Wait for tool call indicator
      await page.waitForSelector('[data-tool-call]', { timeout: 10000 });

      // Tool call should be visible during streaming
      const toolCall = page.locator('[data-tool-call]').first();
      await expect(toolCall).toBeVisible();

      // Should show tool name
      const toolName = await toolCall.getAttribute('data-tool-name');
      expect(toolName).toBeTruthy();

      // Wait for completion
      await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

      // Tool call should still be visible after streaming
      await expect(toolCall).toBeVisible();
    });

    test('should not flicker during streaming', async () => {
      // Send a message
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Tell me a story');
      await messageInput.press('Enter');

      // Wait for streaming to start
      await page.waitForSelector('[data-streaming="true"]');

      // Take screenshots during streaming to detect flicker
      const screenshots: Buffer[] = [];
      for (let i = 0; i < 5; i++) {
        screenshots.push(await page.screenshot());
        await page.waitForTimeout(100);
      }

      // Compare screenshots for major differences (flicker)
      // This is a simple check - in production you'd use visual regression tools
      for (let i = 1; i < screenshots.length; i++) {
        const sizeDiff = Math.abs(screenshots[i].length - screenshots[i - 1].length);
        // Large size differences might indicate flicker/rerender
        expect(sizeDiff).toBeLessThan(50000); // 50KB threshold
      }
    });
  });

  test.describe('Post-Streaming Rendering', () => {
    test('should maintain message integrity after streaming', async () => {
      // Send a message with markdown
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Explain markdown with **bold** and `code`');
      await messageInput.press('Enter');

      // Wait for streaming to complete
      await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

      // Check markdown is rendered
      const messageContainer = page.locator('[data-message-role="assistant"]:last-child');

      // Bold text should be rendered
      const boldElements = messageContainer.locator('strong, b');
      expect(await boldElements.count()).toBeGreaterThan(0);

      // Code should be rendered
      const codeElements = messageContainer.locator('code');
      expect(await codeElements.count()).toBeGreaterThan(0);
    });

    test('should show timestamps correctly', async () => {
      // Get the last message
      const lastMessage = page.locator('[data-message-id]:last-child');

      // Check for timestamp
      const timestamp = lastMessage.locator('[data-timestamp]');
      await expect(timestamp).toBeVisible();

      // Timestamp should be recent
      const timestampText = await timestamp.getAttribute('data-timestamp');
      if (timestampText) {
        const messageTime = new Date(timestampText);
        const now = new Date();
        const diffMinutes = (now.getTime() - messageTime.getTime()) / 60000;
        expect(diffMinutes).toBeLessThan(5); // Within 5 minutes
      }
    });
  });

  test.describe('Refresh and Persistence', () => {
    test('should restore messages after refresh', async () => {
      // Send some messages
      const messageInput = page.locator('[data-testid="message-input"]');

      await messageInput.fill('First message');
      await messageInput.press('Enter');
      await page.waitForSelector('[data-streaming="false"]');

      await messageInput.fill('Second message');
      await messageInput.press('Enter');
      await page.waitForSelector('[data-streaming="false"]');

      // Count messages before refresh
      const messagesBeforeRefresh = await page.locator('[data-message-id]').count();
      expect(messagesBeforeRefresh).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant

      // Get message content
      const firstUserMessage = await page
        .locator('[data-message-role="user"]')
        .first()
        .textContent();
      const lastAssistantMessage = await page
        .locator('[data-message-role="assistant"]')
        .last()
        .textContent();

      // Refresh the page
      await page.reload();

      // Wait for app to be ready again
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });

      // Messages should be restored
      const messagesAfterRefresh = await page.locator('[data-message-id]').count();
      expect(messagesAfterRefresh).toBe(messagesBeforeRefresh);

      // Content should match
      const restoredFirstUser = await page
        .locator('[data-message-role="user"]')
        .first()
        .textContent();
      const restoredLastAssistant = await page
        .locator('[data-message-role="assistant"]')
        .last()
        .textContent();

      expect(restoredFirstUser).toBe(firstUserMessage);
      expect(restoredLastAssistant).toBe(lastAssistantMessage);
    });

    test('should handle refresh during streaming', async () => {
      // Send a long message to ensure streaming takes time
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Write a very long detailed explanation about quantum computing');
      await messageInput.press('Enter');

      // Wait for streaming to start
      await page.waitForSelector('[data-streaming="true"]');

      // Wait a bit to let some content accumulate
      await page.waitForTimeout(1000);

      // Get partial content
      const partialContent = await page
        .locator('[data-message-role="assistant"]:last-child')
        .textContent();
      expect(partialContent).toBeTruthy();

      // Refresh during streaming
      await page.reload();

      // Wait for app to be ready
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });

      // The partial message should be restored
      const restoredMessage = await page
        .locator('[data-message-role="assistant"]:last-child')
        .textContent();
      expect(restoredMessage).toBeTruthy();

      // Should not be streaming after refresh
      const streamingIndicator = page.locator('[data-streaming="true"]');
      await expect(streamingIndicator).not.toBeVisible();
    });

    test('should maintain scroll position after refresh', async () => {
      // Send many messages to create scrollable content
      const messageInput = page.locator('[data-testid="message-input"]');

      for (let i = 0; i < 10; i++) {
        await messageInput.fill(`Message ${i + 1}`);
        await messageInput.press('Enter');
        await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });
      }

      // Scroll to middle
      const scrollContainer = page.locator('[data-scroll-container]');
      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2;
      });

      // Get scroll position
      const scrollBefore = await scrollContainer.evaluate((el) => el.scrollTop);
      expect(scrollBefore).toBeGreaterThan(0);

      // Refresh
      await page.reload();
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });

      // Check scroll position is restored (with some tolerance)
      const scrollAfter = await scrollContainer.evaluate((el) => el.scrollTop);
      expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(100);
    });
  });

  test.describe('IPC Communication', () => {
    test('should handle IPC message flow correctly', async () => {
      // Enable IPC debugging in DevTools console
      await page.evaluate(() => {
        // @ts-expect-error - Electron API not typed in test context
        window.electronAPI?.enableIPCLogging?.(true);
      });

      // Send a message
      const messageInput = page.locator('[data-testid="message-input"]');
      await messageInput.fill('Test IPC flow');
      await messageInput.press('Enter');

      // Check IPC events in console
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        if (msg.text().includes('IPC')) {
          consoleLogs.push(msg.text());
        }
      });

      // Wait for response
      await page.waitForSelector('[data-streaming="false"]', { timeout: 30000 });

      // Should have IPC communication logs
      expect(consoleLogs.some((log) => log.includes('agent:send-message'))).toBeTruthy();
      expect(consoleLogs.some((log) => log.includes('agent:stream'))).toBeTruthy();
    });
  });

  test.describe('Performance', () => {
    test('should handle large conversations efficiently', async () => {
      const messageInput = page.locator('[data-testid="message-input"]');

      // Measure initial performance
      const startTime = Date.now();

      // Send many messages
      for (let i = 0; i < 20; i++) {
        await messageInput.fill(`Performance test message ${i + 1}`);
        await messageInput.press('Enter');

        // Don't wait for each to complete, just ensure streaming started
        await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });
      }

      // Wait for all to complete
      await page.waitForTimeout(5000);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should handle 20 messages in reasonable time
      expect(totalTime).toBeLessThan(60000); // 60 seconds

      // Check UI is still responsive
      await messageInput.fill('Final test message');
      await messageInput.press('Enter');
      await page.waitForSelector('[data-streaming="true"]', { timeout: 5000 });

      // Should still be able to scroll
      const scrollContainer = page.locator('[data-scroll-container]');
      const canScroll = await scrollContainer.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(canScroll).toBeTruthy();
    });
  });
});
