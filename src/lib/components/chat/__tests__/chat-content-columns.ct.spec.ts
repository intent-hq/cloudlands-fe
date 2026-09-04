import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';
import {
  applyAuroraPaintProbe,
  colorDistance,
  isPaintProbe,
  samplePanelBottomPixels,
} from './aurora-panel-pixels';

const center = (box: { x: number; width: number }) => box.x + box.width / 2;

const transcriptInsetCases = [
  {
    width: 600,
    expectedLeftInset: '16px',
    expectedComposerInset: '16px',
    label: 'below the panel breakpoint',
  },
  {
    width: 680,
    expectedLeftInset: '49.6px',
    expectedComposerInset: '24px',
    label: 'above the panel breakpoint',
  },
] as const;

const bottomSurfaceGeometry = (locator: Locator) =>
  locator.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      edges: [box.left, box.right, box.bottom],
      radii: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
    };
  });

async function expectPanelToClipFlushAurora(aurora: Locator, panel: Locator) {
  const [auroraGeometry, panelGeometry] = await Promise.all([
    bottomSurfaceGeometry(aurora),
    bottomSurfaceGeometry(panel),
  ]);
  expect(auroraGeometry.radii).toEqual(panelGeometry.radii);
  expect(Number.parseFloat(panelGeometry.radii[0])).toBeGreaterThan(0);
  await applyAuroraPaintProbe(aurora);
  const pixels = await samplePanelBottomPixels(panel);
  pixels.outsideCorners.forEach((corner) => expect(isPaintProbe(corner)).toBe(false));
  pixels.insideCorners.forEach((corner) => expect(isPaintProbe(corner)).toBe(true));
  pixels.straightEdges.forEach((edge) => {
    expect(isPaintProbe(edge)).toBe(true);
    pixels.outsideCorners.forEach((corner) =>
      expect(colorDistance(edge, corner)).toBeGreaterThan(100),
    );
  });
}

test('caps and centers transcript, prompt, and composer at the shared 140em measure', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 3000, height: 900 });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 3000 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const composer = component.getByTestId('chat-composer-controls-inner');
  const composerLane = component.getByTestId('chat-composer-lane');
  const shell = component.getByTestId('chat-composer-shell');
  const promptLayer = component.getByTestId('composer-prompt-layer');
  const aurora = component.getByTestId('composer-aurora-host');

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { theme, zoom, width: 3000 } });
      const sharedMeasure = await transcript.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          maxWidth: Number.parseFloat(style.maxWidth),
        };
      });
      expect(sharedMeasure.maxWidth / sharedMeasure.fontSize).toBeCloseTo(140, 5);
      await expect
        .poll(async () => {
          const [transcriptBox, composerLaneBox] = await Promise.all([
            transcript.boundingBox(),
            composerLane.boundingBox(),
          ]);
          return Math.abs(transcriptBox!.width - composerLaneBox!.width);
        })
        .toBeLessThanOrEqual(1);
      const [transcriptBox, composerBox, composerLaneBox, shellBox, promptBox] = await Promise.all([
        transcript.boundingBox(),
        composer.boundingBox(),
        composerLane.boundingBox(),
        shell.boundingBox(),
        promptLayer.boundingBox(),
      ]);
      expect(composerLaneBox!.width).toBeCloseTo(transcriptBox!.width, 1);
      expect(composerBox!.width).toBeCloseTo(transcriptBox!.width - 48 * zoom, 1);
      expect(Math.abs(center(transcriptBox!) - center(composerBox!))).toBeLessThanOrEqual(0.5);
      expect(promptBox!.width).toBeCloseTo(shellBox!.width, 1);
      const panel = component.locator('.panel');
      const [auroraGeometry, shellGeometry, panelContentGeometry] = await Promise.all([
        bottomSurfaceGeometry(aurora),
        bottomSurfaceGeometry(shell),
        bottomSurfaceGeometry(component.locator('.panel > .panel-content')),
      ]);
      expect(auroraGeometry.edges).toEqual(shellGeometry.edges);
      expect(auroraGeometry.edges).toEqual(panelContentGeometry.edges);
      await expectPanelToClipFlushAurora(aurora, panel);
      await expect(promptLayer).toHaveCSS('border-top-width', '0px');
      await expect(composerLane).toHaveCSS('padding-left', '24px');
      await expect(composerLane).toHaveCSS('padding-right', '24px');
      await expect(composerLane).toHaveCSS('padding-bottom', '24px');
      expect(
        await composerLane.evaluate((node) => Number.parseFloat(getComputedStyle(node).maxWidth)),
      ).toBeCloseTo(sharedMeasure.maxWidth, 5);
    }
  }
});

