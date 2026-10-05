import { expect, test } from '../../../../test/ct-test';
import GuestWindowNameHarness from './GuestWindowNameHarness.svelte';

test('guest chrome follows the selected host through delayed metadata and a backend switch', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(GuestWindowNameHarness);
  await expect(page.getByRole('button', { name: /remote\.example/ })).toBeVisible();
  await component.update({ props: { hostname: 'Remote Studio' } });
  const trigger = page.getByRole('button', { name: /Remote Studio/ });
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText('Remote Studio');
  await testInfo.attach('guest-host-name.png', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await component.update({ props: { hostname: 'Remote Studio', backendId: 'local' } });
  await expect(page.getByRole('button', { name: /Remote Studio/ })).toHaveCount(0);
  await component.update({ props: { hostname: 'Late guest name', backendId: 'local' } });
  await expect(page.getByRole('button', { name: /Late guest name/ })).toHaveCount(0);
  await component.update({ props: { hostname: 'Remote Studio', backendId: 'guest-window' } });
  await expect(page.getByRole('button', { name: /Remote Studio/ })).toBeVisible();
});
