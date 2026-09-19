import { test, expect } from '@playwright/experimental-ct-svelte';
import Combobox from './combobox.svelte';

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
