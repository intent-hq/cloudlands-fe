import { expect, test } from '../../../test/ct-test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

const note = {
  sidebarTabId: 'notes',
  type: 'note',
  noteId: 'sidebar-preview-note-9',
};
const terminal = {
  sidebarTabId: 'terminals',
  type: 'terminal',
  terminalId: 'sidebar-preview-terminal-0',
};
const script = {
  sidebarTabId: 'terminals',
  type: 'terminal',
  scriptId: 'sidebar-dev-server',
};

for (const collapsed of [false, true]) {
  test(`reveal opens a note's folded ancestor chain (${collapsed ? 'collapsed' : 'pinned'})`, async ({
    mount,
  }) => {
    const component = await mount(SidebarTabsPreview, {
      props: { collapsed, nestedNote: true, locate: note },
    });
    const context = component.getByRole('tab', { name: 'Context', exact: true });
    if (collapsed) await context.hover();
    else await context.click();
    const parent = component.locator('[data-note-id="sidebar-preview-note-8"]');
    const ancestor = component.locator('[data-note-id="sidebar-preview-note-7"]');
    await parent.hover();
    await parent.getByRole('button', { name: 'Collapse', exact: true }).click();
    await ancestor.hover();
    await ancestor.getByRole('button', { name: 'Collapse', exact: true }).click();
    const row = component.locator(`[data-note-id="${note.noteId}"]`);
    await expect(row).toHaveCount(0);
    await component.locator('[data-sidebar-preview-locate]').click();
    await expect(row).toBeInViewport();
    await expect(row).toHaveClass(/sidebar-locate-highlight/);
    await expect(parent.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
    await expect(ancestor.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
    if (collapsed)
      await expect
        .poll(() => row.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
    await expect(component.locator('[data-sidebar-section="context"]')).toBeVisible();
  });
}

test('reveal opens the collapsed flyout on the target and keeps it open', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: { collapsed: true, locate: note },
  });
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'false');
  await component.locator('[data-sidebar-preview-locate]').click();
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  const row = flyout.locator(`[data-note-id="${note.noteId}"]`);
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/sidebar-locate-highlight/);
  await expect(
    component
      .locator('[data-workspace-sidebar-rail]')
      .getByRole('tab', { name: 'Context', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await testInfo.attach('collapsed-note', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  // Moving back to the work must not close the revealed flyout under the user.
  await component.getByRole('textbox', { name: 'Workspace draft' }).hover();
  await page.waitForTimeout(400);
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
});

for (const [name, target, selector, groupName] of [
  ['terminal', terminal, `[data-sidebar-shell-terminal="${terminal.terminalId}"]`, 'Terminals'],
  [
    'saved script',
    script,
    `[data-sidebar-shell-script="${script.scriptId}"]`,
    'Development scripts',
  ],
] as const) {
  for (const collapsed of [false, true]) {
    test(`reveal finds a ${name} in Shells (${collapsed ? 'collapsed' : 'pinned'})`, async ({
      mount,
      page,
    }, testInfo) => {
      const component = await mount(SidebarTabsPreview, {
        props: { collapsed, terminals: 1, locate: target },
      });
      const shells = component.getByRole('tab', { name: 'Shells', exact: true });
      if (collapsed) await shells.hover();
      else await shells.click();
      const group = component
        .locator('[data-workspace-shell-list]')
        .getByRole('button', { name: groupName, exact: true });
      await group.click();
      await expect(group).toHaveAttribute('aria-expanded', 'false');
      await expect(component.locator(selector)).toHaveCount(0);
      await component.locator('[data-sidebar-preview-locate]').click();
      const row = component.locator(selector);
      await expect(row).toBeInViewport();
      await expect(row).toHaveClass(/sidebar-locate-highlight/);
      await expect(group).toHaveAttribute('aria-expanded', 'true');
      await expect(component.locator('[data-sidebar-section="shell"]')).toBeVisible();
      await testInfo.attach(`${name}-${collapsed ? 'collapsed' : 'pinned'}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  }
}

test('managers reveal saved scripts but not raw terminals', async ({ mount, page }, testInfo) => {
  const scriptView = await mount(SidebarTabsPreview, {
    props: { manager: true, collapsed: true, terminals: 1, locate: script },
  });
  const rail = scriptView.locator('[data-workspace-sidebar-rail]');
  await expect(rail.getByRole('tab', { name: 'Shells', exact: true })).toBeVisible();
  await scriptView.locator('[data-sidebar-preview-locate]').click();
  const flyout = scriptView.locator('[data-workspace-sidebar-flyout]');
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  await expect(flyout.locator(`[data-sidebar-shell-script="${script.scriptId}"]`)).toHaveClass(
    /sidebar-locate-highlight/,
  );
  await expect(flyout.locator('[data-sidebar-shell-terminal]')).toHaveCount(0);
  await testInfo.attach('manager-script', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await scriptView.unmount();

  const terminalView = await mount(SidebarTabsPreview, {
    props: { manager: true, collapsed: true, terminals: 1, locate: terminal },
  });
  await terminalView.locator('[data-sidebar-preview-locate]').click();
  await page.waitForTimeout(300);
  await expect(terminalView.locator('[data-workspace-sidebar-flyout]')).toHaveAttribute(
    'data-workspace-sidebar-flyout',
    'false',
  );
  await expect(terminalView.locator('[data-sidebar-shell-terminal]')).toHaveCount(0);
});

test('collaborators without script access cannot reveal Shells', async ({ mount, page }) => {
  const component = await mount(SidebarTabsPreview, {
    props: { collaborator: true, collapsed: true, terminals: 1, locate: script },
  });
  await component.locator('[data-sidebar-preview-locate]').click();
  await page.waitForTimeout(300);
  await expect(component.locator('[data-workspace-sidebar-flyout]')).toHaveAttribute(
    'data-workspace-sidebar-flyout',
    'false',
  );
  await expect(component.locator('[data-sidebar-section="shell"]')).toHaveCount(0);
});

test('a short rail scrolls its tabs under a fixed expand button', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 640, height: 260 });
  const component = await mount(SidebarTabsPreview, {
    props: { collapsed: true, width: 640, height: 220, terminals: 1, locate: terminal },
  });
  const rail = component.locator('[data-workspace-sidebar-rail]');
  const expand = rail.locator('[data-sidebar-rail-expand]');
  const scroller = rail.locator('[data-sidebar-rail-scroll]');
  expect(await rail.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThan(1);
  expect(await scroller.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(
    0,
  );
  const before = await expand.boundingBox();

  // Reveal scrolls the target's rail tab into view without moving the expand button.
  await component.locator('[data-sidebar-preview-locate]').click();
  const shells = rail.getByRole('tab', { name: 'Shells', exact: true });
  await expect(shells).toHaveAttribute('aria-selected', 'true');
  await expect(shells).toBeInViewport({ ratio: 1 });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await expand.boundingBox()).toEqual(before);
  await expect(expand).toBeInViewport({ ratio: 1 });
  await testInfo.attach('short-rail', { body: await page.screenshot(), contentType: 'image/png' });
});

for (const collapsed of [false, true]) {
  test(`reveal scrolls an offscreen virtual file into view (${collapsed ? 'collapsed' : 'pinned'})`, async ({
    mount,
    page,
  }, testInfo) => {
    const filePath = '/preview/sidebar-tabs/file-180.ts';
    const component = await mount(SidebarTabsPreview, {
      props: {
        collapsed,
        extraFiles: 200,
        locate: { sidebarTabId: 'files', type: 'file', filePath },
      },
    });
    const row = component.locator(`[data-file-path="${filePath}"]`);
    await expect(row).toHaveCount(0);
    await component.locator('[data-sidebar-preview-locate]').click();
    await expect(row).toBeInViewport();
    await expect(row).toHaveClass(/sidebar-locate-highlight/);
    await testInfo.attach(`virtual-file-${collapsed ? 'collapsed' : 'pinned'}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('reveal waits for a slow folder expansion before highlighting a nested file', async ({
  mount,
  page,
}, testInfo) => {
  const filePath = '/preview/sidebar-tabs/src/Sidebar.svelte';
  const component = await mount(SidebarTabsPreview, {
    props: {
      collapsed: true,
      extraFiles: 200,
      // Slower than any fixed delay the reveal could rely on.
      revealDelay: 900,
      locate: { sidebarTabId: 'files', type: 'file', filePath },
    },
  });
  const row = component.locator(`[data-file-path="${filePath}"]`);
  await component.locator('[data-sidebar-preview-locate]').click();
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  await expect(row).toHaveCount(0);
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/sidebar-locate-highlight/);
  await testInfo.attach('slow-nested-file', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

const agentRow = (id: string) => `[data-lazy-agent-card="${id}"], [data-agent-id="${id}"]`;

for (const [name, props] of [
  ['nested', { items: 12, delegatedParent: 1, collapsed: false }],
  ['virtual', { items: 40, delegatedParent: 30, collapsed: true }],
] as const) {
  test(`reveal opens a collapsed delegation group in the ${name} agent list`, async ({
    mount,
    page,
  }, testInfo) => {
    const id = 'sidebar-preview-delegate-2';
    const component = await mount(SidebarTabsPreview, {
      props: {
        ...props,
        initialSection: 'agents',
        delegated: 3,
        locate: { sidebarTabId: 'agents', type: 'agent', agentId: id },
      },
    });
    const toggle = component.locator(
      `[data-agent-delegation-toggle="sidebar-preview-agent-${props.delegatedParent}"]`,
    );
    const row = component.locator(agentRow(id)).first();
    await expect(row).toHaveCount(0);
    await component.locator('[data-sidebar-preview-locate]').click();
    await expect(row).toBeInViewport();
    await expect(row).toHaveClass(/sidebar-locate-highlight/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await testInfo.attach(`delegated-${name}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('reveal of an agent that is not loaded consumes safely', async ({ mount, page }) => {
  const component = await mount(SidebarTabsPreview, {
    props: {
      initialSection: 'agents',
      delegated: 3,
      locate: { sidebarTabId: 'agents', type: 'agent', agentId: 'missing-agent' },
    },
  });
  await component.locator('[data-sidebar-preview-locate]').click();
  await expect(component.locator('[data-sidebar-section="agents"]')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(component.locator('.sidebar-locate-highlight')).toHaveCount(0);
  await expect(
    component.locator('[data-agent-delegation-toggle="sidebar-preview-agent-1"]'),
  ).toHaveAttribute('aria-expanded', 'false');
});

test('reveal waits for a cold file tree before highlighting a nested file', async ({
  mount,
  page,
}, testInfo) => {
  const filePath = '/preview/sidebar-tabs/src/Sidebar.svelte';
  const component = await mount(SidebarTabsPreview, {
    props: {
      collapsed: true,
      extraFiles: 200,
      // The tree arrives well after the request; expansion is slow too.
      treeDelay: 1200,
      revealDelay: 400,
      locate: { sidebarTabId: 'files', type: 'file', filePath },
    },
  });
  const tree = component.locator('[data-workspace-sidebar-flyout] [role="tree"]');
  const row = component.locator(`[data-file-path="${filePath}"]`);
  await component.locator('[data-sidebar-preview-locate]').click();
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  await expect(flyout).toHaveAttribute('data-workspace-sidebar-flyout', 'true');
  await expect(tree).toHaveCount(0);
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/sidebar-locate-highlight/);
  await testInfo.attach('cold-tree-file', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('a new reveal cancels a pending file reveal without taking focus back', async ({
  mount,
  page,
}) => {
  const props = { collapsed: true, revealDelay: 900 };
  const component = await mount(SidebarTabsPreview, {
    props: {
      ...props,
      locate: {
        sidebarTabId: 'files',
        type: 'file',
        filePath: '/preview/sidebar-tabs/src/Sidebar.svelte',
      },
    },
  });
  await component.locator('[data-sidebar-preview-locate]').click();
  await expect(component.locator('[data-sidebar-section="files"]')).toBeVisible();
  await component.update({ props: { ...props, locate: note } });
  await component.locator('[data-sidebar-preview-locate]').click();
  const row = component.locator(`[data-note-id="${note.noteId}"]`);
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/sidebar-locate-highlight/);
  // Let the superseded expansion land; it must not steal the selection or focus.
  await page.waitForTimeout(1100);
  await expect(component.locator('[data-sidebar-section="context"]')).toBeVisible();
  await expect(component.locator('[data-sidebar-section="files"]')).not.toBeVisible();
  await expect
    .poll(() => row.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
});

test('a cancelled file reveal does not replay after returning to the workspace', async ({
  mount,
  page,
}) => {
  const filePath = '/preview/sidebar-tabs/src/Sidebar.svelte';
  const props = {
    revealDelay: 900,
    locate: { sidebarTabId: 'files', type: 'file', filePath },
  };
  const component = await mount(SidebarTabsPreview, { props });
  await component.locator('[data-sidebar-preview-locate]').click();
  await expect(component.locator('[data-sidebar-section="files"]')).toBeVisible();
  await expect(page.locator('[data-sidebar-tabs-preview]')).toHaveAttribute(
    'data-sidebar-file-reveal-count',
    '1',
  );
  await component.update({ props: { ...props, active: false } });
  const draft = component.getByRole('textbox', { name: 'Workspace draft' });
  await draft.focus();
  await component.update({ props: { ...props, active: true } });
  const row = component.locator(`[data-file-path="${filePath}"]`);
  await expect(row).toBeVisible();
  // Allow the superseded request's row observer to run if it was incorrectly retained.
  await page.waitForTimeout(300);
  await expect(row).not.toHaveClass(/sidebar-locate-highlight/);
  await expect(draft).toBeFocused();
});
