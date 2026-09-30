/**
 * Build Smoke Test — Multi-Agent Orchestration UI
 *
 * Tests the UI's reaction to multiple agents in a workspace.
 * Uses the mock parent's authenticated workspace MCP bridge to create a child and asserts that the sidebar, chat history, and streaming
 * indicators update correctly.
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
  getSmokeWorkspace,
  openAgentsSidebarPanel,
  openAgentChat,
  archiveAndGoHome,
  setMockAgentBehavior,
  exitPackagedApp,
} from './build-smoke-helpers';

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

test.describe('Build Smoke — Multi-Agent Orchestration UI', () => {
  test.fixme(
    process.env.BUILD_SMOKE_VALIDATE_JOURNEYS !== '1',
    'Pending real packaged validation: intent-hq/intent#5608',
  );
  test.beforeAll(async () => {
    const repo = createTempRepo();
    repoPath = repo.repoPath;
    repoCleanup = repo.cleanup;

    const mockScriptPath = path.resolve(process.cwd(), 'e2e', 'mock-acp-agent.js');
    const launched = await launchPackagedApp({
      // The daemon's mock spawn adapter defaults to --mcp-config delivery.
      // This fixture consumes the real parent bridge via ACP session/new instead.
      extraEnv: { MOCK_AGENT_SCRIPT_PATH: mockScriptPath, MOCK_AGENT_SESSION_MCP: '1' },
    });
    app = launched.app;
    page = launched.page;
    console.log(
      `📝 Electron logs: main=${launched.logPaths.mainProcess}, renderer=${launched.logPaths.renderer}`,
    );
  });

  test.afterAll(async () => {
    await exitPackagedApp(app);
    if (repoCleanup) {
      try {
        repoCleanup();
      } catch {
        /* best-effort */
      }
    }
  });

  test('child agent creation updates sidebar and chat isolation', async () => {
    test.setTimeout(180_000);
    setMockAgentBehavior({
      response: 'PARENT_ONLY: I will coordinate the work. TASK_COMPLETE',
      delegate: { name: 'Implementor', prompt: 'CHILD_REQUEST: Implement the feature with tests' },
      child: {
        response: 'CHILD_ONLY: Implementation complete. TASK_COMPLETE',
        files: { 'child-output.txt': 'Written by child agent' },
      },
    });
    const workspaceId = await createWorkspaceWithPrompt(page, {
      repoPath,
      prompt: 'PARENT_REQUEST: Build the feature end to end',
      providerName: 'Mock (E2E)',
    });
    try {
      const messages = page.locator('.tab-content-wrapper:not(.hidden) [data-message-role]');
      await expect(messages.filter({ hasText: 'PARENT_ONLY:' }).last()).toBeVisible({
        timeout: 60_000,
      });
      await openAgentsSidebarPanel(page);
      const parentCard = page.locator('[data-testid="agent-panel"] [data-agent-id]').first();
      await expect(parentCard).toBeVisible();
      const parentAgentId = await parentCard.getAttribute('data-agent-id');
      expect(parentAgentId).toBeTruthy();
      const workspace = await getSmokeWorkspace(page, workspaceId);

      const childAgentId = await page.evaluate(
        async ({ workspaceId, parentAgentId }) => {
          const result = await (window as any).electronAPI.invoke('backend:request', {
            method: 'agent.list',
            params: { workspaceId, scope: 'delegated', parentAgentId },
          });
          if (!result.ok) throw new Error(JSON.stringify(result));
          const children = result.result.agents.filter(
            (agent: any) => agent.parentAgentId === parentAgentId,
          );
          if (children.length !== 1)
            throw new Error(`Expected one real child: ${JSON.stringify(result)}`);
          return children[0].id as string;
        },
        { workspaceId, parentAgentId },
      );
      expect(childAgentId).not.toBe(parentAgentId);

      const delegation = page.locator(`[data-agent-delegation-toggle="${parentAgentId}"]`);
      await expect(delegation).toContainText('1 delegated', { timeout: 30_000 });
      if ((await delegation.getAttribute('aria-expanded')) !== 'true') await delegation.click();
      await expect(page.locator(`[data-agent-id="${childAgentId}"]`).first()).toBeVisible();
      await openAgentChat(page, childAgentId);
      await expect(messages.filter({ hasText: 'CHILD_ONLY:' }).last()).toBeVisible({
        timeout: 60_000,
      });
      await expect(messages.filter({ hasText: 'CHILD_REQUEST:' })).toBeVisible();
      await expect(messages.filter({ hasText: 'PARENT_ONLY:' })).toHaveCount(0);
      await expect(messages.filter({ hasText: 'PARENT_REQUEST:' })).toHaveCount(0);
      await expect(page.getByTestId('pane-stack-selector-trigger')).toContainText('Implementor');
      await expect
        .poll(() => fs.readFile(path.join(workspace.worktreePath, 'child-output.txt'), 'utf8'))
        .toBe('Written by child agent');

      await openAgentChat(page, parentAgentId!);
      await expect(messages.filter({ hasText: 'PARENT_ONLY:' }).last()).toBeVisible();
      await expect(messages.filter({ hasText: 'PARENT_REQUEST:' })).toBeVisible();
      await expect(messages.filter({ hasText: 'CHILD_ONLY:' })).toHaveCount(0);
      await expect(messages.filter({ hasText: 'CHILD_REQUEST:' })).toHaveCount(0);
      // Switching twice catches history replacement as well as first-open routing.
      await openAgentChat(page, childAgentId);
      await expect(messages.filter({ hasText: 'CHILD_ONLY:' }).last()).toBeVisible();
      await expect(messages.filter({ hasText: 'PARENT_ONLY:' })).toHaveCount(0);
      await test.info().attach('agent-identities', {
        body: JSON.stringify({
          workspaceId,
          parentAgentId,
          childAgentId,
          worktreePath: workspace.worktreePath,
        }),
        contentType: 'application/json',
      });
      await takeScreenshot(page, 'multi-agent-complete');
    } finally {
      await archiveAndGoHome(page, workspaceId);
    }
  });
});
