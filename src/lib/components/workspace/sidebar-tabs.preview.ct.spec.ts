import { expect, test } from '../../../test/ct-test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

test('section tabs preserve search, scroll, and the main draft', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, { props: { items: 40, height: 440 } });
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  const agents = component.locator('[data-sidebar-section="agents"]');
  await expect(agents).toBeVisible();
  const mainDraft = component.getByRole('textbox', { name: 'Workspace draft' });
  await mainDraft.fill('A draft that must survive sidebar navigation.');
  const scroll = agents.locator('[data-sidebar-section-scroll="agents"]');
  await scroll.evaluate((node) => {
    node.scrollTop = 160;
  });
  const scrollTop = await scroll.evaluate((node) => node.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  await tabs.getByRole('tab', { name: 'Context', exact: true }).click();
  const context = component.locator('[data-sidebar-section="context"]');
  await context.locator('[data-sidebar-search="context"] button').click();
  const search = context.locator('[data-sidebar-search-input="context"]');
  await search.fill('Interaction');
  await tabs.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(scroll).toBeVisible();
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(scrollTop);
  await tabs.getByRole('tab', { name: 'Context', exact: true }).click();
  await expect(search).toHaveValue('Interaction');
  await expect(mainDraft).toHaveValue('A draft that must survive sidebar navigation.');
  await tabs.getByRole('tab', { name: 'Context', exact: true }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(component.locator('[data-sidebar-section="changes"]')).toBeVisible();
  await testInfo.attach('tab-navigation', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`collapsed rail floats without moving content in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    const component = await mount(SidebarTabsPreview, { props: { collapsed: true } });
    const main = component.locator('[data-sidebar-preview-main]');
    const draft = component.getByRole('textbox', { name: 'Workspace draft' });
    await draft.fill('Keep this draft.');
    await expect(component.locator('[data-workspace-sidebar-rail-shell]')).toHaveCSS(
      'width',
      '48px',
    );
    await expect(component.locator('.workspace-sidebar-panel')).toHaveCSS('width', '0px');
    const before = await main.boundingBox();
    expect(before!.width).toBeGreaterThan(900);
    const rail = component.locator('[data-workspace-sidebar-rail]');
    await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
    const flyout = component.locator('[data-workspace-sidebar-flyout]');
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await expect(flyout.locator('[data-agent-row-name]').first()).toBeVisible();
    const after = await main.boundingBox();
    expect(after?.x).toBeCloseTo(before!.x, 0);
    expect(after?.width).toBeCloseTo(before!.width, 0);
    await rail.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(flyout.locator('[data-sidebar-section="context"]')).toBeVisible();
    await flyout.locator('[data-sidebar-search="context"] button').click();
    await flyout.locator('[data-sidebar-search-input="context"]').fill('Interaction');
    await draft.hover();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'false');
    await expect(rail.locator('[data-sidebar-rail-expand]')).toBeFocused();
    await rail.getByRole('tab', { name: 'Agents', exact: true }).hover();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await draft.click();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'false');
    await expect(draft).toHaveValue('Keep this draft.');
    await rail.hover();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await testInfo.attach(`floating-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('pinning, collapsing, and keyboard reveal retain the same sidebar', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, { props: { collapsed: true } });
  const rail = component.locator('[data-workspace-sidebar-rail]');
  const sidebar = component.locator('[data-workspace-sidebar]');
  await rail.getByRole('tab', { name: 'Context', exact: true }).focus();
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  await rail.getByRole('tab', { name: 'Context', exact: true }).press('Enter');
  await sidebar.locator('[data-sidebar-search="context"] button').click();
  await sidebar.locator('[data-sidebar-search-input="context"]').fill('Interaction');
  await sidebar.locator('[data-sidebar-collapse]').click();
  await expect(component.locator('[data-workspace-sidebar-shell]')).not.toHaveClass(
    /sidebar-collapsed/,
  );
  await sidebar.locator('[data-sidebar-collapse]').click();
  await expect(component.locator('[data-workspace-sidebar-shell]')).toHaveClass(
    /sidebar-collapsed/,
  );
  await expect(component.locator('[data-workspace-sidebar-flyout]')).toHaveAttribute(
    'data-workspace-sidebar-flyout',
    'false',
  );
  await component.getByRole('textbox', { name: 'Workspace draft' }).hover();
  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await expect(component.locator('[data-workspace-sidebar-flyout]')).toHaveAttribute(
    'data-workspace-sidebar-flyout',
    'true',
  );
  await expect(sidebar.locator('[data-sidebar-search-input="context"]')).toHaveValue('Interaction');
  await testInfo.attach('pin-and-collapse', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('a portalled menu keeps the floating sidebar open', async ({ mount, page }, testInfo) => {
  const component = await mount(SidebarTabsPreview, { props: { collapsed: true } });
  await component.locator('[data-workspace-sidebar-rail]').hover();
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  await flyout.getByRole('button', { name: 'Workspace actions', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.hover();
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  await testInfo.attach('floating-menu', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
});

for (const side of ['left', 'right'] as const) {
  test(`the ${side} rail fits a narrow short window`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: 420, height: 400 });
    const component = await mount(SidebarTabsPreview, {
      props: { side, collapsed: true, width: 420, height: 360, sidebarWidth: 320 },
    });
    await expect(component.locator('[data-workspace-sidebar-rail-shell]')).toHaveCSS(
      'width',
      '48px',
    );
    await expect(component.locator('.workspace-sidebar-panel')).toHaveCSS('width', '0px');
    const before = await component.locator('[data-sidebar-preview-main]').boundingBox();
    const rail = component.locator('[data-workspace-sidebar-rail]');
    await rail.getByRole('tab', { name: 'Files', exact: true }).click();
    const flyout = component.locator('[data-workspace-sidebar-flyout]');
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await expect(flyout.locator('[data-sidebar-section="files"]')).toBeVisible();
    const bounds = await component.boundingBox();
    const floating = await flyout.boundingBox();
    expect(floating!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(floating!.x + floating!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    expect(floating!.height).toBeLessThanOrEqual(bounds!.height);
    const after = await component.locator('[data-sidebar-preview-main]').boundingBox();
    expect(after?.width).toBeCloseTo(before!.width, 0);
    await rail.getByRole('tab', { name: 'Shells', exact: true }).click();
    await expect(flyout.locator('[data-sidebar-section="shell"]')).toBeVisible();
    await testInfo.attach(`narrow-${side}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('collaborators keep permitted sections in the collapsed rail', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: { collaborator: true, collapsed: true },
  });
  const rail = component.locator('[data-workspace-sidebar-rail]');
  await expect(rail.getByRole('tab', { name: 'Browsers', exact: true })).toHaveCount(0);
  await expect(rail.getByRole('tab', { name: 'Shells', exact: true })).toHaveCount(0);
  await rail.getByRole('tab', { name: 'Context', exact: true }).click();
  await expect(component.locator('[data-sidebar-section="context"]')).toBeVisible();
  await testInfo.attach('collaborator', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const loading of [false, true]) {
  test(`navigation stays usable with ${loading ? 'loading' : 'empty'} content`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(SidebarTabsPreview, { props: { items: 0, loading } });
    await expect(component.locator('[data-sidebar-section="agents"]')).toBeVisible();
    await component
      .locator('[data-sidebar-section-tabs="horizontal"]')
      .getByRole('tab', { name: 'Files', exact: true })
      .click();
    await expect(component.locator('[data-sidebar-section="files"]')).toBeVisible();
    await testInfo.attach(loading ? 'loading' : 'empty', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('a wide pinned sidebar fits a narrow window and recovers its saved width', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 440 });
  const component = await mount(SidebarTabsPreview, {
    props: { width: 420, height: 400, sidebarWidth: 600 },
  });
  const sidebar = component.locator('.workspace-sidebar-panel');
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThanOrEqual(420);
  await component.locator('[data-sidebar-collapse]').click();
  const rail = component.locator('[data-workspace-sidebar-rail]');
  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await expect(component.locator('[data-workspace-sidebar-flyout]')).toHaveAttribute(
    'data-workspace-sidebar-flyout',
    'true',
  );
  await component.locator('[data-workspace-sidebar-flyout] [data-sidebar-collapse]').click();
  await page.setViewportSize({ width: 1040, height: 760 });
  await component.update({ props: { width: 1040, height: 680, sidebarWidth: 600 } });
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(600);
  await testInfo.attach('restored-wide-sidebar', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
