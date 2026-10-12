// Ignored draft; no discovery/native execution without the exact coordinator release.
import {
  test,
  expect,
  openDetected,
  control,
  apply,
  expectRow,
  footer,
  sameNode,
  detached,
  setMounted,
  capture,
  geometry,
  service,
  command,
} from '../lib/detected-scripts.mjs';

test('detected scripts DS4: same-key field changes retain actual rows and show current content', async ({
  page,
}, info) => {
  const item = await openDetected(page);
  const initial = {
    name: 'Stable',
    command: 'pnpm stable',
    mode: 'service',
    category: 'development',
  };
  await apply(item, [initial]);
  await expect(item.rows).toHaveCount(1);
  const row = await item.rows.nth(0).elementHandle();
  const card = await item.card.elementHandle();
  try {
    await expectRow(item.rows.nth(0), { ...initial, badges: [service, 'development'] });
    await capture(item, 'same-key-before', info);
    await item.host
      .getByRole('textbox', { name: 'Parent input', exact: true })
      .fill('Unrelated caller edit');
    await sameNode(item.card, card);
    await sameNode(item.rows.nth(0), row);
    await control(item, 'Load same-key field changes').click();
    await control(item, 'Apply scripts').click();
    await expectRow(item.rows.nth(0), { ...initial, badges: [command, 'verification'] });
    await sameNode(item.card, card);
    await sameNode(item.rows.nth(0), row);
    await control(item, 'Load same-key field changes').click();
    await control(item, 'Apply scripts').click();
    await expectRow(item.rows.nth(0), { ...initial, badges: [service] });
    await sameNode(item.rows.nth(0), row);
    await apply(item, [{ ...initial, mode: 'command', category: '' }]);
    await expectRow(item.rows.nth(0), { ...initial, badges: [command] });
    await sameNode(item.card, card);
    await sameNode(item.rows.nth(0), row);
    await footer(item, 'chat_detectedScripts_count_one', 1);
    await geometry(item, 'same-key-after', info);
    await capture(item, 'same-key-after', info);
  } finally {
    await row.dispose();
    await card.dispose();
  }
});

test('detected scripts DS5: reorder key changes and remount use actual source identity boundaries', async ({
  page,
}, info) => {
  const item = await openDetected(page);
  const first = { name: 'First', command: 'pnpm first', mode: 'command' };
  const second = { name: 'Second', command: 'pnpm second', mode: 'service' };
  await apply(item, [first, second]);
  await expect(item.rows).toHaveCount(2);
  const handles = [];
  const retain = async (locator) => {
    const handle = await locator.elementHandle();
    handles.push(handle);
    return handle;
  };
  try {
    const firstNode = await retain(item.rows.nth(0));
    const secondNode = await retain(item.rows.nth(1));
    const cardNode = await retain(item.card);
    await control(item, 'Load reversed rows').click();
    await control(item, 'Apply scripts').click();
    await expectRow(item.rows.nth(0), { ...second, badges: [service] });
    await expectRow(item.rows.nth(1), { ...first, badges: [command] });
    await sameNode(item.rows.nth(0), secondNode);
    await sameNode(item.rows.nth(1), firstNode);
    await sameNode(item.card, cardNode);
    await capture(item, 'reordered', info);

    const renamed = { ...second, name: 'Renamed second' };
    await apply(item, [renamed, first]);
    await detached(secondNode);
    await expectRow(item.rows.nth(0), { ...renamed, badges: [service] });
    const renamedNode = await retain(item.rows.nth(0));
    await sameNode(item.rows.nth(1), firstNode);
    const changedCommand = { ...renamed, command: 'pnpm replacement' };
    await apply(item, [changedCommand, first]);
    await detached(renamedNode);
    await expectRow(item.rows.nth(0), { ...changedCommand, badges: [service] });
    const commandNode = await retain(item.rows.nth(0));
    await sameNode(item.rows.nth(1), firstNode);
    await sameNode(item.card, cardNode);
    await capture(item, 'key-replaced', info);

    await setMounted(item, false);
    await expect(item.card).toHaveCount(0);
    for (const handle of [cardNode, firstNode, commandNode]) await detached(handle);
    const current = {
      name: 'After absence',
      command: 'pnpm current',
      mode: 'command',
      category: 'quality',
    };
    await apply(item, [current]);
    await expect(item.card).toHaveCount(0);
    await setMounted(item, true);
    await expect(item.rows).toHaveCount(1);
    await expectRow(item.rows.nth(0), { ...current, badges: [command, 'quality'] });
    const mountedCard = await retain(item.card);
    const mountedRow = await retain(item.rows.nth(0));
    await control(item, 'Remount scripts card').click();
    await detached(mountedCard);
    await detached(mountedRow);
    await expectRow(item.rows.nth(0), { ...current, badges: [command, 'quality'] });
    await footer(item, 'chat_detectedScripts_count_one', 1);
    await geometry(item, 'remounted-current', info);
    await capture(item, 'remounted-current', info);
  } finally {
    for (const handle of handles) await handle.dispose();
  }
});

test('detected scripts DS6: native theme and frame controls preserve readable narrow and wide content', async ({
  page,
}, info) => {
  const item = await openDetected(page);
  const inputs = [
    { name: 'Development', command: 'pnpm dev', mode: 'service', category: 'development' },
    { name: 'Build', command: 'pnpm build', mode: 'command', category: 'quality' },
  ];
  await apply(item, inputs);
  await item.host.getByTestId('detected-scripts-width-420').click();
  await expectRow(item.rows.nth(0), { ...inputs[0], badges: [service, 'development'] });
  await expectRow(item.rows.nth(1), { ...inputs[1], badges: [command, 'quality'] });
  const card = await item.card.elementHandle();
  try {
    await expect(page).toHaveURL(/[?&]theme=light(?:&|$)/);
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', 'light');
    const narrow = await geometry(item, 'light-narrow', info);
    await capture(item, 'light-narrow', info);
    const customize = page.getByRole('button', { name: 'Customize preview', exact: true });
    if ((await customize.getAttribute('aria-expanded')) !== 'true') await customize.click();
    const theme = page.getByTestId('catalog-theme-control');
    await theme.getByRole('radio', { name: 'Dark', exact: true }).click();
    await expect(page).toHaveURL(/[?&]theme=dark(?:&|$)/);
    await expect(theme.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', 'dark');
    await customize.click();
    await expect(customize).toHaveAttribute('aria-expanded', 'false');
    await sameNode(item.card, card);
    await geometry(item, 'dark-narrow', info);
    await capture(item, 'dark-narrow', info);

    // Actual viewport1280 leaves720 available after the real desktop sidebar/gutters.
    // Catalog Preview width affects fixtures only; it is not this caller's width oracle.
    await page.setViewportSize({ width: 1280, height: 900 });
    await item.host.getByTestId('detected-scripts-width-720').click();
    const wide = await geometry(item, 'dark-wide', info);
    expect(wide.viewport).toEqual({ width: 1280, height: 900 });
    expect(wide.card.width, 'Wide case must actually grow').toBeGreaterThan(narrow.card.width);
    expect(
      wide.frame.width,
      'Exercise the requested720 frame, not a clamped small frame',
    ).toBeGreaterThanOrEqual(719);
    expect(wide.frame.width).toBeLessThanOrEqual(721);
    await sameNode(item.card, card);
    await expectRow(item.rows.nth(0), { ...inputs[0], badges: [service, 'development'] });
    await expectRow(item.rows.nth(1), { ...inputs[1], badges: [command, 'quality'] });
    await capture(item, 'dark-wide', info);
  } finally {
    await card.dispose();
  }
});
