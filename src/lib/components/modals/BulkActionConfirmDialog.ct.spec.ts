import { expect, test } from '../../../test/ct-test';
import Preview from './bulk-delete-dialog.preview.svelte';

for (const viewport of [
  { width: 548, height: 570, name: 'reported short window' },
  { width: 360, height: 570, name: 'narrow window' },
  { width: 1280, height: 800, name: 'desktop window' },
]) {
  test(`bulk delete keeps warnings, archived badges and actions reachable in the ${viewport.name}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let submitted = 0;
    await mount(Preview, { props: { onConfirm: () => submitted++ } });
    const dialog = page.getByRole('dialog');
    const body = dialog.locator('[data-slot="dialog-body"]');
    const list = dialog.getByRole('list');
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Delete all', exact: true });
    await expect(cancel).toBeFocused();
    await page.evaluate(() => document.fonts.ready);

    const geometry = await dialog.evaluate((node) => {
      const rect = (element: Element) => element.getBoundingClientRect().toJSON();
      const body = node.querySelector<HTMLElement>('[data-slot="dialog-body"]')!;
      const list = node.querySelector<HTMLElement>('[role="list"]')!;
      const row = list.querySelector('[role="listitem"]')!;
      const warnings = Array.from(body.querySelectorAll('p')).flatMap((warning) => {
        const range = document.createRange();
        range.selectNodeContents(warning);
        return Array.from(range.getClientRects()).map((line) => line.toJSON());
      });
      return {
        dialog: rect(node),
        body: rect(body),
        bodyClient: body.clientWidth,
        bodyScroll: body.scrollWidth,
        listClient: list.clientWidth,
        listScroll: list.scrollWidth,
        warnings,
        badges: Array.from(list.querySelectorAll('[role="listitem"]')).map((item) =>
          rect(item.lastElementChild!),
        ),
        titleClient: (row.children[1] as HTMLElement).clientWidth,
        titleScroll: (row.children[1] as HTMLElement).scrollWidth,
        actions: Array.from(node.querySelectorAll('[data-slot="dialog-footer"] button')).map(rect),
      };
    });
    await testInfo.attach('bulk-delete-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await testInfo.attach('bulk-delete-dialog', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    expect(geometry.dialog.left).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.dialog.top).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.bottom).toBeLessThanOrEqual(viewport.height);
    expect(geometry.bodyScroll, 'warning and list must not expand the body').toBeLessThanOrEqual(
      geometry.bodyClient + 1,
    );
    expect(geometry.listScroll, 'workspace list must not scroll horizontally').toBeLessThanOrEqual(
      geometry.listClient + 1,
    );
    for (const content of [...geometry.warnings, ...geometry.badges]) {
      expect(content.left).toBeGreaterThanOrEqual(geometry.body.left);
      expect(
        content.right,
        'warning text and badges must remain inside the body',
      ).toBeLessThanOrEqual(geometry.body.right);
    }
    expect(geometry.titleScroll, 'long workspace names truncate within their row').toBeGreaterThan(
      geometry.titleClient,
    );
    for (const action of geometry.actions) {
      expect(action.left).toBeGreaterThanOrEqual(geometry.dialog.left);
      expect(action.right).toBeLessThanOrEqual(geometry.dialog.right);
      expect(action.top).toBeGreaterThanOrEqual(geometry.body.bottom - 1);
      expect(action.bottom).toBeLessThanOrEqual(geometry.dialog.bottom);
    }

    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect(list.getByRole('listitem').last()).toBeInViewport();
    expect(await body.evaluate((node) => node.scrollLeft)).toBe(0);
    await expect(confirm).toBeEnabled();
    await cancel.press('Enter');
    await expect(dialog).toHaveCount(0);
    expect(submitted).toBe(0);
  });
}

test('bulk delete preflight keeps keyboard cancellation safe before and after readiness', async ({
  mount,
  page,
}) => {
  let submitted = 0;
  const component = await mount(Preview, {
    props: { preflightReady: false, onConfirm: () => submitted++ },
  });
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  const confirm = page.getByRole('button', { name: 'Delete all', exact: true });
  await expect(cancel).toBeFocused();
  await expect(cancel).toBeEnabled();
  await expect(confirm).toBeDisabled();
  await component.update({ props: { preflightReady: true } });
  await expect(confirm).toBeEnabled();
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(submitted).toBe(0);
});
