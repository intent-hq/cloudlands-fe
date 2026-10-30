import { expect, test } from '../../../test/ct-test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

test('truncated note labels retain full hover text when a floating section returns', async ({
  mount,
}) => {
  const component = await mount(SidebarTabsPreview, { props: { collapsed: true } });
  const rail = component.locator('[data-workspace-sidebar-rail]');
  const context = component.locator('[data-sidebar-section="context"]');
  const title = 'A long note title about keeping workspace state intact';
  const row = context.getByRole('button', { name: title, exact: true }).first();
  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await expect(row).toHaveAttribute('title', title);
  await rail.getByRole('tab', { name: 'Agents', exact: true }).hover();
  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await expect(row).toHaveAttribute('title', title);
  await context.locator('[data-sidebar-search="context"] button').click();
  const search = context.locator('[data-sidebar-search-input="context"]');
  await search.fill('Spec');
  await expect(
    context.getByRole('button', { name: 'Spec', exact: true }).first(),
  ).not.toHaveAttribute('title');
  await search.fill('A long note title');
  await expect(row).toHaveAttribute('title', title);
});

test('rapid collapsed previews reuse sizing work and retain content state', async ({
  mount,
  page,
}, testInfo) => {
  await page.evaluate(() => {
    const resizeObservers = new Set<ResizeObserver>();
    const mutationObservers = new Set<MutationObserver>();
    const resizeObserve = ResizeObserver.prototype.observe;
    const mutationObserve = MutationObserver.prototype.observe;
    const rectangle = Element.prototype.getBoundingClientRect;
    const probe = {
      synchronousReads: 0,
      insideInput: false,
      resizeObservers,
      mutationObservers,
    };
    Object.assign(window, { sidebarHoverProbe: probe });
    ResizeObserver.prototype.observe = function (target, options) {
      if (target.matches('[data-workspace-sidebar-shell], [data-sidebar-section]'))
        resizeObservers.add(this);
      return resizeObserve.call(this, target, options);
    };
    MutationObserver.prototype.observe = function (target, options) {
      if (target instanceof Element && target.matches('[data-sidebar-section]'))
        mutationObservers.add(this);
      return mutationObserve.call(this, target, options);
    };
    Element.prototype.getBoundingClientRect = function () {
      if (probe.insideInput && this.matches('[data-workspace-sidebar-shell]'))
        probe.synchronousReads++;
      return rectangle.call(this);
    };
  });

  const component = await mount(SidebarTabsPreview, {
    props: { collapsed: true, items: 200, extraFiles: 200, navigationEnabled: true },
  });
  const rail = component.locator('[data-workspace-sidebar-rail]');
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  const draft = component.getByRole('textbox', { name: 'Workspace draft' });
  await draft.fill('Keep this draft through rapid hover reversals.');
  const sections = ['agents', 'context', 'changes', 'files', 'browser', 'shell'];
  for (const section of sections) {
    await rail.locator(`[data-sidebar-section-tab="${section}"]`).hover();
    await expect(flyout.locator(`[data-sidebar-section="${section}"]`)).toBeVisible();
  }
  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await flyout.locator('[data-sidebar-search="context"] button').click();
  const search = flyout.locator('[data-sidebar-search-input="context"]');
  await search.fill('Interaction');
  const sectionNode = await flyout.locator('[data-sidebar-section="context"]').elementHandle();

  const counts = () =>
    page.evaluate(() => {
      const probe = (
        window as unknown as {
          sidebarHoverProbe: {
            resizeObservers: Set<ResizeObserver>;
            mutationObservers: Set<MutationObserver>;
            synchronousReads: number;
          };
        }
      ).sidebarHoverProbe;
      return {
        resizeObservers: probe.resizeObservers.size,
        mutationObservers: probe.mutationObservers.size,
        synchronousReads: probe.synchronousReads,
      };
    });
  const before = await counts();

  for (let sweep = 0; sweep < 3; sweep++) {
    for (const section of [...sections, ...sections.slice().reverse()]) {
      await rail.locator(`[data-sidebar-section-tab="${section}"]`).hover();
      await expect(flyout.locator(`[data-sidebar-section="${section}"]`)).toHaveAttribute(
        'data-active',
        'true',
      );
    }
  }
  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await expect(search).toHaveValue('Interaction');
  expect(await sectionNode!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this draft through rapid hover reversals.');
  await expect(component).toHaveAttribute('data-sidebar-activation-count', '0');
  const after = await counts();
  expect(after.resizeObservers).toBe(before.resizeObservers);
  expect(after.mutationObservers).toBe(before.mutationObservers);

  await rail.evaluate((node) => {
    const probe = (window as unknown as { sidebarHoverProbe: { insideInput: boolean } })
      .sidebarHoverProbe;
    probe.insideInput = true;
    try {
      for (const tab of node.querySelectorAll('[data-sidebar-section-tab]'))
        tab.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    } finally {
      probe.insideInput = false;
    }
  });
  await expect(flyout.locator('[data-sidebar-section="shell"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  const final = await counts();
  expect(final.synchronousReads).toBe(0);
  await testInfo.attach('sidebar-hover-work.json', {
    body: JSON.stringify(
      { before, after, final, sweeps: 3, retainedDraftAndSearch: true },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await testInfo.attach('rapid-sidebar-hover', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
