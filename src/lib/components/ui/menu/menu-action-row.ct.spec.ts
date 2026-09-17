import { expect, test } from '@playwright/experimental-ct-svelte';
import ActionRowHarness from './ActionRowTestHarness.svelte';

test('action rows grow with wrapped content and retain independent leading and trailing slots', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 720, height: 800 });
  const component = await mount(ActionRowHarness);
  const multiline = component.getByRole('button', { name: /Review accessible/ });
  const wideHeight = (await multiline.boundingBox())!.height;
  await page.setViewportSize({ width: 280, height: 800 });
  await expect
    .poll(async () => (await multiline.boundingBox())!.height)
    .toBeGreaterThan(wideHeight);
  const rows = component.getByRole('button');
  const geometry = await rows.evaluateAll((elements) =>
    elements.map((row) => {
      const box = row.getBoundingClientRect();
      const slots = Array.from(row.querySelectorAll<HTMLElement>('[data-slot^="action-row-"]'));
      return {
        top: box.top,
        bottom: box.bottom,
        overflow: row.scrollHeight - row.clientHeight,
        contained: slots.every((slot) => {
          const child = slot.getBoundingClientRect();
          return (
            child.top >= box.top &&
            child.bottom <= box.bottom &&
            child.left >= box.left &&
            child.right <= box.right
          );
        }),
      };
    }),
  );
  expect(geometry.every((row) => row.contained && row.overflow <= 1)).toBe(true);
  for (let index = 1; index < geometry.length; index++) {
    expect(geometry[index].top).toBeGreaterThanOrEqual(geometry[index - 1].bottom);
  }
});

test('action rows retain native keyboard activation, visible focus, and disabled tab skipping', async ({
  mount,
  page,
}) => {
  const activated: string[] = [];
  const component = await mount(ActionRowHarness, {
    props: { onActivate: () => activated.push('activated') },
  });
  const short = component.getByRole('button', { name: 'Short action' });
  await short.focus();
  await short.press('Enter');
  await expect.poll(() => activated.length).toBe(1);
  await page.keyboard.press('Tab');
  const multiline = component.getByRole('button', { name: /Review accessible/ });
  await expect(multiline).toBeFocused();
  await expect(multiline).toHaveCSS('outline-style', 'solid');
  await multiline.press('Space');
  await expect.poll(() => activated.length).toBe(2);
  await page.keyboard.press('Tab');
  await expect(component.getByRole('button', { name: 'Following action' })).toBeFocused();
  await expect(component.getByRole('button', { name: 'Unavailable action' })).toBeDisabled();
  expect(activated).toHaveLength(2);
});
