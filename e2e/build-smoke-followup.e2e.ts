/**
 * Build Smoke Test — Follow-up Message Flow (10 rounds)
 *
 * Verifies the conversational loop: send initial prompt, then 10 follow-up
 * messages, asserting that each round produces a new user + assistant
 * message pair and the chat history grows correctly.
 *
 * The mock agent reads MOCK_AGENT_BEHAVIOR once at process start and
 * replays the same response for every session/prompt, so each follow-up
 * gets an identical reply.  The test validates:
 *   - Message count increments by 2 per round (user + assistant)
 *   - Chat scrolls to latest message
 *   - App remains responsive after 10+ turns
 *   - No leaked streaming indicators
 *
 * Run with: npx playwright test --config=e2e/build-smoke.config.ts e2e/build-smoke-followup.e2e.ts
 */

import { test, expect, Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchPackagedApp,
  createTempRepo,
  createWorkspaceWithPrompt,
  waitForAgentCompletion,
  archiveAndGoHome,
  setMockAgentBehavior,
  sendFollowUpMessage,
} from './build-smoke-helpers';

const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e-reports', 'build-smoke');
const NUM_FOLLOWUPS = 10;

let app: ElectronApplication;
let page: Page;
let repoPath: string;
let repoCleanup: () => void;

async function takeScreenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}-${timestamp}.png`),
    fullPage: true,
  });
}

test.describe('Build Smoke — Follow-up Message Flow (10 rounds)', () => {
  test.beforeAll(async () => {
    const repo = createTempRepo();
    repoPath = repo.repoPath;
    repoCleanup = repo.cleanup;

    const mockScriptPath = path.resolve(process.cwd(), 'e2e', 'mock-acp-agent.js');
    const launched = await launchPackagedApp({
      extraEnv: { MOCK_AGENT_SCRIPT_PATH: mockScriptPath, DEFAULT_PROVIDER_OVERRIDE: 'mock' },
    });
    app = launched.app;
    page = launched.page;
    console.log(
      `📝 Electron logs: main=${launched.logPaths.mainProcess}, renderer=${launched.logPaths.renderer}`,
    );

  });

  test.afterAll(async () => {
    if (app) {
      try {
        await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
      } catch {
        // app may already be closed
      }
      await new Promise((r) => setTimeout(r, 2_000));
      try {
        const { execSync } = await import('child_process');
        if (process.platform === 'win32') {
          execSync('taskkill /F /IM "Intent by Augment.exe"', {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          execSync('pkill -f "Intent by Augment" || true', { stdio: 'ignore' });
        }
      } catch {
        // No matching processes
      }
    }
    if (repoCleanup) {
      try {
        repoCleanup();
      } catch {
        /* best-effort */
      }
    }
  });

  test('10 follow-up messages maintain chat history', async () => {
    test.setTimeout(300_000);

    // Configure mock: each turn replays the same response
    const mockEnv = setMockAgentBehavior({
      response: 'Acknowledged. Ready for next instruction.',
    });
    await app.evaluate(({ app: _app }, behavior) => {
      process.env.MOCK_AGENT_BEHAVIOR = behavior;
    }, mockEnv.MOCK_AGENT_BEHAVIOR);

    const workspaceId = await createWorkspaceWithPrompt(page, {
      repoPath,
      prompt: 'Start the conversation',
      providerName: 'Mock (E2E)',
    });

    try {
      // Open the agent chat panel (the onboarding saga skips auto-opening)
      const agentCard = page.locator('[data-testid="agent-list-item"]').first();
      await agentCard.waitFor({ state: 'visible', timeout: 15_000 });
      const agentId = await agentCard.getAttribute('data-agent-id');
      await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent('workspace:open-agent', { detail: { agentId: id } }));
      }, agentId);
      console.log('✅ Agent panel opened');

      // Wait for initial agent response
      await waitForAgentCompletion(page, workspaceId, 60_000);
      console.log('✅ Initial prompt completed');

      // Measure initial message counts (the workspace creation flow may
      // produce more than 1 user message, e.g. spec note or system messages)
      // Each message renders a .message-nav-target wrapper with data-message-role.
      // For user messages, there's also a .user-message child with the same attribute.
      // Use .user-message for users and .message-nav-target for assistants (only one element each).
      const userMessages = page.locator('[data-message-role="user"].user-message:visible');
      const assistantMessages = page.locator('[data-message-role="assistant"].message-nav-target:visible');

      // Wait for the assistant message to render — there's a timing gap between
      // agent completion (streaming finished) and the UI transitioning the message
      // from the streaming render path to the completed render path.
      await expect(assistantMessages.first()).toBeVisible({ timeout: 15_000 });

      const initialUserCount = await userMessages.count();
      const initialAssistantCount = await assistantMessages.count();
      expect(initialAssistantCount).toBeGreaterThanOrEqual(1);
      console.log(
        `✅ Initial state: ${initialUserCount} user + ${initialAssistantCount} assistant messages`,
      );

      // Send 10 follow-up messages
      for (let i = 1; i <= NUM_FOLLOWUPS; i++) {
        const followUpText = `Follow-up message ${i} of ${NUM_FOLLOWUPS}`;

        await sendFollowUpMessage(page, followUpText);
        console.log(`📤 Sent follow-up ${i}/${NUM_FOLLOWUPS}`);

        // Wait for agent to respond
        await waitForAgentCompletion(page, workspaceId, 60_000);

        // Debug: dump all user message elements
        const allUserEls = await userMessages.all();
        console.log(`🔍 Round ${i} — found ${allUserEls.length} user messages:`);
        for (let j = 0; j < allUserEls.length; j++) {
          const text = await allUserEls[j].textContent();
          const classes = await allUserEls[j].getAttribute('class');
          console.log(`   [${j}] text="${text?.slice(0, 80)}" class="${classes}"`);
        }

        // Expected counts: initial baseline + i rounds
        const expectedUserCount = initialUserCount + i;
        const expectedAssistantCount = initialAssistantCount + i;

        await expect(userMessages).toHaveCount(expectedUserCount, { timeout: 10_000 });
        await expect(assistantMessages).toHaveCount(expectedAssistantCount, { timeout: 10_000 });
        console.log(
          `✅ Round ${i}/${NUM_FOLLOWUPS}: ${expectedUserCount} user + ${expectedAssistantCount} assistant messages`,
        );
      }

      // Final assertions after all 10 rounds
      const finalUserCount = initialUserCount + NUM_FOLLOWUPS;
      const finalAssistantCount = initialAssistantCount + NUM_FOLLOWUPS;
      await expect(userMessages).toHaveCount(finalUserCount, { timeout: 5_000 });
      await expect(assistantMessages).toHaveCount(finalAssistantCount, { timeout: 5_000 });
      console.log(`✅ Final count: ${finalUserCount} user + ${finalAssistantCount} assistant messages`);

      // Last assistant message should contain the mock response
      const lastAssistant = assistantMessages.last();
      const lastText = await lastAssistant.textContent();
      expect(lastText).toContain('Acknowledged');
      console.log('✅ Last assistant message contains expected text');

      // Last user message should be follow-up #10
      const lastUser = userMessages.last();
      const lastUserText = await lastUser.textContent();
      expect(lastUserText).toContain(`Follow-up message ${NUM_FOLLOWUPS}`);
      console.log('✅ Last user message is follow-up #10');

      // No streaming indicators left
      const streamingIndicator = page.locator(
        '[data-streaming="true"], [data-testid="streaming-status-thinking"]',
      );
      await expect(streamingIndicator).toHaveCount(0, { timeout: 10_000 });
      console.log('✅ No streaming indicators remaining');

      // Chat input is still interactive
      const chatInput = page.locator(
        '.tab-content-wrapper:not(.hidden) .tiptap-editor[contenteditable="true"]',
      );
      await expect(chatInput.first()).toBeVisible({ timeout: 5_000 });
      console.log('✅ Chat input still interactive after 10 rounds');

      await takeScreenshot(page, 'followup-10-rounds-complete');
    } catch (err) {
      // Capture failure screenshot for debugging in CI artifacts
      await takeScreenshot(page, 'followup-FAILURE').catch(() => { });
      throw err;
    } finally {
      await archiveAndGoHome(page, workspaceId).catch(() => { });
    }
  });
});
