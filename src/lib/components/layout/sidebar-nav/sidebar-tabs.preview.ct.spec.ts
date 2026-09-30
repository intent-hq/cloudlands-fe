import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

test.use({ reducedMotion: 'reduce' });

async function expectNoFocusRing(tab: Locator) {
  await expect(tab).toHaveCSS('outline-style', 'none');
  // Tailwind's ring-0 serializes as zero-size shadow layers, not necessarily 'none'.
  await expect
    .poll(() =>
      tab.evaluate((node) =>
        (getComputedStyle(node).boxShadow.match(/-?\d*\.?\d+px/g) ?? [])
          .map(Number.parseFloat)
          .filter((length) => length !== 0),
      ),
    )
    .toEqual([]);
}

async function observePaneMotion(panel: Locator) {
  await panel.evaluate((node) => {
    const element = node as HTMLElement;
    element.dataset.observedMotions = '[]';
    element.addEventListener('animationstart', (event) => {
      if (event.target !== element) return;
      const animation = element
        .getAnimations()
        .find(
          (candidate) =>
            candidate instanceof CSSAnimation && candidate.animationName === event.animationName,
        );
      const frames = (animation?.effect as KeyframeEffect | null)?.getKeyframes();
      if (!frames?.length) return;
      const motions = JSON.parse(element.dataset.observedMotions!);
      motions.push({
        fromX: new DOMMatrix(String(frames[0].transform)).m41,
        toX: new DOMMatrix(String(frames.at(-1)!.transform)).m41,
        fromOpacity: Number(frames[0].opacity),
        toOpacity: Number(frames.at(-1)!.opacity),
      });
      element.dataset.observedMotions = JSON.stringify(motions);
    });
  });
}

for (const width of [288, 100]) {
  test(`both tab labels stay centered and workspace rows stay aligned at ${width}px`, async ({
    mount,
  }) => {
    const component = await mount(SidebarTabsPreview, { props: { width } });
    const workspaces = component.getByRole('tab', { name: 'Workspaces', exact: true });
    const intent = component.getByRole('tab', { name: 'Assistant', exact: true });
    const heading = component.getByRole('heading', { name: 'All workspaces', exact: true });
    const titles = component.locator('[data-workspace-card-title]');
    const rows = component.locator('[data-workspace-card-row]');
    const dots = rows.locator('[data-workspace-status-dot]');
    await expect(titles).toHaveCount(4);
    await expect(rows).toHaveCount(4);
    await expect(dots).toHaveCount(3);

    async function expectAligned() {
      const firstTitle = await titles.first().boundingBox();
      const headingBox = await heading.boundingBox();
      expect(firstTitle).not.toBeNull();
      expect(headingBox).not.toBeNull();
      for (const row of await rows.all()) {
        const contentLeft = await row.evaluate(
          (node) =>
            node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft),
        );
        expect(Math.abs(contentLeft - headingBox!.x)).toBeLessThanOrEqual(1);
      }
      for (const dot of await dots.all()) {
        const box = await dot.boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.x - headingBox!.x)).toBeLessThanOrEqual(1);
      }
      for (const title of await titles.all()) {
        const box = await title.boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.x - firstTitle!.x)).toBeLessThanOrEqual(1);
      }
    }

    async function expectLabelsCentered() {
      for (const trigger of [workspaces, intent]) {
        const tab = await trigger.boundingBox();
        const label = await trigger.locator('span').boundingBox();
        expect(tab).not.toBeNull();
        expect(label).not.toBeNull();
        expect(
          Math.abs(label!.x + label!.width / 2 - (tab!.x + tab!.width / 2)),
        ).toBeLessThanOrEqual(1);
      }
    }

    await expectAligned();
    await expectLabelsCentered();
    await intent.click();
    await expectLabelsCentered();
    await workspaces.click();
    await expect(component.locator('[data-combined-panel-spaces]')).toHaveCSS('transform', 'none');
    await expectAligned();
    await expectLabelsCentered();
  });
}

