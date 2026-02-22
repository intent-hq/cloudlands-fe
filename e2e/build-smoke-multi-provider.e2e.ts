/**
 * Build Smoke Test — Multi-Provider Model Verification
 *
 * Extends the standard hello-world smoke test with an additional step:
 * after agents complete, it finds the implementor agent, opens its chat,
 * sends "What model are you?", and asserts the response matches the
 * expected default model pattern for each provider.
 *
 * Run with: pnpm test:build-smoke -- --grep "multi-provider"
 */

import { test, expect, Page, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import {
  launchPackagedApp,
  createTempRepo,
  getAvailableProviders,
  switchProviderViaLocalStorage,
  setCodexModelViaSettingsUI,
  createWorkspaceWithPrompt,
  resolveWorktreeReadmePath,
  waitForFileContentWithNudge,
  waitForAgentCompletion,
  archiveAndGoHome,
  startPermissionAutoApprover,
  sendFollowUpMessage,
  findImplementorAgent,
  openAgentChat,
  waitForAssistantResponse,
} from './build-smoke-helpers';

const KNOWN_PROVIDERS = ['opencode', 'auggie', 'claude-code', 'codex'] as const;

const PROMPT =
  'Add the text "hello world" to the README.md file. I pre-approve any plan you create — do NOT stop to ask for my review or approval. Write a brief spec with one task and delegate to an implementor in the same turn without pausing. The implementor should make the edit directly without asking for permission, confirming the plan, checking on other agents, or checking file status first -- just write the file.';

const DEFAULT_PROVIDER_TIMEOUT = 4 * 60 * 1000;

/** Codex needs extra time. */
function getProviderTimeout(providerId: string): number {
  if (providerId === 'codex') return 6 * 60 * 1000;
  return DEFAULT_PROVIDER_TIMEOUT;
}

/**
 * Expected model identity patterns per provider.
 * These are loose regexes that tolerate model version bumps.
 */
const EXPECTED_MODEL_PATTERNS: Record<string, RegExp> = {
  auggie: /claude|haiku/i,
  'claude-code': /claude|haiku/i,
  codex: /gpt|codex|openai/i,
  opencode: /pickle|opencode/i,
};

const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e-reports', 'build-smoke');

interface ProviderResult {
  providerId: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs?: number;
  error?: string;
  modelResponse?: string;
}

let app: ElectronApplication;
let page: Page;
let repoPath: string;
let repoCleanup: () => void;
let availableProviders: Set<string> = new Set();
let lastWorkspaceId: string | undefined;
const results: ProviderResult[] = [];

async function takeScreenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}-${timestamp}.png`),
    fullPage: true,
  });
}

async function resetReadme(): Promise<void> {
  let readmePath: string;
  if (lastWorkspaceId) {
    readmePath = resolveWorktreeReadmePath(lastWorkspaceId, repoPath);
  } else {
    readmePath = path.join(repoPath, 'README.md');
  }

  await fs.writeFile(readmePath, '', 'utf-8');
  const { execSync } = await import('child_process');
  const dir = path.dirname(readmePath);
  try {
    execSync('git add README.md && git commit -m "reset readme" --allow-empty', {
      cwd: dir,
      stdio: 'pipe',
    });
  } catch {
    // Commit may fail if nothing changed — that's fine
  }
}

test.describe('multi-provider smoke tests', () => {
  test.beforeAll(async () => {
    const repo = createTempRepo();
    repoPath = repo.repoPath;
    repoCleanup = repo.cleanup;

    const launched = await launchPackagedApp({});
    app = launched.app;
    page = launched.page;
    console.log(
      `📝 Electron logs: main=${launched.logPaths.mainProcess}, renderer=${launched.logPaths.renderer}`,
    );

    availableProviders = await getAvailableProviders(page);
    console.log(`Available providers: ${Array.from(availableProviders).join(', ')}`);
  });

  test.afterAll(async () => {
    console.log('\n=== Multi-Provider Smoke Test Results ===');
    for (const r of results) {
      const time = r.durationMs ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : '';
      const model = r.modelResponse ? ` [model: ${r.modelResponse.slice(0, 80)}]` : '';
      console.log(
        `  ${r.status === 'pass' ? '✅' : r.status === 'skip' ? '⏭️' : '❌'} ${r.providerId}: ${r.status.toUpperCase()}${time}${model}`,
      );
    }
    console.log('==========================================\n');

    if (app) {
      try {
        await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
      } catch {
        // evaluate may fail if the app already crashed
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
          execSync('pkill -9 -f "Intent by Augment"', { stdio: 'ignore' });
        }
      } catch {
        // No matching processes
      }
    }

    if (repoCleanup) {
      try {
        repoCleanup();
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  for (const providerId of KNOWN_PROVIDERS) {
    test(`${providerId} — implementor reports expected model`, async () => {
      if (!availableProviders.has(providerId)) {
        test.skip(true, `${providerId} is not installed`);
        return;
      }

      const providerTimeout = getProviderTimeout(providerId);
      test.setTimeout(providerTimeout);
      const start = Date.now();
      let workspaceId: string | undefined;

      try {
        await switchProviderViaLocalStorage(page, providerId);

        if (providerId === 'codex') {
          const codexModel = process.env.CODEX_SMOKE_MODEL || 'codex:gpt-5.2-codex/low';
          console.log(`🔧 Setting codex model via Settings UI: ${codexModel}`);
          await setCodexModelViaSettingsUI(page, codexModel);
        }

        // Reset README between providers
        if (results.length > 0) {
          try {
            await resetReadme();
          } catch (err) {
            console.warn(`Failed to reset README before ${providerId}:`, err);
          }
        }

        // --- Phase 1: Standard hello-world flow (same as existing test) ---
        workspaceId = await createWorkspaceWithPrompt(page, { repoPath, prompt: PROMPT });
        await takeScreenshot(page, `mp-${providerId}-workspace-created`);

        const readmePath = resolveWorktreeReadmePath(workspaceId, repoPath);
        console.log(`📁 Worktree README path: ${readmePath}`);
        lastWorkspaceId = workspaceId;

        await page.waitForSelector('[data-agent-id]', { timeout: 60_000 });
        await takeScreenshot(page, `mp-${providerId}-agent-started`);

        const stopPermissionApprover = startPermissionAutoApprover(page);

        const remainingTimeout = providerTimeout - (Date.now() - start);
        let tick = 0;
        const diagnosticInterval = setInterval(async () => {
          tick++;
          await takeScreenshot(page, `mp-${providerId}-progress-${tick}`).catch(() => {});
        }, 30_000);

        try {
          await waitForFileContentWithNudge(
            page,
            readmePath,
            /hello world/i,
            Math.max(remainingTimeout, 10_000),
            'Approved. I approve the plan. Delegate to an implementor now -- do not wait for further approval. The implementor should write "hello world" to README.md immediately.',
          );
        } finally {
          clearInterval(diagnosticInterval);
          stopPermissionApprover();
        }

        const agentTimeout = providerTimeout - (Date.now() - start);
        await waitForAgentCompletion(page, workspaceId, Math.max(agentTimeout, 10_000));
        await takeScreenshot(page, `mp-${providerId}-agents-complete`);

        // --- Phase 2: Find implementor, ask about model ---
        console.log(`🔍 Finding implementor agent for ${providerId}...`);
        const impl = await findImplementorAgent(page);
        console.log(`🤖 Found implementor: ${impl.name}`);

        await openAgentChat(page, impl.agentId);
        await takeScreenshot(page, `mp-${providerId}-implementor-chat`);

        // Count existing assistant messages before sending, so
        // waitForAssistantResponse can wait for a genuinely new reply
        // instead of returning a stale message from the hello-world flow.
        const msgCountBefore = await page
          .locator('[data-message-role="assistant"]')
          .count();

        await sendFollowUpMessage(page, 'What model are you?');
        console.log(`💬 Sent "What model are you?" to implementor`);

        const response = await waitForAssistantResponse(page, 60_000, msgCountBefore);
        console.log(`📝 Model response (${providerId}): ${response.slice(0, 200)}`);
        await takeScreenshot(page, `mp-${providerId}-model-response`);

        // Assert the response matches the expected pattern
        const expectedPattern = EXPECTED_MODEL_PATTERNS[providerId];
        if (expectedPattern) {
          const matches = expectedPattern.test(response);
          console.log(
            `🧪 Pattern ${expectedPattern} ${matches ? 'MATCHES ✅' : 'DOES NOT MATCH ❌'}`,
          );

          if (providerId === 'auggie') {
            expect(response).toMatch(expectedPattern);
          } else {
            expect.soft(response, `${providerId} model response did not match ${expectedPattern}`).toMatch(expectedPattern);
          }
        }

        const durationMs = Date.now() - start;
        await takeScreenshot(page, `mp-${providerId}-pass`);
        console.log(`✅ ${providerId}: PASS (${(durationMs / 1000).toFixed(1)}s)`);

        await archiveAndGoHome(page, workspaceId);
        results.push({ providerId, status: 'pass', durationMs, modelResponse: response.slice(0, 200) });

        if (providerId === 'auggie') {
          expect(true).toBe(true);
        }
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorMsg = error instanceof Error ? error.message : String(error);
        await takeScreenshot(page, `mp-${providerId}-fail`).catch(() => {});
        console.error(
          `❌ ${providerId}: FAIL (${(durationMs / 1000).toFixed(1)}s) — ${errorMsg}`,
        );

        // Diagnostic dump on failure
        try {
          const url = page.url();
          console.error(`📍 Page URL at failure: ${url}`);

          if (workspaceId) {
            const readmePath = resolveWorktreeReadmePath(workspaceId, repoPath);
            const readmeContent = existsSync(readmePath)
              ? readFileSync(readmePath, 'utf-8')
              : '(file does not exist)';
            console.error(`📄 README.md content:\n${readmeContent}`);
          }

          if (workspaceId) {
            const agents = await page.evaluate(async (wsId) => {
              const response = await (window as any).electronAPI.invoke(
                'agent:list-sessions',
                wsId,
              );
              const data = response?.data;
              const sessions: any[] = Array.isArray(data) ? data : data?.agents || [];
              return sessions.map((s: any) => ({
                name: s.name || s.id,
                isStreaming: !!s.isStreaming,
                status: s.status || 'unknown',
                isInitialAgent: !!s.isInitialAgent,
              }));
            }, workspaceId);
            console.error(`🤖 Agent sessions at failure: ${JSON.stringify(agents, null, 2)}`);
          }
        } catch {
          // diagnostic dump is best-effort
        }

        if (workspaceId) {
          await archiveAndGoHome(page, workspaceId).catch(() => {});
        }

        results.push({ providerId, status: 'fail', durationMs, error: errorMsg });

        if (providerId === 'auggie') {
          expect(false, `auggie provider failed: ${errorMsg}`).toBe(true);
        } else {
          expect.soft(false, `${providerId} provider failed: ${errorMsg}`).toBe(true);
        }
      }
    });
  }
});