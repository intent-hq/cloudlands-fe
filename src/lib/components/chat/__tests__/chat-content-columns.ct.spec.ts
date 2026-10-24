import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

const transcriptInsetCases = [
  {
    width: 600,
    label: 'below the panel breakpoint',
  },
  {
    width: 680,
    label: 'above the panel breakpoint',
  },
] as const;

for (const { width, label } of transcriptInsetCases) {
  test(`keeps the transcript and pinned prompt usable ${label}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 900 });
    const component = await mount(ChatPanelOperationalGeometryHost, {
      props: { theme: 'light', zoom: 1, width },
    });

    if (width < 640) {
      await testInfo.attach('narrow-chat-content', {
        body: await component.screenshot(),
        contentType: 'image/png',
      });
    } else {
      const viewport = component.getByTestId('chat-transcript-scroll-viewport');
      await viewport.hover();
      const delta = await viewport.evaluate((node) => {
        const prompt = node.querySelector<HTMLElement>('[data-pinned-prompt-id]');
        const turn = prompt?.closest('[data-conversation-turn]');
        if (!prompt || !turn) throw new Error('Expected a user turn in the transcript');
        return (
          (prompt.getBoundingClientRect().bottom + turn.getBoundingClientRect().bottom) / 2 -
          node.getBoundingClientRect().top
        );
      });
      // Upward wheel input releases follow-bottom; programmatic scrolling does not.
      await page.mouse.wheel(0, delta);
      await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();
    }
  });
}

test('keeps the nested composer inset without a narrow scroll owner', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 360 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { theme, zoom, width: 360 } });
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
  page,
}) => {
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'dark', zoom: 2, width: 360 },
  });
  const transcript = component.getByTestId('chat-transcript-inner');
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  await viewport.evaluate((node) => node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 })));
  const finished = component.locator('[data-message-id="assistant-finished"]');
  await finished.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await finished.getByTestId('response-group-disclosure').click();
  await finished.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const longTool = component.locator('[data-tool-use-id="finished-long"]');
  await longTool
    .getByTestId('tool-call-disclosure')
    .evaluate((element) => (element as HTMLElement).click());
  // Wheel-up above paused following; resume through downward user input.
  await viewport.hover({ position: { x: 2, y: 100 } });
  await page.mouse.wheel(0, 100_000);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThanOrEqual(1);
  // Following must survive a later viewport shrink, rather than only landing
  // at the current bottom once during the native wheel scroll.
  const priorHeight = await viewport.evaluate((node) => node.clientHeight);
  await component.update({ props: { theme: 'dark', zoom: 2, width: 360, height: 800 } });
  await expect.poll(() => viewport.evaluate((node) => node.clientHeight)).toBeLessThan(priorHeight);
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