test('pointer tab changes enter from the destination side without remounting content', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(SidebarTabsPreview);
  const spaces = component.locator('[data-combined-panel-spaces]');
  const chief = component.locator('[data-combined-panel-chief]');
  const spacesElement = await spaces.elementHandle();
  await expect(spaces).toHaveCSS('animation-name', 'none');
  await observePaneMotion(spaces);
  await observePaneMotion(chief);
  await component.getByRole('tab', { name: 'Assistant', exact: true }).click();
  await expect.poll(() => chief.getAttribute('data-observed-motions')).not.toBe('[]');
  const [forward] = JSON.parse((await chief.getAttribute('data-observed-motions'))!);
  expect(forward.fromX).toBeGreaterThan(0);
  expect(forward.toX).toBe(0);
  expect(forward.fromOpacity).toBeLessThan(forward.toOpacity);
  await expect(spaces).toBeHidden();
  expect(await spaces.evaluate((node) => (node as HTMLElement).inert)).toBe(true);

  await component.getByRole('tab', { name: 'Workspaces', exact: true }).click();
  await expect.poll(() => spaces.getAttribute('data-observed-motions')).not.toBe('[]');
  const [backward] = JSON.parse((await spaces.getAttribute('data-observed-motions'))!);
  expect(backward.fromX).toBeLessThan(0);
  expect(backward.toX).toBe(0);
  await expect(spaces).toHaveCSS('transform', 'none');
  expect(await spaces.evaluate((node, previous) => node === previous, spacesElement)).toBe(true);

  await component.getByRole('tab', { name: 'Workspaces', exact: true }).press('ArrowRight');
  await expect(chief).toBeVisible();
  await expect(chief).toHaveCSS('animation-name', 'none');
  await expect(chief).toHaveCSS('transform', 'none');
});

for (const preference of ['os', 'battery'] as const) {
  test(`${preference} reduced motion switches panes without a directional animation`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: preference === 'os' ? 'reduce' : 'no-preference' });
    const component = await mount(SidebarTabsPreview);
    if (preference === 'battery') {
      await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
    }
    await component.getByRole('tab', { name: 'Assistant', exact: true }).click();
    const chief = component.locator('[data-combined-panel-chief]');
    await expect(chief).toBeVisible();
    await expect(chief).toHaveCSS('animation-name', 'none');
    await expect(chief).toHaveCSS('transform', 'none');
    // Global scrollbar-color transitions may still be present for 0.01ms.
    // Assert the pane's keyframe animation is absent, not unrelated transitions.
    expect(
      await chief.evaluate((node) =>
        node
          .getAnimations()
          .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
          .map((animation) => animation.animationName),
      ),
    ).toEqual([]);
  });
}

