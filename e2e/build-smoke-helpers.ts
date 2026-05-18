/**
 * Build Smoke Test Helpers
 *
 * Utilities for running smoke tests against the packaged Electron app.
 * Independent from the main e2e test-helpers — these target the packaged binary.
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execSync } from 'child_process';

import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  createWriteStream,
  appendFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { basename, join, resolve } from 'path';

// ---------------------------------------------------------------------------
// findPackagedApp
// ---------------------------------------------------------------------------

/**
 * Locate the packaged Electron app binary in dist-electron/.
 *
 * Resolution order:
 *  1. PACKAGED_APP_PATH env var (explicit override)
 *  2. dist-electron/mac-arm64/Intent by Augment.app/Contents/MacOS/Intent by Augment
 *  3. dist-electron/mac/Intent by Augment.app/Contents/MacOS/Intent by Augment
 *
 * Throws if no binary is found.
 */
export function findPackagedApp(): string {
  const envPath = process.env.PACKAGED_APP_PATH;
  if (envPath) {
    if (!existsSync(envPath)) {
      throw new Error(`PACKAGED_APP_PATH points to a missing file: ${envPath}`);
    }
    return envPath;
  }

  const root = process.cwd();
  const candidates =
    process.platform === 'win32'
      ? [join(root, 'dist-electron', 'win-unpacked', 'Intent by Augment.exe')]
      : [
        join(
          root,
          'dist-electron',
          'mac-arm64',
          'Intent by Augment.app',
          'Contents',
          'MacOS',
          'Intent by Augment',
        ),
        join(
          root,
          'dist-electron',
          'mac',
          'Intent by Augment.app',
          'Contents',
          'MacOS',
          'Intent by Augment',
        ),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find packaged app. Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}\n` +
    'Set PACKAGED_APP_PATH to override.',
  );
}

// ---------------------------------------------------------------------------
// killExistingPackagedApp
// ---------------------------------------------------------------------------

/**
 * Kill any running "Intent by Augment" processes to release the single instance lock.
 * The packaged app uses app.requestSingleInstanceLock() which prevents a second
 * instance from launching.
 */
async function killExistingPackagedApp(): Promise<void> {
  console.log('⚠️  Killing existing "Intent by Augment" processes for clean test launch...');
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /F /IM "Intent by Augment.exe"', { stdio: 'ignore', windowsHide: true });
    } catch {
      // No matching processes — that's fine
    }
  } else {
    try {
      // Kill the main process
      execSync('pkill -f "Intent by Augment"', { stdio: 'ignore' });
    } catch {
      // No matching processes — that's fine
    }
    // Also try killing by app bundle name (macOS)
    try {
      execSync('pkill -f "Intent by Augment.app"', { stdio: 'ignore' });
    } catch {
      // No matching processes
    }
  }
  // Wait for processes to fully terminate and release the lock file
  await new Promise((r) => setTimeout(r, 2000));
}

// ---------------------------------------------------------------------------
// launchPackagedApp
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  /** Directory to use as the workspace root */
  workspaceDir?: string;
  /** Extra environment variables passed to the app */
  extraEnv?: Record<string, string>;
}

/**
 * Launch the packaged Electron app and wait for it to be ready.
 *
 * Returns the ElectronApplication handle, the first window Page, and paths
 * to log files capturing the Electron main-process stdout/stderr and
 * renderer console output.
 */
export async function launchPackagedApp(options: LaunchOptions = {}): Promise<{
  app: ElectronApplication;
  page: Page;
  logPaths: { mainProcess: string; renderer: string };
}> {
  await killExistingPackagedApp();

  const executablePath = findPackagedApp();

  const app = await electron.launch({
    executablePath,
    args: [...(process.env.CI ? ['--disable-gpu', '--disable-software-rasterizer'] : [])],
    env: {
      ...process.env,
      TESTING: 'true',
      ...(options.workspaceDir ? { TEST_WORKSPACE_DIR: options.workspaceDir } : {}),
      ...(options.extraEnv || {}),
    },
  });

  // --- Capture Electron main-process stdout/stderr ---
  const logDir = join(process.cwd(), 'e2e-reports', 'build-smoke');
  mkdirSync(logDir, { recursive: true });

  const mainProcessLogPath = join(logDir, 'electron-main-process.log');
  const rendererLogPath = join(logDir, 'electron-renderer.log');

  const proc = app.process();
  const logStream = createWriteStream(mainProcessLogPath, { flags: 'w' });
  if (proc.stdout) {
    proc.stdout.pipe(logStream);
  }
  if (proc.stderr) {
    proc.stderr.pipe(logStream);
  }

  const page = await app.firstWindow();

  // --- Capture renderer console output ---
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}\n`;
    try {
      appendFileSync(rendererLogPath, line);
    } catch {
      // best-effort — don't let logging failures break the test
    }
  });
  // The app has no data-testid="app-ready" attribute.
  // Instead, wait for the splash screen to be removed (signals Svelte layout mounted)
  // and then for the home page content to render.
  await page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 30_000,
  });
  // Give the home page components time to initialize
  await page.waitForTimeout(2_000);

  // --- Dismiss "Update check failed" toast if visible ---
  // The auto-updater may show an error toast that can interfere with UI interactions.
  try {
    const toastClose = page.locator('[data-sonner-toast] button[data-close-button]').first();
    const toastVisible = await toastClose.isVisible().catch(() => false);
    if (toastVisible) {
      console.log('🔕 Dismissing update-check toast');
      await toastClose.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // No toast or already gone — fine
  }

  return { app, page, logPaths: { mainProcess: mainProcessLogPath, renderer: rendererLogPath } };
}

// ---------------------------------------------------------------------------
// createTempRepo
// ---------------------------------------------------------------------------

/**
 * Create a temporary git repository with an initial commit.
 *
 * Uses a **stable** path (`/tmp/build-smoke-repo`) so that stale localStorage
 * references from a previous test run still point to a valid directory.
 * The directory is deleted and recreated fresh each time.
 *
 * Returns the absolute path to the repo. The caller should call the returned
 * `cleanup` function when done.
 */
