import { writeFile } from 'node:fs/promises';
import { expect, test, wheelUntilScrolled } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import DockOverview from './DockOverview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

for (const shape of ['notch', 'top-pill'] as const) {
  test(`expanded ${shape} logo aligns with the workspace icon column`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 720, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const component = await mount(DockRailPreview, {
      props: dockRailPreview.states[shape].props,
    });
    const shell = component.getByTestId('dock-shell');
    const logo = component.getByTestId('dock-drag-handle');
    const center = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.x + box.width / 2;
    };
    const compactCenter = await logo.evaluate(center);
    await logo.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    const row = component.locator('[data-dock-row]').first();
    const icon = row.locator('[data-dock-repo-avatar]');
    await expect(icon).toBeVisible();
    const centers = {
      logo: await logo.evaluate(center),
      workspace: await icon.evaluate(center),
      search: await component.locator('.search-lead').evaluate(center),
    };
    await component.locator('section[data-dock-surface]').screenshot({
      path: info.outputPath(`expanded-${shape}-alignment.png`),
    });
    await info.attach('icon-column-centers', {
      body: JSON.stringify(centers),
      contentType: 'application/json',
    });
    expect(Math.abs(centers.logo - centers.workspace)).toBeLessThan(0.5);
    expect(Math.abs(centers.logo - centers.search)).toBeLessThan(0.5);
    await page.mouse.move(1, 630);
    await expect(shell).toHaveAttribute('data-reveal', '0');
    expect(Math.abs((await logo.evaluate(center)) - compactCenter)).toBeLessThan(0.5);
  });
}

test('compact header status counts match accessible row descriptions', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const props = dockRailPreview.states.notch.props;
  // One in-progress and three unread workspaces, as the user saw in the live notch.
  const base = props.workspaces[0];
  const make = (id: string, workspace: Partial<typeof base.workspace>) => ({
    ...base,
    workspace: {
      ...base.workspace,
      id: `${base.workspace.id}-${id}` as typeof base.workspace.id,
      ...workspace,
    },
  });
  const items = [
    make('running', { displayStatus: 'in_progress', attention: 'none' }),
    ...[1, 2, 3].map((n) => make(`unread-${n}`, { displayStatus: 'idle', attention: 'unread' })),
  ];
  const component = await mount(DockRailPreview, { props: { ...props, workspaces: items } });
  const header = component.getByTestId('dock-update-count');
  // One glyph per status present, no numbers; the counts live in the accessible label.
  await expect(header.locator('[data-status-group]')).toHaveCount(2);
  await expect(header).toHaveText('');
  await expect(header).toHaveAccessibleName(/1.*3/);
  const shell = component.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  const box = await shell.boundingBox();
  if (!box) throw new Error('Missing shell bounds');
  await page.screenshot({
    path: test.info().outputPath('dock-header-status-groups.png'),
    clip: {
      x: box.x - 12,
      y: Math.max(0, box.y - 12),
      width: box.width + 24,
      height: box.height + 24,
    },
  });
  await test.info().attach('dock-header-status-groups.png', {
    path: test.info().outputPath('dock-header-status-groups.png'),
    contentType: 'image/png',
  });
  const headerGroups = await header.locator('[data-status-group]').evaluateAll((groups) =>
    groups.map((group) => ({
      status: group.getAttribute('data-status-group'),
      count: Number(group.getAttribute('data-status-count')),
    })),
  );
  expect(headerGroups).toEqual([
    { status: 'in_progress', count: 1 },
    { status: 'unread', count: 3 },
  ]);
  // Repository avatars identify rows; their accessible descriptions carry the statuses.
  await component.getByTestId('dock-drag-handle').hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  const rows = component
    .getByRole('grid', { name: 'Active spaces', exact: true })
    .locator('[data-dock-row]');
  await expect(rows).toHaveCount(4);
  for (const [index, item] of items.entries()) {
    await expect(
      rows.and(component.locator(`[data-workspace-id="${item.workspace.id}"]`)),
    ).toHaveAccessibleDescription(index === 0 ? /In progress$/ : /Unread$/);
  }
  const descriptions = await rows.evaluateAll((buttons) =>
    buttons.map((button) =>
      (button.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  );
  const rowCounts = [
    {
      status: 'in_progress',
      count: descriptions.filter((text) => /In progress$/.test(text)).length,
    },
    { status: 'unread', count: descriptions.filter((text) => /Unread$/.test(text)).length },
  ];
  expect(headerGroups).toEqual(rowCounts);
  expect(headerGroups.reduce((sum, group) => sum + group.count, 0)).toBe(4);
  expect(rowCounts.reduce((sum, group) => sum + group.count, 0)).toBe(descriptions.length);
});

test('workspace status cues follow transitions and open the indicated workspace', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const props = dockRailPreview.states.notch.props;
  const base = props.workspaces[0];
  const cases = [
    { title: 'Repair release checks', displayStatus: 'failed', attention: 'none', label: 'Failed' },
    {
      title: 'Resolve access blocker',
      displayStatus: 'blocked',
      attention: 'none',
      label: 'Blocked',
    },
    {
      title: 'Answer design question',
      displayStatus: 'needs_attention',
      attention: 'none',
      label: 'Needs attention',
    },
    {
      title: 'Polish workspace dock',
      displayStatus: 'in_progress',
      attention: 'none',
      label: 'In progress',
    },
    { title: 'Read verifier report', displayStatus: 'idle', attention: 'unread', label: 'Unread' },
    {
      title: 'Answer a folder question',
      displayStatus: 'needs_attention',
      attention: 'none',
      label: 'Needs attention',
    },
  ] as const;
  const items = cases.map((entry, index) => ({
    ...base,
    workspace: {
      ...base.workspace,
      id: `${base.workspace.id}-status-${index}` as typeof base.workspace.id,
      title: entry.title,
      displayStatus: entry.displayStatus,
      attention: entry.attention,
      // A local/nested repository owner uses the deterministic initial avatar.
      repositoryOwner: 'demo/team',
      plainFolder: index === cases.length - 1,
    },
  }));
  const component = await mount(DockRailPreview, { props: { ...props, workspaces: items } });
  await component.getByTestId('dock-drag-handle').hover();
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
  const overview = component.getByTestId('dock-overview');
  const path = test.info().outputPath('dock-workspace-status-cues.png');
  await overview.screenshot({ path });
  await test.info().attach('dock-workspace-status-cues', { path, contentType: 'image/png' });
  for (const [index, entry] of cases.entries()) {
    const row = overview.locator(
      `[data-dock-row][data-workspace-id="${items[index].workspace.id}"]`,
    );
    await expect(row).toHaveAccessibleDescription(new RegExp(`${entry.label}$`));
    await expect(
      row.locator(
        `[data-workspace-status-visual][data-workspace-status="${entry.attention === 'unread' ? 'unread' : entry.displayStatus}"]`,
      ),
    ).toBeVisible();
  }
  const targetId = String(items[2].workspace.id);
  const target = overview.locator(`[data-dock-row][data-workspace-id="${targetId}"]`);
  await target.focus();
  for (const transition of [
    { displayStatus: 'in_progress', attention: 'none', state: 'in_progress', label: 'In progress' },
    { displayStatus: 'idle', attention: 'unread', state: 'unread', label: 'Unread' },
    { displayStatus: 'idle', attention: 'none', state: 'idle', label: 'Idle' },
    {
      displayStatus: 'needs_attention',
      attention: 'none',
      state: 'needs_attention',
      label: 'Needs attention',
    },
  ] as const) {
    const workspaces = items.map((item, index) =>
      index === 2
        ? {
            ...item,
            workspace: {
              ...item.workspace,
              displayStatus: transition.displayStatus,
              attention: transition.attention,
            },
          }
        : item,
    );
    await component.update({ props: { workspaces } });
    await expect(target.locator('[data-workspace-status-visual]')).toHaveAttribute(
      'data-workspace-status',
      transition.state,
    );
    await expect(target).toHaveAccessibleDescription(new RegExp(`${transition.label}$`));
    await expect(target).toBeFocused();
    await expect(
      component.getByTestId('dock-update-count').locator('[data-status-group="needs_attention"]'),
    ).toHaveAttribute('data-status-count', transition.state === 'needs_attention' ? '2' : '1');
  }
  await target.press('Enter');
  await expect(component).toHaveAttribute('data-preview-action', `workspace:${targetId}`);
});

