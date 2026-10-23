/**
 * Build Smoke Test — File Tab Media Download
 *
 * Opens a PNG and an SVG from the Files sidebar, clicks the viewer's Download
 * button, and verifies the packaged app saves the original workspace bytes.
 * Only the native save dialog is stubbed; the IPC transfer and daemon reads run.
 *
 * Run with: pnpm test:build-smoke -- --grep "file tab download"
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { crc32, deflateSync } from 'zlib';
import {
  archiveAndGoHome,
  createTempRepo,
  createWorkspaceWithPrompt,
  exitPackagedApp,
  getSmokeWorkspace,
  launchPackagedApp,
  setMockAgentBehavior,
} from './build-smoke-helpers';

const ARTIFACT_DIR = path.join(process.cwd(), 'e2e-reports', 'file-download');

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const frame = Buffer.alloc(8 + body.length);
  frame.writeUInt32BE(data.length, 0);
  body.copy(frame, 4);
  frame.writeUInt32BE(crc32(body), 4 + body.length);
  return frame;
}

function quadrantPng(size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2], 8); // 8-bit RGB
  const colors = [
    [37, 99, 235],
    [245, 158, 11],
    [16, 185, 129],
    [239, 68, 68],
  ];
  const pixels = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = colors[(y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1)];
      pixels.set(color, y * (1 + size * 3) + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const FIXTURES: Record<string, Buffer> = {
  'Icon-512.png': quadrantPng(512),
  'logo.svg': Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' +
      '<circle cx="80" cy="80" r="64" fill="#2563eb"/></svg>\n',
  ),
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

let app: ElectronApplication;
let page: Page;
let workspaceId = '';
let worktreePath = '';
let saveRoot = '';
let cleanupRepo: (() => void) | undefined;

async function openFromFilesSidebar(name: string) {
  const sidebar = page.locator('.workspace-sidebar-panel');
  if ((await sidebar.evaluate((element) => element.clientWidth)) === 0) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
  }
  await expect.poll(() => sidebar.evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
  const tree = page.getByRole('tree', { name: 'File explorer' });
  if (!(await tree.isVisible())) {
    await page
      .locator('[data-sidebar-launcher="files"]')
      .getByRole('button', { name: 'Expand panel' })
      .click();
  }
  await tree.locator(`[data-file-path="${name}"], [data-file-path$="/${name}"]`).first().click();
}

/** Replace only the native dialog; record the suggested names it receives. */
async function stubSaveDialog(filePath: string) {
  await app.evaluate(({ dialog }, target) => {
    const calls: string[] = [];
    const stub = async (...args: unknown[]) => {
      const options = args.at(-1) as { defaultPath?: string } | undefined;
      calls.push(options?.defaultPath ?? '');
      return { canceled: false, filePath: target };
    };
    (globalThis as { __saveDialogCalls?: string[] }).__saveDialogCalls = calls;
    (dialog as unknown as { showSaveDialog: typeof stub }).showSaveDialog = stub;
    if ((dialog as unknown as { showSaveDialog: unknown }).showSaveDialog !== stub) {
      throw new Error('dialog.showSaveDialog could not be stubbed');
    }
  }, filePath);
}

test.describe('Build Smoke — File tab download', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const repo = createTempRepo();
    cleanupRepo = repo.cleanup;
    for (const [name, bytes] of Object.entries(FIXTURES)) {
      writeFileSync(path.join(repo.repoPath, name), bytes);
    }
    execSync('git add . && git commit -m "add media fixtures"', {
      cwd: repo.repoPath,
      stdio: 'ignore',
    });

    ({ app, page } = await launchPackagedApp({ extraEnv: setMockAgentBehavior() }));
    workspaceId = await createWorkspaceWithPrompt(page, {
      repoPath: repo.repoPath,
      prompt: 'Review the media fixtures',
    });
    worktreePath = (await getSmokeWorkspace(page, workspaceId)).worktreePath;
    saveRoot = mkdtempSync(path.join(tmpdir(), 'file-download-'));
    mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  test.afterAll(async () => {
    if (page && workspaceId) await archiveAndGoHome(page, workspaceId).catch(() => undefined);
    await exitPackagedApp(app);
    cleanupRepo?.();
    if (saveRoot) rmSync(saveRoot, { recursive: true, force: true });
  });

  for (const [name, source] of Object.entries(FIXTURES)) {
    test(`file tab download saves the original bytes of ${name}`, async () => {
      expect(sha256(readFileSync(path.join(worktreePath, name)))).toBe(sha256(source));

      await openFromFilesSidebar(name);
      const viewer = page
        .locator('.tab-content-wrapper:not(.hidden)')
        .filter({ has: page.locator(`img[alt="${name}"]`) });
      const image = viewer.locator(`img[alt="${name}"]`);
      await expect
        .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBeGreaterThan(0);

      const target = path.join(saveRoot, name);
      await stubSaveDialog(target);
      const download = viewer.getByTitle('Download', { exact: true });
      await expect(download).toBeEnabled();
      await download.click();

      await expect.poll(() => existsSync(target), { timeout: 30_000 }).toBe(true);
      const saved = readFileSync(target);
      expect(sha256(saved)).toBe(sha256(source));
      const suggested = await app.evaluate(
        () => (globalThis as { __saveDialogCalls?: string[] }).__saveDialogCalls ?? [],
      );
      expect(suggested).toEqual([name]);

      await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`) });
      writeFileSync(
        path.join(ARTIFACT_DIR, `${name}.receipt.json`),
        JSON.stringify(
          {
            file: name,
            suggestedName: suggested[0],
            sourceBytes: source.length,
            savedBytes: saved.length,
            sourceSha256: sha256(source),
            savedSha256: sha256(saved),
          },
          null,
          2,
        ),
      );
    });
  }
});
