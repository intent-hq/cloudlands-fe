import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
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

test('preserves edit, selection, reorder, save, cancel, removal, and scroll ownership', async ({
  mount,
  page,
}) => {
  const component = await mount(QueuedMessageBottomGapHost, {
    props: { width: 720, queueCount: 3, saveDelayMs: 1000 },
  });
  await settle(component, page);
  const rows = component.getByTestId('queued-message-row');

  await rows.first().hover();
  await rows.first().getByTestId('queued-message-content').dblclick();
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

  await textarea.press('Enter');
  await expect(textarea).toHaveCount(1);
  await expect(textarea).toHaveCount(0);

  await rows.first().hover();
  await rows.first().getByTestId('queued-message-content').dblclick();
  await expect(textarea).toBeFocused();
  await textarea.press('Escape');
  await expect(textarea).toHaveCount(0);

  await rows.first().hover();
  await rows
    .first()
    .getByTestId('queued-message-actions')
    .getByRole('button', { name: 'Remove' })
    .click();
  await settle(component, page);
  await expect(rows).toHaveCount(2);
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
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await component.getByTestId('queued-message-row').hover();
  await component
    .getByTestId('queued-message-actions')
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(component.getByTestId('queued-message-utility-area')).toHaveCount(0);
  await expect(component.getByTestId('queued-messages-container')).toHaveCount(0);
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);

  await component.update({ props: { queueCount: 2 } });
  await expect(component.getByTestId('queued-message-row')).toHaveCount(1);
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
});
