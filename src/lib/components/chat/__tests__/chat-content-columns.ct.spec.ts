import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

const center = (box: { x: number; width: number }) => box.x + box.width / 2;

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
  const input = component.getByTestId('message-input');
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
      const [
        transcriptBox,
        composerBox,
        composerLaneBox,
        shellBox,
        promptBox,
        inputBox,
        auroraBox,
      ] = await Promise.all([
        transcript.boundingBox(),
        composer.boundingBox(),
        composerLane.boundingBox(),
        shell.boundingBox(),
        promptLayer.boundingBox(),
        input.boundingBox(),
        aurora.boundingBox(),
      ]);
      expect(composerLaneBox!.width).toBeCloseTo(transcriptBox!.width, 1);
      expect(composerBox!.width).toBeCloseTo(transcriptBox!.width - 48 * zoom, 1);
      expect(Math.abs(center(transcriptBox!) - center(composerBox!))).toBeLessThanOrEqual(0.5);
      expect(promptBox!.width).toBeCloseTo(shellBox!.width, 1);
      expect(auroraBox!.x).toBeCloseTo(inputBox!.x, 1);
      expect(auroraBox!.x + auroraBox!.width).toBeCloseTo(inputBox!.x + inputBox!.width, 1);
      expect(auroraBox!.y + auroraBox!.height).toBeCloseTo(inputBox!.y + inputBox!.height, 1);
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

test('keeps the nested composer inset without a narrow scroll owner', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 360 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const composer = component.getByTestId('chat-composer-controls-inner');
  const composerLane = component.getByTestId('chat-composer-lane');
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');

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
