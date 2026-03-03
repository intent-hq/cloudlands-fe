/**
 * Build Smoke Test — Provider Verification
 *
 * Verifies each installed ACP provider works end-to-end in the packaged app:
 * creates a workspace with a standard prompt, waits for agent completion,
 * and checks that "hello world" was written to the README.
 *
 * Each known provider gets its own `test()` case so Playwright reports
 * individual pass/fail/skip per provider.
 *
 * Run with: pnpm test:build-smoke
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
  setOpencodeModelViaSettingsUI,
  createWorkspaceWithPrompt,
  resolveWorktreeReadmePath,
  waitForFileContent,
  waitForAgentCompletion,
  archiveAndGoHome,
  startPermissionAutoApprover,
  startChatNudgeMonitor,
} from './build-smoke-helpers';

const KNOWN_PROVIDERS = ['auggie', 'claude-code', 'codex', 'opencode'] as const;

const PROMPT =
  'Write a simple spec to add "hello world" to the README.md and then delegate it to an implementor.';
const DEFAULT_PROVIDER_TIMEOUT = 4 * 60 * 1000;

/** Codex needs extra time: coordinator → approval → delegation → implementor + Settings UI model override. */
function getProviderTimeout(providerId: string): number {
  if (providerId === 'codex') return 6 * 60 * 1000;
  return DEFAULT_PROVIDER_TIMEOUT;
}
const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e-reports', 'build-smoke');

