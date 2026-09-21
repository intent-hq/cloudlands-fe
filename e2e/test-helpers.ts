/**
 * E2E Test Helper Utilities
 *
 * Launches the built (unpackaged) Electron app from dist/ for build-smoke specs that
 * opt into the built app instead of the packaged binary.
 */

import { Page, ElectronApplication, _electron as electron } from '@playwright/test';
import { join } from 'path';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Launch Electron application for testing
 */
export async function launchApp(
  options: {
    workspaceDir?: string;
    extraArgs?: string[];
    extraEnv?: Record<string, string>;
  } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [
      join(__dirname, '../dist/main/index.js'),
      '--no-sandbox',
      '--disable-gpu-sandbox',
      ...(options.extraArgs || []),
    ],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TESTING: 'true',
      TEST_WORKSPACE_DIR: options.workspaceDir || path.join(process.cwd(), '.test-workspaces'),
      ...(options.extraEnv || {}),
    },
  });

  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });

  return { app, page };
}
