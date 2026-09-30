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
  exitPackagedApp,
  getSmokeWorkspace,
} from './build-smoke-helpers';

const artifactPhase = process.env.EDITORIAL_ARTIFACT_PHASE ?? 'current';
const artifactDir = path.join(process.cwd(), 'e2e-reports', 'editorial-workspace', artifactPhase);
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

  await page.getByTitle('Click to edit workspace title').click();
  const titleInput = page.locator('input[placeholder="Untitled"]').first();
  await titleInput.fill(longTitle);
  await titleInput.press('Enter');

  await page.getByRole('button', { name: 'Edit workspace status' }).click();
  const statusInput = page.getByLabel('Workspace status');
  await statusInput.fill(longStatus);
  await statusInput.press('Enter');

  await expect(page.getByTitle('Click to edit workspace title')).toContainText(longTitle);
  await expect(page.getByRole('button', { name: 'Edit workspace status' })).toContainText(
    longStatus,
  );
  await setSidebarSections(['overview']);
}

async function setSidebarSections(tabIds: string[]) {
  const target = tabIds.at(-1) ?? 'overview';
  const expanded = page.locator('[data-sidebar-launcher] button[aria-expanded="true"]');
  if (target === 'overview') {
    if ((await expanded.count()) > 0) await expanded.first().click();
    await expect(expanded).toHaveCount(0);
    return;
  }

  const launcher = page.locator(`[data-sidebar-launcher="${target}"] button[aria-expanded]`);
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
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
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
  await expect(async () => {
    const geometry = await panel.evaluate((element) => {
      const inset = element.closest<HTMLElement>('[data-testid="panel-workspace-inset"]')!;
      const frame = element.closest('.panel-canvas-frame')!;
      const rect = (node: Element) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const style = getComputedStyle(element);
      const insetStyle = getComputedStyle(inset);
      return {
        inset: rect(inset),
        frame: rect(frame),
        panel: rect(element),
        padding: [
          insetStyle.paddingLeft,
          insetStyle.paddingTop,
          insetStyle.paddingRight,
          insetStyle.paddingBottom,
        ].map(Number.parseFloat),
        scrollLeft: inset.scrollLeft,
        scrollWidth: inset.scrollWidth,
        viewportWidth: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        radius: style.borderRadius,
        shadow: style.boxShadow,
        surface: style.backgroundColor,
        canvas: getComputedStyle(element.closest('[aria-label="Workspace layout"]')!)
          .backgroundColor,
      };
    });
    // The current uncontained canvas is flush left, with responsive top/right/
    // bottom padding. Its intrinsic width may leave unused space to the right.
    const inset = geometry.viewportWidth < 640 ? 8 : 12;
    expect(geometry.padding).toEqual([0, inset, inset, inset]);
    expect(geometry.panel.x - geometry.inset.x + geometry.scrollLeft).toBeCloseTo(0, 0);
    expect(geometry.panel.y - geometry.inset.y).toBeCloseTo(inset, 0);
    expect(
      geometry.inset.y + geometry.inset.height - geometry.panel.y - geometry.panel.height,
    ).toBeCloseTo(inset, 0);
    expect(geometry.panel.width).toBeGreaterThan(0);
    expect(geometry.panel.width).toBeCloseTo(geometry.frame.width, 0);
    expect(geometry.scrollWidth + 1).toBeGreaterThanOrEqual(geometry.frame.width + inset);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.radius).toBe('12px');
    expect(geometry.shadow).not.toBe('none');
    expect(geometry.surface).not.toBe(geometry.canvas);
  }).toPass({ timeout: 5_000 });
}

