import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  archiveAndGoHome,
  createTempRepo,
  createWorkspaceWithPrompt,
  launchPackagedApp,
  sendFollowUpMessage,
  setMockAgentBehavior,
  waitForAgentNotStreaming,
} from './build-smoke-helpers';
import { launchApp } from './test-helpers';

const artifactPhase = process.env.EDITORIAL_ARTIFACT_PHASE ?? 'current';
const artifactDir = path.join(process.cwd(), 'e2e-reports', 'editorial-workspace', artifactPhase);
const useBuiltApp = process.env.EDITORIAL_USE_BUILT_APP === '1';
const conversationResponse = [
  '# Editorial conversation ready',
  '',
  'The readable transcript keeps long-form reasoning calm while preserving every work surface.',
  '',
  '| Surface | Presentation | Behavior |',
  '| --- | --- | --- |',
  '| User turn | Restrained semantic tint | Editing remains available |',
  '| Assistant turn | Flat editorial prose | Actions remain keyboard reachable |',
  '| Composer | Raised card surface | Model, context, send, and stop remain intact |',
  '',
  '```typescript',
  "const conversationFrame = { width: 'max-w-3xl', rhythm: 'editorial' };",
  '```',
  '',
  'A deliberately long token stays locally contained: conversation_surface_geometry_verification_without_page_level_horizontal_overflow.',
  '',
  '<!-- suggested-prompts',
  'Inspect the compact conversation layout.',
  'Verify the streaming composer state.',
  '-->',
].join('\n');

let app: ElectronApplication;
let page: Page;
let workspaceId: string;
let cleanupRepo: (() => void) | undefined;
let userDataDir: string;

async function emulateViewport(width: number, height: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.waitForTimeout(100);
}

async function setTheme(mode: 'light' | 'dark') {
  await page.evaluate((theme) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, mode);
}

async function prepareSidebarFixture() {
  const longTitle = 'Editorial navigation and sidebar hierarchy verification workspace';
  const longStatus =
    'Refining the rail, workspace identity, and selected sections while preserving every interaction.';

  await page.getByTitle('Click to edit space title').click();
  const titleInput = page.locator('input[placeholder="Untitled"]').first();
  await titleInput.fill(longTitle);
  await titleInput.press('Enter');

  await page.getByRole('button', { name: 'Add workspace status' }).click();
  const statusInput = page.getByLabel('Workspace status');
  await statusInput.fill(longStatus);
  await statusInput.press('Enter');

  await expect(page.getByTitle('Click to edit space title')).toContainText(longTitle);
  await expect(page.getByRole('button', { name: 'Edit workspace status' })).toContainText(
    longStatus,
  );
  await setSidebarSections(['overview']);
}

async function setSidebarSections(tabIds: string[]) {
  const target = tabIds.at(-1) ?? 'overview';
  const expanded = page.locator('[data-sidebar-launcher][aria-expanded="true"]');
  if (target === 'overview') {
    if ((await expanded.count()) > 0) await expanded.first().click();
    await expect(expanded).toHaveCount(0);
    return;
  }

  const launcher = page.locator(`[data-sidebar-launcher="${target}"]`);
  if ((await launcher.getAttribute('aria-expanded')) !== 'true') await launcher.click();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  await expect(expanded).toHaveCount(1);
}

async function setSidebarSide(side: 'left' | 'right') {
  const expectedClass = `.workspace-sidebar-${side}`;
  if (await page.locator(expectedClass).isVisible()) return;
  await page.getByRole('button', { name: 'Workspace actions' }).click();
  await page.getByText(`Move sidebar to ${side}`, { exact: true }).click();
  await expect(page.locator(`.workspace-sidebar-${side}`)).toBeVisible();
}

async function setApplicationZoom(factor: number) {
  const resolvedFactor = await app.evaluate(({ BrowserWindow }, nextFactor) => {
    const focusedWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!focusedWindow) throw new Error('No Electron window is available');
    focusedWindow.webContents.setZoomFactor(nextFactor);
    return focusedWindow.webContents.getZoomFactor();
  }, factor);
  expect(resolvedFactor).toBeCloseTo(factor, 2);
  await page.waitForTimeout(150);
}