test('narrow repository status keeps cues and fallback text clear of timestamps', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 300, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const base = dockRailPreview.states.notch.props.workspaces[0];
  const workspaces = [
    {
      ...base,
      workspace: {
        ...base.workspace,
        repositoryOwner: 'demo/team',
        repositoryName: 'a-deliberately-long-repository-name',
        title: 'A deliberately long workspace title which must stay in its text column',
      },
    },
    {
      ...base,
      workspace: {
        ...base.workspace,
        id: `${base.workspace.id}-folder` as typeof base.workspace.id,
        repositoryOwner: undefined,
        repositoryName: undefined,
        repositoryPath: undefined,
        plainFolder: true,
        title: 'Folder workspace',
        statusMessage: 'A long folder status message that must truncate before the timestamp',
      },
    },
  ];
  const component = await mount(DockOverview, { props: { workspaces, onOpen: () => {} } });
  for (const item of workspaces) {
    const row = component.locator(`[data-dock-row][data-workspace-id="${item.workspace.id}"]`);
    await expect(row).toHaveAccessibleDescription(/Failed$/);
    await expect(row.locator('[data-workspace-status-visual]')).toHaveCount(1);
    const clear = await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const copy = element.querySelector('.row-copy')!.getBoundingClientRect();
      const time = element.querySelector('.row-time')!.getBoundingClientRect();
      const status = element.querySelector('.row-status')!;
      const cue = status.querySelector('[data-workspace-status-visual]')!.getBoundingClientRect();
      const text = status
        .querySelector('[data-dock-row-repo], [data-dock-row-message]')!
        .getBoundingClientRect();
      return (
        copy.width > 0 &&
        cue.width > 0 &&
        text.width > 0 &&
        cue.right < text.left &&
        text.right <= copy.right &&
        copy.right <= time.left &&
        time.right <= box.right &&
        box.right <= innerWidth
      );
    });
    expect(clear).toBe(true);
  }
  await expect(component.locator('[data-dock-row-repo]')).toHaveText(
    'demo/team/a-deliberately-long-repository-name',
  );
  await expect(component.locator('[data-dock-row-message]')).toHaveText(
    workspaces[1].workspace.statusMessage!,
  );
  const path = info.outputPath('narrow-repository-status.png');
  await component.screenshot({ path });
  await info.attach('Narrow repository and folder status', { path, contentType: 'image/png' });
});

