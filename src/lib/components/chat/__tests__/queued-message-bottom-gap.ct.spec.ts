import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import QueuedMessageBottomGapHost from './QueuedMessageBottomGapHost.svelte';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function settle(component: Locator, page: Page) {
  await page.waitForTimeout(240);
  await component.evaluate(async (node) => {
    await Promise.all(
      node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})),
    );
  });
}

async function outerGap(component: Locator) {
  return component.evaluate((root) => {
    const column = root.querySelector('[data-testid="queued-gap-column"]')!;
    const queue = root.querySelector('[data-testid="queued-messages-container"]')!;
    return column.getBoundingClientRect().bottom - queue.getBoundingClientRect().bottom;
  });
}

async function visibleComposerGap(component: Locator) {
  const transcript = component.getByTestId('queued-gap-transcript');
  await transcript.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  return component.evaluate((root) => {
    const queue = root.querySelector('[data-testid="queued-messages-container"]')!;
    const composer = root.querySelector('[data-testid="queued-gap-composer"]')!;
    return composer.getBoundingClientRect().top - queue.getBoundingClientRect().bottom;
  });
}

async function rowGeometry(component: Locator) {
  return component
    .getByTestId('queued-message-row')
    .first()
    .evaluate((row) => {
      const style = getComputedStyle(row);
      const list = row.parentElement!;
      return {
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        rowGap: getComputedStyle(list).rowGap,
        containerPaddingBottom: getComputedStyle(
          row.closest('[data-testid="queued-messages-container"]')!,
        ).paddingBottom,
      };
    });
}

test('keeps the edge gap at zero for empty, one, and many queues in every display matrix', async ({
  mount,
  page,
}) => {
  const component = await mount(QueuedMessageBottomGapHost);
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 720]) {
      for (const zoom of [1, 2]) {
        if (
          (theme === 'light' && (width !== 720 || zoom !== 1)) ||
          (theme === 'dark' && (width !== 320 || zoom !== 2))
        )
          continue;
        await component.update({ props: { theme, width, zoom, queueCount: 0 } });
        await settle(component, page);
        await expect(component.getByTestId('queued-message-utility-area')).toHaveCount(0);
        await expect(component.getByTestId('queued-messages-container')).toHaveCount(0);
        await expect(component.getByTestId('chat-scroll-end-marker')).toHaveCSS('height', '0px');
        await expect(component.getByTestId('queued-gap-column')).toHaveCSS(
          'padding-bottom',
          width === 320 ? '12px' : '24px',
        );

        for (const queueCount of [1, 3]) {
          await component.update({
            props: {
              theme,
              width,
              zoom,
              queueCount,
            },
          });
          await settle(component, page);
          await expect(component.getByTestId('queued-message-row')).toHaveCount(queueCount);
          await expect(component.getByTestId('queued-gap-column')).toHaveCSS(
            'padding-bottom',
            '0px',
          );
          expect(await outerGap(component)).toBeCloseTo(0, 5);
          expect(await visibleComposerGap(component)).toBeCloseTo(0, 5);
          expect(await rowGeometry(component)).toEqual({
            paddingTop: '4px',
            paddingBottom: '4px',
            rowGap: 'normal',
            containerPaddingBottom: '8px',
          });
        }
      }
    }
  }
});

test('preserves edit, selection, reorder, save, cancel, removal, and scroll ownership', async ({
  mount,
  page,
}) => {
  const component = await mount(QueuedMessageBottomGapHost, {
    props: { width: 720, queueCount: 3, saveDelayMs: 1000 },
  });
  await settle(component, page);
  const baseline = await rowGeometry(component);
  const rows = component.getByTestId('queued-message-row');

  await rows.first().hover();
  await rows.first().getByTestId('queued-message-actions').getByRole('button').nth(1).click();
  const textarea = component.locator('textarea');
  await expect(textarea).toBeFocused();
  await textarea.fill('Edited queued message');
  await textarea.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(3, 9));
  await component.update({
    props: { width: 720, queueCount: 3, reverse: true, saveDelayMs: 1000 },
  });
  await expect(textarea).toBeFocused();
  await expect
    .poll(() => textarea.evaluate((node) => (node as HTMLTextAreaElement).selectionStart))
    .toBe(3);
  await expect
    .poll(() => textarea.evaluate((node) => (node as HTMLTextAreaElement).selectionEnd))
    .toBe(9);
  await expect(rows.first()).toHaveAttribute('data-message-id', 'queue-2');
  expect(await outerGap(component)).toBeCloseTo(0, 5);

  await textarea.press('Enter');
  await expect(textarea).toHaveCount(1);
  expect(await outerGap(component)).toBeCloseTo(0, 5);
  await expect(textarea).toHaveCount(0);
  expect(await rowGeometry(component)).toEqual(baseline);

  await rows.first().hover();
  await rows.first().getByTestId('queued-message-actions').getByRole('button').nth(1).click();
  await expect(textarea).toBeFocused();
  await textarea.press('Escape');
  await expect(textarea).toHaveCount(0);
  expect(await outerGap(component)).toBeCloseTo(0, 5);

  await rows.first().hover();
  await rows.first().getByTestId('queued-message-actions').getByRole('button').nth(2).click();
  await settle(component, page);
  await expect(rows).toHaveCount(2);
  expect(await rowGeometry(component)).toEqual(baseline);
  expect(await visibleComposerGap(component)).toBeCloseTo(0, 5);
  await expect(component.getByTestId('queued-gap-bottom-state')).toContainText('locked:0');

  const transcript = component.getByTestId('queued-gap-transcript');
  await transcript.evaluate((node) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    node.scrollTop = 80;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect(component.getByTestId('queued-gap-bottom-state')).toContainText('unlocked');
  const beforeTop = await transcript.evaluate((node) => node.scrollTop);
  await component.update({ props: { width: 720, queueCount: 5, reverse: false } });
  await settle(component, page);
  await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBe(beforeTop);
  expect(await outerGap(component)).toBeCloseTo(0, 5);
});

test('leaves no stale shell after removal, transition reversal, or reduced motion', async ({
  mount,
  page,
}) => {
  const component = await mount(QueuedMessageBottomGapHost, { props: { queueCount: 1 } });
  await settle(component, page);
  await component.update({ props: { queueCount: 0 } });
  await page.waitForTimeout(40);
  await component.update({ props: { queueCount: 1 } });
  await settle(component, page);
  await expect(component.getByTestId('queued-message-utility-area')).toHaveCount(1);
  await expect(component.getByTestId('queued-messages-container')).toHaveCount(1);
  expect(await outerGap(component)).toBeCloseTo(0, 5);
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await component.getByTestId('queued-message-row').hover();
  await component.getByTestId('queued-message-actions').getByRole('button').nth(2).click();
  await expect(component.getByTestId('queued-message-utility-area')).toHaveCount(0);
  await expect(component.getByTestId('queued-messages-container')).toHaveCount(0);
  await expect(component.getByTestId('chat-scroll-end-marker')).toHaveCSS('height', '0px');
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);

  await component.update({ props: { queueCount: 2 } });
  await expect(component.getByTestId('queued-message-row')).toHaveCount(1);
  await expect.poll(() => visibleComposerGap(component)).toBeCloseTo(0, 5);
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
});