async function setSidebarCollapsed(collapsed: boolean) {
  const sidebar = page.locator('.workspace-sidebar-panel');
  const isCollapsed = async () => (await sidebar.evaluate((element) => element.clientWidth)) === 0;

  if ((await isCollapsed()) !== collapsed) {
    await page.keyboard.press('Meta+b');
  }
  await expect.poll(isCollapsed).toBe(collapsed);
}

async function expectCompactSidebarOverlay() {
  const geometry = await page.evaluate(() => {
    const upper = document.querySelector('.upper-area')!.getBoundingClientRect();
    const content = document.querySelector('.main-content-area')!.getBoundingClientRect();
    const sidebar = document.querySelector('.workspace-sidebar-panel')!.getBoundingClientRect();
    return {
      upper: { x: upper.x, width: upper.width },
      content: { x: content.x, width: content.width },
      sidebarWidth: sidebar.width,
    };
  });

  expect(geometry.sidebarWidth).toBeGreaterThan(0);
  expect(geometry.content.x).toBeCloseTo(geometry.upper.x, 0);
  expect(geometry.content.width).toBeCloseTo(geometry.upper.width, 0);
}

async function capture(name: string) {
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), animations: 'disabled' });
}

async function expectEditorialSurface() {
  const panel = page.locator('[data-panel-id]').first();
  const { insetBox, panelBox, styles } = await panel.evaluate((element) => {
    const inset = document.querySelector('[data-testid="panel-workspace-inset"]')!;
    const insetRect = inset.getBoundingClientRect();
    const panelRect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const canvas = getComputedStyle(document.querySelector('[aria-label="Workspace layout"]')!);
    return {
      insetBox: {
        x: insetRect.x,
        y: insetRect.y,
        width: insetRect.width,
        height: insetRect.height,
      },
      panelBox: {
        x: panelRect.x,
        y: panelRect.y,
        width: panelRect.width,
        height: panelRect.height,
      },
      styles: {
        radius: style.borderRadius,
        shadow: style.boxShadow,
        surface: style.backgroundColor,
        canvas: canvas.backgroundColor,
      },
    };
  });
  const expectedInset = (await page.evaluate(() => innerWidth)) < 640 ? 8 : 12;
  expect(panelBox.x - insetBox.x).toBeCloseTo(expectedInset, 0);
  expect(panelBox.y - insetBox.y).toBeCloseTo(expectedInset, 0);
  expect(insetBox.x + insetBox.width - panelBox.x - panelBox.width).toBeCloseTo(expectedInset, 0);
  expect(insetBox.y + insetBox.height - panelBox.y - panelBox.height).toBeCloseTo(expectedInset, 0);
  expect(styles.radius).toBe('9px');
  expect(styles.shadow).not.toBe('none');
  expect(styles.surface).not.toBe(styles.canvas);
}

async function expectEightPixelGutters() {
  const gutters = page.locator('[data-split-gutter]');
  expect(await gutters.count()).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < (await gutters.count()); index += 1) {
    const gutter = gutters.nth(index);
    const direction = await gutter.getAttribute('data-split-gutter');
    const gutterBox = await gutter.boundingBox();
    const targetBox = await gutter
      .getByRole('button', { name: 'Resize panel', exact: true })
      .boundingBox();
    expect(gutterBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(direction === 'horizontal' ? gutterBox!.width : gutterBox!.height).toBeCloseTo(8, 0);
    expect(direction === 'horizontal' ? targetBox!.width : targetBox!.height).toBeCloseTo(16, 0);
  }
}

