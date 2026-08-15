import { expect, test } from '@playwright/experimental-ct-svelte';
import MessageSendTransitionHost from './MessageSendTransitionHost.svelte';

async function captureTransitionFrames(page: import('@playwright/test').Page, owner: string) {
  return page.evaluate(
    (panelId) =>
      new Promise<
        Array<{
          box: { left: number; top: number; width: number; height: number };
          opacity: string;
        }>
      >((resolve) => {
        const frames: Array<{
          box: { left: number; top: number; width: number; height: number };
          opacity: string;
        }> = [];
        const sample = () => {
          const overlay = document.querySelector<HTMLElement>(
            `[data-message-send-owner="${panelId}"]`,
          );
          if (!overlay) {
            resolve(frames);
            return;
          }
          const { left, top, width, height } = overlay.getBoundingClientRect();
          frames.push({
            box: { left, top, width, height },
            opacity: getComputedStyle(overlay).opacity,
          });
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    owner,
  );
}

test('keeps rapid-send frames continuous and owned by one panel', async ({ mount, page }) => {
  const component = await mount(MessageSendTransitionHost, {
    props: { panelId: 'rapid', rapidCount: 2 },
  });
  await component.getByTestId('send-button').click();
  const frames = await captureTransitionFrames(page, 'rapid');
  await expect(component.getByTestId('settled-count')).toHaveText('2');
  expect(frames.length).toBeGreaterThan(4);
  expect(frames.every(({ opacity }) => opacity === '1')).toBe(true);
  expect(await component.getByTestId('send-target').count()).toBe(2);
  expect(await page.locator('[data-message-send-transition]').count()).toBe(0);
});

test('lands multiline long content on the canonical box without a handoff jump', async ({
  mount,
  page,
}) => {
  const text = 'A multiline message\n' + 'long content '.repeat(35);
  const component = await mount(MessageSendTransitionHost, {
    props: { panelId: 'long', text },
  });
  await component.getByTestId('send-button').click();
  const frames = await captureTransitionFrames(page, 'long');
  const target = await component.getByTestId('send-target').boundingBox();
  const last = frames.at(-1)?.box;
  expect(last).toBeTruthy();
  expect(Math.abs((last?.left ?? 0) - (target?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((last?.top ?? 0) - (target?.y ?? 0))).toBeLessThan(2);
});

test('follows the bottom without smooth-scroll competition and preserves manual scroll', async ({
  mount,
  page,
}) => {
  await mount(MessageSendTransitionHost, { props: { panelId: 'follow' } });
  const followed = page.locator('[data-panel-id="follow"]');
  await followed.getByTestId('send-button').click();
  await expect(followed.getByTestId('settled-count')).toHaveText('1');
  const followPosition = await followed.getByTestId('send-scroll').evaluate((node) => ({
    top: node.scrollTop,
    bottom: node.scrollHeight - node.clientHeight,
  }));
  expect(Math.abs(followPosition.top - followPosition.bottom)).toBeLessThan(1);

  await mount(MessageSendTransitionHost, {
    props: { panelId: 'manual', followBottom: false },
  });
  const manual = page.locator('[data-panel-id="manual"]');
  await manual.getByTestId('send-scroll').evaluate((node) => (node.scrollTop = 48));
  await manual.getByTestId('send-button').click();
  await expect(manual.getByTestId('settled-count')).toHaveText('1');
  await expect
    .poll(() => manual.getByTestId('send-scroll').evaluate((node) => node.scrollTop))
    .toBe(48);
});

test('stays continuous when response content starts during the send', async ({ mount }) => {
  const component = await mount(MessageSendTransitionHost, {
    props: { panelId: 'response', responseStart: true },
  });
  await component.getByTestId('send-button').click();
  await expect(component.getByTestId('response-start')).toBeVisible();
  await expect(component.getByTestId('settled-count')).toHaveText('1');
  await expect(component.getByTestId('send-target')).toBeVisible();
});

test('keeps simultaneous panel transitions isolated and honors reduced motion', async ({
  mount,
  page,
}) => {
  await mount(MessageSendTransitionHost, { props: { panelId: 'left' } });
  await mount(MessageSendTransitionHost, { props: { panelId: 'right' } });
  const left = page.locator('[data-panel-id="left"]');
  const right = page.locator('[data-panel-id="right"]');
  await left.getByTestId('send-button').click();
  await right.getByTestId('send-button').click();
  await expect(left.getByTestId('settled-count')).toHaveText('1');
  await expect(right.getByTestId('settled-count')).toHaveText('1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await left.getByTestId('send-button').click();
  await expect(left.getByTestId('settled-count')).toHaveText('2');
  expect(await page.locator('[data-message-send-transition]').count()).toBe(0);
});
