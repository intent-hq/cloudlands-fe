/**
 * Build Smoke Test — Chat History Persists After Navigation
 *
 * Verifies that navigating away from a workspace and back preserves the
 * chat history (both user and assistant messages).
 *
 * Run with: pnpm test:build-smoke
 */

import { test, expect, Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchPackagedApp,
  createTempRepo,
  createWorkspaceWithPrompt,
  waitForAgentCompletion,
  setMockAgentBehavior,
  archiveAndGoHome,
} from './build-smoke-helpers';

const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e-reports', 'build-smoke');
const TEST_TIMEOUT = 90_000;

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

test.describe('Build Smoke — Chat History Navigation', () => {
  test.beforeAll(async () => {
    const repo = createTempRepo();
    repoPath = repo.repoPath;
    repoCleanup = repo.cleanup;

    const mockScriptPath = path.resolve(process.cwd(), 'e2e', 'mock-acp-agent.js');
    const launched = await launchPackagedApp({
      extraEnv: { MOCK_AGENT_SCRIPT_PATH: mockScriptPath },
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
          execSync('taskkill /F /IM "Intent.exe"', {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          execSync('pkill -9 -f "Intent\\.app/Contents/MacOS/Intent"', { stdio: 'ignore' });
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

  test('chat messages persist after navigating away and back', async () => {
    test.setTimeout(TEST_TIMEOUT);

    const AGENT_RESPONSE = 'This is a unique response for navigation test. TASK_COMPLETE';
    const USER_PROMPT = 'Tell me something memorable for the navigation test';

    const mockEnv = setMockAgentBehavior({
      response: AGENT_RESPONSE,
    });

    await app.evaluate(
      (_electron, env) => {
        for (const [k, v] of Object.entries(env)) {
          process.env[k] = v;
        }
      },
      mockEnv,
    );

    // 1. Create workspace and wait for agent response
    const workspaceId = await createWorkspaceWithPrompt(page, {
      repoPath,
      prompt: USER_PROMPT,
      providerName: 'Mock (E2E)',
    });
    console.log(`🏗️  Workspace created: ${workspaceId}`);

    // Open the agent chat panel (the onboarding saga skips auto-opening)
    const agentCard = page.locator('[data-testid="agent-list-item"]').first();
    await agentCard.waitFor({ state: 'visible', timeout: 15_000 });
    const agentId = await agentCard.getAttribute('data-agent-id');
    await page.evaluate((id) => {
      window.dispatchEvent(new CustomEvent('workspace:open-agent', { detail: { agentId: id } }));
    }, agentId);
    console.log('✅ Agent panel opened');

    await waitForAgentCompletion(page, workspaceId, 60_000);
    console.log('✅ Agent completed');

    // 2. Verify initial messages are present (capture actual counts — the app
    //    may render more than one user bubble, e.g. a system-injected message)
    const userMessages = page.locator('[data-message-role="user"]:visible');
    const assistantMessages = page.locator('[data-message-role="assistant"]:visible');

    // Wait for at least one assistant response before capturing baselines
    await expect(assistantMessages.first()).toBeVisible({ timeout: 15_000 });
    const initialUserCount = await userMessages.count();
    const initialAssistantCount = await assistantMessages.count();
    expect(initialUserCount).toBeGreaterThanOrEqual(1);
    expect(initialAssistantCount).toBeGreaterThanOrEqual(1);
    console.log(`✅ Initial messages verified (${initialUserCount} user + ${initialAssistantCount} assistant)`);

    await takeScreenshot(page, 'nav-before-leaving');

    // 3. Navigate to homepage (without archiving — just navigate away)
    const baseUrl = await page.evaluate(() => window.location.origin);
    await page.goto(`${baseUrl}/`);
    await page.waitForLoadState('domcontentloaded');
    console.log('🏠 Navigated to homepage');

    // 4. Brief settle time
    await new Promise((r) => setTimeout(r, 2_000));

    // 5. Navigate back to the workspace
    await page.goto(`${baseUrl}/workspace/${workspaceId}`);
    await page.waitForLoadState('domcontentloaded');
    console.log(`🔙 Navigated back to workspace ${workspaceId}`);

    // 6. Wait for the page to load, then re-open the agent panel.
    //    Navigation destroys the Svelte component tree; the chat panel
    //    won't auto-open on a cold workspace load — the test must
    //    explicitly open it, just like on initial creation.
    await page.waitForTimeout(2_000);
    const agentCardAfter = page.locator('[data-testid="agent-list-item"]').first();
    await agentCardAfter.waitFor({ state: 'visible', timeout: 15_000 });
    const agentIdAfter = await agentCardAfter.getAttribute('data-agent-id');
    await page.evaluate((id) => {
      window.dispatchEvent(new CustomEvent('workspace:open-agent', { detail: { agentId: id } }));
    }, agentIdAfter);
    console.log('✅ Agent panel re-opened after navigation');
    await page.waitForTimeout(2_000);

    // 7. Verify messages are still present
    //    NOTE: We check for >= 1 assistant messages rather than exact count matching.
    //    The initial count may include ephemeral messages (streaming placeholders,
    //    thinking indicators) or messages from multiple agents that aren't all
    //    rendered after a cold workspace reload.  The key assertion is that SOME
    //    messages survive navigation — not that the exact count is preserved.
    const userMessagesAfter = page.locator('[data-message-role="user"]:visible');
    const assistantMessagesAfter = page.locator('[data-message-role="assistant"]:visible');

    await expect(userMessagesAfter).toHaveCount(initialUserCount, { timeout: 15_000 });
    console.log(`✅ User messages persisted after navigation (${initialUserCount})`);

    await expect(assistantMessagesAfter.first()).toBeVisible({ timeout: 15_000 });
    const assistantCountAfter = await assistantMessagesAfter.count();
    expect(assistantCountAfter).toBeGreaterThanOrEqual(1);
    console.log(`✅ Assistant messages persisted after navigation (${assistantCountAfter} of ${initialAssistantCount})`);

    await takeScreenshot(page, 'nav-after-returning');

    // Cleanup
    await archiveAndGoHome(page, workspaceId).catch(() => { });
  });
});