test('arrows, Home and End select tabs without moving focus into hidden content', async ({
  mount,
}) => {
  const component = await mount(SidebarTabsPreview);
  const workspaces = component.getByRole('tab', { name: 'Workspaces', exact: true });
  const intent = component.getByRole('tab', { name: 'Assistant', exact: true });
  const spacesPanel = component.locator('[data-combined-panel-spaces]');
  const intentPanel = component.locator('[data-combined-panel-chief]');
  const shell = component.locator('[data-sidebar-panel]');

  await workspaces.focus();
  await workspaces.press('ArrowRight');
  await expect(intent).toBeFocused();
  await expectNoFocusRing(intent);
  await expect(intent).toHaveAttribute('aria-selected', 'true');
  await expect(shell).toHaveAttribute('data-panel-item', 'chief');
  await expect(intentPanel).toBeVisible();
  await expect(spacesPanel).toBeHidden();
  expect(await spacesPanel.evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  expect(await spacesPanel.evaluate((node) => (node as HTMLElement).hidden)).toBe(true);
  expect(await intentPanel.evaluate((node) => (node as HTMLElement).inert)).toBe(false);
  await expect(component.getByRole('tabpanel')).toHaveCount(1);

  await intent.press('ArrowLeft');
  await expect(workspaces).toBeFocused();
  await expectNoFocusRing(workspaces);
  await expect(shell).toHaveAttribute('data-panel-item', 'all-workspaces');
  expect(await intentPanel.evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  expect(await intentPanel.evaluate((node) => (node as HTMLElement).hidden)).toBe(true);
  expect(await spacesPanel.evaluate((node) => (node as HTMLElement).inert)).toBe(false);
  await workspaces.press('End');
  await expect(intent).toBeFocused();
  await expect(intent).toHaveAttribute('aria-selected', 'true');
  await intent.press('Home');
  await expect(workspaces).toBeFocused();
  await expect(workspaces).toHaveAttribute('aria-selected', 'true');

  await workspaces.press('Tab');
  expect(await component.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  expect(await intentPanel.evaluate((node) => node.contains(document.activeElement))).toBe(false);
});

test('switching tabs preserves the real workspace search and mounted panel elements', async ({
  mount,
}) => {
  const component = await mount(SidebarTabsPreview);
  const workspaces = component.getByRole('tab', { name: 'Workspaces', exact: true });
  const intent = component.getByRole('tab', { name: 'Assistant', exact: true });
  const spacesPanel = component.locator('[data-combined-panel-spaces]');
  const intentPanel = component.locator('[data-combined-panel-chief]');
  const spacesElement = await spacesPanel.elementHandle();
  const intentElement = await intentPanel.elementHandle();

  await component.locator('[data-combined-panel-search-toggle]').click();
  const search = spacesPanel.getByRole('textbox');
  await search.fill('release');
  await expect(spacesPanel.locator('[data-workspace-card-trigger]')).toHaveCount(1);
  await expect(
    spacesPanel.getByRole('button', { name: 'Review the release checklist', exact: true }),
  ).toBeVisible();

  await intent.click();
  await expect(spacesPanel).toBeHidden();
  await expect(intentPanel).toBeVisible();
  await workspaces.click();
  await expect(search).toHaveValue('release');
  await expect(spacesPanel.locator('[data-workspace-card-trigger]')).toHaveCount(1);
  expect(await spacesPanel.evaluate((node, previous) => node === previous, spacesElement)).toBe(
    true,
  );
  expect(await intentPanel.evaluate((node, previous) => node === previous, intentElement)).toBe(
    true,
  );
});

test('external openPanel navigation changes the selected tab in the existing shell', async ({
  mount,
}) => {
  const component = await mount(SidebarTabsPreview, { props: { initialTab: 'chief' } });
  const intent = component.getByRole('tab', { name: 'Assistant', exact: true });
  await expect(intent).toHaveAttribute('aria-selected', 'true');
  const shell = await component.locator('[data-sidebar-panel]').elementHandle();
  await component.update({ props: { initialTab: 'all-workspaces' } });
  await expect(component.getByRole('tab', { name: 'Workspaces', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    await component
      .locator('[data-sidebar-panel]')
      .evaluate((node, previous) => node === previous, shell),
  ).toBe(true);
});

test('both tabs remain inside the 100px minimum panel and usable by pointer and keyboard', async ({
  mount,
}) => {
  const component = await mount(SidebarTabsPreview, { props: { width: 100 } });
  const shell = component.locator('[data-sidebar-panel]');
  const workspaces = component.getByRole('tab', { name: 'Workspaces', exact: true });
  const intent = component.getByRole('tab', { name: 'Assistant', exact: true });
  const tablist = component.getByRole('tablist');
  await expect(workspaces).toBeVisible();
  await expect(shell).toHaveCSS('width', '100px');
  const shellBox = await shell.boundingBox();
  const listBox = await tablist.boundingBox();
  expect(shellBox).not.toBeNull();
  expect(listBox).not.toBeNull();
  for (const tab of [workspaces, intent]) {
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(shellBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(shellBox!.x + shellBox!.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(listBox!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(listBox!.y + listBox!.height + 1);
  }
  await expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
  await intent.click();
  await expect(intent).toHaveAttribute('aria-selected', 'true');
  await intent.press('ArrowUp');
  await expect(workspaces).toBeFocused();
  await workspaces.press('ArrowDown');
  await expect(intent).toBeFocused();
  await expect(intent).toHaveAttribute('aria-selected', 'true');
  await intent.press('Home');
  await expect(workspaces).toBeFocused();
  await expect(workspaces).toHaveAttribute('aria-selected', 'true');
});

test('drag resizing changes the keyboard axis without remounting workspace search', async ({
  mount,
  page,
}) => {
  const component = await mount(SidebarTabsPreview);
  const tablist = component.getByRole('tablist');
  const workspaces = component.getByRole('tab', { name: 'Workspaces', exact: true });
  const intent = component.getByRole('tab', { name: 'Assistant', exact: true });
  await component.locator('[data-combined-panel-search-toggle]').click();
  const search = component.getByRole('textbox');
  await search.fill('release');
  const searchElement = await search.elementHandle();

  async function dragBy(delta: number) {
    const resizeHandle = component.getByTestId('width-resize-handle');
    const handle = await resizeHandle.boundingBox();
    expect(handle).not.toBeNull();
    // The handle straddles the shell's clipped edge. Start in its inner half.
    const x = handle!.x + handle!.width / 4;
    const y = handle!.y + handle!.height / 2;
    await resizeHandle.hover({ position: { x: handle!.width / 4, y: handle!.height / 2 } });
    await page.mouse.down();
    await expect(resizeHandle).toHaveAttribute('data-resizing', 'true');
    await page.mouse.move(x + delta, y, { steps: 5 });
    await page.mouse.up();
    await expect(resizeHandle).toHaveAttribute('data-resizing', 'false');
  }

  await dragBy(-108);
  await expect(component.locator('[data-sidebar-panel]')).toHaveCSS('width', '180px');
  await expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
  await workspaces.focus();
  await workspaces.press('ArrowDown');
  await expect(intent).toBeFocused();
  await expect(intent).toHaveAttribute('aria-selected', 'true');
  await intent.press('ArrowUp');
  await expect(workspaces).toBeFocused();
  await expect(search).toHaveValue('release');

  await dragBy(108);
  await expect(component.locator('[data-sidebar-panel]')).toHaveCSS('width', '288px');
  await expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');
  await workspaces.focus();
  await workspaces.press('ArrowRight');
  await expect(intent).toBeFocused();
  await intent.press('Home');
  await expect(search).toHaveValue('release');
  expect(await search.evaluate((node, previous) => node === previous, searchElement)).toBe(true);
});
