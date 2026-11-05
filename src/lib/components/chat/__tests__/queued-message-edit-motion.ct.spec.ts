import { expect, test } from '../../../../test/ct-test';
import QueuedMessageEditMotionHost from './QueuedMessageEditMotionHost.svelte';

test.describe.configure({ mode: 'serial' });

for (const config of [
  { name: 'normal light at 100%', theme: 'light' as const, width: 640, zoom: 1 },
  { name: 'narrow dark at 100%', theme: 'dark' as const, width: 320, zoom: 1 },
  { name: 'normal dark at 200%', theme: 'dark' as const, width: 640, zoom: 2 },
  { name: 'narrow light at 200%', theme: 'light' as const, width: 320, zoom: 2 },
]) {
  test(`preserves queue edit focus and identity at ${config.name}`, async ({ mount }) => {
    const component = await mount(QueuedMessageEditMotionHost, { props: config });
    const transcript = component.getByTestId('queued-edit-transcript');
    const row = component.locator('[data-message-id="motion-0"]');
    await transcript.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await row.evaluate((node) => (node.dataset.identity = 'stable'));

    await row.getByTestId('queued-message-content').dblclick();
    const textarea = row.locator('textarea');
    await expect(textarea).toBeFocused();
    await textarea.fill('First line\nSecond line grows the editor\nThird line');
    await component.getByTestId('queued-edit-refresh').click();
    await expect(textarea).toBeFocused();
    await component.getByTestId('queued-edit-reorder').click();
    await expect(textarea).toBeFocused();
    await textarea.press('Enter');
    await expect(row.getByTestId('queued-message-content')).toBeVisible();

    expect(await row.getAttribute('data-identity')).toBe('stable');
  });
}

test('preserves a deliberately scrolled-up viewport during edit, refresh, reorder, and cancel', async ({
  mount,
}) => {
  const component = await mount(QueuedMessageEditMotionHost);
  const transcript = component.getByTestId('queued-edit-transcript');
  const row = component.locator('[data-message-id="motion-0"]');
  await transcript.evaluate((node) => {
    node.scrollTop = 180;
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
  });
  const initialTop = await transcript.evaluate((node) => node.scrollTop);
  // Locator.click() scrolls an off-screen target into view before dispatching
  // input, which would make this an automation-scroll test instead.
  await row.getByTestId('queued-message-content').dispatchEvent('dblclick');
  const textarea = row.locator('textarea');
  await textarea.evaluate((node, value) => {
    node.value = value;
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, 'one\ntwo\nthree');
  await component.getByTestId('queued-edit-refresh').click();
  await component.getByTestId('queued-edit-reorder').click();
  await textarea.dispatchEvent('keydown', { key: 'Escape' });
  await expect(row.getByTestId('queued-message-content')).toBeVisible();
  expect(await transcript.evaluate((node) => node.scrollTop)).toBeCloseTo(initialTop, 1);
  await expect(component.getByTestId('queued-edit-bottom-state')).toContainText('unlocked');
});

test('completes reduced motion immediately and removes rows without residual space', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessageEditMotionHost);
  const row = component.locator('[data-message-id="motion-0"]');
  await row.getByTestId('queued-message-content').dblclick();
  await expect(row.locator('textarea')).toBeFocused();
  // Reduced motion completes animations immediately, but finished transitions
  // can linger in getAnimations() for a frame or two under load — poll.
  await expect
    .poll(() => row.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
  await component.getByTestId('queued-edit-remove').click();
  await expect(component.locator('[data-message-id="motion-1"]')).toHaveCount(0);
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
});
