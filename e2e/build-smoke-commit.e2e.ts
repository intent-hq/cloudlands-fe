/**
 * Build Smoke Test — Local Commit
 *
 * Verifies the commit flow using a local temp repo and the mock provider.
 * The mock agent writes a file via `behavior.files`, then the test navigates
 * to the Changes tab, stages all files, opens the commit drawer, types a
 * commit message, clicks commit, and verifies it succeeds.
 *
 * No tokens, no remote, no PR — this test should always run.
 *
 * Run with:
 *   npx playwright test --config=e2e/build-smoke.config.ts e2e/build-smoke-commit.e2e.ts --reporter=list
 */

import { test, Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import {
  launchPackagedApp,
  createTempRepo,
  setMockAgentBehavior,
  createWorkspaceWithPrompt,
  waitForAgentCompletion,
  archiveAndGoHome,
} from './build-smoke-helpers';

const TEST_TIMEOUT = 3 * 60 * 1000;
const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e-reports', 'build-smoke');

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

test.describe('Build Smoke — Local Commit', () => {
  test.beforeAll(async () => {
    const repo = createTempRepo();
    repoPath = repo.repoPath;
    repoCleanup = repo.cleanup;

    const mockEnv = setMockAgentBehavior({
      files: { 'README.md': 'hello world' },
      response: 'I have written README.md. TASK_COMPLETE',
    });

    const launched = await launchPackagedApp({ extraEnv: mockEnv });
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
        // app may have already exited
      }
      await new Promise((r) => setTimeout(r, 2_000));
      try {
        if (process.platform === 'win32') {
          execSync('taskkill /F /IM "Intent.exe"', {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          execSync('pkill -f "Intent.app/Contents/MacOS/Intent" || true', { stdio: 'ignore' });
        }
      } catch {
        // no matching processes
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

  test('stage files and commit locally', async () => {
    test.setTimeout(TEST_TIMEOUT);
    const start = Date.now();
    let workspaceId: string | undefined;

    try {
      // 1. Create workspace with mock agent
      workspaceId = await createWorkspaceWithPrompt(page, {
        repoPath,
        prompt: 'Write hello world to README.md',
        providerName: 'Mock (E2E)',
      });
      await takeScreenshot(page, 'commit-workspace-created');
      console.log(`📁 Workspace created: ${workspaceId}`);

      // 2. Wait for mock agent to complete
      await waitForAgentCompletion(page, workspaceId, 60_000);
      await takeScreenshot(page, 'commit-agent-complete');
      console.log('✅ Agent completed');

      // 3. Navigate to Changes tab and stage all files
      const changesTab = page.locator('button', { hasText: 'Changes' }).first();
      await changesTab.waitFor({ state: 'visible', timeout: 10_000 });
      await changesTab.click();
      await page.waitForTimeout(1_000);

      const stageAllButton = page.locator('button').filter({ hasText: 'Stage all' }).first();
      await stageAllButton.waitFor({ state: 'visible', timeout: 15_000 });
      await stageAllButton.click();
      console.log('📥 Clicked Stage all');
      await page.waitForTimeout(2_000);

      const stagedRows = page.locator('[data-file-key^="staged:"]');
      await stagedRows.first().waitFor({ state: 'visible', timeout: 10_000 });
      const stagedCount = await stagedRows.count();
      console.log(`✅ ${stagedCount} file(s) now staged`);
      await takeScreenshot(page, 'commit-files-staged');

      // 4. Open commit drawer, type message, and commit
      const commitDividerButton = page
        .locator('[data-testid="commit-export-divider"] button')
        .filter({ hasText: 'Commit' })
        .first();
      await commitDividerButton.waitFor({ state: 'visible', timeout: 10_000 });

      await page.waitForFunction(
        () => {
          const divider = document.querySelector('[data-testid="commit-export-divider"]');
          if (!divider) return false;
          const commitBtn = [...divider.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Commit'),
          );
          return commitBtn && !(commitBtn as HTMLButtonElement).disabled;
        },
        undefined,
        { timeout: 10_000 },
      );

      await commitDividerButton.click();
      await page.waitForTimeout(500);
      await takeScreenshot(page, 'commit-drawer-open');
      console.log('📝 Commit drawer opened');

      const commitTextarea = page.locator('textarea[placeholder="Commit message..."]').first();
      await commitTextarea.waitFor({ state: 'visible', timeout: 10_000 });
      await commitTextarea.click();
      await page.waitForTimeout(200);
      await commitTextarea.fill('test: e2e smoke test local commit');
      await page.waitForTimeout(300);
      await takeScreenshot(page, 'commit-message-typed');

      const commitSubmitButton = page.locator('[data-testid="commit-submit-button"]');
      await commitSubmitButton.waitFor({ state: 'visible', timeout: 5_000 });
      await commitSubmitButton.click();
      console.log('🚀 Clicked commit submit button');

      // 5. Verify commit succeeds (drawer closes or message clears)
      await page.waitForFunction(
        () => {
          const textarea = document.querySelector(
            'textarea[placeholder="Commit message..."]',
          ) as HTMLTextAreaElement | null;
          return !textarea || textarea.value === '';
        },
        undefined,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(1_000);
      await takeScreenshot(page, 'commit-success');

      const durationMs = Date.now() - start;
      console.log(`✅ Local commit test: PASS (${(durationMs / 1000).toFixed(1)}s)`);

      // Archive and go home
      await archiveAndGoHome(page, workspaceId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await takeScreenshot(page, 'commit-fail').catch(() => {});
      console.error(`❌ Local commit test: FAIL — ${errorMsg}`);

      if (workspaceId) {
        await archiveAndGoHome(page, workspaceId).catch(() => {});
      }

      throw error;
    }
  });
});
