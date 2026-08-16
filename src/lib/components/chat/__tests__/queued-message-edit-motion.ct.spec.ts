import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import QueuedMessageEditMotionHost from './QueuedMessageEditMotionHost.svelte';

test.describe.configure({ mode: 'serial' });

interface FrameSample {
  height: number;
  bottomDistance: number;
  editModes: number;
  displayModes: number;
}

async function startSampling(transcript: Locator, row: Locator, frames = 48) {
  await transcript.evaluate(
    (scroll, { rowSelector, frames }) => {
      const state = window as typeof window & {
        __queuedEditSamples?: FrameSample[];
        __queuedEditSamplingDone?: boolean;
      };
      state.__queuedEditSamples = [];
      state.__queuedEditSamplingDone = false;
      let remaining = frames;
      const sample = () => {
        const target = document.querySelector<HTMLElement>(rowSelector);
        state.__queuedEditSamples!.push({
          height: target?.getBoundingClientRect().height ?? 0,
          bottomDistance: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
          editModes:
            target?.querySelectorAll('[data-testid="queued-message-edit-mode"]').length ?? 0,
          displayModes: target?.querySelectorAll('[data-mode="display"]').length ?? 0,
        });
        remaining -= 1;
        if (remaining > 0) requestAnimationFrame(sample);
        else state.__queuedEditSamplingDone = true;
      };
      requestAnimationFrame(sample);
    },
    { rowSelector: `[data-message-id="${await row.getAttribute('data-message-id')}"]`, frames },
  );
}

async function finishSampling(page: Page): Promise<FrameSample[]> {
  await page.waitForFunction(
    () =>
      (window as typeof window & { __queuedEditSamplingDone?: boolean }).__queuedEditSamplingDone,
  );
  return page.evaluate(
    () =>
      (window as typeof window & { __queuedEditSamples?: FrameSample[] }).__queuedEditSamples ?? [],
  );
}

for (const config of [
  { name: 'normal light at 100%', theme: 'light' as const, width: 640, zoom: 1 },
  { name: 'narrow dark at 100%', theme: 'dark' as const, width: 320, zoom: 1 },
  { name: 'normal dark at 200%', theme: 'dark' as const, width: 640, zoom: 2 },
  { name: 'narrow light at 200%', theme: 'light' as const, width: 320, zoom: 2 },
]) {
  test(`keeps queue edit motion continuous and bottom-locked at ${config.name}`, async ({
    mount,
    page,
  }) => {
    const component = await mount(QueuedMessageEditMotionHost, { props: config });
    const transcript = component.getByTestId('queued-edit-transcript');
    const row = component.locator('[data-message-id="motion-0"]');
    await transcript.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await row.evaluate((node) => (node.dataset.identity = 'stable'));
    await startSampling(transcript, row);

    await row.getByTestId('queued-message-content').click();
    const textarea = row.locator('textarea');
    await expect(textarea).toBeFocused();
    await textarea.fill('First line\nSecond line grows the editor\nThird line');
    await component.getByTestId('queued-edit-refresh').click();
    await expect(textarea).toBeFocused();
    await component.getByTestId('queued-edit-reorder').click();
    await expect(textarea).toBeFocused();
    await textarea.press('Enter');
    await expect(row.getByTestId('queued-message-content')).toBeVisible();

    const samples = await finishSampling(page);
    expect(await row.getAttribute('data-identity')).toBe('stable');
    expect(samples.length).toBe(48);
    expect(samples.every((sample) => sample.height > 0)).toBe(true);
    expect(samples.every((sample) => sample.editModes + sample.displayModes === 1)).toBe(true);
    expect(
      Math.max(...samples.map((sample) => Math.abs(sample.bottomDistance))),
    ).toBeLessThanOrEqual(8);
    const deltas = samples
      .slice(1)
      .map((sample, index) => Math.abs(sample.height - samples[index].height));
    expect(Math.max(...deltas)).toBeLessThan(48 * config.zoom);
    expect(samples.at(-1)!.height).toBeCloseTo(samples.at(-2)!.height, 1);
  });
}

test('preserves a deliberately scrolled-up viewport during edit, refresh, reorder, and reversal', async ({
  mount,
  page,
}) => {
  const component = await mount(QueuedMessageEditMotionHost);
  const transcript = component.getByTestId('queued-edit-transcript');
  const row = component.locator('[data-message-id="motion-0"]');
  await transcript.evaluate((node) => {
    node.scrollTop = 180;
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
  });
  const initialTop = await transcript.evaluate((node) => node.scrollTop);
  await startSampling(transcript, row, 36);
  // Locator.click() scrolls an off-screen target into view before dispatching
  // input, which would make this an automation-scroll test instead.
  await row.getByTestId('queued-message-content').dispatchEvent('click');
  const textarea = row.locator('textarea');
  await textarea.evaluate((node, value) => {
    node.value = value;
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, 'one\ntwo\nthree');
  await component.getByTestId('queued-edit-refresh').click();
  await component.getByTestId('queued-edit-reorder').click();
  await textarea.dispatchEvent('keydown', { key: 'Escape' });
  const samples = await finishSampling(page);
  expect(samples.every((sample) => sample.editModes + sample.displayModes === 1)).toBe(true);
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
  await row.getByTestId('queued-message-content').click();
  await expect(row.locator('textarea')).toBeFocused();
  expect(await row.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await component.getByTestId('queued-edit-remove').click();
  await expect(component.locator('[data-message-id="motion-1"]')).toHaveCount(0);
  expect(await component.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});