test('matches the wide side and lower composer spacing', async ({ mount, page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 720 },
  });
  const promptLayer = component.getByTestId('composer-prompt-layer');

  await expect(promptLayer).toHaveAttribute('data-has-transcript-utility', 'false');
  await expect(component.getByTestId('chat-composer-lane')).toHaveCSS('padding-bottom', '24px');
});

for (const { width, expectedLeftInset, expectedComposerInset, label } of transcriptInsetCases) {
  test(`uses the regular transcript inset ${label}`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    const component = await mount(ChatPanelOperationalGeometryHost, {
      props: { theme: 'light', zoom: 1, width },
    });

    await expect(component.getByTestId('chat-transcript-inner')).toHaveCSS(
      'padding-left',
      expectedLeftInset,
    );
    await expect(component.getByTestId('chat-transcript-inner')).toHaveCSS(
      'padding-right',
      expectedLeftInset,
    );
    await expect(component.getByTestId('chat-composer-lane')).toHaveCSS(
      'padding-left',
      expectedComposerInset,
    );
    await expect(component.getByTestId('chat-composer-lane')).toHaveCSS(
      'padding-right',
      expectedComposerInset,
    );
    await expect(component.getByTestId('chat-composer-lane')).toHaveCSS(
      'padding-bottom',
      expectedComposerInset,
    );
    await expect(component.locator('.tiptap-editor.regular-composer-content-inset')).toHaveCSS(
      'padding-left',
      expectedComposerInset,
    );
    await expect(component.locator('.tiptap-editor.regular-composer-content-inset')).toHaveCSS(
      'padding-right',
      expectedComposerInset,
    );
    await expect(component.locator('[data-chat-input-action-bar]')).toHaveCSS(
      'padding-left',
      expectedComposerInset,
    );
    await expect(component.locator('[data-chat-input-action-bar]')).toHaveCSS(
      'padding-right',
      expectedComposerInset,
    );

    if (width < 640) {
      const [avatarBox, titleBox, iconBox, summaryBox] = await Promise.all([
        component.getByTestId('panel-header-agent-avatar-slot').boundingBox(),
        component.locator('[data-panel-header-title]').boundingBox(),
        component.locator('[data-operational-icon-box]').first().boundingBox(),
        component.locator('[data-operational-summary]').first().boundingBox(),
      ]);

      expect(avatarBox).not.toBeNull();
      expect(titleBox).not.toBeNull();
      expect(iconBox).not.toBeNull();
      expect(summaryBox).not.toBeNull();
      expect(Math.abs(center(avatarBox!) - center(iconBox!))).toBeLessThanOrEqual(1);
      expect(Math.abs(titleBox!.x - summaryBox!.x)).toBeLessThanOrEqual(1);
    } else {
      await component
        .getByTestId('chat-transcript-scroll-viewport')
        .evaluate((node) => node.scrollTo(0, node.scrollHeight));
      await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();
      await expect(component.getByTestId('pinned-prompt-overlay-lane')).toHaveCSS(
        'padding-left',
        expectedLeftInset,
      );
      await expect(component.getByTestId('pinned-prompt-overlay-lane')).toHaveCSS(
        'padding-right',
        expectedLeftInset,
      );
    }
  });
}