interface ProviderResult {
  providerId: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs?: number;
  error?: string;
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
  // Reset the README in the worktree (where the agent writes) if available,
  // otherwise fall back to the temp repo path.
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

test.describe('Build Smoke — Provider Verification', () => {
  test.beforeAll(async () => {
    // Create temp repo with empty README
    const repo = createTempRepo();
    repoPath = repo.repoPath;
    repoCleanup = repo.cleanup;

    // Launch the packaged app
    const launched = await launchPackagedApp({});
    app = launched.app;
    page = launched.page;
    console.log(
      `📝 Electron logs: main=${launched.logPaths.mainProcess}, renderer=${launched.logPaths.renderer}`,
    );

    // Detect available providers via IPC
    availableProviders = await getAvailableProviders(page);
    console.log(`Available providers: ${Array.from(availableProviders).join(', ')}`);
  });

  test.afterAll(async () => {
    // Print summary
    console.log('\n=== Build Smoke Test Results ===');
    for (const r of results) {
      const time = r.durationMs ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : '';
      console.log(
        `  ${r.status === 'pass' ? '✅' : r.status === 'skip' ? '⏭️' : '❌'} ${r.providerId}: ${r.status.toUpperCase()}${time}`,
      );
    }
    console.log('================================\n');

    // Close app — app.close() triggers Electron's before-quit handler which
    // shows a native "Quit anyway?" dialog when agents are still running.
    // That dialog blocks the close forever.  Instead, use app.exit(0) via
    // Playwright's evaluate() which immediately terminates the Node process
    // without firing before-quit.  Fall back to pkill if that fails.
    if (app) {
      try {
        await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
      } catch {
        // evaluate may fail if the app already crashed — force-kill
      }
      // Give the OS a moment to release the single-instance lock file
      await new Promise((r) => setTimeout(r, 2_000));
      // Belt-and-suspenders: kill any stragglers (e.g. helper processes)
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
        // No matching processes — already exited cleanly
      }
    }

    // Clean up temp repo
    if (repoCleanup) {
      try {
        repoCleanup();
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  for (const providerId of KNOWN_PROVIDERS) {
    test(`${providerId} provider completes the hello-world task`, async () => {
      // Skip unavailable providers — shows as "skipped" in Playwright reporter
      if (!availableProviders.has(providerId)) {
        test.skip(true, `${providerId} is not installed`);
        return;
      }

      const providerTimeout = getProviderTimeout(providerId);
      test.setTimeout(providerTimeout);
      const start = Date.now();
      let workspaceId: string | undefined;

      try {
        // Always explicitly switch provider via localStorage — don't assume any
        // default.  A previous test run may have left a different provider active.
        await switchProviderViaLocalStorage(page, providerId);

        // gpt-5.3-codex may not be available via API key access.  The CI
        // workflow probes models and exports CODEX_SMOKE_MODEL with the first
        // one that works.  Set the model via the Settings UI so that the
        // Svelte reactivity system picks up the change (electron-store IPC
        // writes are not reflected in the renderer's SpecialistsStore).
        if (providerId === 'codex') {
          const codexModel = process.env.CODEX_SMOKE_MODEL || 'codex:gpt-5.2-codex/low';
          console.log(`🔧 Setting codex model via Settings UI: ${codexModel}`);
          await setCodexModelViaSettingsUI(page, codexModel);
        }

        // OpenCode models are dynamic (fetched from the CLI at runtime) so
        // they aren't in PROVIDER_MODEL_TIERS.  Without an explicit model
        // override the tier resolution returns empty and the agent factory
        // falls back to the auggie DEFAULT_AGENT_MODEL, which is invalid
        // for opencode.  Set a real model via the Settings UI.
        // if (providerId === 'opencode') {
        //   console.log(`Setting opencode model via Settings UI`);
        //   await setOpencodeModelViaSettingsUI(page);
        // }

        // Reset README between providers (skip for the first one)
        if (results.length > 0) {
          try {
            await resetReadme();
          } catch (err) {
            console.warn(`Failed to reset README before ${providerId}:`, err);
          }
        }

        // Create a workspace through the UI (like a real user would)
        workspaceId = await createWorkspaceWithPrompt(page, { repoPath, prompt: PROMPT });
        await takeScreenshot(page, `${providerId}-workspace-created`);

        // Resolve the worktree README path (the app creates a git worktree,
        // so the agent writes to ~/intent/workspaces/{id}/{slug}/README.md)
        const readmePath = resolveWorktreeReadmePath(workspaceId, repoPath);
        console.log(`📁 Worktree README path: ${readmePath}`);

        // Store the last workspace ID so resetReadme can use the worktree path
        lastWorkspaceId = workspaceId;

        // Wait for at least one agent to appear (proves provider connected)
        await page.waitForSelector('[data-agent-id]', { timeout: 60_000 });
        await takeScreenshot(page, `${providerId}-agent-started`);

        // Auto-approve any permission requests (e.g. tool-use approvals)
        const stopPermissionApprover = startPermissionAutoApprover(page);

        // Reactively monitor the chat thread for the coordinator asking for
        // approval.  Unlike the fixed-timer nudge, this watches the actual
        // last assistant message and responds within 5 seconds.
        const stopChatNudge = startChatNudgeMonitor(
          page,
          'Approved. I approve the plan. Delegate to an implementor now -- do not wait for further approval. The implementor should write "hello world" to README.md immediately.',
        );

        // Check README for "hello world" -- with periodic nudges for providers
        // that may stall waiting for user approval (e.g. opencode)
        const remainingTimeout = providerTimeout - (Date.now() - start);

        // Take periodic screenshots every 30s so CI artifacts show progress.
        let tick = 0;
        const diagnosticInterval = setInterval(async () => {
          tick++;
          await takeScreenshot(page, `${providerId}-progress-${tick}`).catch(() => {});
        }, 30_000);

        try {
          // startChatNudgeMonitor handles approval nudging reactively —
          // no need for the inline nudge in waitForFileContentWithNudge.
          await waitForFileContent(
            readmePath,
            /hello world/i,
            Math.max(remainingTimeout, 10_000),
          );
        } finally {
          clearInterval(diagnosticInterval);
          stopPermissionApprover();
          stopChatNudge();
        }

        // Wait for all agents to finish their work
        const agentTimeout = providerTimeout - (Date.now() - start);
        await waitForAgentCompletion(page, workspaceId, Math.max(agentTimeout, 10_000));

        const durationMs = Date.now() - start;
        await takeScreenshot(page, `${providerId}-pass`);
        console.log(`✅ ${providerId}: PASS (${(durationMs / 1000).toFixed(1)}s)`);

        // Archive workspace and go home for the next provider
        await archiveAndGoHome(page, workspaceId);

        results.push({ providerId, status: 'pass', durationMs });

        // auggie is a hard requirement — must pass
        if (providerId === 'auggie') {
          expect(true).toBe(true); // explicit pass
        }
      } catch (error) {
        const durationMs = Date.now() - start;
        const errorMsg = error instanceof Error ? error.message : String(error);
        await takeScreenshot(page, `${providerId}-fail`).catch(() => {});
        console.error(`❌ ${providerId}: FAIL (${(durationMs / 1000).toFixed(1)}s) — ${errorMsg}`);

        // Diagnostic dump on failure — helps identify where the provider got stuck
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
              }));
            }, workspaceId);
            console.error(`🤖 Agent sessions at failure: ${JSON.stringify(agents, null, 2)}`);
          }
        } catch {
          // diagnostic dump is best-effort
        }

        // Best-effort cleanup even on failure
        if (workspaceId) {
          await archiveAndGoHome(page, workspaceId).catch(() => {});
        }

        results.push({ providerId, status: 'fail', durationMs, error: errorMsg });

        // auggie failure = hard test failure; others = soft failure
        if (providerId === 'auggie') {
          expect(false, `auggie provider failed: ${errorMsg}`).toBe(true);
        } else {
          expect.soft(false, `${providerId} provider failed: ${errorMsg}`).toBe(true);
        }
      }
    });
  }
});
