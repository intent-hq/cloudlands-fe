import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

for (const platform of ['MacIntel', 'Linux x86_64']) {
  const modifier = platform === 'MacIntel' ? 'Meta' : 'Control';

  test(`Home opens a row with ${modifier} while normal clicks keep the preview`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'platform', { get: () => value });
    }, platform);
    await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview);
    const row = component.locator('[data-home-workspace="home-review"]');
    const before = await page.evaluate(() => window.__homeWorkspacePreview?.navigation());
    await row.click();
    await expect(component.locator('[data-home-detail]')).toBeVisible();
    expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
    await row.click({ modifiers: [modifier] });
    await expect
      .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
      .toBe('home-review');
    await expect(row.locator('..')).toHaveAttribute('aria-selected', 'true');
    const tabs = await page.evaluate(() => window.__homeWorkspacePreview?.navigation().tabOrder);
    expect(tabs?.filter((id) => id === 'home-review')).toHaveLength(1);
    await testInfo.attach(`home-open-${modifier}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test(`Home supports ${modifier}-Enter without selecting the preview`, async ({ mount, page }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'platform', { get: () => value });
    }, platform);
    await page.reload();
    const component = await mount(Preview);
    const option = component.locator('[data-home-workspace="home-review"]').locator('..');
    await option.focus();
    await page.keyboard.press(`${modifier}+Enter`);
    await expect
      .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
      .toBe('home-review');
    await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  });
}

test('Home menu controls keep their own actions and can open an archived workspace', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const row = component.locator('[data-home-workspace="home-review"]');
  const before = await page.evaluate(() => window.__homeWorkspacePreview?.navigation());
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control',
  );
  await row.getByRole('button').click({ modifiers: [modifier] });
  expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
  await page.keyboard.press('Escape');
  await row.getByRole('button').focus();
  await page.keyboard.press(`${modifier}+Enter`);
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  await expect(component.locator('[data-home-group="pinned"]')).toBeVisible();
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.getByRole('button', { name: /^Archived/ }).click();
  const archived = component.locator('[data-home-workspace="home-archived"]');
  await archived.getByRole('button').click();
  await testInfo.attach('home-open-menu', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('menuitem', { name: /^Open workspace/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-archived');
});

test('Home title remains operable with a long title in a narrow preview', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Preview);
  await component.locator('[data-home-workspace="home-ready"]').click();
  const open = component
    .locator('[data-home-detail]')
    .getByRole('button', { name: 'Open workspace' });
  await expect(open).toBeInViewport();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-ready');
  await testInfo.attach('home-long-title-open', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home board supports modifier click and keyboard opening', async ({ mount, page }) => {
  const component = await mount(Preview, { props: { scenario: 'board' } });
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control',
  );
  await component.locator('[data-home-workspace="home-review"]').click({ modifiers: [modifier] });
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-review');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.locator('[data-home-workspace="home-running"]').focus();
  await page.keyboard.press(`${modifier}+Enter`);
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-running');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
});

test('Home opens a list row on double-click and keeps it selected', async ({ mount, page }) => {
  const component = await mount(Preview);
  const row = component.locator('[data-home-workspace="home-review"]');
  await row.dblclick();
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-review');
  await expect(row.locator('..')).toHaveAttribute('aria-selected', 'true');
  const tabs = await page.evaluate(() => window.__homeWorkspacePreview?.navigation().tabOrder);
  expect(tabs?.filter((id) => id === 'home-review')).toHaveLength(1);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});

test('Home double-click on an already selected row opens it without deselecting', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const row = component.locator('[data-home-workspace="home-review"]');
  await row.click();
  await expect(row.locator('..')).toHaveAttribute('aria-selected', 'true');
  await row.dblclick();
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-review');
  await expect(row.locator('..')).toHaveAttribute('aria-selected', 'true');
});

test('Home double-click on a row menu button does not open the workspace', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const row = component.locator('[data-home-workspace="home-review"]');
  const before = await page.evaluate(() => window.__homeWorkspacePreview?.navigation());
  await row.getByRole('button').dblclick();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
});

test('Home Cmd/Ctrl double-click opens once through the modifier path without selecting', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control',
  );
  const row = component.locator('[data-home-workspace="home-review"]');
  await row.dblclick({ modifiers: [modifier] });
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-review');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await expect(row.locator('..')).toHaveAttribute('aria-selected', 'false');
});

test('Home board opens a card on double-click', async ({ mount, page }) => {
  const component = await mount(Preview, { props: { scenario: 'board' } });
  const card = component.locator('[data-home-workspace="home-review"]');
  await card.dblclick();
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-review');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const tabs = await page.evaluate(() => window.__homeWorkspacePreview?.navigation().tabOrder);
  expect(tabs?.filter((id) => id === 'home-review')).toHaveLength(1);
});

test('Home board double-click on an already selected card keeps it selected', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { scenario: 'board' } });
  const card = component.locator('[data-home-workspace="home-review"]');
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await card.dblclick();
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-review');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
});

for (const scenario of ['list', 'board'] as const) {
  test(`Home ${scenario} double-click opens the workspace in a narrow window where the preview replaces the list`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    const component = await mount(Preview, {
      props: scenario === 'board' ? { scenario: 'board' } : {},
    });
    const target = component.locator('[data-home-workspace="home-review"]');
    const before = await page.evaluate(() => window.__homeWorkspacePreview?.navigation());
    await target.click();
    await expect(component.locator('[data-home-detail]')).toBeVisible();
    await expect(target).toBeHidden();
    expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(target).toBeVisible();
    await humanDoubleClick(page, target, () => expect(target).toBeHidden());
    await expect
      .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
      .toBe('home-review');
    await expect(component.locator('[data-home-detail]')).toBeVisible();
  });
}

/** A person's double-click: the second press lands after the first click re-rendered Home. */
async function humanDoubleClick(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
  afterFirstClick: () => Promise<void>,
) {
  // A person clicks where the card is once Home has finished moving it: closing
  // the narrow preview animates the list back in, and a box measured mid-way
  // would aim the click at where the card was, not where it is.
  let previous: Awaited<ReturnType<typeof target.boundingBox>> = null;
  await expect
    .poll(async () => {
      const current = await target.boundingBox();
      const settled =
        !!current &&
        !!previous &&
        current.x === previous.x &&
        current.y === previous.y &&
        current.width === previous.width &&
        current.height === previous.height;
      previous = current;
      return settled;
    })
    .toBe(true);
  const box = await target.boundingBox();
  if (!box) throw new Error('double-click target is not visible');
  const x = box.x + Math.min(24, box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await afterFirstClick();
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}