for (const mode of ['floating', 'notch'] as const) {
  test(`long status list in ${mode} keeps cues aligned and every workspace reachable`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 720, height: 680 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const props = dockRailPreview.states[`${mode}-status-list`].props;
    const component = await mount(DockRailPreview, { props });
    const grip = component.getByTestId('dock-drag-handle');
    // Hover the anchored float for a pointer-driven hero without a keyboard focus ring.
    if (mode === 'floating') await grip.hover();
    else {
      await page.keyboard.press('Tab');
      await expect(grip).toBeFocused();
    }
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
    const overview = component.getByTestId('dock-overview');
    const rows = overview.locator(
      '[data-dock-row][data-workspace-id]:not([data-workspace-id="dock:assistant"])',
    );
    await expect(rows).toHaveCount(10);
    await expect(rows.locator('.row-status > [data-workspace-status-visual]')).toHaveCount(10);
    await expect(rows.locator('[data-dock-row-message]')).toHaveText('Waiting for your review.');
    const center = (element: Element) => {
      const r = element.getBoundingClientRect();
      return r.x + r.width / 2;
    };
    const centers = {
      logo: await grip.evaluate(center),
      avatar: await rows.first().locator('[data-dock-repo-avatar]').evaluate(center),
      search: await overview.locator('.search-lead').evaluate(center),
    };
    const centersPath = info.outputPath(`${mode}-column-centers.json`);
    await writeFile(centersPath, JSON.stringify(centers, null, 2));
    await info.attach(`${mode}-column-centers`, {
      path: centersPath,
      contentType: 'application/json',
    });
    const surface = component.locator('section[data-dock-surface]');
    const top = info.outputPath(`${mode}-status-list-top.png`);
    await surface.screenshot({ path: top });
    await info.attach(`${mode} long list top`, { path: top, contentType: 'image/png' });
    expect(Math.abs(centers.logo - centers.avatar)).toBeLessThan(0.5);
    expect(Math.abs(centers.logo - centers.search)).toBeLessThan(0.5);
    const scroller = overview.locator('[data-dock-scroll]');
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight))
      .toBe(true);
    await wheelUntilScrolled(scroller, { deltaY: 700 });
    await rows.last().focus();
    await expect(rows.last()).toBeInViewport();
    const bottom = info.outputPath(`${mode}-status-list-bottom.png`);
    await surface.screenshot({ path: bottom });
    await info.attach(`${mode} long list bottom`, { path: bottom, contentType: 'image/png' });
    const targetId = await rows.last().getAttribute('data-workspace-id');
    await rows.last().locator('[data-workspace-status-visual]').click();
    await expect(component).toHaveAttribute('data-preview-action', `workspace:${targetId}`);
  });
}

for (const direction of ['down', 'up'] as const) {
  test(`floating ${direction} expansion aligns the logo and returns to its compact anchor`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 720, height: 680 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const props =
      dockRailPreview.states[
        direction === 'up' ? 'floating-status-list-up' : 'floating-status-list'
      ].props;
    const component = await mount(DockRailPreview, { props });
    const shell = component.getByTestId('dock-shell');
    const logo = component.getByTestId('dock-drag-handle');
    const center = (element: Element) => {
      const r = element.getBoundingClientRect();
      return r.x + r.width / 2;
    };
    const compact = await logo.evaluate(center);
    await logo.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect(component.locator('section[data-dock-surface]')).toHaveAttribute(
      'data-expansion-direction',
      direction,
    );
    const avatar = component.locator('[data-dock-repo-avatar]').first();
    const search = component.locator('.search-lead');
    await expect
      .poll(async () => Math.abs((await logo.evaluate(center)) - (await avatar.evaluate(center))))
      .toBeLessThan(0.5);
    await expect
      .poll(async () => Math.abs((await logo.evaluate(center)) - (await search.evaluate(center))))
      .toBeLessThan(0.5);
    const path = info.outputPath(`floating-${direction}-aligned.png`);
    await component.locator('section[data-dock-surface]').screenshot({ path });
    await info.attach(`Floating ${direction} aligned`, { path, contentType: 'image/png' });
    await page.mouse.move(700, 660);
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await expect
      .poll(async () => Math.abs((await logo.evaluate(center)) - compact))
      .toBeLessThan(0.5);
    // A second opening must retain the same shared avatar/search alignment.
    await logo.hover();
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await expect
      .poll(async () => Math.abs((await logo.evaluate(center)) - (await avatar.evaluate(center))))
      .toBeLessThan(0.5);
  });
}
