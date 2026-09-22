import { test, expect } from '../../../../test/ct-test';
import Combobox from './combobox.svelte';
import Scrolled from './combobox-scrolled.test-harness.svelte';

test('filtering a scrolled constrained popover commits immediately and returns focus', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 320 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Scrolled);
  const trigger = page.getByRole('button', { name: 'Choose branch' });
  await trigger.click();
  const input = page.getByRole('combobox', { name: 'Branches' });
  await expect(input).toBeFocused();
  await input.press('End');
  await expect
    .poll(() => page.getByRole('listbox').evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await input.fill('feature/task-29');
  await input.press('Enter');
  await expect(page.getByLabel('Selected branch')).toHaveText('feature/task-29');
  await expect(page.getByLabel('Branch commits')).toHaveText('1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('immediate filtered Enter commits the matching branch instead of the previous highlight', async ({
  mount,
  page,
}) => {
  await mount(Combobox, {
    props: {
      ariaLabel: 'Branches',
      value: 'main',
      staticPosition: true,
      allowCustom: true,
      options: [
        { value: 'main', label: 'main' },
        ...Array.from({ length: 30 }, (_, index) => ({
          value: `feature/task-${index}`,
          label: `feature/task-${index}`,
        })),
      ],
    },
  });
  const input = page.getByRole('combobox', { name: 'Branches' });
  await input.fill('feature/task-29');
  await input.press('Enter');
  await expect(input).toHaveValue('feature/task-29');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.fill('feature/new');
  await input.press('Enter');
  await expect(input).toHaveValue('feature/new');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('multi-select checkmarks follow selection and deselection', async ({ mount, page }) => {
  await mount(Combobox, {
    props: {
      ariaLabel: 'Networks',
      multiple: true,
      options: [
        { value: 'lan', label: 'LAN' },
        { value: 'vpn', label: 'VPN' },
      ],
    },
  });
  await page.getByRole('combobox').click();
  const lan = page.getByRole('option', { name: 'LAN', exact: true });
  const vpn = page.getByRole('option', { name: 'VPN', exact: true });
  const mark = lan.locator('[data-slot="combobox-item-check"]');
  await expect(mark).toHaveCSS('opacity', '0');
  await lan.click();
  await expect(lan).toHaveAttribute('aria-selected', 'true');
  await expect(mark).toHaveCSS('opacity', '1');
  await expect(vpn.locator('[data-slot="combobox-item-check"]')).toHaveCSS('opacity', '0');
  await lan.click();
  await expect(lan).not.toHaveAttribute('aria-selected', 'true');
  await expect(mark).toHaveCSS('opacity', '0');
});
