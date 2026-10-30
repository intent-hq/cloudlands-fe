import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

for (const side of ['left', 'right'] as const) {
  test(`machine picker switches from the ${side} dock rail and restores logo focus`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(DockRailPreview, {
      props: {
        ...dockRailPreview.states[`side-${side}`].props,
        machineFixture: true,
        controlledPlacement: true,
      },
    });
    const logo = component.getByRole('button', { name: 'Switch machine', exact: true });
    await logo.click();
    const menu = page.getByRole('menu', { name: 'Machines' });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`machine-picker-${side}.png`) });
    await menu.getByRole('menuitemradio', { name: 'Build server', exact: true }).click();
    await expect(
      menu.getByRole('menuitemradio', { name: 'Build server', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(JSON.parse((await component.getAttribute('data-preview-actions'))!)).toEqual([
      'machine:remote-build',
    ]);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(logo).toBeFocused();
  });
}

test('logo machine picker preserves current selection on failure and retries without opening a workspace', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(DockRailPreview, {
    props: {
      ...dockRailPreview.states.notch.props,
      machineFixture: true,
      failMachineOnce: true,
      controlledPlacement: true,
      theme: 'dark',
    },
  });
  const logo = component.getByRole('button', { name: 'Switch machine', exact: true });
  await logo.click();
  const menu = page.getByRole('menu', { name: 'Machines' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'This Mac', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemradio', { name: 'Build server', exact: true }).click();
  await expect(
    menu.getByRole('menuitemradio', { name: 'Connecting to Build server…', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('alert')).toHaveText('Could not connect. Select a machine to retry.');
  await expect(menu.getByRole('menuitemradio', { name: 'This Mac', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemradio', { name: 'Build server', exact: true }).click();
  await expect(
    menu.getByRole('menuitemradio', { name: 'Build server', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  const actions = JSON.parse((await component.getAttribute('data-preview-actions'))!);
  expect(actions).toEqual(['machine:remote-build', 'machine:remote-build']);
  await page.screenshot({ path: testInfo.outputPath('notch-machine-picker.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(logo).toBeFocused();
});

test('keyboard opens machine picker and Escape restores the logo without dismissing the notch', async ({
  mount,
  page,
}) => {
  const component = await mount(DockRailPreview, {
    props: {
      ...dockRailPreview.states.notch.props,
      machineFixture: true,
      controlledPlacement: true,
    },
  });
  const logo = component.getByRole('button', { name: 'Switch machine', exact: true });
  await logo.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Machines' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(logo).toBeFocused();
  await expect(component.getByTestId('dock-shell')).toBeVisible();
  expect(JSON.parse((await component.getAttribute('data-preview-actions'))!)).not.toContain(
    'placement:dismiss',
  );
});

test('dragging the logo does not open the machine picker', async ({ mount, page }) => {
  const component = await mount(DockRailPreview, {
    props: {
      ...dockRailPreview.states.notch.props,
      machineFixture: true,
      controlledPlacement: true,
    },
  });
  const logo = component.getByRole('button', { name: 'Switch machine', exact: true });
  const box = await logo.boundingBox();
  if (!box) throw new Error('Missing logo');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2 + 32, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        JSON.parse((await component.getAttribute('data-preview-commands'))!).filter(
          (command: { action: string }) => command.action === 'begin-drag',
        ).length,
    )
    .toBe(1);
  await expect(page.getByRole('menu', { name: 'Machines' })).toHaveCount(0);
});

test('clicking the Intent logo toggles the machine picker closed and open again', async ({
  mount,
  page,
}) => {
  const component = await mount(DockRailPreview, {
    props: {
      ...dockRailPreview.states.notch.props,
      machineFixture: true,
      controlledPlacement: true,
    },
  });
  const logo = component.getByRole('button', { name: 'Switch machine', exact: true });
  const menu = page.getByRole('menu', { name: 'Machines' });
  await logo.click();
  await expect(menu).toBeVisible();
  await logo.click();
  await expect(menu).toHaveCount(0);
  await expect(logo).toHaveAttribute('aria-expanded', 'false');
  await logo.click();
  await expect(menu).toBeVisible();
  expect(JSON.parse((await component.getAttribute('data-preview-actions'))!)).toEqual([]);
});

test('Escape closes the machine picker when focus has returned to the logo', async ({
  mount,
  page,
}) => {
  const component = await mount(DockRailPreview, {
    props: {
      ...dockRailPreview.states.notch.props,
      machineFixture: true,
      controlledPlacement: true,
    },
  });
  const logo = component.getByRole('button', { name: 'Switch machine', exact: true });
  const menu = page.getByRole('menu', { name: 'Machines' });
  await logo.click();
  await expect(menu).toBeVisible();
  await logo.focus();
  await expect(logo).toBeFocused();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(logo).toBeFocused();
  await expect(component.getByTestId('dock-shell')).toBeVisible();
  expect(JSON.parse((await component.getAttribute('data-preview-actions'))!)).not.toContain(
    'placement:dismiss',
  );
});

test('machine list remains operable inside an empty notch native envelope', async ({
  mount,
  page,
}) => {
  const component = await mount(DockRailPreview, {
    props: {
      ...dockRailPreview.states.notch.props,
      workspaces: [],
      machineFixture: true,
      controlledPlacement: true,
      floatingDisplay: {
        id: 1,
        bounds: { x: 0, y: 0, width: 640, height: 600 },
        workArea: { x: 0, y: 32, width: 640, height: 568 },
        cutout: { x: 244, y: 0, width: 152, height: 32 },
      },
    },
  });
  await component.getByRole('button', { name: 'Switch machine', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Machines' });
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const popup = await menu.boundingBox();
      const envelope = await component.locator('[data-dock-rail-preview]').boundingBox();
      if (!popup || !envelope) return false;
      return (
        popup.x >= envelope.x &&
        popup.y >= envelope.y &&
        popup.x + popup.width <= envelope.x + envelope.width + 1 &&
        popup.y + popup.height <= envelope.y + envelope.height + 1
      );
    })
    .toBe(true);
  await expect
    .poll(async () => {
      const popup = await menu.boundingBox();
      const regions = JSON.parse((await component.getAttribute('data-preview-pointer'))!)
        .regions as { x: number; y: number; width: number; height: number }[];
      return (
        !!popup &&
        regions.some(
          (region) =>
            popup.x + popup.width / 2 >= region.x &&
            popup.x + popup.width / 2 <= region.x + region.width &&
            popup.y + popup.height / 2 >= region.y &&
            popup.y + popup.height / 2 <= region.y + region.height,
        )
      );
    })
    .toBe(true);
  await menu.getByRole('menuitemradio', { name: 'Build server', exact: true }).click();
  await expect(
    menu.getByRole('menuitemradio', { name: 'Build server', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('notch machine menu expands the shell at once and shows the whole menu', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(DockRailPreview, {
    props: { ...dockRailPreview.states.notch.props, machineFixture: true },
  });
  const shell = component.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await component.getByRole('button', { name: 'Switch machine', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Machines' });
  await expect(menu).toBeVisible();
  // The shell opens with the menu (never held compact waiting on a later event).
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await expect(shell).toHaveAttribute('data-reveal', '1', { timeout: 600 });
  // The whole card is on screen and nothing covers or clips its corners.
  const corners = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const inset = 4;
    return [
      [box.left + inset, box.top + inset],
      [box.right - inset, box.top + inset],
      [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset],
    ].map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return (
        x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && !!hit && element.contains(hit)
      );
    });
  });
  expect(corners).toEqual([true, true, true, true]);
});