for (const { width, label } of transcriptInsetCases) {
  test(`aligns the workspace setup card ${label}`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    const component = await mount(ChatPanelOperationalGeometryHost, {
      props: { theme: 'light', zoom: 1, width, setupCardOnly: true },
    });

    const [headerTitleBox, setupTitleBox, iconBox] = await Promise.all([
      component.locator('[data-panel-header-title]').boundingBox(),
      component.getByRole('heading', { name: 'Workspace ready to go!' }).boundingBox(),
      component.getByTestId('workspace-setup-step-icon').first().locator('svg').boundingBox(),
    ]);

    expect(headerTitleBox).not.toBeNull();
    expect(setupTitleBox).not.toBeNull();
    expect(iconBox).not.toBeNull();
    expect(Math.abs(setupTitleBox!.x - iconBox!.x)).toBeLessThanOrEqual(1);
    if (width < 640) {
      expect(Math.abs(headerTitleBox!.x - setupTitleBox!.x)).toBeLessThanOrEqual(1);
    }
  });
}

test('keeps the nested composer inset without a narrow scroll owner', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 360 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const composer = component.getByTestId('chat-composer-controls-inner');
  const composerLane = component.getByTestId('chat-composer-lane');
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  const aurora = component.getByTestId('composer-aurora-host');
  const shell = component.getByTestId('chat-composer-shell');

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { theme, zoom, width: 360 } });
      // Wait until the transcript/composer widths converge: the scrollbar
      // gutter can lag the resize by a frame and skew the transcript width.
      await expect
        .poll(async () => {
          const [transcriptWidth, composerWidth] = await Promise.all([
            transcript.boundingBox().then((box) => box?.width ?? 0),
            composer.boundingBox().then((box) => box?.width ?? 0),
          ]);
          return transcriptWidth > 0
            ? Math.abs(transcriptWidth - composerWidth - 32 * zoom)
            : Infinity;
        })
        .toBeLessThanOrEqual(1);
      const [transcriptBox, composerBox] = await Promise.all([
        transcript.boundingBox(),
        composer.boundingBox(),
      ]);
      expect(Math.abs(transcriptBox!.width - composerBox!.width - 32 * zoom)).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs(center(transcriptBox!) - center(composerBox!))).toBeLessThanOrEqual(0.5);
      await expect(composerLane).toHaveCSS('padding-left', '16px');
      await expect(composerLane).toHaveCSS('padding-right', '16px');
      await expect(composerLane).toHaveCSS('padding-bottom', '16px');
      expect(transcriptBox!.width).toBeLessThanOrEqual(360 * zoom);
      expect(await transcript.evaluate((node) => node.scrollWidth <= node.clientWidth + 0.5)).toBe(
        true,
      );
      await expect(viewport).toHaveCSS('overflow-y', 'auto');
      await expect(transcript).toHaveCSS('overflow-y', 'visible');
      const panel = component.locator('.panel');
      const [auroraGeometry, shellGeometry, panelContentGeometry] = await Promise.all([
        bottomSurfaceGeometry(aurora),
        bottomSurfaceGeometry(shell),
        bottomSurfaceGeometry(component.locator('.panel > .panel-content')),
      ]);
      expect(auroraGeometry.edges).toEqual(shellGeometry.edges);
      expect(auroraGeometry.edges).toEqual(panelContentGeometry.edges);
      await expectPanelToClipFlushAurora(aurora, panel);
    }
  }
});

test('contains expanded long tool content, follows bottom, and preserves composer focus', async ({
  mount,
}) => {
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'dark', zoom: 2, width: 360 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  await component
    .locator('[data-message-id="assistant-finished"]')
    .getByTestId('response-group-disclosure')
    .click();
  const longTool = component.locator('[data-tool-use-id="finished-long"]');
  await longTool
    .getByTestId('tool-call-disclosure')
    .evaluate((element) => (element as HTMLElement).click());
  await viewport.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThanOrEqual(1);
  expect(await transcript.evaluate((node) => node.scrollWidth <= node.clientWidth + 0.5)).toBe(
    true,
  );
  const editor = component.getByTestId('message-input').locator('.ProseMirror');
  await editor.focus();
  await expect(editor).toBeFocused();
});
