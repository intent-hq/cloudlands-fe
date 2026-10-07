import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

interface SidebarMotionRecord {
  view: string | null;
  toggle: boolean;
  main: boolean;
  headerDisplayed?: boolean;
  frames: { x: number; y: number; opacity: number }[];
  duration: number;
}

declare global {
  interface Window {
    __sidebarMotionRecords: SidebarMotionRecord[];
  }
}

test.use({ video: 'on' });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    window.__sidebarMotionRecords = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (
        this.closest('.home-layout') &&
        this.matches(
          '.home-sidebar-content, .home-destination-content, .home-tab-content, [data-tabs-indicator]',
        ) &&
        Array.isArray(frames) &&
        frames.length > 1 &&
        frames.some(
          (frame) => frame.transform !== frames[0].transform || frame.opacity !== frames[0].opacity,
        )
      ) {
        window.__sidebarMotionRecords.push({
          view:
            this.getAttribute('data-value') ??
            this.getAttribute('data-home-view') ??
            this.getAttribute('data-home-destination'),
          toggle: this.hasAttribute('data-tabs-indicator'),
          main: this.matches('.home-destination-content, .home-tab-content'),
          headerDisplayed: this.hasAttribute('data-home-view')
            ? (this.querySelector<HTMLElement>('.home-header')?.offsetWidth ?? 0) > 0
            : undefined,
          frames: frames.map((frame) => ({
            x:
              !frame.transform || frame.transform === 'none'
                ? 0
                : new DOMMatrix(String(frame.transform)).m41,
            y:
              !frame.transform || frame.transform === 'none'
                ? 0
                : new DOMMatrix(String(frame.transform)).m42,
            opacity: Number(frame.opacity),
          })),
          duration: Number(typeof options === 'number' ? options : options?.duration),
        });
      }
      return animate.call(this, frames, options);
    };
  });
});

