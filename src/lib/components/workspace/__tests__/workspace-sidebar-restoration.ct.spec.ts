import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/WorkspaceSidebarRestorationHarness.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];

test.use({ trace: 'on' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
});

const activeSurface = (page: Page) => page.locator('[data-retained-workspace-active="true"]');
const sidebar = (page: Page) => activeSurface(page).locator('.workspace-sidebar-panel');

async function expectCollapsed(page: Page) {
  await expect(page.locator('[data-sidebar-collapse-choice]')).toHaveAttribute(
    'data-sidebar-collapse-choice',
    'true',
  );
  await expect(sidebar(page)).toHaveCSS('width', '0px');
  await expect(activeSurface(page).locator('[data-sidebar-rail-expand]')).toBeVisible();
  await expect
    .poll(() =>
      activeSurface(page).evaluate((surface) => {
        const rail = surface.querySelector('[data-workspace-sidebar-rail-shell]')!;
        const content = surface.querySelector('.main-content-area')!;
        return Math.abs(
          surface.getBoundingClientRect().width -
            rail.getBoundingClientRect().width -
            content.getBoundingClientRect().width,
        );
      }),
    )
    .toBeLessThanOrEqual(1);
}

test.afterEach(async ({ page }, testInfo) => {
  const geometry = await activeSurface(page).evaluate((surface) => {
    const box = (selector: string) =>
      surface.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
    return {
      workspaceId: surface.getAttribute('data-retained-workspace-surface'),
      sidebar: box('.workspace-sidebar-panel'),
      rail: box('[data-workspace-sidebar-rail-shell]'),
      content: box('.main-content-area'),
      surface: surface.getBoundingClientRect().toJSON(),
      collapsed: document
        .querySelector('[data-sidebar-collapse-choice]')
        ?.getAttribute('data-sidebar-collapse-choice'),
    };
  });
  await testInfo.attach('sidebar-geometry', {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('sidebar-after', {
    body: await page.screenshot({ path: testInfo.outputPath('sidebar-after.png') }),
    contentType: 'image/png',
  });
});

for (const sidebarSide of ['left', 'right'] as const) {
  test(`restored collapsed ${sidebarSide} sidebar survives reopening, switching, and resize`, async ({
    mount,
    page,
  }) => {
    const component = await mount(Harness, { props: { sidebarSide } });
    await expectCollapsed(page);
    await component.getByTestId('switch-b').click();
    await expectCollapsed(page);
    await component.getByTestId('switch-a').click();
    await expectCollapsed(page);
    await component.getByTestId('remount').click();
    await expectCollapsed(page);
    await page.setViewportSize({ width: 900, height: 700 });
    await expectCollapsed(page);
    await activeSurface(page).locator('[data-sidebar-rail-expand]').click();
    await expect(sidebar(page)).toHaveCSS('width', '410px');
    await component.getByTestId('toggle-sidebar').click();
    await expectCollapsed(page);
  });
}

test('a retained workspace follows collapse changes made in another workspace', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { collapsed: false } });
  await expect(sidebar(page)).toHaveCSS('width', '410px');
  await component.getByTestId('switch-b').click();
  await expect(sidebar(page)).toHaveCSS('width', '460px');
  await component.getByTestId('toggle-sidebar').click();
  await expectCollapsed(page);
  await component.getByTestId('switch-a').click();
  await expectCollapsed(page);
  await activeSurface(page).locator('[data-sidebar-rail-expand]').focus();
  await page.keyboard.press('Enter');
  await expect(sidebar(page)).toHaveCSS('width', '410px');
  await component.getByTestId('switch-b').click();
  await expect(sidebar(page)).toHaveCSS('width', '460px');
  await component.getByTestId('toggle-sidebar').click();
  await expectCollapsed(page);
});

test('late width hydration stays collapsed and restores the saved width on expansion', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { delayedWidth: true } });
  await expectCollapsed(page);
  await component.getByTestId('hydrate-width').click();
  await expectCollapsed(page);
  await activeSurface(page).locator('[data-sidebar-rail-expand]').click();
  await expect(sidebar(page)).toHaveCSS('width', '530px');
  await component.getByTestId('toggle-sidebar').click();
  await expectCollapsed(page);
});

test('boot redirect from the held onboarding route preserves the collapsed choice', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, {
    props: { gatedBoot: true, initialWorkspaceId: 'new' },
  });
  await expect(sidebar(page)).toHaveCSS('width', '0px');
  await component.getByTestId('switch-a').click();
  await component.getByTestId('resolve-boot').click();
  await expectCollapsed(page);
});

test('actual onboarding completion opens a visible sidebar and keeps it open on return', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness);
  await expectCollapsed(page);
  await component.getByTestId('start-onboarding').click();
  await expect(activeSurface(page)).toHaveAttribute('data-retained-workspace-surface', 'new');
  await expect(sidebar(page)).toHaveCSS('width', '0px');
  await component.getByTestId('finish-onboarding').click();
  await expect(activeSurface(page)).toHaveAttribute(
    'data-retained-workspace-surface',
    'workspace-created',
  );
  await expect(page.locator('[data-sidebar-collapse-choice]')).toHaveAttribute(
    'data-sidebar-collapse-choice',
    'false',
  );
  await expect(sidebar(page)).toHaveCSS('width', '360px');
  await expect(sidebar(page).locator('.h-full').first()).toBeVisible();
  await component.getByTestId('switch-a').click();
  await expect(sidebar(page)).toHaveCSS('width', '410px');
  await component.getByTestId('toggle-sidebar').click();
  await expectCollapsed(page);
});