async function expectConversationGeometry() {
  const geometry = await page.evaluate(() => {
    const activeTab = document.querySelector('.tab-content-wrapper:not(.hidden)');
    const panel = activeTab?.closest('[data-panel-id]');
    const column = activeTab?.querySelector('.conversation-column');
    const composer = activeTab?.querySelector('.conversation-composer');
    const input = activeTab?.querySelector('.rich-input-container');
    const assistant = activeTab?.querySelector('[data-message-role="assistant"]');
    if (!panel || !column || !composer || !input || !assistant) return null;

    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
      };
    };
    const inputStyle = getComputedStyle(input);
    return {
      panel: rect(panel),
      column: rect(column),
      composer: rect(composer),
      input: rect(input),
      assistant: rect(assistant),
      columnMaxWidth: getComputedStyle(column).maxWidth,
      inputRadius: inputStyle.borderRadius,
      inputShadow: inputStyle.boxShadow,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry!.columnMaxWidth).toBe('768px');
  expect(geometry!.column.width).toBeLessThanOrEqual(Math.min(768, geometry!.viewportWidth));
  expect(geometry!.composer.width).toBeCloseTo(geometry!.column.width, 0);
  expect(geometry!.assistant.left).toBeGreaterThanOrEqual(geometry!.column.left);
  expect(geometry!.assistant.right).toBeLessThanOrEqual(geometry!.column.right + 1);
  expect(geometry!.inputRadius).toBe('8px');
  expect(geometry!.inputShadow).not.toBe('none');
  expect(geometry!.panel.bottom - geometry!.input.bottom).toBeGreaterThanOrEqual(8);
  expect(geometry!.panel.bottom - geometry!.input.bottom).toBeLessThanOrEqual(20);
}

