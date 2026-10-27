import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { copyFile, rm } from 'node:fs/promises';
import { finish, launch, sourceEvidence } from './harness';
import { installSyntheticFeedbackMedia } from './feedback-media';

const state = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as any).companionNative.native.getAnnotationState());
const boundary = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as any).companionNative.feedback.snapshot());

async function openFeedback(testInfo: TestInfo, options: Record<string, unknown> = {}) {
  const fixture = await launch(testInfo);
  const diagnostics: unknown[] = [];
  fixture.app.context().on('page', (page) => {
    page.on('console', (message) => {
      if (message.text().startsWith('feedback-'))
        diagnostics.push({ route: page.url(), message: message.text() });
    });
    page.on('pageerror', (error) => diagnostics.push({ route: page.url(), error: String(error) }));
  });
  try {
    await fixture.app.context().addInitScript(installSyntheticFeedbackMedia);
    if (typeof options.workAreaWidth === 'number') {
      await fixture.app.evaluate(({ screen }, width) => {
        const all = screen.getAllDisplays.bind(screen);
        const nearest = screen.getDisplayNearestPoint.bind(screen);
        const mapped = (display: Electron.Display) => ({
          ...display,
          workArea: { ...display.workArea, width },
        });
        screen.getAllDisplays = () => all().map(mapped);
        screen.getDisplayNearestPoint = (point) => mapped(nearest(point));
      }, options.workAreaWidth);
    }
    await fixture.app.evaluate(
      (_, options) => (globalThis as any).companionNative.feedback.configure(options),
      options,
    );
    const started = await fixture.page.evaluate(() =>
      window.electronAPI!.invoke('annotation:start', {
        workspaceId: 'feedback-alpha',
        workspaceTitle: 'Navigation polish',
      }),
    );
    expect(started).toMatchObject({ success: true });
    await expect
      .poll(
        () => fixture.app.windows().filter((p) => p.url().endsWith('/annotation-toolbar')).length,
      )
      .toBe(1);
    const toolbar = fixture.app.windows().find((p) => p.url().endsWith('/annotation-toolbar'))!;
    const overlay = fixture.app.windows().find((p) => p.url().endsWith('/annotation'))!;
    await expect(toolbar.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Start voice', exact: true })).toBeVisible();
    return { ...fixture, toolbar, overlay, diagnostics };
  } catch (error) {
    await fixture.app
      .evaluate(() => {
        const boundary = (globalThis as any).companionNative;
        boundary.feedback.releaseAll();
        boundary.native.closeAnnotationMode();
      })
      .catch(() => {});
    await finish(fixture.app, fixture.page, testInfo, { startupError: String(error) });
    await rm(fixture.profile, { recursive: true, force: true });
    throw error;
  }
}

async function choose(page: Page, label: string, option: string) {
  if (!(await page.getByRole('combobox', { name: label, exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function mark(overlay: Page, offset = 0) {
  // Playwright renderer input: explicitly not physical desktop input.
  await overlay.mouse.move(80 + offset, 120);
  await overlay.mouse.down();
  await overlay.mouse.move(180 + offset, 190, { steps: 5 });
  await overlay.mouse.up();
}

async function closeFeedback(
  fixture: Awaited<ReturnType<typeof openFeedback>>,
  testInfo: TestInfo,
) {
  const { app, page, profile } = fixture;
  const evidence = await app.evaluate(() => {
    const fixture = (globalThis as any).companionNative;
    return { native: fixture.snapshot(), feedback: fixture.feedback.snapshot() };
  });
  const renderer = await Promise.all(
    [fixture.toolbar, fixture.overlay].map(async (p) =>
      p.isClosed()
        ? { closed: true }
        : p.evaluate(() => ({
            route: location.pathname,
            fixture: (window as any).companionFixture?.evidence(),
            media: (window as any).feedbackMedia?.evidence(),
          })),
    ),
  );
  await app.evaluate(() => {
    const fixture = (globalThis as any).companionNative;
    fixture.feedback.releaseAll();
    fixture.native.closeAnnotationMode();
  });
  try {
    await finish(app, page, testInfo, {
      ...evidence,
      diagnostics: fixture.diagnostics,
      renderer,
      source: await sourceEvidence([
        'src/features/annotation/components/AnnotationToolbar.svelte',
        'src/features/annotation/components/AnnotationToolbarPanel.svelte',
        'src/features/annotation/components/AnnotationOverlay.svelte',
        'src/features/annotation/annotation-submit-service.ts',
        'src/features/annotation/annotation-voice-service.ts',
        'src/features/annotation/main/annotation-window.ts',
        'src/features/annotation/main/annotation.ipc.ts',
      ]),
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

export function registerFeedbackTests() {
  test('horizontal feedback artifact: settled error popup', async ({}, testInfo) => {
    const fixture = await openFeedback(testInfo, { mode: 'failed' });
    const { app, toolbar, overlay } = fixture;
    try {
      await expect(
        toolbar.getByRole('button', { name: 'Send to agent', exact: true }),
      ).toBeEnabled();
      await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
      await mark(overlay);
      await toolbar.getByRole('button', { name: 'Send to agent', exact: true }).click();
      await expect.poll(async () => (await state(app)).delivery.status).toBe('failed');
      await toolbar.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(toolbar.getByRole('combobox', { name: 'Workspace', exact: true })).toBeFocused();
      await toolbar.keyboard.press('Escape');
      const popup = toolbar.locator('.annotation-destination-popover');
      await expect(popup.getByRole('alert')).toBeVisible();
      await popup.evaluate(async (el) => {
        await Promise.all(
          el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
        );
      });
      await expect(toolbar.getByRole('button', { name: 'Retry send', exact: true })).toBeEnabled();
      await toolbar.screenshot({ path: testInfo.outputPath('final-error.png') });
      fixture.diagnostics.push({
        errorPopup: await popup.evaluate((el) => ({
          bounds: el.getBoundingClientRect().toJSON(),
          text: el.textContent,
          scrollTop: el.scrollTop,
        })),
      });
    } finally {
      await closeFeedback(fixture, testInfo);
    }
  });

  for (const width of [720, 480]) {
    test(`horizontal feedback demo: ${width}px final recording readability`, async ({}, testInfo) => {
      const fixture = await openFeedback(testInfo, { holdSend: true, workAreaWidth: width });
      const { app, toolbar, overlay } = fixture;
      const video = toolbar.video();
      const pace = () => toolbar.waitForTimeout(width === 720 ? 2000 : 100);
      try {
        await expect(toolbar.getByRole('button', { name: 'Workspace', exact: true })).toContainText(
          'Main agent',
        );
        await toolbar.screenshot({ path: testInfo.outputPath(`final-${width}-idle.png`) });
        await pace();
        await choose(toolbar, 'Workspace', 'Search quality');
        await choose(toolbar, 'Agent', 'beta implementor');
        const popup = toolbar.locator('.annotation-destination-popover');
        await popup.evaluate(async (el) => {
          await Promise.all(
            el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
          );
        });
        await toolbar.screenshot({ path: testInfo.outputPath(`final-${width}-destination.png`) });
        await pace();
        await toolbar.getByRole('button', { name: 'Workspace', exact: true }).click();
        await expect(popup).not.toBeVisible();
        await toolbar.getByRole('button', { name: 'Start voice', exact: true }).click();
        await expect(toolbar.locator('.annotation-toolbar-panel')).toHaveAttribute(
          'data-voice-state',
          'recording',
        );
        await pace();
        const text = toolbar.locator('.voice-status');
        await expect(text).toBeVisible();
        const readability = await text.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            viewport: { width: innerWidth, height: innerHeight },
          };
        });
        expect(readability.scrollWidth).toBeLessThanOrEqual(readability.clientWidth + 1);
        expect(readability.scrollHeight).toBeLessThanOrEqual(readability.clientHeight + 1);
        expect(readability.x).toBeGreaterThanOrEqual(0);
        expect(readability.bottom).toBeLessThanOrEqual(readability.viewport.height);
        await expect(
          toolbar.getByRole('button', { name: 'Stop voice', exact: true }),
        ).toBeVisible();
        await expect(toolbar.locator('.elapsed')).toBeVisible();
        fixture.diagnostics.push({ width, readability });
        await toolbar.screenshot({ path: testInfo.outputPath(`final-${width}-recording.png`) });
        if (width === 480) {
          await toolbar.getByRole('button', { name: 'Cancel', exact: true }).click();
          await expect.poll(() => state(app)).toBeNull();
          return;
        }
        await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
        await mark(overlay);
        await pace();
        await toolbar.getByRole('button', { name: 'Mouse', exact: true }).click();
        await pace();
        await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
        await mark(overlay, 140);
        await pace();
        await toolbar.getByRole('button', { name: 'Stop voice', exact: true }).click();
        await expect.poll(async () => (await boundary(app)).pendingVoice).toBe(1);
        await app.evaluate(() =>
          (globalThis as any).companionNative.feedback.releaseVoice(
            'Keep the destination clear and the toolbar compact.',
          ),
        );
        await expect.poll(async () => (await state(app)).transcripts.length).toBe(1);
        await pace();
        await toolbar.getByRole('button', { name: 'Send to agent', exact: true }).click();
        await expect.poll(async () => (await boundary(app)).sent.length).toBe(1);
        await expect(toolbar.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
        await toolbar.screenshot({ path: testInfo.outputPath('final-720-sending.png') });
        await pace();
        await app.evaluate(() => (globalThis as any).companionNative.feedback.releaseSend());
        await expect.poll(() => state(app)).toBeNull();
      } finally {
        await closeFeedback(fixture, testInfo);
        if (video)
          await copyFile(await video.path(), testInfo.outputPath(`final-${width}-flow.webm`));
      }
    });
  }

  for (const width of [720, 480]) {
    test(`horizontal feedback: ${width}px native popup and ordinary controls`, async ({}, testInfo) => {
      const fixture = await openFeedback(testInfo, { mode: 'failed', workAreaWidth: width });
      const { app, toolbar, overlay } = fixture;
      const nativeToolbar = () =>
        app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().endsWith('/annotation-toolbar'),
          )!;
          return { id: win.id, bounds: win.getBounds() };
        });
      const assertControlsFit = async () => {
        const rects = await toolbar.evaluate(() => {
          const panel = document.querySelector('.annotation-toolbar-panel')!;
          return [...panel.querySelectorAll('button[aria-label]')]
            .filter(
              (el) => !el.closest('.annotation-destination-popover') && !el.closest('.tools-row'),
            )
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                name: el.getAttribute('aria-label'),
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
                width: innerWidth,
                height: innerHeight,
              };
            });
        });
        for (const r of rects) {
          expect(r.x, r.name!).toBeGreaterThanOrEqual(0);
          expect(r.y, r.name!).toBeGreaterThanOrEqual(0);
          expect(r.right, r.name!).toBeLessThanOrEqual(r.width + 1);
          expect(r.bottom, r.name!).toBeLessThanOrEqual(r.height + 1);
        }
        fixture.diagnostics.push({ controls: rects });
      };
      try {
        await expect
          .poll(async () => (await nativeToolbar()).bounds)
          .toMatchObject({ width, height: 72 });
        const collapsed = await nativeToolbar();
        await assertControlsFit();
        await toolbar.screenshot({ path: testInfo.outputPath('horizontal-idle.png') });
        await toolbar.getByRole('button', { name: 'Workspace', exact: true }).click();
        await expect.poll(async () => (await nativeToolbar()).bounds.height).toBe(320);
        const expanded = await nativeToolbar();
        expect(expanded.bounds.y + expanded.bounds.height).toBe(
          collapsed.bounds.y + collapsed.bounds.height,
        );
        const popup = toolbar.locator('.annotation-destination-popover');
        await expect(popup).toBeVisible();
        const popupRect = await popup.boundingBox();
        expect(popupRect!.y).toBeGreaterThanOrEqual(0);
        expect(popupRect!.x + popupRect!.width).toBeLessThanOrEqual(width);
        const workspace = toolbar.getByRole('combobox', { name: 'Workspace', exact: true });
        await expect(workspace).toBeFocused();
        await popup.evaluate(async (el) => {
          await Promise.all(
            el
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        const initialInput = await workspace.boundingBox();
        fixture.diagnostics.push({
          pickerBefore: await popup.evaluate((el) => ({
            scrollTop: el.scrollTop,
            rect: el.getBoundingClientRect().toJSON(),
            animations: el.getAnimations({ subtree: true }).map((a) => a.playState),
          })),
        });
        await workspace.fill('Search');
        await expect(workspace).toHaveValue('Search');
        await expect(
          toolbar.getByRole('option', { name: 'Search quality', exact: true }),
        ).toBeVisible();
        await popup.evaluate(async (el) => {
          await Promise.all(
            el
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        fixture.diagnostics.push({
          pickerAfter: await popup.evaluate((el) => ({
            scrollTop: el.scrollTop,
            rect: el.getBoundingClientRect().toJSON(),
            animations: el.getAnimations({ subtree: true }).map((a) => a.playState),
          })),
        });
        expect(await workspace.boundingBox()).toEqual(initialInput);
        await toolbar.getByRole('option', { name: 'Search quality', exact: true }).click();
        await choose(toolbar, 'Agent', 'beta implementor');
        await expect
          .poll(async () => (await state(app)).destination)
          .toMatchObject({ workspaceId: 'feedback-beta', agentId: 'beta-override' });
        await toolbar.screenshot({ path: testInfo.outputPath('horizontal-destination.png') });
        const gap = { x: expanded.bounds.x + width - 5, y: expanded.bounds.y + 5 };
        await app.evaluate(
          (_, point) => (globalThis as any).companionNative.setControlledCursor(point),
          gap,
        );
        await expect
          .poll(() =>
            app.evaluate(
              (_, id) =>
                (globalThis as any).companionNative.calls
                  .filter(
                    (c: any) => c.boundary === 'annotation-pointer-routing' && c.windowId === id,
                  )
                  .at(-1)?.ignore,
              expanded.id,
            ),
          )
          .toBe(true);
        await app.evaluate(
          (_, point) => (globalThis as any).companionNative.setControlledCursor(point),
          { x: expanded.bounds.x + popupRect!.x + 20, y: expanded.bounds.y + popupRect!.y + 20 },
        );
        await expect
          .poll(() =>
            app.evaluate(
              (_, id) =>
                (globalThis as any).companionNative.calls
                  .filter(
                    (c: any) => c.boundary === 'annotation-pointer-routing' && c.windowId === id,
                  )
                  .at(-1)?.ignore,
              expanded.id,
            ),
          )
          .toBe(false);
        await toolbar.keyboard.press('Escape');
        if (
          (await toolbar
            .getByRole('button', { name: 'Workspace', exact: true })
            .getAttribute('aria-expanded')) === 'true'
        )
          await toolbar.keyboard.press('Escape');
        await expect(popup).not.toBeVisible();
        await expect.poll(async () => (await nativeToolbar()).bounds.height).toBe(72);
        await expect(toolbar.getByRole('button', { name: 'Workspace', exact: true })).toBeFocused();
        expect(await state(app)).not.toBeNull();
        expect((await boundary(app)).sent).toHaveLength(0);
        await toolbar.getByRole('button', { name: 'Workspace', exact: true }).press('Enter');
        await expect(workspace).toBeFocused();
        await toolbar.keyboard.press('Escape');
        if (
          (await toolbar
            .getByRole('button', { name: 'Workspace', exact: true })
            .getAttribute('aria-expanded')) === 'true'
        )
          await toolbar.keyboard.press('Escape');
        await expect(popup).not.toBeVisible();
        await toolbar.getByRole('button', { name: 'Start voice', exact: true }).click();
        await expect(toolbar.locator('.annotation-toolbar-panel')).toHaveAttribute(
          'data-voice-state',
          'recording',
        );
        await expect(toolbar.locator('.elapsed')).toBeVisible();
        await assertControlsFit();
        await toolbar.screenshot({ path: testInfo.outputPath('horizontal-recording.png') });
        await toolbar.getByRole('button', { name: 'Stop voice', exact: true }).click();
        await expect.poll(async () => (await boundary(app)).pendingVoice).toBe(1);
        await app.evaluate(() =>
          (globalThis as any).companionNative.feedback.releaseVoice('Keep the toolbar compact.'),
        );
        await expect.poll(async () => (await state(app)).transcripts.length).toBe(1);
        await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
        await mark(overlay);
        await toolbar.getByRole('button', { name: 'Send to agent', exact: true }).click();
        await expect.poll(async () => (await state(app)).delivery.status).toBe('failed');
        await expect(
          toolbar.getByRole('button', { name: 'Retry send', exact: true }),
        ).toBeVisible();
        await assertControlsFit();
        await expect(toolbar.getByRole('button', { name: 'Workspace', exact: true })).toContainText(
          'Could not send the annotation.',
        );
        await toolbar.getByRole('button', { name: 'Workspace', exact: true }).click();
        await toolbar.keyboard.press('Escape');
        await expect(popup.getByRole('alert')).toBeVisible();
        await toolbar.screenshot({ path: testInfo.outputPath('horizontal-error.png') });
        await toolbar.keyboard.press('Escape');
        if (
          (await toolbar
            .getByRole('button', { name: 'Workspace', exact: true })
            .getAttribute('aria-expanded')) === 'true'
        )
          await toolbar.keyboard.press('Escape');
        await toolbar.getByRole('button', { name: 'Retry send', exact: true }).click();
        await expect.poll(() => state(app)).toBeNull();
        expect((await boundary(app)).sent).toHaveLength(2);
        fixture.diagnostics.push({
          collapsed,
          expanded,
          popupRect,
          input: initialInput,
          inputMode:
            'synthesized renderer input; controlled OS cursor; no physical click delivery claim',
        });
      } finally {
        await closeFeedback(fixture, testInfo);
      }
    });
  }

  test('direct feedback: discovered workspace main agent receives all voice and capture segments', async ({}, testInfo) => {
    const fixture = await openFeedback(testInfo, { holdSend: true });
    const { app, toolbar, overlay } = fixture;
    try {
      const workspace = toolbar.getByRole('combobox', { name: 'Workspace', exact: true });
      await toolbar.getByRole('button', { name: 'Workspace', exact: true }).click();
      await workspace.click();
      await expect(
        toolbar.getByRole('option', { name: 'Search quality', exact: true }),
      ).toBeVisible();
      await expect(
        toolbar.getByRole('option', { name: 'Archived project', exact: true }),
      ).toHaveCount(0);
      await workspace.press('Escape');
      await choose(toolbar, 'Agent', 'alpha implementor');
      await choose(toolbar, 'Workspace', 'Search quality');
      await expect
        .poll(async () => (await state(app)).destination)
        .toMatchObject({ workspaceId: 'feedback-beta', agentId: null });
      await choose(toolbar, 'Workspace', 'Navigation polish');
      await expect
        .poll(async () => (await state(app)).destination)
        .toMatchObject({ workspaceId: 'feedback-alpha', agentId: null });
      expect(
        (await toolbar.evaluate(() => (window as any).feedbackMedia.evidence())).acquisitions,
      ).toBe(0);
      await toolbar.screenshot({ path: testInfo.outputPath('workspace-main-default.png') });

      await toolbar.getByRole('button', { name: 'Start voice', exact: true }).click();
      await expect(toolbar.locator('.annotation-toolbar-panel')).toHaveAttribute(
        'data-voice-state',
        'recording',
      );
      await toolbar.evaluate(() => (window as any).feedbackMedia.emitPart());
      await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
      await expect(overlay.locator('main[data-tool]')).toHaveAttribute('data-tool', 'draw');
      await mark(overlay);
      await toolbar.getByRole('button', { name: 'Mouse', exact: true }).click();
      await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
      await expect(overlay.locator('main[data-tool]')).toHaveAttribute('data-tool', 'draw');
      await toolbar.evaluate(() => (window as any).feedbackMedia.emitPart());
      await mark(overlay, 140);
      expect((await toolbar.evaluate(() => (window as any).feedbackMedia.evidence())).starts).toBe(
        1,
      );
      await toolbar.getByRole('button', { name: 'Stop voice', exact: true }).click();
      await expect.poll(async () => (await boundary(app)).pendingVoice).toBe(1);
      const firstAudio = (await boundary(app)).audio[0];
      expect(firstAudio.samples).toBeGreaterThanOrEqual(3199);
      expect(firstAudio.firstMean).toBeCloseTo(0.2, 2);
      expect(firstAudio.lastMean).toBeCloseTo(0.6, 2);
      await app.evaluate(() =>
        (globalThis as any).companionNative.feedback.releaseVoice(
          'Keep the earlier navigation visible.',
        ),
      );
      await expect.poll(async () => (await state(app)).transcripts.length).toBe(1);
      await toolbar.getByRole('button', { name: 'Start voice', exact: true }).click();
      await expect(toolbar.locator('.annotation-toolbar-panel')).toHaveAttribute(
        'data-voice-state',
        'recording',
      );
      await toolbar.evaluate(() => (window as any).feedbackMedia.emitPart());
      await toolbar.getByRole('button', { name: 'Mouse', exact: true }).click();
      await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
      await expect.poll(async () => (await state(app)).transcripts.length).toBe(1);
      await toolbar.evaluate(() => (window as any).feedbackMedia.emitPart());
      await toolbar.getByRole('button', { name: 'Send to agent', exact: true }).click();
      await expect.poll(async () => (await boundary(app)).pendingVoice).toBe(1);
      expect((await boundary(app)).sent).toHaveLength(0);
      await expect(toolbar.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
      await toolbar.screenshot({ path: testInfo.outputPath('direct-send-transcribing.png') });
      await app.evaluate(() =>
        (globalThis as any).companionNative.feedback.releaseVoice(
          'Also retain the final search detail.',
        ),
      );
      await expect.poll(async () => (await boundary(app)).sent.length).toBe(1);
      const current = await state(app);
      const delivery = (await boundary(app)).sent[0];
      expect(delivery.agentId).toBe('alpha-main');
      expect(delivery.workspaceId).toBe('feedback-alpha');
      expect(delivery.messageId).toBe(current.sendRequest.requestId);
      expect(delivery.content).toContain('Keep the earlier navigation visible.');
      expect(delivery.content).toContain('Also retain the final search detail.');
      expect(delivery.messageMetadata.captures.length).toBeGreaterThanOrEqual(2);
      expect(current.phase).toBe('capturing');
      await expect(overlay.getByRole('dialog')).toHaveCount(0);
      const duplicate = await toolbar.evaluate(
        (startedAt) => window.electronAPI!.invoke('annotation:request-send', { startedAt }),
        current.startedAt,
      );
      expect(duplicate).toMatchObject({ success: false });
      expect((await boundary(app)).sent).toHaveLength(1);
      await toolbar.screenshot({ path: testInfo.outputPath('direct-send-pending.png') });
      await app.evaluate(() => (globalThis as any).companionNative.feedback.releaseSend());
      await expect.poll(() => state(app)).toBeNull();
    } finally {
      await closeFeedback(fixture, testInfo);
    }
  });

  for (const scenario of ['failed', 'edited', 'uncertain'] as const) {
    test(`direct feedback: ${scenario} retry preserves the correct identity and override`, async ({}, testInfo) => {
      const fixture = await openFeedback(testInfo, {
        mode: scenario === 'uncertain' ? 'uncertain' : 'failed',
      });
      const { app, toolbar, overlay } = fixture;
      try {
        await choose(toolbar, 'Agent', 'alpha implementor');
        await toolbar.getByRole('button', { name: 'Draw', exact: true }).click();
        await expect(overlay.locator('main[data-tool]')).toHaveAttribute('data-tool', 'draw');
        await mark(overlay);
        await toolbar.getByRole('button', { name: 'Send to agent', exact: true }).click();
        await expect
          .poll(async () => (await state(app))?.delivery?.status)
          .toBe(scenario === 'uncertain' ? 'uncertain' : 'failed');
        const before = await state(app);
        const first = (await boundary(app)).sent[0];
        expect(first.agentId).toBe('alpha-override');
        await toolbar.screenshot({ path: testInfo.outputPath(`${scenario}-draft-retained.png`) });
        if (scenario === 'edited') {
          // Do not switch tools: only the overlay's first-edit IPC may invalidate this retry.
          await expect(overlay.locator('main[data-tool]')).toHaveAttribute('data-tool', 'draw');
          await mark(overlay, 180);
          await expect.poll(async () => (await state(app))?.sendRequest).toBeUndefined();
        }
        const retry = toolbar.getByRole('button', {
          name:
            scenario === 'uncertain'
              ? 'Send again'
              : scenario === 'edited'
                ? 'Send to agent'
                : 'Retry send',
          exact: true,
        });
        await retry.click();
        await expect.poll(() => state(app)).toBeNull();
        const final = await boundary(app);
        expect(final.sent).toHaveLength(scenario === 'uncertain' ? 1 : 2);
        if (scenario !== 'uncertain') {
          expect(final.sent[1].agentId).toBe('alpha-override');
          if (scenario === 'edited') {
            expect(final.sent[1].messageId).not.toBe(first.messageId);
            expect(final.sent[1].imageBlocks).not.toEqual(first.imageBlocks);
            expect(final.uploads.at(-1).sha256).not.toBe(final.uploads[0].sha256);
          } else {
            expect(final.sent[1].messageId).toBe(first.messageId);
            expect(final.sent[1].imageBlocks).toEqual(first.imageBlocks);
          }
        }
        const events = await app.evaluate(() => (globalThis as any).companionNative.calls);
        const preparing = events.filter(
          (row: any) =>
            row.boundary === 'production-annotation-event' &&
            row.state?.delivery?.status === 'preparing',
        );
        expect(preparing.length).toBeGreaterThanOrEqual(2);
        if (scenario !== 'edited')
          expect(preparing.at(-1).state.delivery.requestId).toBe(before.sendRequest.requestId);
        if (scenario === 'uncertain')
          expect(events.some((row: any) => row.method === 'agent.getQueue')).toBe(true);
      } finally {
        await closeFeedback(fixture, testInfo);
      }
    });
  }

  test('direct feedback: cancel during final transcription prevents late delivery', async ({}, testInfo) => {
    const fixture = await openFeedback(testInfo);
    const { app, toolbar } = fixture;
    try {
      await expect(
        toolbar.getByRole('button', { name: 'Send to agent', exact: true }),
      ).toBeEnabled();
      await toolbar.getByRole('button', { name: 'Start voice', exact: true }).click();
      await expect(toolbar.locator('.annotation-toolbar-panel')).toHaveAttribute(
        'data-voice-state',
        'recording',
      );
      await toolbar.getByRole('button', { name: 'Send to agent', exact: true }).click();
      await expect.poll(async () => (await boundary(app)).pendingVoice).toBe(1);
      await toolbar.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect.poll(() => state(app)).toBeNull();
      await app.evaluate(() =>
        (globalThis as any).companionNative.feedback.releaseVoice('Late words must not send.'),
      );
      expect((await boundary(app)).sent).toHaveLength(0);
    } finally {
      await closeFeedback(fixture, testInfo);
    }
  });

  for (const scenario of ['discovery-error', 'missing-main'] as const) {
    test(`direct feedback: ${scenario} never silently targets an arbitrary agent`, async ({}, testInfo) => {
      const fixture = await openFeedback(testInfo, {
        discoveryFailure: scenario === 'discovery-error',
      });
      const { app, toolbar } = fixture;
      try {
        if (scenario === 'discovery-error') {
          await expect(
            toolbar.getByText('Could not load workspaces. Try again.', { exact: true }),
          ).toBeVisible();
        } else {
          await choose(toolbar, 'Workspace', 'No main agent');
          await expect(
            toolbar.getByRole('combobox', { name: 'Workspace', exact: true }),
          ).toHaveValue('No main agent');
          await expect(toolbar.getByRole('combobox', { name: 'Agent', exact: true })).toHaveValue(
            '',
          );
        }
        await expect(
          toolbar.getByRole('button', { name: 'Send to agent', exact: true }),
        ).toBeDisabled();
        expect((await boundary(app)).sent).toHaveLength(0);
        await toolbar.screenshot({ path: testInfo.outputPath(`${scenario}.png`) });
        if (scenario === 'discovery-error') {
          await app.evaluate(() =>
            (globalThis as any).companionNative.feedback.configure({ discoveryFailure: false }),
          );
          await toolbar.getByRole('button', { name: 'Refresh recipients', exact: true }).click();
          await expect(
            toolbar.getByRole('button', { name: 'Send to agent', exact: true }),
          ).toBeEnabled();
        } else {
          await choose(toolbar, 'Agent', 'empty implementor');
          await expect
            .poll(async () => (await state(app)).destination)
            .toMatchObject({
              workspaceId: 'feedback-empty',
              agentId: 'empty-override',
            });
          await expect(
            toolbar.getByRole('button', { name: 'Send to agent', exact: true }),
          ).toBeEnabled();
        }
      } finally {
        await closeFeedback(fixture, testInfo);
      }
    });
  }
}