async function expectEightPixelGutters() {
  // New gutter wrappers have the same resize intro as new panels. Read every
  // gutter and handle in one frame, then require settled geometry without
  // disabling motion or weakening the 8px gutter / 16px handle contract.
  await expect(async () => {
    const gutters = await page.locator('[data-split-gutter]').evaluateAll((elements) =>
      elements.map((element) => {
        const handles = element.querySelectorAll('button[aria-label="Resize panel"]');
        const box = element.getBoundingClientRect();
        const handle = handles[0]?.getBoundingClientRect();
        return {
          direction: element.getAttribute('data-split-gutter'),
          width: box.width,
          height: box.height,
          handles: handles.length,
          handleWidth: handle?.width,
          handleHeight: handle?.height,
          moving: element
            .getAnimations()
            .some((animation) => animation.pending || animation.playState === 'running'),
        };
      }),
    );
    expect(gutters.length).toBeGreaterThanOrEqual(2);
    for (const gutter of gutters) {
      expect(['horizontal', 'vertical']).toContain(gutter.direction);
      expect(gutter.moving).toBe(false);
      expect(gutter.handles).toBe(1);
      expect(gutter.width).toBeGreaterThan(0);
      expect(gutter.height).toBeGreaterThan(0);
      expect(gutter.direction === 'horizontal' ? gutter.width : gutter.height).toBeCloseTo(8, 0);
      expect(
        gutter.direction === 'horizontal' ? gutter.handleWidth : gutter.handleHeight,
      ).toBeCloseTo(16, 0);
    }
  }).toPass({ timeout: 5_000 });
}

async function expectConversationGeometry() {
  // Sample the transcript and inset composer lane together. The outer composer
  // shell intentionally spans the panel and is not the shared content measure.
  await expect(async () => {
    const geometry = await page.evaluate(() => {
      const activeTab = document.querySelector('.tab-content-wrapper[aria-hidden="false"]');
      const panel = activeTab?.closest('[data-panel-id]');
      const chat = activeTab?.querySelector('.chat-panel-container');
      const column = activeTab?.querySelector('[data-testid="chat-transcript-inner"]');
      const lane = activeTab?.querySelector('[data-testid="chat-composer-lane"]');
      const input = activeTab?.querySelector('.rich-input-container');
      const assistant = activeTab?.querySelector('[data-message-role="assistant"]');
      if (!panel || !chat || !column || !lane || !input || !assistant) return null;
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, bottom: box.bottom, width: box.width };
      };
      const inputStyle = getComputedStyle(input);
      const columnStyle = getComputedStyle(column);
      const laneStyle = getComputedStyle(lane);
      return {
        panel: rect(panel),
        chat: rect(chat),
        column: rect(column),
        lane: rect(lane),
        input: rect(input),
        assistant: rect(assistant),
        columnMaxWidth: Number.parseFloat(columnStyle.maxWidth),
        columnFontSize: Number.parseFloat(columnStyle.fontSize),
        laneMaxWidth: Number.parseFloat(laneStyle.maxWidth),
        laneFontSize: Number.parseFloat(laneStyle.fontSize),
        lanePadding: [laneStyle.paddingLeft, laneStyle.paddingRight, laneStyle.paddingBottom].map(
          Number.parseFloat,
        ),
        inputRadius: inputStyle.borderRadius,
        inputShadow: inputStyle.boxShadow,
        inputBorder: inputStyle.borderBottomWidth,
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry).not.toBeNull();
    const g = geometry!;
    expect(g.columnMaxWidth / g.columnFontSize).toBeCloseTo(140, 4);
    expect(g.laneMaxWidth / g.laneFontSize).toBeCloseTo(140, 4);
    expect(g.column.width).toBeLessThanOrEqual(Math.min(g.columnMaxWidth, g.chat.width) + 1);
    expect(g.column.width).toBeGreaterThan(0);
    expect(Math.abs(g.lane.width - g.column.width)).toBeLessThanOrEqual(1);
    expect(
      Math.abs((g.column.left + g.column.right - g.lane.left - g.lane.right) / 2),
    ).toBeLessThanOrEqual(1);
    const expectedInset = g.chat.width >= 640 ? 24 : 16;
    expect(g.lanePadding).toEqual([expectedInset, expectedInset, expectedInset]);
    expect(g.input.left - g.lane.left).toBeCloseTo(expectedInset, 0);
    expect(g.lane.right - g.input.right).toBeCloseTo(expectedInset, 0);
    expect(g.lane.bottom - g.input.bottom).toBeCloseTo(expectedInset, 0);
    expect(g.panel.bottom - g.lane.bottom).toBeCloseTo(1, 0);
    expect(g.assistant.left).toBeGreaterThanOrEqual(g.column.left - 1);
    expect(g.assistant.right).toBeLessThanOrEqual(g.column.right + 1);
    expect(g.pageWidth).toBeLessThanOrEqual(g.viewportWidth + 1);
    expect(g.inputRadius).toBe('8px');
    expect(g.inputShadow).toBe('none');
    expect(g.inputBorder).toBe('1px');
  }).toPass({ timeout: 5_000 });
}

