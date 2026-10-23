import { expect, test } from '../../../test/ct-test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

for (const key of ['Enter', 'Space']) {
  test(`activating a section tab with ${key} dismisses its tooltip and keeps focus`, async ({
    mount,
    page,
  }) => {
    const component = await mount(SidebarTabsPreview);
    const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
    const agents = tabs.getByRole('tab', { name: 'Agents', exact: true });
    const context = tabs.getByRole('tab', { name: 'Context', exact: true });
    const draft = component.getByRole('textbox', { name: 'Workspace draft' });
    await agents.focus();
    await expect(page.getByRole('tooltip', { name: 'Agents', exact: true })).toBeVisible();
    await agents.press('ArrowRight');
    await expect(context).toBeFocused();
    await expect(page.getByRole('tooltip', { name: 'Context', exact: true })).toBeVisible();
    await context.press(key);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(context).toBeFocused();
    await expect(context).toHaveAttribute('aria-selected', 'true');
    await draft.hover();
    // Wait beyond the 400ms hover delay to catch a tooltip reopening after activation.
    await page.waitForTimeout(500);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await context.hover();
    await expect(page.getByRole('tooltip', { name: 'Context', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(context).toBeFocused();
    await context.press('ArrowLeft');
    await expect(agents).toBeFocused();
    await expect(page.getByRole('tooltip', { name: 'Agents', exact: true })).toBeVisible();
  });
}

test('clicking a section tab cancels delayed help and allows another hover', async ({
  mount,
  page,
}) => {
  const component = await mount(SidebarTabsPreview);
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  const context = tabs.getByRole('tab', { name: 'Context', exact: true });
  const draft = component.getByRole('textbox', { name: 'Workspace draft' });
  await draft.focus();
  await context.hover();
  await context.click();
  // Keep the pointer over the clicked tab beyond the pending hover delay.
  await page.waitForTimeout(500);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(context).toBeFocused();
  await expect(component.locator('[data-sidebar-section="context"]')).toBeVisible();
  await draft.hover();
  await context.hover();
  const tooltip = page.getByRole('tooltip', { name: 'Context', exact: true });
  await expect(tooltip).toBeVisible();
  await context.click();
  await expect(tooltip).toHaveCount(0);
  await draft.hover();
  await context.hover();
  await expect(tooltip).toBeVisible();
  await draft.hover();
  await expect(tooltip).toHaveCount(0);
});

test('overflowing icon tabs reveal restored, keyboard-selected, and resized sections', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: { width: 960, height: 520, sidebarWidth: 280, initialSection: 'shell' },
  });
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  const viewport = tabs.locator('[data-sidebar-tab-scroll]');
  const agents = tabs.getByRole('tab', { name: 'Agents', exact: true });
  const shell = tabs.getByRole('tab', { name: 'Shells', exact: true });
  const draft = component.getByRole('textbox', { name: 'Workspace draft' });
  await draft.fill('Keep this draft while the tab row scrolls.');
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollWidth > node.clientWidth))
    .toBe(true);
  const selectedIsVisible = () =>
    viewport.evaluate((node) => {
      const selected = node.querySelector('[role="tab"][aria-selected="true"]');
      if (!selected) return false;
      const tab = selected.getBoundingClientRect();
      const frame = node.getBoundingClientRect();
      return tab.left >= frame.left && tab.right <= frame.right;
    });
  await expect(shell).toHaveAttribute('aria-selected', 'true');
  await expect.poll(selectedIsVisible).toBe(true);
  const scrolled = await viewport.evaluate((node) => node.scrollLeft);
  expect(scrolled).toBeGreaterThan(0);
  await viewport.hover();
  await page.mouse.wheel(-160, 0);
  await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).toBeLessThan(scrolled);
  await expect(shell).toHaveAttribute('aria-selected', 'true');
  await shell.press('Home');
  await expect(agents).toHaveAttribute('aria-selected', 'true');
  await expect.poll(selectedIsVisible).toBe(true);
  const main = component.locator('[data-sidebar-preview-main]');
  const before = await main.boundingBox();
  await agents.press('End');
  await expect(shell).toHaveAttribute('aria-selected', 'true');
  await expect.poll(selectedIsVisible).toBe(true);
  expect(await main.boundingBox()).toEqual(before);
  const rowWidth = await viewport.evaluate((node) => node.clientWidth);
  await component.evaluate((node) => {
    node.style.width = '240px';
  });
  await expect.poll(() => viewport.evaluate((node) => node.clientWidth)).toBeLessThan(rowWidth);
  await expect.poll(selectedIsVisible).toBe(true);
  await expect(draft).toHaveValue('Keep this draft while the tab row scrolls.');
  await testInfo.attach('scrolling-icon-tabs', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

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
    await expect(flyout.locator('[data-sidebar-section="context"]')).toBeVisible();
    await expect(flyout.locator('[data-workspace-title-region]')).toBeHidden();
    const after = await main.boundingBox();
    expect(after?.x).toBeCloseTo(before!.x, 0);
    expect(after?.width).toBeCloseTo(before!.width, 0);
    await draft.hover();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'false');
    await expect(rail.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
    await rail.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(flyout.locator('[data-sidebar-section="context"]')).toBeVisible();
    await flyout.locator('[data-sidebar-search="context"] button').click();
    await flyout.locator('[data-sidebar-search-input="context"]').fill('Interaction');
    await draft.hover();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'false');
    await expect(rail.getByRole('tab', { name: 'Context', exact: true })).toBeFocused();
    await rail.getByRole('tab', { name: 'Context', exact: true }).press('Enter');
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await rail.getByRole('tab', { name: 'Agents', exact: true }).hover();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
    await draft.click();
    await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'false');
    await expect(draft).toHaveValue('Keep this draft.');
    await rail.getByRole('tab', { name: 'Agents', exact: true }).hover();
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
  await rail.locator('[data-sidebar-rail-expand]').click();
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
  await component
    .locator('[data-workspace-sidebar-rail]')
    .getByRole('tab', { name: 'Files', exact: true })
    .hover();
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  await flyout
    .getByRole('button', { name: 'package.json', exact: true })
    .click({ button: 'right' });
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
  await rail.locator('[data-sidebar-rail-expand]').click();
  await page.setViewportSize({ width: 1040, height: 760 });
  await component.update({ props: { width: 1040, height: 680, sidebarWidth: 600 } });
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(600);
  await testInfo.attach('restored-wide-sidebar', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('content-sized hover panels keep long virtual lists reachable', async ({ mount }) => {
  const component = await mount(SidebarTabsPreview, {
    props: { collapsed: true, height: 360, items: 200, extraFiles: 200 },
  });
  const draft = component.getByRole('textbox', { name: 'Workspace draft' });
  await draft.fill('Keep my draft while the preview resizes.');
  await expect(component.locator('.workspace-sidebar-panel')).toHaveCSS('width', '0px');
  const rail = component.locator('[data-workspace-sidebar-rail]');
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await rail.getByRole('tab', { name: 'Files', exact: true }).hover();
  const tree = flyout.getByRole('tree');
  await expect(tree.locator('[data-file-path]').first()).toBeVisible();
  await tree.focus();
  const fileScrollState = () =>
    tree.evaluate((root) => {
      const viewport = Array.from(root.querySelectorAll<HTMLElement>('*')).find(
        (node) =>
          /auto|scroll/.test(getComputedStyle(node).overflowY) &&
          node.scrollHeight > node.clientHeight,
      );
      const outerScrollPositions = [];
      for (let node = root.parentElement; node; node = node.parentElement) {
        outerScrollPositions.push([node.scrollLeft, node.scrollTop]);
      }
      return {
        treeScrollTop: viewport?.scrollTop ?? 0,
        outerScrollPositions,
        pagePosition: [window.scrollX, window.scrollY],
      };
    });
  const beforeFileScroll = await fileScrollState();
  await tree.press('End');
  await expect(tree.locator('[data-file-path$="/file-99.ts"]')).toBeVisible();
  await expect
    .poll(async () => (await fileScrollState()).treeScrollTop)
    .toBeGreaterThan(beforeFileScroll.treeScrollTop);
  const afterFileScroll = await fileScrollState();
  expect(afterFileScroll.outerScrollPositions).toEqual(beforeFileScroll.outerScrollPositions);
  expect(afterFileScroll.pagePosition).toEqual(beforeFileScroll.pagePosition);
  expect(await tree.locator('[data-file-path]').count()).toBeLessThan(200);
  await expect(
    flyout.locator('[data-sidebar-section=files] [data-sidebar-section-header]'),
  ).toBeVisible();
  await rail.getByRole('tab', { name: 'Agents', exact: true }).hover();
  const agents = flyout.locator('[data-sidebar-section=agents]');
  const names = agents.locator('[data-agent-row-name]');
  await expect(names.first()).toBeVisible();
  const before = await names.allTextContents();
  const scroll = agents.locator('.virtual-list-scroll').first();
  await scroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => names.allTextContents()).not.toEqual(before);
  expect(await names.count()).toBeLessThan(200);
  await expect(agents.locator('[data-sidebar-section-header]')).toBeVisible();
  await expect(draft).toHaveValue('Keep my draft while the preview resizes.');
});
