import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createWorkspaceWithPrompt } from './build-smoke-helpers';
import { launchApp } from './test-helpers';

const intentdBin =
  process.env.SEMANTIC_MAP_INTENTD_BIN ?? resolve('../intentd/target/debug/intentd');
const mockAgent = resolve('e2e/mock-acp-agent.js');
const manifest = {
  version: 1,
  regions: [
    {
      id: 'product',
      label: 'Product',
      responsibility: 'Product code',
      anchor: [0.2, 0.3],
      paths: ['src/**'],
    },
    {
      id: 'quality',
      label: 'Quality',
      responsibility: 'Test code',
      anchor: [0.8, 0.3],
      paths: ['tests/**'],
    },
    {
      id: 'guides',
      label: 'Guides',
      responsibility: 'Documentation',
      anchor: [0.5, 0.8],
      paths: ['docs/**'],
    },
  ],
  crossings: [
    { from: 'product', to: 'quality', label: 'Product verification' },
    { from: 'quality', to: 'guides', label: 'Verified guidance' },
  ],
};

let app: ElectronApplication;
let page: Page;
let daemon: ChildProcess;
let testRoot: string;
let repoPath: string;

function behavior(files: Record<string, string>): string {
  return `SEMANTIC_MAP_BEHAVIOR:${JSON.stringify({ files, response: 'TASK_COMPLETE' })}`;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, params }) => {
      const response = await (window as any).electronAPI.invoke('backend:request', {
        method,
        params,
      });
      if (!response?.ok) throw new Error(response?.error?.message ?? `${method} failed`);
      return response.result;
    },
    { method, params },
  );
}

async function createAgent(workspaceId: string, name: string, prompt: string): Promise<string> {
  const created = await rpc<{ agent: { id: string } }>('agent.create', {
    workspaceId,
    workspacePath: repoPath,
    name,
    provider: 'mock',
    idempotencyKey: `semantic-map-${name.toLowerCase()}`,
  });
  await rpc('agent.sendMessage', { workspaceId, agentId: created.agent.id, content: prompt });
  return created.agent.id;
}

async function waitForActivities(workspaceId: string, paths: string[]) {
  await expect
    .poll(
      async () => {
        const rows = await rpc<Array<{ path?: string }>>('map.activity', {
          workspaceId,
          minutesAgo: 5,
          limit: 100,
        });
        return paths.every((path) => rows.some((row) => row.path === path));
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

test.describe('Semantic map in the Electron shell', () => {
  test.skip(!existsSync(intentdBin), `Build the semantic-map intentd branch at ${intentdBin}`);

  test.beforeAll(async () => {
    testRoot = mkdtempSync(join(tmpdir(), 'semantic-map-e2e-'));
    repoPath = join(testRoot, 'repo');
    mkdirSync(join(repoPath, 'src'), { recursive: true });
    mkdirSync(join(repoPath, 'tests'), { recursive: true });
    mkdirSync(join(repoPath, 'docs'), { recursive: true });
    writeFileSync(join(repoPath, 'README.md'), 'semantic map e2e\n');
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.email', 'semantic-map@test.local'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.name', 'Semantic Map E2E'], { cwd: repoPath });
    execFileSync('git', ['add', '.'], { cwd: repoPath });
    execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: repoPath });

    const dataDir = join(testRoot, 'intentd');
    mkdirSync(dataDir);
    daemon = spawn(intentdBin, ['serve'], {
      env: {
        ...process.env,
        INTENTD_DATA_DIR: dataDir,
        MOCK_AGENT_SCRIPT_PATH: mockAgent,
        MOCK_AGENT_BEHAVIOR_FROM_PROMPT: '1',
        MOCK_AGENT_FILES_VIA_ACP: '1',
        MOCK_AGENT_DELAY_MS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const socket = join(dataDir, 'intentd.sock');
    await expect.poll(() => existsSync(socket), { timeout: 30_000 }).toBe(true);
    ({ app, page } = await launchApp({ extraEnv: { INTENTD_SOCKET: socket } }));
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    daemon?.kill('SIGTERM');
    if (testRoot) rmSync(testRoot, { recursive: true, force: true });
  });

  test('projects three attributed agents and a stable selected route', async () => {
    const firstPrompt = behavior({ 'src/alpha.ts': 'alpha', 'tests/alpha.test.ts': 'alpha test' });
    const workspaceId = await createWorkspaceWithPrompt(page, {
      repoPath,
      prompt: firstPrompt,
      providerName: 'Mock (E2E)',
    });
    await rpc('map.setManifest', { workspaceId, json: manifest });
    const parentId = await page.locator('[data-agent-id]').first().getAttribute('data-agent-id');
    expect(parentId).toBeTruthy();
    const [builderId, writerId] = await Promise.all([
      createAgent(
        workspaceId,
        'Builder',
        behavior({ 'tests/beta.test.ts': 'beta', 'docs/beta.md': 'beta docs' }),
      ),
      createAgent(
        workspaceId,
        'Writer',
        behavior({ 'docs/gamma.md': 'gamma', 'src/gamma.ts': 'gamma source' }),
      ),
    ]);
    await waitForActivities(workspaceId, [
      'src/alpha.ts',
      'tests/alpha.test.ts',
      'tests/beta.test.ts',
      'docs/beta.md',
      'docs/gamma.md',
      'src/gamma.ts',
    ]);

    await page.locator('[data-sidebar-launcher="map"] button').click();
    const canvas = page.locator('[data-semantic-map-canvas]');
    await expect(canvas).toHaveAttribute('data-semantic-map-agent-count', '3', { timeout: 1_000 });
    await page.locator(`[data-agent-id="${builderId}"]`).last().click();
    await expect(page.locator('[data-semantic-map-detail][data-selection="agent"]')).toContainText(
      'beta.md',
    );
    await expect(page.locator('[data-semantic-map-detail]')).toContainText('Verified guidance');

    await page.waitForTimeout(350);
    const before = await canvas
      .locator('canvas')
      .evaluate((node: HTMLCanvasElement) => node.toDataURL());
    await page.locator('[data-sidebar-overlay]').getByRole('button', { name: 'Close tab' }).click();
    await page.locator('[data-sidebar-launcher="map"] button').click();
    await page.waitForTimeout(350);
    const after = await canvas
      .locator('canvas')
      .evaluate((node: HTMLCanvasElement) => node.toDataURL());
    expect(after).toBe(before);
    expect(new Set([parentId, builderId, writerId]).size).toBe(3);
  });

  test.fixme('shows unsolicited attributed activity within one second of the source event', () => {});
  test.fixme('offers agent, kind, and time-window controls that filter the accessible activity model', () => {});
});
