import { expect, test } from '../../../../../test/ct-test';
import WorkspacePresenceFollowHost from './mocks/WorkspacePresenceFollowHost.svelte';

// The real sidebar, authority selectors, transport channel, follow saga and
// navigation reducer run here. CT's shared goto stub does not change URLs;
// route invocation and async route races are covered by the saga suite.
for (const width of [360, 960]) {
  test(`presence tooltip and keyboard follow at ${width}px`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width, height: 640 });
    const component = await mount(WorkspacePresenceFollowHost);
    const avatar = component.getByRole('button', { name: /Alex Chen.*Shared destination/ });
    await expect(avatar).toBeVisible();
    await avatar.focus();
    await expect(page.getByRole('tooltip')).toContainText('Shared destination');
    await testInfo.attach(`presence-hover-${width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expect(component.getByRole('heading', { name: 'Project plan', exact: true })).toHaveCount(
      0,
    );
    await avatar.press('Enter');
    await expect(
      component.getByRole('heading', { name: 'Project plan', exact: true }),
    ).toBeVisible();
    await testInfo.attach(`presence-navigation-${width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('hidden guest destination has no actionable avatar or location metadata', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspacePresenceFollowHost, {
    props: { hidden: true, role: 'guest' },
  });
  const avatar = component.getByRole('button', { name: /Alex/ });
  await expect(avatar).toHaveAttribute('aria-disabled', 'true');
  await expect(avatar).toBeVisible();
  await component.getByRole('group', { name: '1 other person here' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Alex');
  expect(await component.innerHTML()).not.toContain('Shared destination');
  expect(await component.innerHTML()).not.toContain('/workspace/destination');
  await avatar.click({ force: true });
  await expect(component.getByRole('heading', { name: 'Project plan', exact: true })).toHaveCount(
    0,
  );
});