test('Sidebar fades in both directions and keeps filters, drafts, and toggle alignment', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const tabs = sidebar.getByRole('tablist');
  const workspaces = tabs.getByRole('tab', { name: 'Workspaces', exact: true });
  const assistant = tabs.getByRole('tab', { name: 'Assistant', exact: true });
  await sidebar.getByRole('button', { name: 'acme/platform', exact: true }).click();
  await component.getByRole('searchbox').fill('sidebar');
  await page.evaluate(() => (window.__sidebarMotionRecords = []));
  await assistant.click();
  await expect(sidebar.getByRole('listbox')).toBeVisible();
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  const forward = await page.evaluate(() => window.__sidebarMotionRecords);
  const entry = forward.find((record) => !record.main && record.view === 'assistant')!;
  const exit = forward.find((record) => !record.main && record.view === 'workspaces')!;
  expect(entry.frames[0].x).toBeGreaterThan(0);
  expect(entry.frames[0].opacity).toBe(0);
  expect(entry.frames.at(-1)).toEqual({ x: 0, y: 0, opacity: 1 });
  expect(exit.frames.at(-1)!.x).toBeLessThan(0);
  expect(exit.frames.at(-1)!.opacity).toBe(0);
  const toggle = forward.find((record) => record.toggle)!;
  expect(toggle.frames.some((frame) => frame.opacity < 1)).toBe(true);
  expect(toggle.frames.at(-1)!.opacity).toBe(1);
  expect(toggle.duration).toBe(entry.duration);
  const main = forward.find((record) => record.main && record.view === 'assistant')!;
  expect(main.frames[0].y).toBe(0);
  expect(main.frames[0].x).toBeGreaterThan(0);
  expect(main.frames[0].opacity).toBe(0);
  expect(main.frames.at(-1)).toEqual({ x: 0, y: 0, opacity: 1 });
  expect(main.duration).toBe(entry.duration);
  const mainExit = forward.find((record) => record.main && record.view === 'workspaces')!;
  expect(mainExit.headerDisplayed).toBe(true);
  expect(mainExit.frames.at(-1)!.y).toBe(0);
  expect(mainExit.frames.at(-1)!.x).toBeLessThan(0);
  expect(mainExit.frames.at(-1)!.opacity).toBe(0);
  await expect
    .poll(async () => {
      const selected = await assistant.boundingBox();
      const indicator = await tabs.locator('[data-tabs-indicator]').boundingBox();
      return Math.abs(indicator!.x - selected!.x);
    })
    .toBeLessThan(1);
  const draft = component.locator('.home-surface [contenteditable="true"]').first();
  await draft.fill('Keep this draft through the animation');
  await page.evaluate(() => (window.__sidebarMotionRecords = []));
  await workspaces.click();
  await expect(sidebar.getByRole('button', { name: /^All repos/ })).toBeVisible();
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  const backward = await page.evaluate(() => window.__sidebarMotionRecords);
  expect(
    backward.find((record) => !record.main && record.view === 'workspaces')!.frames[0].x,
  ).toBeLessThan(0);
  expect(
    backward.find((record) => !record.main && record.view === 'assistant')!.frames.at(-1)!.x,
  ).toBeGreaterThan(0);
  await expect(component.getByRole('searchbox')).toHaveValue('sidebar');
  const mainReturn = backward.find((record) => record.main && record.view === 'workspaces')!;
  expect(mainReturn.frames[0].y).toBe(0);
  expect(mainReturn.frames[0].x).toBeLessThan(0);
  const assistantExit = backward.find((record) => record.main && record.view === 'assistant')!;
  expect(assistantExit.frames.at(-1)!.y).toBe(0);
  expect(assistantExit.frames.at(-1)!.x).toBeGreaterThan(0);
  expect(assistantExit.frames.at(-1)!.opacity).toBe(0);
  await expect(component.locator('.workspace-list').getByRole('option')).toHaveCount(1);
  await assistant.click();
  await expect(draft).toHaveText('Keep this draft through the animation');
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  await testInfo.attach('sidebar-directional-motion', {
    body: JSON.stringify({ forward, backward }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('sidebar-motion-after', {
    body: await sidebar.screenshot({ path: testInfo.outputPath('sidebar-motion-after.png') }),
    contentType: 'image/png',
  });
});

test('Sidebar handles rapid reversals, keyboard switching, and reduced motion while animating', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 768 });
  const component = await mount(Preview, { props: { scenario: 'assistant-many' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const tabs = sidebar.getByRole('tablist');
  await page.evaluate(async () => {
    const tabs = document.querySelector('.home-sidebar [role="tablist"]')!;
    for (const value of ['assistant', 'workspaces', 'assistant', 'workspaces', 'assistant']) {
      tabs.querySelector<HTMLElement>(`[data-value="${value}"]`)!.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });
  const assistant = tabs.getByRole('tab', { name: 'Assistant', exact: true });
  await expect(assistant).toHaveAttribute('aria-selected', 'true');
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  await expect(sidebar.getByRole('listbox')).toBeVisible();
  expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await assistant.focus();
  await page.keyboard.press('ArrowLeft');
  const workspaces = tabs.getByRole('tab', { name: 'Workspaces', exact: true });
  await expect(workspaces).toBeFocused();
  await expect(workspaces).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(assistant).toHaveAttribute('aria-selected', 'true');
  await expect(component.locator('.home-surface .tiptap-editor').first()).toHaveAttribute(
    'contenteditable',
    'true',
  );
  await expect(assistant).toBeFocused();
  await page.evaluate(async () => {
    document
      .querySelector<HTMLElement>('.home-sidebar [role="tab"][data-value="workspaces"]')!
      .click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    document.documentElement.setAttribute('data-reduce-motion', '');
  });
  await expect(workspaces).toHaveAttribute('aria-selected', 'true');
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  await expect
    .poll(() => sidebar.evaluate((element) => element.getAnimations({ subtree: true }).length))
    .toBe(0);
  await testInfo.attach('sidebar-motion-reversal', {
    body: JSON.stringify(await page.evaluate(() => window.__sidebarMotionRecords), null, 2),
    contentType: 'application/json',
  });
});

test('Home content enters and exits horizontally in the direction of its tabs', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview);
  const records: SidebarMotionRecord[] = [];
  let currentView = 'workspaces';
  for (const [name, view] of [
    ['Pull requests', 'prs'],
    ['Linear issues', 'linear'],
    ['Workspaces', 'workspaces'],
  ] as const) {
    await page.evaluate(() => (window.__sidebarMotionRecords = []));
    await component
      .locator(`[data-home-view="${currentView}"] .home-header`)
      .getByRole('tab', { name, exact: true })
      .click();
    const selectedTab = component
      .locator(`[data-home-view="${view}"] .home-header`)
      .getByRole('tab', { name, exact: true });
    await expect(selectedTab).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() =>
        page.evaluate(
          (value) =>
            window.__sidebarMotionRecords.some((record) => record.main && record.view === value),
          view,
        ),
      )
      .toBe(true);
    const record = await page.evaluate(
      (value) =>
        window.__sidebarMotionRecords.find((record) => record.main && record.view === value)!,
      view,
    );
    expect(record.frames[0].y).toBe(0);
    expect(Math.sign(record.frames[0].x)).toBe(view === 'workspaces' ? -1 : 1);
    expect(record.frames[0].opacity).toBe(0);
    expect(record.frames.at(-1)).toMatchObject({ x: 0, y: 0, opacity: 1 });
    expect(record.headerDisplayed).toBe(true);
    await expect(selectedTab).toBeVisible();
    records.push(record);
    currentView = view;
  }
  await testInfo.attach('home-content-horizontal-motion', {
    body: JSON.stringify(records, null, 2),
    contentType: 'application/json',
  });
});

for (const preference of ['OS', 'battery saver'] as const) {
  test(`Sidebar switches instantly with ${preference} reduced motion and empty threads`, async ({
    mount,
    page,
  }, testInfo) => {
    if (preference === 'OS') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
    const component = await mount(Preview, { props: { scenario: 'empty' } });
    const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
    const tabs = sidebar.getByRole('tablist');
    await tabs.getByRole('tab', { name: 'Assistant', exact: true }).click();
    await expect(sidebar.getByRole('status')).toContainText('No Assistant threads');
    await tabs.getByRole('tab', { name: 'Workspaces', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: /^All repos/ })).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.__sidebarMotionRecords.filter((record) => record.duration > 0),
      ),
    ).toEqual([]);
    await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
    await testInfo.attach('sidebar-reduced-motion', {
      body: await sidebar.screenshot({ path: testInfo.outputPath('sidebar-reduced-motion.png') }),
      contentType: 'image/png',
    });
  });
}