export function createTempRepo(): { repoPath: string; cleanup: () => void } {
  const repoPath = join(tmpdir(), 'build-smoke-repo');

  // Delete any leftover directory from a previous run and recreate fresh
  rmSync(repoPath, { recursive: true, force: true });
  mkdirSync(repoPath, { recursive: true });

  console.log(`📂 Created temp repo at stable path: ${repoPath}`);

  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "smoke-test@test.local"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Smoke Test"', { cwd: repoPath, stdio: 'ignore' });

  writeFileSync(join(repoPath, 'README.md'), '');
  execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: repoPath, stdio: 'ignore' });

  const cleanup = () => {
    try {
      rmSync(repoPath, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };

  return { repoPath, cleanup };
}

// ---------------------------------------------------------------------------
// createTempRepoFromRemote
// ---------------------------------------------------------------------------

/**
 * Clone a remote repository into a temp directory and check out a fresh branch.
 *
 * Used for e2e tests that need to push commits and open PRs against a real
 * remote (e.g. `augmentcode/intent-e2e-test`).
 *
 * Requires `INTENT_SMOKE_TEST` env var for authentication.  The branch name includes
 * a timestamp and random suffix to avoid collisions between concurrent runs.
 *
 * Returns the repo path, branch name, and a cleanup function that:
 *   - Closes any open PRs from the branch
 *   - Deletes the remote branch
 *   - Removes the local directory
 */
export function createTempRepoFromRemote(options?: {
  /** GitHub repo in "owner/repo" format. Default: augmentcode/intent-e2e-test */
  repo?: string;
  /** PAT token for auth. Default: process.env.INTENT_SMOKE_TEST */
  token?: string;
}): {
  repoPath: string;
  branchName: string;
  cleanup: () => void;
} {
  const repo = options?.repo ?? 'augmentcode/intent-e2e-test';
  const token = options?.token ?? process.env.INTENT_SMOKE_TEST;
  if (!token) {
    throw new Error('INTENT_SMOKE_TEST env var is required for createTempRepoFromRemote');
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const branchName = `e2e-test-${timestamp}-${random}`;

  const repoPath = join(tmpdir(), `build-smoke-pr-repo-${random}`);

  // Delete any leftover directory from a previous run
  rmSync(repoPath, { recursive: true, force: true });

  // Use GIT_ASKPASS to provide the token without embedding it in the URL
  // (avoids leaking the secret in error messages or .git/config)
  const askPassScript = join(tmpdir(), `git-askpass-${random}.sh`);
  writeFileSync(askPassScript, `#!/bin/sh\necho "${token}"\n`, { mode: 0o700 });

  const cloneUrl = `https://x-access-token@github.com/${repo}.git`;
  const gitEnv = { ...process.env, GIT_ASKPASS: askPassScript, GIT_TERMINAL_PROMPT: '0' };
  console.log(`📂 Cloning ${repo} into ${repoPath}...`);
  execSync(`git clone --depth=1 "${cloneUrl}" "${repoPath}"`, { stdio: 'ignore', env: gitEnv });

  // Configure git user and credential helper for this repo
  // (GIT_ASKPASS in repo config ensures push/fetch also use the token without URL embedding)
  execSync('git config user.email "smoke-test@test.local"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Smoke Test"', { cwd: repoPath, stdio: 'ignore' });
  execSync(`git config core.askPass "${askPassScript}"`, { cwd: repoPath, stdio: 'ignore' });

  // Create and check out a new branch
  execSync(`git checkout -b "${branchName}"`, { cwd: repoPath, stdio: 'ignore' });
  console.log(`🌿 Created branch: ${branchName}`);

  // Empty the README so the agent has a clean slate (matches createTempRepo behavior)
  writeFileSync(join(repoPath, 'README.md'), '');
  execSync('git add README.md', { cwd: repoPath, stdio: 'ignore' });
  execSync('git commit -m "reset README for e2e test"', { cwd: repoPath, stdio: 'ignore' });
  execSync(`git push origin "${branchName}"`, { cwd: repoPath, stdio: 'ignore' });

  const cleanup = () => {
    try {
      // Close any open PRs from this branch via gh CLI (best-effort)
      try {
        execSync(
          `gh pr list --repo "${repo}" --head "${branchName}" --state open --json number -q '.[].number' | xargs -I {} gh pr close {} --repo "${repo}" --delete-branch`,
          { stdio: 'ignore', env: { ...process.env, GH_TOKEN: token } },
        );
      } catch {
        // gh may not be installed or no PRs to close
      }
      // Delete the remote branch (best-effort)
      try {
        execSync(`git push origin --delete "${branchName}"`, { cwd: repoPath, stdio: 'ignore' });
      } catch {
        // Branch may already be deleted
      }
      // Remove the local directory and askpass script
      rmSync(repoPath, { recursive: true, force: true });
      try {
        rmSync(askPassScript);
      } catch {
        /* askpass script may already be cleaned up */
      }
    } catch {
      // best-effort cleanup
    }
  };

  return { repoPath, branchName, cleanup };
}

// ---------------------------------------------------------------------------
// createWorkspaceWithPrompt
// ---------------------------------------------------------------------------

export interface CreateWorkspaceOptions {
  /** Absolute path to the git repo to use */
  repoPath: string;
  /** Prompt text to type into onboarding */
  prompt: string;
  /** Provider to select during the welcome step (display name, e.g. 'Mock (E2E)') */
  providerName?: string;
}

/**
 * Create a new workspace from the new onboarding flow.
 *
 * Strategy:
 *  1. Pre-seed sessionStorage/localStorage with the repo path so onboarding
 *     restores it on mount (no dropdown interaction needed)
 *  2. Mock electronAPI.invoke('dialog:open') as fallback (correct format)
 *  3. Focus the prompt textarea and type the prompt
 *  4. Click "Create workspace"
 *  5. Wait for navigation to /workspace/ and return the workspace ID
 */
export async function createWorkspaceWithPrompt(
  page: Page,
  options: CreateWorkspaceOptions,
): Promise<string> {
  const { repoPath, prompt, providerName } = options;

  // Ensure we have a stable origin before seeding onboarding state.
  const baseUrl = await page.evaluate(() => window.location.origin);
  await page.goto(`${baseUrl}/`);
  await page.waitForLoadState('domcontentloaded');

  // Clear form-related localStorage keys to prevent stale state from a
  // previous run. The current onboarding flow reads workspace-prefill first,
  // then falls back to workspace-initializer-last-repo.
  await page.evaluate((path) => {
    // Clear stale state
    localStorage.removeItem('workspace-initializer-last-repo');
    localStorage.removeItem('onboarding-form-state');

    // Clear any saved prompt from a previous run so the editor starts empty.
    sessionStorage.removeItem('onboarding-prompt');

    sessionStorage.setItem('workspace-prefill', JSON.stringify({ repoPath: path, branch: 'main' }));

    // Do NOT seed workspace-initializer-last-repo — it triggers auto-advance
    // past the project step, which leaves projectSelection null and blocks
    // workspace creation. The sessionStorage prefill above is sufficient.
  }, repoPath);

  console.log(`📍 Seeded onboarding prefill with repo path: ${repoPath}`);

  await page.goto(`${baseUrl}/workspace/new`);
  await page.waitForLoadState('domcontentloaded');

  const onboardingRoot = page.locator('[data-onboarding-step]').first();
  await onboardingRoot.waitFor({ state: 'visible', timeout: 20_000 });

  async function getOnboardingStep() {
    return onboardingRoot.getAttribute('data-onboarding-step');
  }

  let onboardingStep = await getOnboardingStep();
  if (onboardingStep === 'welcome') {
    // If a specific provider is requested, click its card in the AgentGrid
    // to select it before proceeding. The card's aria-label is "Use <name>"
    // when the provider is ready (available + authenticated).
    if (providerName) {
      const providerCard = page.locator(`[aria-label="Use ${providerName}"]`).first();
      await providerCard.waitFor({ state: 'visible', timeout: 20_000 });
      await providerCard.click();
      console.log(`🔄 Selected provider: ${providerName}`);
    }

    const letsGo = page.getByRole('button', { name: "Let's go" }).first();
    await letsGo.waitFor({ state: 'visible', timeout: 20_000 });

    // Wait for the "Let's go" button to become enabled.  The button requires
    // at least one provider to be available + authenticated, which involves
    // async IPC calls + CLI checks that can be slow on cold CI runners.
    const isEnabled = await letsGo.isEnabled().catch(() => false);
    if (!isEnabled) {
      console.log('⏳ "Let\'s go" button is disabled — waiting for provider availability...');
      try {
        await page.waitForFunction(
          () => {
            const btn = [...document.querySelectorAll('button')].find((b) =>
              b.textContent?.includes("Let's go"),
            );
            return btn && !btn.disabled;
          },
          { timeout: 45_000 },
        );
        console.log('✅ "Let\'s go" button is now enabled');
      } catch {
        // Provider check didn't complete in time — bypass the welcome step
        // by dispatching goToStep('project') through the Redux store.
        console.warn('⚠️ "Let\'s go" button still disabled after 45s — bypassing welcome step via Redux');
        await page.evaluate(() => {
          const ctx = (window as any).intent?.reduxContext;
          const store = Array.isArray(ctx) ? ctx[0]?.store : ctx?.store;
          if (store) {
            store.dispatch({ type: 'onboarding/goToStep', payload: ['project'] });
          }
        });
        await page.locator('[data-onboarding-step="project"]').waitFor({ timeout: 10_000 });
        onboardingStep = 'project';
      }
    }

    if (onboardingStep === 'welcome') {
      await letsGo.click();
      await page.locator('[data-onboarding-step="project"]').waitFor({ timeout: 10_000 });
      onboardingStep = 'project';
    }
  }

  if (onboardingStep === 'project') {
    // Wait for ProjectPickerMessage to mount and read from sessionStorage
    // before advancing — this populates projectSelection.isValid.
    await page.waitForTimeout(1_000);
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`);
    await page.locator('[data-onboarding-step="configuring"]').waitFor({ timeout: 10_000 });
  } else if (onboardingStep !== 'configuring') {
    throw new Error(`Unexpected onboarding step before prompt entry: ${onboardingStep}`);
  }

  // Mock the native folder picker dialog as a fallback in case the user
  // clicks the folder picker button. RepoSelector.svelte expects
  // { success: true, data: { canceled, filePaths } }.
  await page.evaluate((path) => {
    const originalInvoke = (window as any).electronAPI?.invoke;
    if (originalInvoke) {
      (window as any).electronAPI.invoke = async (channel: string, ...args: any[]) => {
        if (channel === 'dialog:open') {
          return { success: true, data: { canceled: false, filePaths: [path] } };
        }
        return originalInvoke(channel, ...args);
      };
    }
  }, repoPath);

  // Focus the TipTap rich-text editor and type the prompt.
  // RichTextarea uses TipTap (contenteditable div), not a native <textarea>.
  // The wrapper has role="textbox"; inside it TipTap creates a [contenteditable] div.
  //
  // IMPORTANT: When the editor is empty, suggestion pills with pointer-events-auto
  // overlay the contenteditable area (OnboardingPromptStep.svelte line ~237).
  // Clicking the contenteditable hits the overlay instead of focusing the editor.
  // Use page.evaluate to programmatically focus the ProseMirror element.
  const editable = page.locator('[role="textbox"] [contenteditable="true"]').first();
  await editable.waitFor({ state: 'visible', timeout: 10_000 });

  // Programmatically focus — bypasses any overlays
  await editable.evaluate((el: HTMLElement) => el.focus());
  await page.waitForTimeout(300);

  // Verify focus took hold; if not, try clicking the top-left corner of the
  // editor (above the suggestion overlay which starts at top: 52px)
  const isFocused = await editable.evaluate((el) =>
    el === document.activeElement || el.contains(document.activeElement));
  if (!isFocused) {
    console.log('⚠️ Programmatic focus failed, clicking editor top-left corner...');
    const box = await editable.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.waitForTimeout(300);
    }
  }

  // Clear any pre-existing content before typing.  When multiple providers run
  // in serial the editor may still contain text from a previous iteration
  // (restored from sessionStorage or not yet cleared).  Select-all + delete
  // ensures we start with a blank slate so the prompt isn't duplicated.
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);

  await page.keyboard.type(prompt, { delay: 10 });

  // Wait for "Create workspace" button to be enabled before clicking.
  // If the repo selector still shows an invalid/stale path the button stays
  // disabled.  Waiting here gives a clear error instead of a silent no-op click.
  const createBtn = page.locator('button', { hasText: 'Create workspace' });
  await createBtn.waitFor({ state: 'visible', timeout: 10_000 });

  try {
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Create workspace'),
        );
        return btn && !btn.disabled;
      },
      { timeout: 10_000 },
    );
  } catch {
    // Take a screenshot for debugging before throwing
    const enabled = await createBtn.isEnabled();
    console.error(
      `❌ "Create workspace" button enabled=${enabled} — repo selector may show stale path`,
    );
    throw new Error(
      `"Create workspace" button is still disabled after 10s. ` +
      `The repo selector likely shows a stale/invalid path. Repo path: ${repoPath}`,
    );
  }

  console.log('✅ "Create workspace" button is enabled — clicking');
  await createBtn.click();

  // Wait for navigation to the actual workspace page (not /workspace/creating).
  // The new onboarding flow navigates to /workspace/creating first, then
  // redirects to /workspace/<slug> once the workspace is ready.
  await page.waitForURL(
    (url) => {
      const path = url.pathname || url.toString();
      return /\/workspace\//.test(path) && !/\/workspace\/creating/.test(path) && !/\/workspace\/new/.test(path);
    },
    { timeout: 60_000 },
  );
  const url = page.url();
  const workspaceId = url.match(/\/workspace\/([^/?#]+)/)?.[1];
  if (!workspaceId) {
    throw new Error(`Failed to extract workspace ID from URL: ${url}`);
  }
  console.log(`✅ Workspace created: ${workspaceId} (URL: ${url})`);
  return workspaceId;
}

// ---------------------------------------------------------------------------
// resolveWorktreeReadmePath
// ---------------------------------------------------------------------------

/**
 * Resolve the path to README.md inside the worktree that the app creates.
 *
 * The app creates a git worktree at:
 *   ~/intent/workspaces/{workspaceId}/{repo-slug}/
 *
 * where repo-slug is the slugified last segment of the repo path, falling
 * back to 'repo' if the slug doesn't exist on disk.
 */
export function resolveWorktreeReadmePath(workspaceId: string, repoPath: string): string {
  const repoName = basename(repoPath);
  const slugCandidate = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const wsBase = join(homedir(), 'intent', 'workspaces', workspaceId);

  const candidatePath = join(wsBase, slugCandidate, 'README.md');
  if (existsSync(join(wsBase, slugCandidate))) {
    return candidatePath;
  }

  // Fallback to 'repo' folder name
  return join(wsBase, 'repo', 'README.md');
}

// ---------------------------------------------------------------------------
// waitForFileContent
// ---------------------------------------------------------------------------

/**
 * Poll the filesystem until a file contains the given pattern.
 *
 * Useful for verifying that an agent wrote expected content (e.g. "hello world"
 * in README.md). Default timeout: 2 minutes.
 */
export async function waitForFileContent(
  filePath: string,
  pattern: string | RegExp,
  timeout: number = 2 * 60 * 1000,
): Promise<void> {
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        const matches =
          typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
        if (matches) return;
      }
    } catch {
      // file may not exist yet — keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timed out after ${timeout}ms waiting for ${filePath} to contain ${String(pattern)}`,
  );
}

// ---------------------------------------------------------------------------
// sendFollowUpMessage
// ---------------------------------------------------------------------------

/**
 * Send a follow-up message in the active workspace chat.
 *
 * Locates the TipTap rich-text input, types the message, and presses
 * Enter to send.  Best-effort — swallows errors so it can be used
 * as a non-critical "nudge" to unblock stuck agents.
 *
 * IMPORTANT: The selector is scoped to the active (visible) tab content
 * wrapper so that we don't accidentally type into the spec editor or a
 * chat input in a hidden tab.  When multiple tabs are cached in the DOM,
 * an unscoped `.tiptap-editor` selector can match editors in hidden panels.
 *
 * NOTE: We intentionally use plain Enter (normal submit) rather than
 * Cmd+Enter (force-submit) because force-submit calls stopChat() first,
 * which can wake sleeping agents via event subscriptions and cause races.
 */
export async function sendFollowUpMessage(page: Page, message: string): Promise<void> {
  // Scope to the active (visible) tab content wrapper.  The chat input is a
  // TipTap/ProseMirror editor with class .tiptap-editor and contenteditable="true".
  // Without scoping, we can hit the spec editor or a hidden tab's chat input.
  //
  // IMPORTANT: The editor may be temporarily disabled (contenteditable="false")
  // during session transitions.  Retry with backoff to handle this race.
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 500;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const editable = page
      .locator('.tab-content-wrapper:not(.hidden) .tiptap-editor[contenteditable="true"]')
      .first();
    const visible = await editable.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!visible) {
      // Fallback: try unscoped selector (e.g. during workspace creation when
      // tab-content-wrapper may not exist yet)
      const fallback = page.locator('.tiptap-editor[contenteditable="true"]').first();
      const fallbackVisible = await fallback.isVisible({ timeout: 2_000 }).catch(() => false);
      if (!fallbackVisible) {
        if (attempt < MAX_RETRIES) {
          console.log(
            `⚠️  Chat input not visible (attempt ${attempt}/${MAX_RETRIES}) — retrying in ${RETRY_DELAY_MS}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        console.log('⚠️  Chat input not visible after retries — skipping nudge');
        return;
      }
      await fallback.click();
      await page.waitForTimeout(300);
      await page.keyboard.type(message, { delay: 5 });
      // Small delay to let ProseMirror process the last keystroke and update
      // the Svelte binding (canSend derives from value.trim()).  Without this,
      // Enter can fire before the value binding updates, causing handleSubmit
      // to see canSend=false and silently return.
      await page.waitForTimeout(100);
      await page.keyboard.press('Enter');
      console.log(`💬 Sent follow-up nudge (fallback): "${message}"`);
      return;
    }
    await editable.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(message, { delay: 5 });
    // Small delay to let ProseMirror process the last keystroke and update
    // the Svelte binding (canSend derives from value.trim()).
    await page.waitForTimeout(100);
    // Enter to send (normal submit, not force-submit)
    await page.keyboard.press('Enter');
    console.log(`💬 Sent follow-up nudge: "${message}"`);
    return;
  }
}

// ---------------------------------------------------------------------------
// waitForFileContentWithNudge
// ---------------------------------------------------------------------------

/**
 * Like `waitForFileContent` but periodically sends a follow-up "nudge"
 * message if the file hasn't been written yet AND the agent has been
 * truly idle (no streaming, no new messages) for at least 60 seconds.
 *
 * Some providers (e.g. opencode) may pause waiting for user approval.
 * The nudge tells the agent to proceed.
 */
export async function waitForFileContentWithNudge(
  page: Page,
  filePath: string,
  pattern: string | RegExp,
  timeout: number = 2 * 60 * 1000,
  nudgeMessage: string = 'go ahead, proceed with the plan',
): Promise<void> {
  const pollInterval = 2_000;
  const nudgeInterval = 60_000; // Only nudge after 60s of true inactivity
  const deadline = Date.now() + timeout;
  let lastActivityTime = Date.now(); // Track last detected UI activity
  let nudgeCount = 0;
  const MAX_NUDGES = 3;
  let lastAssistantMessageId: string | null = null;

  while (Date.now() < deadline) {
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        const matches =
          typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
        if (matches) return;
      }
    } catch {
      // file may not exist yet — keep polling
    }

    // Check for UI activity before considering a nudge
    let activityDetected = false;

    // Check streaming indicators.
    // NOTE: Do NOT include `.animate-pulse` here — it matches generic loading
    // spinners and save indicators that are always visible, which prevents the
    // inactivity timer from ever reaching the nudge threshold.
    const streaming = await page
      .locator('.tab-content-wrapper:not(.hidden) [data-streaming="true"], .tab-content-wrapper:not(.hidden) [data-agent-status="streaming"]')
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    if (streaming) {
      activityDetected = true;
    }

    // Check if the last assistant message ID has changed.
    // Scope to the active tab so hidden tabs' messages don't cause false activity.
    const currentMessageId = await page
      .locator('.tab-content-wrapper:not(.hidden) [data-message-role="assistant"]')
      .last()
      .getAttribute('data-message-id')
      .catch(() => null);
    if (currentMessageId && currentMessageId !== lastAssistantMessageId) {
      activityDetected = true;
      lastAssistantMessageId = currentMessageId;
    }

    if (activityDetected) {
      console.log('[file-nudge] Activity detected, resetting inactivity timer');
      lastActivityTime = Date.now();
    }

    // Only nudge after 60s of complete inactivity
    const inactivityDuration = Date.now() - lastActivityTime;
    if (nudgeCount < MAX_NUDGES && inactivityDuration >= nudgeInterval) {
      try {
        console.log(
          `[file-nudge] No activity for ${(inactivityDuration / 1000).toFixed(0)}s, sending nudge ${nudgeCount + 1}/${MAX_NUDGES}`,
        );
        await sendFollowUpMessage(page, nudgeMessage);
        nudgeCount++;
        lastActivityTime = Date.now(); // Reset so we wait another 60s before next nudge
      } catch {
        // nudge is best-effort
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timed out after ${timeout}ms waiting for ${filePath} to contain ${String(pattern)}`,
  );
}

// ---------------------------------------------------------------------------
// waitForAgentCompletion
// ---------------------------------------------------------------------------

/**
 * Poll agent sessions via IPC until ALL agents have finished streaming.
 *
 * Uses `page.evaluate()` to call `electronAPI.invoke('agent:list-sessions', workspaceId)`
 * which queries the in-memory unified state store for accurate `isStreaming` state.
 * (The on-disk JSON `status` field is never updated when agents complete, so disk
 * polling does not work.)
 *
 * Falls back to UI-based detection if the IPC call consistently fails (e.g. when
 * the agent backend service is unavailable in the packaged build).
 *
 * Polls every 2 seconds. Resolves when all agents are settled or timeout expires.
 */
export async function waitForAgentCompletion(
  page: Page,
  workspaceId: string,
  timeout: number = 2 * 60 * 1000,
): Promise<void> {
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;
  let consecutiveIpcFailures = 0;
  const IPC_FAILURE_THRESHOLD = 5; // Switch to UI fallback after 5 consecutive IPC failures

  console.log(`⏳ Waiting for agents to complete (timeout: ${(timeout / 1000).toFixed(0)}s)...`);

  if (process.env.CI) {
    console.log('⏩ CI detected — skipping IPC polling, using UI-based agent completion detection');
    await waitForAgentCompletionViaUI(page, deadline);
    return;
  }

  while (Date.now() < deadline) {
    // If IPC is consistently broken, fall back to UI-based detection
    if (consecutiveIpcFailures >= IPC_FAILURE_THRESHOLD) {
      console.log('⚠️  IPC agent polling failed repeatedly — switching to UI-based detection');
      await waitForAgentCompletionViaUI(page, deadline);
      return;
    }

    try {
      const agentInfo = await page.evaluate(async (wsId) => {
        const response = await (window as any).electronAPI.invoke('agent:list-sessions', wsId);
        const data = response?.data;
        // Handle both response shapes: data may be AgentSession[] or { agents: AgentSession[] }
        const sessions: any[] = Array.isArray(data) ? data : data?.agents || [];
        return {
          total: sessions.length,
          streaming: sessions.filter((s: any) => s.isStreaming).length,
          agents: sessions.map((s: any) => ({
            id: s.id,
            name: s.name,
            isStreaming: !!s.isStreaming,
          })),
        };
      }, workspaceId);

      consecutiveIpcFailures = 0; // Reset on success

      console.log(`🔄 Agents: ${agentInfo.total} total, ${agentInfo.streaming} still streaming`);

      if (agentInfo.total > 0 && agentInfo.streaming === 0) {
        console.log('✅ All agents have completed');
        return;
      }
    } catch (err) {
      consecutiveIpcFailures++;
      console.log(
        `🔄 Polling error (${consecutiveIpcFailures}/${IPC_FAILURE_THRESHOLD} before UI fallback): ${err}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.warn('⚠️  Timed out waiting for agents to complete — proceeding anyway');
}

/**
 * Wait until no agent in the workspace is streaming.
 *
 * This is a stronger post-condition than waitForAgentCompletion: it polls
 * the IPC `agent:list-sessions` endpoint (which reflects the in-memory
 * `isStreaming` flag set/cleared by the backend handler) until all agents
 * report `isStreaming === false`.  Falls back to a fixed delay on IPC
 * failure so the caller is never blocked forever.
 *
 * Use this between follow-up messages to avoid hitting the backend's
 * `inFlightSessionPrompts` duplicate guard which silently drops prompts
 * sent while the previous session/prompt is still being finalized.
 */
export async function waitForAgentNotStreaming(
  page: Page,
  workspaceId: string,
  timeout: number = 15_000,
): Promise<void> {
  // In CI, IPC calls to agent:list-sessions consistently fail.
  // Instead, poll the renderer's Redux store directly — it's the same
  // source of truth the send-message saga uses to decide send vs queue.
  // We need ALL workspace agents to be: isStreaming=false, isResponding=false,
  // and have a stopReason set (meaning the stream fully completed).
  if (process.env.CI) {
    console.log('⏩ CI detected — using Redux store polling for waitForAgentNotStreaming');
    const deadline = Date.now() + timeout;
    const pollInterval = 500;

    while (Date.now() < deadline) {
      try {
        const storeState = await page.evaluate((wsId) => {
          try {
            const ctx = (window as any).intent?.reduxContext;
            const store = Array.isArray(ctx) ? ctx[0]?.store : ctx?.store;
            if (!store) return { available: false, reason: 'no-store' };

            const state = store.getState();
            // workspace-agents slice: state.workspaceAgents.byWorkspaceId[wsId].agentIds
            // agent-session slice: state.agentSessions.byAgentId[agentId]
            const wsState = state?.workspaceAgents?.byWorkspaceId?.[wsId];
            const agentIds: string[] = wsState?.agentIds || [];
            const byAgentId = state?.agentSessions?.byAgentId || {};

            if (agentIds.length === 0) {
              return { available: true, allIdle: true, agentCount: 0, details: 'no agents' };
            }

            const agentStates = agentIds.map((id: string) => {
              const session = byAgentId[id];
              // Check if the latest assistant message is still streaming.
              // The send-message saga's selectAgentIsResponding selector checks
              // isStreamingMessage(latestAssistant), so we must too — otherwise we
              // can declare the agent idle while the saga still thinks it's active
              // and routes our follow-up to the queue path.
              const messages: any[] = session?.messages || [];
              let lastAssistantStreaming = false;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i]?.role === 'assistant') {
                  const msg = messages[i];
                  lastAssistantStreaming = !!(msg.isStreaming || msg.streamingComplete === false);
                  break;
                }
              }
              return {
                id,
                isStreaming: session?.isStreaming ?? false,
                isResponding: session?.isResponding ?? false,
                isProcessing: session?.isProcessing ?? false,
                status: session?.status,
                stopReason: session?.stopReason,
                lastAssistantStreaming,
                activationState: session?.activationState,
              };
            });

            // An agent is idle when EITHER:
            // 1. All streaming/processing flags are cleared AND the latest
            //    assistant message is not streaming AND status is not 'active'
            //    (matches the saga's selectAgentIsResponding / isActiveAgentThread
            //    logic which checks stored.status === 'active' and
            //    isStreamingMessage(latestAssistant)), OR
            // 2. The backend has authoritatively set status='idle' with a stopReason
            //    (the agent:idle event updates status/stopReason).
            const allIdle = agentStates.every(
              (a: any) => {
                // Path 2: authoritative idle
                if (a.status === 'idle' && a.stopReason != null) return true;
                // Path 1: all flags cleared + no streaming assistant message + non-active status
                const flagsCleared = !a.isStreaming && !a.isResponding && !a.isProcessing;
                const statusNotActive = a.status !== 'active';
                return flagsCleared && !a.lastAssistantStreaming && statusNotActive;
              },
            );

            return {
              available: true,
              allIdle,
              agentCount: agentStates.length,
              details: JSON.stringify(agentStates),
            };
          } catch (e: any) {
            return { available: false, reason: e.message };
          }
        }, workspaceId);

        if (storeState.available && storeState.allIdle && storeState.agentCount > 0) {
          console.log(
            `✅ Redux store confirms all ${storeState.agentCount} agents idle — ` +
            `waiting 10s for IPC response + saga cleanup + tryBeginSessionPrompt guard`,
          );
          // Buffer for the backend IPC response to arrive, the saga's
          // activeSends guard to clear, AND the backend's tryBeginSessionPrompt
          // guard to release.  The guard is cleared in onComplete (after
          // finalizeStream + emitAgentIdleEvent) but the session/prompt
          // JSON-RPC result may not have resolved yet — the done notification
          // fires before the provider promise resolves, so the finally block
          // (which also clears the guard) may still be pending.
          // Extended from 5s to 10s: CI runners can be slow and the
          // provider.streamMessage() promise may take longer to resolve,
          // leaving activeSends stale and causing follow-up routing races.
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return;
        }

        if (!storeState.available) {
          console.log(`⚠️  Redux store not available: ${storeState.reason}`);
        } else if (!storeState.allIdle) {
          console.log(`🔄 Agents not idle yet: ${storeState.details}`);
        } else if (storeState.agentCount === 0) {
          console.log(`⚠️  No agents found in workspace ${workspaceId}`);
        }
      } catch (err: any) {
        console.log(`⚠️  Redux store poll error: ${err.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // If we timed out, apply a generous fixed delay
    console.log('⏳ Redux store polling timed out — using 8s fallback delay');
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    return;
  }

  // Non-CI path: use IPC polling
  const pollInterval = 500;
  const deadline = Date.now() + timeout;
  let ipcFailed = false;

  while (Date.now() < deadline) {
    try {
      const info = await page.evaluate(async (wsId) => {
        const response = await (window as any).electronAPI.invoke('agent:list-sessions', wsId);
        const data = response?.data;
        const sessions: any[] = Array.isArray(data) ? data : data?.agents || [];
        return {
          total: sessions.length,
          streaming: sessions.filter((s: any) => s.isStreaming).length,
        };
      }, workspaceId);

      if (info.total > 0 && info.streaming === 0) {
        return; // All agents idle
      }
    } catch {
      ipcFailed = true;
      break; // Fall back to fixed delay
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Fallback: if IPC doesn't work or timed out, wait a fixed period
  // to give the backend time to clear the in-flight prompt guard.
  if (ipcFailed) {
    console.log('⏳ IPC unavailable — using fixed 8s delay for backend settling');
    await new Promise((resolve) => setTimeout(resolve, 8_000));
  } else {
    console.log('⏳ Agent still streaming after timeout — proceeding anyway');
  }
}

/**
 * UI-based fallback for detecting agent completion.
 *
 * Checks the page for visual indicators that agents have finished:
 * - No spinning/loading indicators in the agent sidebar
 * - Agent chat shows a final message (not streaming)
 * - The "Send message" button is present (chat is idle)
 *
 * This is less precise than IPC polling but works when the agent backend
 * service is unavailable.
 */
async function waitForAgentCompletionViaUI(page: Page, deadline: number): Promise<void> {
  const pollInterval = 3_000;

  while (Date.now() < deadline) {
    try {
      // Check if there are any streaming indicators visible.
      // NOTE: Do NOT include `.animate-pulse` — it matches generic loading
      // spinners that are always visible, causing this to never detect completion.
      const hasStreamingIndicator = await page
        .locator('.tab-content-wrapper:not(.hidden) [data-streaming="true"], .tab-content-wrapper:not(.hidden) [data-agent-status="streaming"]')
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false);

      if (!hasStreamingIndicator) {
        // Double-check: the chat input should be enabled (not disabled) when agents are idle
        const sendButtonDisabled = await page
          .locator('button:has-text("Send message")[disabled]')
          .isVisible({ timeout: 1_000 })
          .catch(() => false);

        // If send button is disabled, the agent might still be processing
        // But if there's no streaming indicator AND the page looks settled, we're done
        if (!sendButtonDisabled) {
          console.log('✅ All agents appear complete (UI-based detection)');
          return;
        }

        // Even with disabled send button, if no streaming indicators, give it one more check
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const stillStreaming = await page
          .locator('.tab-content-wrapper:not(.hidden) [data-streaming="true"], .tab-content-wrapper:not(.hidden) [data-agent-status="streaming"]')
          .first()
          .isVisible({ timeout: 1_000 })
          .catch(() => false);

        if (!stillStreaming) {
          console.log('✅ All agents appear complete (UI-based detection, confirmed)');
          return;
        }
      }
    } catch (err) {
      console.log(`🔄 UI polling error (will retry): ${err}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.warn('⚠️  Timed out waiting for agents (UI-based) — proceeding anyway');
}

// ---------------------------------------------------------------------------
// getAvailableProviders (IPC-based)
// ---------------------------------------------------------------------------

/**
 * Detect which providers are available using the `providers:get-availability`
 * IPC channel.
 *
 * Returns a Set of provider IDs (e.g. `new Set(['auggie', 'claude-code'])`).
 */
export async function getAvailableProviders(page: Page): Promise<Set<string>> {
  // Clear stale workspace state from localStorage to prevent ErrorBoundary
  // from blocking the page.
  await page.evaluate(() => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('workspace:')) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  });

  const result = await page.evaluate(async () => {
    const response = await (window as any).electronAPI.invoke('providers:get-availability');
    return response?.data;
  });

  const available = new Set<string>();
  const keyMap: Record<string, string> = {
    auggie: 'auggie',
    claudeCode: 'claude-code',
    codex: 'codex',
    mock: 'mock',
    opencode: 'opencode',
  };

  for (const [key, providerId] of Object.entries(keyMap)) {
    if (result?.providers?.[key]?.available) {
      available.add(providerId);
    }
  }

  return available;
}

// ---------------------------------------------------------------------------
// switchProviderViaLocalStorage
// ---------------------------------------------------------------------------

/**
 * Switch the active provider by writing to localStorage and reloading.
 *
 * The active provider is stored under the `workspaces-active-provider` key
 * (see `src/lib/stores/active-provider.store.svelte.ts`).
 */
export async function switchProviderViaLocalStorage(page: Page, providerId: string): Promise<void> {
  await page.evaluate((id) => {
    localStorage.setItem('workspaces-active-provider', id);
  }, providerId);

  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Verify the switch actually took effect.  If localStorage was cleared by
  // the reload (unlikely but observed), retry once.
  const actual = await page.evaluate(() => localStorage.getItem('workspaces-active-provider'));
  if (actual !== providerId) {
    console.warn(
      `⚠️  Provider switch verification failed: expected '${providerId}', got '${actual}' — retrying`,
    );
    await page.evaluate((id) => {
      localStorage.setItem('workspaces-active-provider', id);
    }, providerId);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const retry = await page.evaluate(() => localStorage.getItem('workspaces-active-provider'));
    if (retry !== providerId) {
      throw new Error(
        `Provider switch failed after retry: expected '${providerId}', got '${retry}'`,
      );
    }
  }
  console.log(`🔄 Switched provider to: ${providerId}`);
}

// ---------------------------------------------------------------------------
// setSpecialistModelOverrides
// ---------------------------------------------------------------------------

/**
 * Set specialist model overrides via electron-store IPC.
 *
 * Writes to the `specialists-overrides` electron-store key, which is read by
 * `SpecialistsStore.loadOverrides()` on init and by `getUserModelOverride()`
 * in the main process.  This is the correct way to override the model used
 * by `InitialAgentPicker.resolveEffectiveModel()` — localStorage-based
 * overrides are ignored.
 *
 * @param page      Playwright Page with access to `window.electronAPI`
 * @param overrides Map of specialist ID → model ID (e.g. `{ 'spec-writer': 'codex:gpt-5.2-codex' }`)
 */
export async function setSpecialistModelOverrides(
  page: Page,
  overrides: Record<string, string>,
): Promise<void> {
  await page.evaluate(async (modelOverrides) => {
    await (window as any).electronAPI.invoke('settings:set', {
      key: 'specialists-overrides',
      value: {
        modelOverrides,
        behaviorPromptOverrides: {},
      },
    });
  }, overrides);

  // Reload so SpecialistsStore.loadOverrides() picks up the new values
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

// ---------------------------------------------------------------------------
// setOpencodeModelViaSettingsUI
// ---------------------------------------------------------------------------

/**
 * Set the OpenCode model for Default, Coordinator, and Implementor specialists
 * by navigating through the Settings UI.
 *
 * OpenCode models are dynamic (fetched at runtime from the CLI), so unlike
 * codex we can't look up a label from a static map.  Instead we open the
 * model-picker dropdown, wait for real options to appear, and select:
 *   - The option matching OPENCODE_SMOKE_MODEL env var (if set), OR
 *   - The first non-"Use default" option in the list.
 */
export async function setOpencodeModelViaSettingsUI(page: Page): Promise<void> {
  const envModel = process.env.OPENCODE_SMOKE_MODEL; // e.g. "anthropic/claude-sonnet-4"

  // Helper: open a ModelPicker dropdown inside `container`, wait for real
  // options to load, then click the best match.
  async function selectFirstModelInDropdown(
    container: ReturnType<Page['locator']>,
    context: string,
  ): Promise<string> {
    const trigger = container.locator('button[aria-haspopup="listbox"]').first();
    await trigger.waitFor({ state: 'visible', timeout: 10_000 });
    await trigger.click();

    // Wait for at least one non-"Use default" option to appear (models load async).
    const realOption = page.locator('[role="option"]').filter({ hasNotText: 'Use default' });
    await realOption.first().waitFor({ state: 'visible', timeout: 15_000 });

    // If an env var hint was provided, try to match it (substring match on label text).
    if (envModel) {
      const hint = envModel.replace(/^opencode:/, '');
      const matching = realOption.filter({ hasText: hint });
      if ((await matching.count()) > 0) {
        const label = (await matching.first().textContent()) || hint;
        await matching.first().click();
        await page.waitForTimeout(500);
        console.log(`  [${context}] selected model matching hint: ${label.trim()}`);
        return label.trim();
      }
    }

    // Fallback: pick the first real option.
    const label = (await realOption.first().textContent()) || 'unknown';
    await realOption.first().click();
    await page.waitForTimeout(500);
    console.log(`  [${context}] selected first available model: ${label.trim()}`);
    return label.trim();
  }

  // 1. Navigate to Settings > Agents
  const baseUrl = await page.evaluate(() => window.location.origin);
  await page.goto(`${baseUrl}/settings`);
  await page.waitForLoadState('domcontentloaded');

  const agentsTab = page.locator('button', { hasText: 'Agents' }).first();
  await agentsTab.waitFor({ state: 'visible', timeout: 5_000 });
  await agentsTab.click();
  await page.waitForTimeout(500);

  // 2. Set the Default Model
  const defaultModelSection = page.locator('#default-model');
  await defaultModelSection.waitFor({ state: 'visible', timeout: 5_000 });
  await selectFirstModelInDropdown(defaultModelSection, 'Default');

  // 3. Set Coordinator model
  const coordinatorBtn = page.locator('button').filter({ hasText: 'Coordinator' }).first();
  await coordinatorBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await coordinatorBtn.click();
  await page.waitForTimeout(500);
  await page
    .locator('h2', { hasText: 'Coordinator' })
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });
  const editorPanel = page.locator('.editor-container');
  await selectFirstModelInDropdown(editorPanel, 'Coordinator');

  // 4. Set Implementor model
  const implementorBtn = page.locator('button').filter({ hasText: 'Implementor' }).first();
  await implementorBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await implementorBtn.click();
  await page.waitForTimeout(500);
  await page
    .locator('h2', { hasText: 'Implementor' })
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });
  await selectFirstModelInDropdown(editorPanel, 'Implementor');

  // 5. Navigate back to home
  await page.goto(`${baseUrl}/`);
  await page.waitForLoadState('domcontentloaded');
  console.log(`  opencode model overrides applied via Settings UI`);
}

// ---------------------------------------------------------------------------
// startPermissionAutoApprover
// ---------------------------------------------------------------------------

/**
 * Start auto-approving permission requests via IPC polling.
 *
 * Polls `permission:get-pending` every 2 seconds and responds to each pending
 * request by selecting the option whose `id` includes `'allow'` (falling back
 * to the first option).
 *
 * Returns a cleanup function that stops the polling.
 */
export function startPermissionAutoApprover(page: Page): () => void {
  const interval = setInterval(async () => {
    try {
      const approved = await page.evaluate(async () => {
        const resp = await (window as any).electronAPI.invoke('permission:get-pending');
        if (!resp?.success || !resp?.requests?.length) return 0;
        let count = 0;
        for (const req of resp.requests) {
          const allowOpt = req.options.find((o: any) => o.id.includes('allow')) || req.options[0];
          if (allowOpt) {
            await (window as any).electronAPI.invoke('permission:respond', {
              requestId: req.requestId,
              outcome: { outcome: 'selected', optionId: allowOpt.id },
            });
            count++;
          }
        }
        return count;
      });
      if (approved > 0) console.log(`🔓 Auto-approved ${approved} permission request(s)`);
    } catch {
      /* best-effort */
    }
  }, 2000);
  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// startChatNudgeMonitor
// ---------------------------------------------------------------------------

/**
 * Reactively monitor the chat thread for the coordinator asking for approval.
 *
 * Unlike the fixed-timer nudge in `waitForFileContentWithNudge`, this runs as
 * a background poller (every 10 s) that actually inspects the last assistant
 * message.  When the agent has been idle for at least 60 seconds *and* the
 * message text looks like it is asking for permission / approval / confirmation,
 * a follow-up message is sent.
 *
 * Keeps a set of already-nudged message IDs so it never double-taps.
 *
 * Returns a cleanup function that stops the monitoring.
 */
export function startChatNudgeMonitor(
  page: Page,
  nudgeMessage: string = 'Approved. I approve the plan. Proceed immediately without waiting for further approval.',
): () => void {
  const respondedTo = new Set<string>();
  const MAX_NUDGES = 3;
  let nudgeCount = 0;
  let lastActivityTime = Date.now();
  let lastSeenMessageId: string | null = null;
  let lastSeenMessageCount = 0;
  const INACTIVITY_THRESHOLD = 20_000; // 20 seconds of inactivity required

  const PERMISSION_KEYWORDS = [
    'approval',
    'approve',
    'permission',
    'confirm',
    'shall i',
    'should i',
    'do you want',
    'would you like',
    'waiting for',
    'before i',
    'let me know',
    'ready to proceed',
    'want me to',
    'proceed with',
    'review the plan',
    'look good',
    'go ahead',
  ];

  const interval = setInterval(async () => {
    try {
      // 1. Check if an agent is still actively streaming -- if so, reset inactivity timer.
      // NOTE: Do NOT include `.animate-pulse` — it matches generic loading
      // spinners that are always visible, preventing nudges from ever firing.
      const streaming = await page
        .locator('.tab-content-wrapper:not(.hidden) [data-streaming="true"], .tab-content-wrapper:not(.hidden) [data-agent-status="streaming"]')
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false);
      if (streaming) {
        console.log('[nudge-monitor] Streaming detected, resetting inactivity timer');
        lastActivityTime = Date.now();
        return;
      }

      // 2. Check if message count or last message ID changed (indicates progress).
      //    Scope to the active tab so hidden tabs' messages don't inflate the count.
      const visibleAssistant = page.locator(
        '.tab-content-wrapper:not(.hidden) [data-message-role="assistant"]',
      );
      const messageCount = await visibleAssistant.count();
      const lastAssistant = visibleAssistant.last();
      const visible = await lastAssistant.isVisible({ timeout: 1_000 }).catch(() => false);
      if (!visible) return;

      const messageId = await lastAssistant.getAttribute('data-message-id').catch(() => null);

      if (messageCount !== lastSeenMessageCount || (messageId && messageId !== lastSeenMessageId)) {
        console.log(
          `[nudge-monitor] Activity detected (messages: ${lastSeenMessageCount}->${messageCount}, id: ${lastSeenMessageId}->${messageId}), resetting inactivity timer`,
        );
        lastActivityTime = Date.now();
        lastSeenMessageCount = messageCount;
        if (messageId) lastSeenMessageId = messageId;
      }

      // 3. Only proceed if we've been inactive for at least 20 seconds.
      const inactivityDuration = Date.now() - lastActivityTime;
      if (inactivityDuration < INACTIVITY_THRESHOLD) return;

      if (!messageId || respondedTo.has(messageId)) return;
      if (nudgeCount >= MAX_NUDGES) return;

      // 4. Read the text and check for approval-seeking language.
      const text = await lastAssistant.innerText({ timeout: 2_000 }).catch(() => '');
      if (!text) return;

      const lower = text.toLowerCase();
      const isAskingForApproval = PERMISSION_KEYWORDS.some((kw) => lower.includes(kw));
      if (!isAskingForApproval) return;

      // 5. Agent idle for 60s+ and is asking for approval -- nudge it.
      respondedTo.add(messageId);
      nudgeCount++;
      console.log(
        `[nudge-monitor] Agent idle for ${(inactivityDuration / 1000).toFixed(0)}s and asking for approval (msg ${messageId}), sending nudge ${nudgeCount}/${MAX_NUDGES}...`,
      );
      await sendFollowUpMessage(page, nudgeMessage);
      lastActivityTime = Date.now(); // Reset so we wait another 60s before next nudge
    } catch {
      /* best-effort */
    }
  }, 5_000);

  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// findImplementorAgent
// ---------------------------------------------------------------------------

/**
 * Find the implementor agent in a workspace by scanning the AgentNavRail
 * (the vertical sidebar with agent avatar buttons).
 *
 * The first entry is the coordinator (initial agent); subsequent entries are
 * delegated agents. Returns the agent ID of the second agent (the implementor),
 * or `null` if no implementor was found within the timeout.
 *
 * Uses `[data-agent-id]` selectors from the AgentNavRail component which
 * is always visible, unlike the "Threads" list in AgentsList which requires the
 * Threads tab to be active.
 *
 * Note: The same agent ID may appear in multiple AgentCard instances (e.g. in
 * the main thread list and as a delegated child). This function counts all
 * `[data-agent-id]` elements to detect agents; `openAgentChat` uses `.first()`
 * to avoid Playwright strict-mode violations from duplicate matches.
 *
 * Returns `null` (instead of throwing) when no implementor is found — some
 * providers handle the task inline without delegating.
 */
export async function findImplementorAgent(
  page: Page,
  timeout: number = 15_000,
): Promise<{ name: string; agentId: string } | null> {
  // Agent cards have data-agent-id attributes. The same agent may appear
  // multiple times (main list + delegated children), but nth(1) still gives
  // us a valid implementor agent ID.
  const agentButtons = page.locator('[data-agent-id]');

  // Wait for at least 2 agents to appear (coordinator + implementor)
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = await agentButtons.count();
    if (count >= 2) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }

  const count = await agentButtons.count();
  if (count < 2) {
    console.log(`⚠️  Only ${count} agent(s) in nav rail — provider may not have delegated`);
    return null;
  }

  // First agent = coordinator, second = implementor
  const agentId = await agentButtons.nth(1).getAttribute('data-agent-id');
  if (!agentId) {
    console.log('⚠️  Implementor agent button has no data-agent-id attribute');
    return null;
  }

  // Agent name isn't visible in the nav rail; use a short ID label for logging
  return { name: `implementor (${agentId.substring(0, 8)})`, agentId };
}

// ---------------------------------------------------------------------------
// openAgentChat
// ---------------------------------------------------------------------------

/**
 * Open an agent's chat panel by clicking its avatar button in the AgentNavRail.
 *
 * Uses `[data-agent-id]` which is always visible in the left rail,
 * unlike the "Threads" list which requires a specific sidebar tab.
 *
 * After clicking, waits for the chat panel to become visible (indicated by
 * the presence of a chat message or the chat input in the **active** tab).
 *
 * Includes a retry mechanism: if the first click doesn't activate the
 * correct tab (verified by checking that the active tab's content wrapper
 * contains a chat panel), it scrolls the button into view and clicks again.
 */
export async function openAgentChat(page: Page, agentId: string): Promise<void> {
  // The same agent ID can appear in multiple AgentCard instances (main thread
  // list + delegated children list), so use .first() to avoid Playwright
  // strict-mode violations from duplicate matches.
  const agentButton = page.locator(`[data-agent-id="${agentId}"]`).first();

  await agentButton.waitFor({ state: 'visible', timeout: 10_000 });
  await agentButton.click();

  // Wait for the chat panel to render in the ACTIVE tab — look for a chat
  // input or message inside the visible tab-content-wrapper.
  const activeTabContent = page.locator(
    '.tab-content-wrapper:not(.hidden) .tiptap-editor[contenteditable="true"], ' +
    '.tab-content-wrapper:not(.hidden) [data-message-role]',
  );

  try {
    await activeTabContent.first().waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    // First click may not have activated the tab (e.g. if the button was
    // partially obscured or in a scrollable area).  Scroll into view and retry.
    console.log(`⚠️  First click on agent ${agentId.substring(0, 8)} didn't open tab — retrying`);
    await agentButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await agentButton.click({ force: true });
    await activeTabContent.first().waitFor({ state: 'visible', timeout: 10_000 });
  }

  // Brief settle time for the panel to fully load
  await page.waitForTimeout(1_000);
}

// ---------------------------------------------------------------------------
// waitForAssistantResponse
// ---------------------------------------------------------------------------

/**
 * Wait for the assistant to finish streaming and return the text of the last
 * assistant message in the **active** (visible) chat panel.
 *
 * After sending a message, call this to wait for the response. It polls until
 * no streaming indicators are visible and then extracts the inner text of the
 * last `[data-message-role="assistant"]` element.
 *
 * IMPORTANT: The selector is scoped to the visible tab content wrapper
 * (`.tab-content-wrapper:not(.hidden)`) so that messages from inactive chat
 * panels (e.g. the coordinator's tab) are excluded.  Without this scoping,
 * the function can return a stale message from another panel and fail the
 * pattern assertion.
 *
 * @param previousMessageCount - If provided, wait until the number of visible
 *   assistant messages exceeds this count before extracting. This prevents
 *   returning a stale message from a prior exchange when the chat already has
 *   history.
 */
export async function waitForAssistantResponse(
  page: Page,
  timeout: number = 60_000,
  previousMessageCount?: number,
): Promise<string> {
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;

  // Scope to the active (visible) tab content so we don't pick up messages
  // from other chat panels that are still mounted but hidden in the DOM.
  const visibleMessages = page.locator(
    '.tab-content-wrapper:not(.hidden) [data-message-role="assistant"]',
  );

  // Brief delay to let the stream start before we check streaming state.
  // Without this, we can race: the message is sent, streaming hasn't begun
  // yet, we see "not streaming" and immediately return a stale message.
  await page.waitForTimeout(2_000);

  // If a previous count was provided, wait until at least one new assistant
  // message appears beyond that count before proceeding.
  if (previousMessageCount !== undefined) {
    while (Date.now() < deadline) {
      const currentCount = await visibleMessages.count();
      if (currentCount > previousMessageCount) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  } else {
    // No count guard — just wait for at least one assistant message to appear
    await visibleMessages.last().waitFor({
      state: 'visible',
      timeout: Math.min(timeout, 30_000),
    });
  }

  // Then wait for streaming to stop AND the response text to stabilize.
  // We need both checks because:
  //   1. The streaming indicator may not be set yet when the message first appears
  //   2. The text may still be rendering even after streaming stops
  // So we wait for "not streaming" AND then verify the text doesn't change
  // over a short window before returning.
  let lastText = '';
  let stableCount = 0;
  const STABLE_CHECKS_REQUIRED = 2; // Text must be unchanged for 2 consecutive checks

  while (Date.now() < deadline) {
    const isStreaming = await page
      .locator('.tab-content-wrapper:not(.hidden) [data-streaming="true"], .tab-content-wrapper:not(.hidden) [data-agent-status="streaming"]')
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    if (!isStreaming) {
      // Streaming stopped — check if the text has stabilized
      const text = await visibleMessages
        .last()
        .innerText({ timeout: 5_000 })
        .catch(() => '');

      if (text && text === lastText) {
        stableCount++;
        if (stableCount >= STABLE_CHECKS_REQUIRED) {
          return text;
        }
      } else {
        // Text changed — reset stability counter
        stableCount = 0;
        lastText = text;
      }
    } else {
      // Still streaming — reset stability tracking
      stableCount = 0;
      lastText = '';
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout — return whatever is there
  const text = await visibleMessages
    .last()
    .innerText({ timeout: 5_000 })
    .catch(() => '');
  return text;
}

// ---------------------------------------------------------------------------
// setMockAgentBehavior
// ---------------------------------------------------------------------------

/**
 * Build a `MOCK_AGENT_BEHAVIOR` env-var payload for the mock ACP provider.
 *
 * The mock provider reads this env var on startup and replays the described
 * behavior instead of calling a real LLM.
 *
 * @param options.files  - Map of relative file paths → content the mock agent
 *                         should write (e.g. `{ 'README.md': 'hello world' }`).
 * @param options.response - The text the mock agent should return as its chat
 *                           response.  Defaults to a simple completion message
 *                           that includes `TASK_COMPLETE`.
 * @returns A `Record<string, string>` suitable for spreading into
 *          `LaunchOptions.extraEnv`.
 */
export function setMockAgentBehavior(
  options: {
    files?: Record<string, string>;
    response?: string;
    chunks?: string[];
    chunkDelayMs?: number;
  } = {},
): Record<string, string> {
  const behavior: Record<string, unknown> = {
    files: options.files ?? {},
  };

  if (options.chunks) {
    behavior.chunks = options.chunks;
    behavior.chunkDelayMs = options.chunkDelayMs ?? 500;
  } else {
    behavior.response = options.response ?? 'I have completed the task. TASK_COMPLETE';
  }

  return {
    MOCK_AGENT_BEHAVIOR: JSON.stringify(behavior),
    MOCK_AGENT_SCRIPT_PATH: resolve(process.cwd(), 'e2e', 'mock-acp-agent.js'),
    DEFAULT_PROVIDER_OVERRIDE: 'mock',
  };
}

// ---------------------------------------------------------------------------
// archiveAndGoHome
// ---------------------------------------------------------------------------

/**
 * Archive the current workspace via IPC and navigate back to the homepage.
 *
 * This cleans up the workspace between provider tests so each provider
 * starts fresh from the home screen.  We first attempt to stop all running
 * agents so that the Electron `before-quit` handler won't detect active
 * streams and show a blocking "Quit anyway?" dialog.
 */
export async function archiveAndGoHome(page: Page, workspaceId: string): Promise<void> {
  console.log(`🗄️  Archiving workspace ${workspaceId}...`);

  // Best-effort: stop any still-running agents before archive.
  // The IPC may fail (agent backend is flaky in packaged builds) — that's OK.
  try {
    await page.evaluate(async (wsId) => {
      // Try listing agents and stopping each one
      try {
        const resp = await (window as any).electronAPI.invoke('agent:list-sessions', wsId);
        const data = resp?.data;
        const sessions: any[] = Array.isArray(data) ? data : data?.agents || [];
        for (const s of sessions) {
          if (s.isStreaming && s.id) {
            await (window as any).electronAPI
              .invoke('agent:stop', { agentId: s.id })
              .catch(() => { });
          }
        }
      } catch {
        // IPC may not work — proceed with archive anyway
      }
    }, workspaceId);
  } catch {
    // Page may be in a bad state — proceed
  }

  // Archive the workspace via IPC
  await page.evaluate((id) => {
    return (window as any).electronAPI.invoke('workspace:archive', { id });
  }, workspaceId);

  // Brief settle time for background processes to wind down
  await new Promise((r) => setTimeout(r, 2_000));

  // Navigate to homepage
  const baseUrl = await page.evaluate(() => window.location.origin);
  await page.goto(`${baseUrl}/`);
  await page.waitForLoadState('domcontentloaded');

  console.log('🏠 Navigated to homepage');
}
