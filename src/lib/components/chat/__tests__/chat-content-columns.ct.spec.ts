import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

const center = (box: { x: number; width: number }) => box.x + box.width / 2;

test('caps and centers separate transcript and composer columns in every wide state', async ({
  mount,
}) => {
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 1440 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const composer = component.getByTestId('chat-composer-controls-inner');
  const shell = component.getByTestId('chat-composer-shell');
  const promptLayer = component.getByTestId('composer-prompt-layer');

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { theme, zoom, width: 1440 } });
      await expect
        .poll(async () => (await transcript.boundingBox())!.width)
        .toBeCloseTo(1050 * zoom, 1);
      const [transcriptBox, composerBox, shellBox, promptBox] = await Promise.all([
        transcript.boundingBox(),
        composer.boundingBox(),
        shell.boundingBox(),
        promptLayer.boundingBox(),
      ]);
      expect(composerBox!.width).toBeCloseTo(1050 * zoom, 1);
      expect(Math.abs(center(transcriptBox!) - center(composerBox!))).toBeLessThanOrEqual(0.5);
      expect(promptBox!.width).toBeCloseTo(shellBox!.width, 1);
      await expect(promptLayer).toHaveCSS('border-top-width', '1px');
      await expect(transcript).toHaveCSS('max-width', '1050px');
      await expect(composer).toHaveCSS('max-width', '1050px');
    }
  }
});

test('adds bottom breathing room when no subscription utility is visible', async ({ mount }) => {
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 720 },
  });
  const promptLayer = component.getByTestId('composer-prompt-layer');

  await expect(promptLayer).toHaveAttribute('data-has-transcript-utility', 'false');
  await expect(promptLayer).toHaveCSS('padding-bottom', '12px');
});

test('uses the same available width and gutters without a nested narrow scroll owner', async ({
  mount,
}) => {
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 360 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const composer = component.getByTestId('chat-composer-controls-inner');
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
          return transcriptWidth > 0 ? Math.abs(transcriptWidth - composerWidth) : Infinity;
        })
        .toBeLessThanOrEqual(0.05);
      const [transcriptBox, composerBox] = await Promise.all([
        transcript.boundingBox(),
        composer.boundingBox(),
      ]);
      expect(transcriptBox!.width).toBeCloseTo(composerBox!.width, 1);
      expect(Math.abs(center(transcriptBox!) - center(composerBox!))).toBeLessThanOrEqual(0.5);
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
