import { expect, test } from '../../../test/ct-test';
import DockRail from './DockRail.svelte';
import DockActionTestHost from './DockActionTestHost.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test.beforeEach(async ({ page }) => {
  await page.addStyleTag({ content: '#root { height: 100vh; }' });
});

test('keeps the first keyboard move when a menu is reopened', async ({ mount, page }) => {
  const annotated: string[] = [];
  const opened: string[] = [];
  const component = await mount(DockRail, {
    props: {
      staticData: true,
      workspaces: dockRailPreview.states['four-mixed'].props.workspaces,
      onOpenWorkspace: (id: string) => {
        opened.push(id);
      },
      onAnnotate: async ({ workspaceId }: { workspaceId: string }) => {
        annotated.push(workspaceId);
      },
    },
  });
  const buttons = component.locator('button[data-workspace-id]');
  await buttons.first().focus();
  await buttons.first().press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Open Workspace' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(buttons.first()).toBeFocused();
  await buttons.first().press('ArrowDown');
  await expect(buttons.nth(1)).toBeFocused();

  // Send the next key as soon as initial focus is available, before any later
  // render can remount the focus scope and reset the user's selection.
  await page.evaluate(() => {
    const navigateOnFocus = (event: FocusEvent) => {
      const item = event.target as HTMLElement;
      if (item.getAttribute('role') !== 'menuitem') return;
      document.removeEventListener('focusin', navigateOnFocus);
      queueMicrotask(() =>
        item.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    };
    document.addEventListener('focusin', navigateOnFocus);
  });
  await buttons.nth(1).press('ContextMenu');
  // Observe focus after the pending render, not the transient ArrowDown result.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('menuitem', { name: 'Give feedback' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => annotated.length).toBe(1);
  expect(annotated).toEqual([await buttons.nth(1).getAttribute('data-workspace-id')]);
  expect(opened).toEqual([]);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(buttons.nth(1)).toBeFocused();
});

test('supports secondary click, Menu, and Shift+F10 with focus return and native menu regions', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 680, height: 600 });
  await page.evaluate(() => {
    Object.assign(window, { __dockRegions: [] });
    window.electronAPI = {
      invoke: async (_channel: string, payload: unknown) => {
        Object.assign(window, { __dockRegions: payload });
        return { success: true };
      },
      on: () => 'dock-focus',
      offById: () => undefined,
    } as unknown as typeof window.electronAPI;
  });
  const opened: string[] = [];
  const annotated: string[] = [];
  const component = await mount(DockRail, {
    props: {
      staticData: true,
      workspaces: dockRailPreview.states['four-mixed'].props.workspaces,
      onOpenWorkspace: (id: string) => {
        opened.push(id);
      },
      onAnnotate: async (request: { workspaceId: string }) => {
        annotated.push(request.workspaceId);
      },
    },
  });
  const buttons = component.locator('button[data-workspace-id]');
  const first = buttons.first();
  await first.focus();
  await first.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open Workspace' })).toBeFocused();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(680);
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => {
          const state = (
            window as unknown as {
              __dockRegions: {
                active: boolean;
                regions: Array<{ x: number; y: number; width: number; height: number }>;
              };
            }
          ).__dockRegions;
          return (
            state.active &&
            state.regions.some(
              (r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
            )
          );
        },
        { x: menuBox.x + 10, y: menuBox.y + 10 },
      ),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(first).toBeFocused();
  await first.press('ArrowDown');
  await expect(buttons.nth(1)).toBeFocused();
  await buttons.nth(1).press('ContextMenu');
  await expect(page.getByRole('menuitem', { name: 'Open Workspace' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Give feedback' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => annotated.length).toBe(1);
  expect(annotated).toEqual([await buttons.nth(1).getAttribute('data-workspace-id')]);
  expect(opened).toEqual([]);
  await expect(menu).toHaveCount(0);
  await expect(buttons.nth(1)).toBeFocused();
  const strip = (await component.getByTestId('dock-collapsed-hit-strip').boundingBox())!;
  await page.mouse.move(679, strip.y + strip.height / 2);
  await expect(component.getByTestId('dock-rail-target')).toHaveAttribute('data-expanded', 'true');
  await first.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.getByRole('menuitem', { name: 'Open Workspace' }).click();
  await expect.poll(() => opened.length).toBe(1);
  expect(opened).toEqual([await first.getAttribute('data-workspace-id')]);
});

test('keeps the menu visible in forced colors and closes it on native window blur', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const component = await mount(DockRail, {
    props: { staticData: true, workspaces: dockRailPreview.states['four-mixed'].props.workspaces },
  });
  const button = component.locator('button[data-workspace-id]').first();
  await button.focus();
  await button.press('ContextMenu');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const style = await menu.evaluate((node) => {
    const css = getComputedStyle(node);
    return { color: css.color, background: css.backgroundColor, animation: css.animationName };
  });
  expect(style.color).not.toBe(style.background);
  expect(style.animation).toBe('none');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(menu).toHaveCount(0);
});

test('keeps error feedback still and permits keyboard retry', async ({ mount, page }, testInfo) => {
  const component = await mount(DockActionTestHost);
  const button = component.locator('button[data-workspace-id]').first();
  await button.focus();
  await button.press('Enter');
  const feedback = page.locator('[data-dock-action-feedback]');
  await expect(feedback).toContainText('Could not open the window.');
  await expect(button).toHaveAttribute('aria-busy', 'false');
  const artifact = testInfo.outputPath('dock-error-feedback.png');
  await page.screenshot({ path: artifact });
  await testInfo.attach('Dock error and retry', { path: artifact, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Retry' }).focus();
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('open-attempts')).toHaveText('2');
});

test('opens Assistant and starts its feedback capture without a workspace', async ({
  mount,
  page,
}, testInfo) => {
  const opened: string[] = [];
  const annotated: string[] = [];
  const component = await mount(DockRail, {
    props: {
      workspaces: [],
      staticData: true,
      onOpenAssistant: () => {
        opened.push('assistant');
      },
      onAnnotate: async ({ workspaceId }: { workspaceId: string }) => {
        annotated.push(workspaceId);
      },
    },
  });
  const assistant = component.locator('[data-dock-assistant]');
  await assistant.focus();
  await assistant.press('Enter');
  await expect.poll(() => opened.length).toBe(1);
  await assistant.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Open Assistant' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Give feedback' })).toBeFocused();
  const artifact = testInfo.outputPath('assistant-feedback-entry.png');
  await page.screenshot({ path: artifact });
  await testInfo.attach('Assistant feedback entry', { path: artifact, contentType: 'image/png' });
  await page.keyboard.press('Enter');
  await expect.poll(() => annotated).toEqual(['__chief__']);
  await expect(page.getByRole('menu')).toHaveCount(0);
});
