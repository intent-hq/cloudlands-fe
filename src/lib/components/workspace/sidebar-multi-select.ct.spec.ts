import { expect, test } from '../../../test/ct-test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`Shift-click adds and removes panes without changing the main content in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    const component = await mount(SidebarTabsPreview, {
      props: { navigationEnabled: true, items: 40 },
    });
    const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
    const agents = tabs.getByRole('tab', { name: 'Agents', exact: true });
    const context = tabs.getByRole('tab', { name: 'Context', exact: true });
    const draft = component.getByRole('textbox', { name: 'Workspace draft' });
    const scene = page.locator('[data-sidebar-tabs-preview]');
    await draft.fill('Keep this draft while several sidebar panes are open.');
    await expect(component.locator('[data-sidebar-section="agents"]')).toBeVisible();
    await testInfo.attach(`single-pane-${theme}`, {
      body: await component.locator('[data-workspace-sidebar]').screenshot(),
      contentType: 'image/png',
    });

    await context.click({ modifiers: ['Shift'] });
    await expect(agents).toHaveAttribute('aria-selected', 'true');
    await expect(context).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tablist')).toHaveAttribute('aria-multiselectable', 'true');
    await expect(component.locator('[data-sidebar-section="agents"]')).toBeVisible();
    const contextPane = component.locator('[data-sidebar-section="context"]');
    await expect(contextPane).toBeVisible();
    await contextPane.locator('[data-sidebar-search="context"] button').click();
    const search = contextPane.locator('[data-sidebar-search-input="context"]');
    await search.fill('Interaction');
    await expect(scene).toHaveAttribute('data-sidebar-activation-count', '0');
    await expect(scene).toHaveAttribute('data-sidebar-destination-id', 'spec');
    await expect(draft).toHaveValue('Keep this draft while several sidebar panes are open.');
    await testInfo.attach(`multiple-panes-${theme}`, {
      body: await component.locator('[data-workspace-sidebar]').screenshot(),
      contentType: 'image/png',
    });

    const agentScroll = component
      .locator('[data-sidebar-section="agents"] .virtual-list-scroll')
      .first();
    await agentScroll.evaluate((node) => {
      node.scrollTop = 160;
    });
    const scrollTop = await agentScroll.evaluate((node) => node.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    await context.click({ modifiers: ['Shift'] });
    await expect(context).toHaveAttribute('aria-selected', 'false');
    await expect(contextPane).toBeHidden();
    await agents.click({ modifiers: ['Shift'] });
    await expect(agents).toHaveAttribute('aria-selected', 'true');
    await expect(scene).toHaveAttribute('data-sidebar-activation-count', '0');
    await context.click({ modifiers: ['Shift'] });
    await expect(search).toHaveValue('Interaction');
    expect(await agentScroll.evaluate((node) => node.scrollTop)).toBe(scrollTop);
    await context.click();
    await expect(agents).toHaveAttribute('aria-selected', 'false');
    await expect(context).toHaveAttribute('aria-selected', 'true');
    await expect(scene).toHaveAttribute('data-sidebar-activation-count', '0');
    await context.click();
    await expect(scene).toHaveAttribute('data-sidebar-activation-count', '1');
  });
}