test.describe('Build Smoke — Editorial Workspace Shell', () => {
  test.fixme(
    process.env.BUILD_SMOKE_VALIDATE_JOURNEYS !== '1',
    'Pending real packaged validation: intent-hq/intent#5608',
  );
  test.beforeAll(async () => {
    const repo = createTempRepo();
    cleanupRepo = repo.cleanup;
    const launchOptions = {
      extraEnv: {
        MOCK_AGENT_SCRIPT_PATH: path.resolve(process.cwd(), 'e2e', 'mock-acp-agent.js'),
        DEFAULT_PROVIDER_OVERRIDE: 'mock',
      },
    };
    const launched = await launchPackagedApp(launchOptions);
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
      .getByTitle('Click to edit workspace title')
      .waitFor({ state: 'visible', timeout: 60_000 });
    await expect(
      page
        .locator('[data-message-role="assistant"]')
        .filter({ hasText: 'Editorial conversation ready' }),
    ).toBeVisible({ timeout: 90_000 });
    await waitForAgentNotStreaming(page, workspaceId, 90_000);
    // The current sidebar omits empty status messages. Seed a distinct fixture
    // status through the real daemon, then edit it through the UI below. The
    // final title/status and reload assertions remain independent outcomes.
    await page.evaluate(async (id) => {
      const result = await (window as any).electronAPI.invoke('backend:request', {
        method: 'workspace.update',
        params: { workspaceId: id, statusMessage: 'Editorial fixture ready for UI editing.' },
      });
      if (
        !result.ok ||
        result.result?.workspace?.id !== id ||
        result.result.workspace.statusMessage !== 'Editorial fixture ready for UI editing.'
      ) {
        throw new Error(`Failed to seed owned editorial fixture: ${JSON.stringify(result)}`);
      }
    }, workspaceId);
    // Leave the transient new-workspace shell before testing the settled UI.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit workspace status' })).toContainText(
      'Editorial fixture ready for UI editing.',
    );
    await setSidebarCollapsed(false);
    await prepareSidebarFixture();
  });

  test.afterAll(async () => {
    if (page && workspaceId) await archiveAndGoHome(page, workspaceId).catch(() => undefined);
    await exitPackagedApp(app);
    cleanupRepo?.();
  });

  test('captures and verifies shell and conversation states', async () => {
    const workspace = await getSmokeWorkspace(page, workspaceId);
    expect(workspace.id).toBe(workspaceId);
    // A renderer reload must retain the title/status we changed through the UI.
    await page.reload();
    await expect(page.getByTitle('Click to edit workspace title')).toContainText(
      'Editorial navigation and sidebar hierarchy verification workspace',
    );
    await expect(page.getByRole('button', { name: 'Edit workspace status' })).toContainText(
      'Refining the rail, workspace identity, and selected sections while preserving every interaction.',
    );
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

    const panels = page.locator('[data-panel-id]');
    // The current product uses fixed horizontal columns: vertical split and
    // split-vertical preset actions deliberately do nothing. Exercise the real
    // create-column shortcut instead of fabricating retired nested layout state.
    const firstPanelId = await panels.first().getAttribute('data-panel-id');
    const createColumn = process.platform === 'darwin' ? 'Meta+Backslash' : 'Control+Backslash';
    await panels.first().click({ position: { x: 24, y: 96 } });
    await page.keyboard.press(createColumn);
    await expect(panels).toHaveCount(2);
    await capture('desktop-light-two-horizontal-panels');
    await panels.nth(1).click({ position: { x: 24, y: 96 } });
    await page.keyboard.press(createColumn);
    await expect(panels).toHaveCount(3);
    const panelIds = await panels.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-panel-id')),
    );
    expect(new Set(panelIds).size).toBe(3);
    expect(panelIds[0]).toBe(firstPanelId);
    await expect(page.locator('[data-split-gutter="horizontal"]')).toHaveCount(2);
    await expect(page.locator('[data-split-gutter="vertical"]')).toHaveCount(0);
    await expectEightPixelGutters();
    await capture('desktop-light-three-horizontal-columns');

    await panels.nth(2).click({ position: { x: 24, y: 96 } });
    await expect(panels.nth(2)).toHaveAttribute('data-focused', 'true');
    await capture('desktop-light-focused-panel');

    // Keep the complete three-column canvas visible for a pointer-driven edge drop.
    await emulateViewport(3200, 1000);
    const target = page.locator(`[data-panel-id="${firstPanelId}"]`);
    const header = target.locator('[data-panel-content-header][draggable="true"]');
    await expect(header).toHaveAttribute('data-pane-stack-size', '1');
    const activePane = target.locator('.tab-content-wrapper[aria-hidden="false"]');
    await expect(activePane).toHaveCount(1);
    const paneId = await activePane.getAttribute('data-tab-id');
    expect(paneId).toBeTruthy();
    const beforePanes = await panels.evaluateAll((elements) =>
      elements.map((element) => ({
        panelId: element.getAttribute('data-panel-id'),
        panes: Array.from(element.querySelectorAll('.tab-content-wrapper')).map((pane) =>
          pane.getAttribute('data-tab-id'),
        ),
      })),
    );
    // The empty flex spacer has no height. Grab the real header's top padding
    // instead, and verify that hit-testing reaches this draggable header rather
    // than a selector/button. No drag event or application state is injected.
    await expect(header).toBeVisible();
    await header.scrollIntoViewIfNeeded();
    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error('Pane header bounds are unavailable');
    await header.hover({ position: { x: headerBox.width / 2, y: 2 } });
    const { x: startX, y: startY } = await header.evaluate((element) => {
      const box = element.getBoundingClientRect();
      if (box.width <= 20 || box.height <= 4) throw new Error('Pane header is too small to drag');
      const x = box.left + box.width / 2;
      const y = box.top + 2;
      if (document.elementFromPoint(x, y) !== element) {
        throw new Error('Pane header drag origin is covered or interactive');
      }
      return { x, y };
    });
    const destinationBox = await panels.last().boundingBox();
    if (!destinationBox) throw new Error('Pane drop bounds are unavailable');
    const dropX = destinationBox.x + destinationBox.width - 3;
    const dropY = destinationBox.y + 80;
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(startX).toBeGreaterThan(0);
    expect(dropX).toBeLessThan(viewportWidth);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    try {
      await page.mouse.move(startX + 10, startY, { steps: 3 });
      await page.mouse.move(dropX, dropY, { steps: 20 });
      await page.mouse.move(dropX, dropY);
      await expect(page.locator('[data-panel-layout-edge-preview="after"]')).toBeVisible();
      await capture('wide-light-drag-over');
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() =>
        panels.evaluateAll((elements) =>
          elements.map((element) => ({
            panelId: element.getAttribute('data-panel-id'),
            panes: Array.from(element.querySelectorAll('.tab-content-wrapper')).map((pane) =>
              pane.getAttribute('data-tab-id'),
            ),
          })),
        ),
      )
      .toEqual([beforePanes[1], beforePanes[2], beforePanes[0]]);
    await expect(panels).toHaveCount(3);
    await expect(panels.last()).toHaveAttribute('data-panel-id', firstPanelId!);
    await expect(activePane).toHaveAttribute('data-tab-id', paneId!);
    await expect(activePane).toBeVisible();
    await expect(target).toHaveAttribute('data-focused', 'true');
    await expect(page.locator('[data-panel-layout-edge-preview]')).toHaveCount(0);
    await expect(page.locator('[data-split-gutter="horizontal"]')).toHaveCount(2);
    await expect(page.locator('[data-split-gutter="vertical"]')).toHaveCount(0);
    await expectEightPixelGutters();
    await capture('wide-light-reordered-columns');
    await emulateViewport(1440, 1000);

    await target.click({ position: { x: 24, y: 96 } });
    await expect(target).toHaveAttribute('data-focused', 'true');
    // Mod+Shift+M toggles workspace chrome; Mod+Shift+Enter zooms the focused panel.
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter',
    );
    await expect(target).toHaveAttribute('data-zoomed', 'true');
    await capture('desktop-light-zoomed-panel');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
    await expect(page.getByRole('button', { name: 'Collapse terminal' }).first()).toBeVisible();
    await capture('desktop-light-terminal-open');
  });
});