test.describe('Build Smoke — Editorial Workspace Shell', () => {
  test.beforeAll(async () => {
    const repo = createTempRepo();
    cleanupRepo = repo.cleanup;
    userDataDir = await mkdtemp(path.join(tmpdir(), 'editorial-shell-user-data-'));
    const launchOptions = {
      extraArgs: [`--user-data-dir=${userDataDir}`],
      extraEnv: {
        MOCK_AGENT_SCRIPT_PATH: path.resolve(process.cwd(), 'e2e', 'mock-acp-agent.js'),
        DEFAULT_PROVIDER_OVERRIDE: 'mock',
        INTENTD_DATA_DIR: path.join(userDataDir, 'intentd'),
      },
    };
    const launched = useBuiltApp
      ? await launchApp(launchOptions)
      : await launchPackagedApp(launchOptions);
    app = launched.app;
    page = launched.page;
    const behavior = setMockAgentBehavior({ response: conversationResponse });
    await app.evaluate(({ app: electronApp }, value) => {
      electronApp.commandLine.appendSwitch('disable-renderer-backgrounding');
      process.env.MOCK_AGENT_BEHAVIOR = value;
    }, behavior.MOCK_AGENT_BEHAVIOR);
    workspaceId = await createWorkspaceWithPrompt(page, {
      repoPath: repo.repoPath,
      prompt: 'Prepare the editorial shell fixture',
    });
    await page.locator('[data-panel-id]').first().waitFor({ state: 'visible', timeout: 20_000 });
    await page
      .getByTitle('Click to edit space title')
      .waitFor({ state: 'visible', timeout: 60_000 });
    await expect(
      page
        .locator('[data-message-role="assistant"]')
        .filter({ hasText: 'Editorial conversation ready' }),
    ).toBeVisible({ timeout: 90_000 });
    await setSidebarCollapsed(false);
    await prepareSidebarFixture();
  });

  test.afterAll(async () => {
    if (page && workspaceId) await archiveAndGoHome(page, workspaceId).catch(() => undefined);
    if (app) await app.close().catch(() => undefined);
    cleanupRepo?.();
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
  });

  test('captures and verifies shell and conversation states', async () => {
    test.setTimeout(360_000);
    for (const [label, width, height] of [
      ['desktop', 1440, 1000],
      ['medium', 1024, 768],
      ['compact', 390, 844],
    ] as const) {
      await emulateViewport(width, height);
      if (label === 'compact') await expectCompactSidebarOverlay();
      await setSidebarCollapsed(label === 'compact');
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(theme);
        await expectEditorialSurface();
        await capture(`${label}-${theme}-single-panel`);
      }
    }

    await emulateViewport(1440, 1000);
    await setSidebarCollapsed(false);
    await setTheme('light');
    await setSidebarSections(['changes']);
    await capture('desktop-light-expanded-sidebar-section');
    await setSidebarSections(['overview']);
    await setSidebarSide('right');
    await capture('desktop-light-right-sidebar');
    await setSidebarSide('left');
    await setApplicationZoom(2);
    await capture('desktop-light-sidebar-200-percent-zoom');
    await setApplicationZoom(1);

    await setSidebarCollapsed(true);
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(theme);
      await expectConversationGeometry();
      await capture(`conversation-desktop-${theme}-complete`);
    }

    await emulateViewport(390, 844);
    await setTheme('light');
    await expectConversationGeometry();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    await capture('conversation-compact-light-complete');

    await emulateViewport(1440, 1000);
    await setApplicationZoom(2);
    await expectConversationGeometry();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    await capture('conversation-desktop-light-200-percent-zoom');
    await setApplicationZoom(1);

    await waitForAgentNotStreaming(page, workspaceId, 90_000);
    const assistantMessages = page.locator(
      '.tab-content-wrapper:not(.hidden) [data-message-role="assistant"].message-nav-target',
    );
    const assistantCount = await assistantMessages.count();
    const streamingBehavior = setMockAgentBehavior({
      chunks: [
        'Reviewing the conversation hierarchy...',
        '\n\nThe centered transcript remains aligned with the raised composer.',
        '\n\nStreaming verification complete.',
      ],
      chunkDelayMs: 2_500,
    });
    await app.evaluate(({ app: _electronApp }, value) => {
      process.env.MOCK_AGENT_BEHAVIOR = value;
    }, streamingBehavior.MOCK_AGENT_BEHAVIOR);
    await sendFollowUpMessage(page, 'Verify the active streaming layout.');
    await expect(page.getByTestId('streaming-status-thinking')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Stop streaming' })).toBeVisible();
    await expectConversationGeometry();
    await capture('conversation-desktop-light-streaming');

    const queuedFollowUp = 'Queue this follow-up for after the active response.';
    await sendFollowUpMessage(page, queuedFollowUp);
    await expect(page.getByText(queuedFollowUp, { exact: true })).toBeVisible({ timeout: 10_000 });
    await capture('conversation-desktop-light-queued');
    await expect(assistantMessages).toHaveCount(assistantCount + 2, { timeout: 90_000 });
    await waitForAgentNotStreaming(page, workspaceId, 90_000);

    await setSidebarCollapsed(false);

    let panels = page.locator('[data-panel-id]');
    await panels.first().locator('button[aria-label="Split panel right"]').click();
    await expect(panels).toHaveCount(2);
    await capture('desktop-light-two-horizontal-panels');
    await panels.nth(1).locator('button[aria-label="Split panel down"]').click();
    await expect(panels).toHaveCount(3);
    await expectEightPixelGutters();
    await capture('desktop-light-nested-split');

    await panels.nth(2).click({ position: { x: 24, y: 96 } });
    await expect(panels.nth(2)).toHaveAttribute('data-focused', 'true');
    await capture('desktop-light-focused-panel');

    const target = panels.first();
    const tabId = await target.locator('[data-tab-id]').first().getAttribute('data-tab-id');
    await target.evaluate((element, id) => {
      const transfer = new DataTransfer();
      transfer.setData(
        'application/x-panel-tab',
        JSON.stringify({ tabId: id, panelId: 'fixture' }),
      );
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          dataTransfer: transfer,
        }),
      );
    }, tabId);
    await expect(target.getByText('Add to panel')).toBeVisible();
    await capture('desktop-light-drag-over');
    await target.dispatchEvent('dragleave');

    await target.locator('[role="tab"][aria-selected="true"]').click({ button: 'right' });
    await page.getByRole('button', { name: /^Zoom Panel/ }).click();
    await expect(target).toHaveAttribute('data-zoomed', 'true');
    await capture('desktop-light-zoomed-panel');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
    await expect(page.getByRole('button', { name: 'Collapse terminal' }).first()).toBeVisible();
    await capture('desktop-light-terminal-open');
  });
});
