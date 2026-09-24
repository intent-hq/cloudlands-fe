import { expect, test } from '../../../test/ct-test';
import Harness from './InvitationDialogHarness.svelte';

for (const kind of ['notice', 'consent', 'sign-in'] as const) {
  test(`${kind}: traps keyboard focus and restores the opener`, async ({ mount, page }) => {
    await mount(Harness, { props: { kind } });
    const opener = page.getByRole('button', { name: 'Open invitation' });
    await opener.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    const buttons = dialog.getByRole('button');
    await buttons.last().focus();
    await page.keyboard.press('Tab');
    await expect(buttons.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(buttons.last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByLabel('Responses')).toHaveText(
      kind === 'notice' ? 'acknowledged' : 'cancel',
    );
  });

  test(`${kind}: outside click dismisses once`, async ({ mount, page }) => {
    await mount(Harness, { props: { kind } });
    await page.getByRole('button', { name: 'Open invitation' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.mouse.click(1, 1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByLabel('Responses')).toHaveText(
      kind === 'notice' ? 'acknowledged' : 'cancel',
    );
  });
}

test('joining remains cancellable without duplicate join requests', async ({ mount, page }) => {
  await mount(Harness, { props: { kind: 'consent' } });
  await page.getByRole('button', { name: 'Open invitation' }).click();
  const join = page.getByRole('button', { name: 'Join', exact: true });
  await join.click();
  await expect(join).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByLabel('Responses')).toHaveText('open,cancel');
});

for (const noticeReason of ['pin-mismatch', 'identity-unavailable'] as const) {
  test(`${noticeReason}: account guidance fits a narrow dialog and acknowledges with keyboard`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 480 });
    await mount(Harness, { props: { kind: 'notice', noticeReason } });
    const opener = page.getByRole('button', { name: 'Open invitation' });
    await opener.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    const acknowledge = dialog.getByRole('button', { name: 'OK', exact: true });
    await expect(acknowledge).toBeInViewport();
    await acknowledge.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByLabel('Responses')).toHaveText('acknowledged');
  });
}