test('Shift-click from keyboard focus preserves the group and Shift+Space or Enter toggles it', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, { props: { navigationEnabled: true } });
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  const agents = tabs.getByRole('tab', { name: 'Agents', exact: true });
  const context = tabs.getByRole('tab', { name: 'Context', exact: true });
  await agents.focus();
  await context.click({ modifiers: ['Shift'] });
  await expect(agents).toHaveAttribute('aria-selected', 'true');
  await expect(context).toHaveAttribute('aria-selected', 'true');
  await expect(context).toBeFocused();
  await context.press('Shift+Space');
  await expect(context).toHaveAttribute('aria-selected', 'false');
  await expect(agents).toHaveAttribute('aria-selected', 'true');
  await context.press('Shift+Enter');
  await expect(context).toHaveAttribute('aria-selected', 'true');
  await expect(agents).toHaveAttribute('aria-selected', 'true');
  await expect(component).toHaveAttribute('data-sidebar-activation-count', '0');
  await testInfo.attach('keyboard-multiple-panes', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('collapsing and previewing preserve selected panes, searches and drafts', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: { initialSections: ['agents', 'context'], navigationEnabled: true },
  });
  const contextPane = component.locator('[data-sidebar-section="context"]');
  await contextPane.locator('[data-sidebar-search="context"] button').click();
  const search = contextPane.locator('[data-sidebar-search-input="context"]');
  await search.fill('Interaction');
  const draft = component.getByRole('textbox', { name: 'Workspace draft' });
  await draft.fill('Keep my pane selection and draft.');
  await component.locator('[data-sidebar-collapse]').click();
  const rail = component.locator('[data-workspace-sidebar-rail]');
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await rail.getByRole('tab', { name: 'Files', exact: true }).hover();
  await expect(flyout.locator('[data-sidebar-section="files"]')).toBeVisible();
  await expect(flyout.locator('[data-sidebar-section="context"]')).toBeHidden();
  await rail.getByRole('tab', { name: 'Changes', exact: true }).click({ modifiers: ['Shift'] });
  await expect(flyout.locator('[data-sidebar-section="changes"]')).toBeVisible();
  await expect(component).toHaveAttribute('data-sidebar-activation-count', '0');
  await rail.locator('[data-sidebar-rail-expand]').click();
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  for (const name of ['Agents', 'Context', 'Changes']) {
    await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await expect(tabs.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await expect(search).toHaveValue('Interaction');
  await expect(draft).toHaveValue('Keep my pane selection and draft.');
  await testInfo.attach('restored-multiple-panes', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('restored multi-selection is filtered by permissions and keeps canonical pane order', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: {
      collaborator: true,
      initialSections: ['files', 'shell', 'people', 'context', 'browser', 'files', 'unknown'],
    },
  });
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  await expect(tabs.getByRole('tab', { name: 'Browsers', exact: true })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'Shells', exact: true })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'People', exact: true })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tabs.getByRole('tab', { name: 'Context', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const visiblePanes = component.locator('[data-sidebar-section]:not([inert])');
  await expect(visiblePanes).toHaveCount(2);
  expect(
    await visiblePanes.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-sidebar-section')),
    ),
  ).toEqual(['context', 'files']);
  await testInfo.attach('permitted-restored-panes', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Reveal in Sidebar adds its pane without closing the other panes', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: {
      initialSections: ['agents', 'files'],
      locate: { sidebarTabId: 'notes', type: 'note', noteId: 'spec' },
    },
  });
  await component.locator('[data-sidebar-preview-locate]').click();
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  for (const name of ['Agents', 'Context', 'Files']) {
    await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await expect(component.locator('[data-sidebar-section="context"]')).toBeVisible();
  await testInfo.attach('reveal-keeps-panes', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('all available panes can stay selected and each header stays reachable', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: {
      initialSections: ['shell', 'browser', 'files', 'changes', 'context', 'agents'],
      height: 680,
    },
  });
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  await expect(tabs.locator('[aria-selected="true"]')).toHaveCount(6);
  for (const id of ['agents', 'context', 'changes', 'files', 'browser', 'shell']) {
    const header = component.locator(
      `[data-sidebar-section="${id}"] [data-sidebar-section-header]`,
    );
    await header.scrollIntoViewIfNeeded();
    await expect(header).toBeInViewport();
  }
  await testInfo.attach('all-selected-panes', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const state of ['populated', 'empty', 'loading', 'files-error'] as const) {
  test(`multiple panes stay reachable in a narrow short window with ${state} content`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 420, height: 460 });
    const component = await mount(SidebarTabsPreview, {
      props: {
        width: 420,
        height: 420,
        sidebarWidth: 280,
        initialSections: ['agents', 'context', 'files'],
        items: state === 'empty' || state === 'loading' ? 0 : 40,
        loading: state === 'loading',
        filesError: state === 'files-error',
      },
    });
    for (const id of ['agents', 'context', 'files']) {
      const pane = component.locator(`[data-sidebar-section="${id}"]`);
      const header = pane.locator('[data-sidebar-section-header]');
      await header.scrollIntoViewIfNeeded();
      await expect(header).toBeInViewport();
      const body = pane.locator('[data-sidebar-section-scroll]');
      expect((await body.boundingBox())!.height).toBeGreaterThan(0);
    }
    expect(await component.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach(`short-multiple-${state}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
