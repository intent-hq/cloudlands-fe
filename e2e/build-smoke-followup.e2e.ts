/**
 * Build Smoke Test — Follow-up Message Flow (2 rounds)
 *
 * Verifies the conversational loop: send initial prompt, then 2 follow-up
 * messages, asserting that each round produces a new user + assistant
 * message pair and the chat history grows correctly.
 *
 * The mock agent reads MOCK_AGENT_BEHAVIOR once at process start and
 * replays the same response for every session/prompt, so each follow-up
 * gets an identical reply.  The test validates:
 *   - Message count increments by 2 per round (user + assistant)
 *   - App remains responsive after multiple turns
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
  waitForAgentNotStreaming,
  archiveAndGoHome,
  setMockAgentBehavior,
  sendFollowUpMessage,
} from './build-smoke-helpers';

const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e-reports', 'build-smoke');
const NUM_FOLLOWUPS = 2;

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

test.describe('Build Smoke — Follow-up Message Flow (2 rounds)', () => {
  test.beforeAll(async () => {
    const repo = createTempRepo();
    repoPath = repo.repoPath;
    repoCleanup = repo.cleanup;

    const mockScriptPath = path.resolve(process.cwd(), 'e2e', 'mock-acp-agent.js');
    const launched = await launchPackagedApp({
      extraEnv: {
        MOCK_AGENT_SCRIPT_PATH: mockScriptPath,
        // Reduce the 3s default delay to 500ms for follow-up tests.
        // The default delay exists to let the app finish chat initialization,
        // but for follow-ups the chat is already initialized.  A shorter delay
        // dramatically reduces race-condition windows.
        MOCK_AGENT_DELAY_MS: '500',
      },
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
          execSync('pkill -f "Intent\\.app/Contents/MacOS/Intent" || true', { stdio: 'ignore' });
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

  test('follow-up messages maintain chat history', async () => {
    test.setTimeout(180_000);

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

      // Measure initial message counts (the workspace creation flow may
      // produce more than 1 user message, e.g. spec note or system messages)
      // Each message renders a .message-nav-target wrapper with data-message-role.
      // For user messages, there's also a .user-message child with the same attribute.
      // Use .user-message for users and .message-nav-target for assistants (only one element each).
      const userMessages = page.locator('[data-message-role="user"].user-message:visible');
      const assistantMessages = page.locator(
        '[data-message-role="assistant"].message-nav-target:visible',
      );

      // Wait for the initial agent response by checking for the actual
      // assistant message containing our expected mock text.  This is much
      // more reliable than UI-based streaming indicators because there's a
      // ~10s gap between workspace creation and the first stream chunk
      // arriving in the UI, during which no streaming indicator exists and
      // waitForAgentCompletion can false-positive.
      //
      // The mock agent streams "Acknowledged. Ready for next instruction."
      // so we wait for that text to appear in an assistant message.
      console.log('⏳ Waiting for initial assistant response with expected content...');
      await expect(assistantMessages.filter({ hasText: 'Acknowledged' }).first()).toBeVisible({
        timeout: 90_000,
      });
      console.log('✅ Initial prompt completed — assistant message with expected content visible');

      const initialUserCount = await userMessages.count();
      const initialAssistantCount = await assistantMessages.count();
      expect(initialAssistantCount).toBeGreaterThanOrEqual(1);
      console.log(
        `✅ Initial state: ${initialUserCount} user + ${initialAssistantCount} assistant messages`,
      );

      // Wait for the backend to fully clear the in-flight prompt guard.
      // The UI shows completion before the backend calls finishSessionPrompt(),
      // so sending a follow-up too quickly causes tryBeginSessionPrompt() to
      // silently drop it.  Additionally, the renderer saga's `activeSends` guard
      // can route the follow-up to handleQueuePath (which won't produce a response
      // because processNextQueuedMessage already ran for the initial stream).
      //
      // We poll the Redux store to confirm all agents are idle — same source of
      // truth the saga uses for its send-vs-queue decision.
      // Use a longer timeout (90s) because the initial prompt can take a while
      // (mock agent has session/new 3s delay + MOCK_AGENT_DELAY_MS + streaming).
      await waitForAgentNotStreaming(page, workspaceId, 90_000);

      // Send follow-up messages with retry logic.
      // The follow-up send path involves multiple async stages (saga → IPC → ACP provider)
      // and can fail silently in CI.  Only resend when the user message itself never
      // appears; if the app already accepted the message, keep waiting for the
      // assistant response instead of duplicating the same follow-up.
      for (let i = 1; i <= NUM_FOLLOWUPS; i++) {
        const followUpText = `Follow-up message ${i} of ${NUM_FOLLOWUPS}`;
        const expectedUserCount = initialUserCount + i;
        const expectedAssistantCount = initialAssistantCount + i;
        const MAX_SEND_ATTEMPTS = 3;
        let assistantAppeared = false;
        let shouldSendMessage = true;

        for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
          if (shouldSendMessage) {
            await sendFollowUpMessage(page, followUpText);
            console.log(
              `📤 Sent follow-up ${i}/${NUM_FOLLOWUPS} (attempt ${attempt}/${MAX_SEND_ATTEMPTS})`,
            );
          } else {
            console.log(
              `⏳ Re-checking follow-up ${i}/${NUM_FOLLOWUPS} response ` +
                `(attempt ${attempt}/${MAX_SEND_ATTEMPTS})`,
            );
          }

          // Wait 20s per attempt for the assistant response (shorter than full 45s to leave room for retries)
          const perAttemptTimeout = attempt < MAX_SEND_ATTEMPTS ? 20_000 : 45_000;
          try {
            await expect(userMessages).toHaveCount(expectedUserCount, { timeout: 10_000 });
            await expect(assistantMessages).toHaveCount(expectedAssistantCount, {
              timeout: perAttemptTimeout,
            });
            assistantAppeared = true;
            break;
          } catch {
            // Dump Redux diagnostics before retrying
            const visibleUserCount = await userMessages.count();
            const visibleAssistantCount = await assistantMessages.count();
            const diagState = await page.evaluate((wsId) => {
              try {
                const ctx = (window as any).intent?.reduxContext;
                const store = Array.isArray(ctx) ? ctx[0]?.store : ctx?.store;
                if (!store) return { error: 'no-store' };
                const state = store.getState();
                const wsState = state?.workspaceAgents?.byWorkspaceId?.[wsId];
                const agentIds: string[] = wsState?.agentIds || [];
                const byAgentId = state?.agentSessions?.byAgentId || {};
                return agentIds.map((id: string) => {
                  const s = byAgentId[id];
                  return {
                    id,
                    status: s?.status,
                    isStreaming: s?.isStreaming,
                    isProcessing: s?.isProcessing,
                    isResponding: s?.isResponding,
                    stopReason: s?.stopReason,
                    activationState: s?.activationState,
                    backendSessionId: !!s?.backendSessionId,
                    messageCount: s?.messages?.length ?? 0,
                    lastMsgRole: s?.messages?.[s.messages.length - 1]?.role,
                    lastMsgStreaming: s?.messages?.[s.messages.length - 1]?.isStreaming,
                  };
                });
              } catch (e: any) {
                return { error: e.message };
              }
            }, workspaceId);
            shouldSendMessage = visibleUserCount < expectedUserCount;
            console.log(
              `⚠️  Follow-up ${i} attempt ${attempt} timed out. ` +
                `Visible counts: ${visibleUserCount} user + ${visibleAssistantCount} assistant. ` +
                `Redux state: ${JSON.stringify(diagState)}`,
            );
            if (!shouldSendMessage) {
              console.log(
                'ℹ️  Follow-up user message is already visible — not resending duplicate text',
              );
            }
            if (attempt < MAX_SEND_ATTEMPTS) {
              // Wait for agent to settle before retrying
              await waitForAgentNotStreaming(page, workspaceId, 15_000);
            }
          }
        }

        if (!assistantAppeared) {
          // Final assertion with standard timeout for proper Playwright error
          await expect(userMessages).toHaveCount(expectedUserCount, { timeout: 5_000 });
          await expect(assistantMessages).toHaveCount(expectedAssistantCount, { timeout: 5_000 });
        }

        console.log(
          `✅ Round ${i}/${NUM_FOLLOWUPS}: ${expectedUserCount} user + ${expectedAssistantCount} assistant messages`,
        );

        // Wait for the backend to clear in-flight state before next follow-up.
        if (i < NUM_FOLLOWUPS) {
          await waitForAgentNotStreaming(page, workspaceId, 30_000);
        }
      }

      // Final assertions
      const finalUserCount = initialUserCount + NUM_FOLLOWUPS;
      const finalAssistantCount = initialAssistantCount + NUM_FOLLOWUPS;
      await expect(userMessages).toHaveCount(finalUserCount, { timeout: 5_000 });
      await expect(assistantMessages).toHaveCount(finalAssistantCount, { timeout: 5_000 });
      console.log(
        `✅ Final count: ${finalUserCount} user + ${finalAssistantCount} assistant messages`,
      );

      // Last assistant message should contain the mock response
      const lastAssistant = assistantMessages.last();
      const lastText = await lastAssistant.textContent();
      expect(lastText).toContain('Acknowledged');
      console.log('✅ Last assistant message contains expected text');

      // Last user message should be follow-up #10
      const lastUser = userMessages.last();
      const lastUserText = await lastUser.textContent();
      expect(lastUserText).toContain(`Follow-up message ${NUM_FOLLOWUPS}`);
      console.log(`✅ Last user message is follow-up #${NUM_FOLLOWUPS}`);

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
      console.log(`✅ Chat input still interactive after ${NUM_FOLLOWUPS} rounds`);

      await takeScreenshot(page, 'followup-10-rounds-complete');
    } catch (err) {
      // Capture failure screenshot for debugging in CI artifacts
      await takeScreenshot(page, 'followup-FAILURE').catch(() => {});
      throw err;
    } finally {
      await archiveAndGoHome(page, workspaceId).catch(() => {});
    }
  });
});
