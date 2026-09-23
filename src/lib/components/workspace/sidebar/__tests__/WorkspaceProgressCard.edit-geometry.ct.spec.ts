import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import WorkspaceProgressCardEditGeometryHost from './mocks/WorkspaceProgressCardEditGeometryHost.svelte';

// Matches the DropdownMenu default collisionPadding: the floating menu must
// stay this far inside the viewport on every side.
const MENU_COLLISION_PADDING = 8;
const MENU_ROW_MIN_WIDTH_PX = 192;

type BoundingBox = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

// bits-ui parks the floating wrapper at translate(0, -200%) until floating-ui
// reports its first placement, so a visible menu can still read x=0 / y<0 for a
// frame or two on a slow runner.
function isPositionedOnPage(box: BoundingBox | null): box is BoundingBox {
  return box !== null && box.x > 0 && box.y >= 0;
}

async function openWorkspaceActionsMenu(component: Locator, page: Page) {
  await component.getByRole('button', { name: 'Workspace actions' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button').first()).toBeVisible();
  await expect.poll(async () => isPositionedOnPage(await menu.boundingBox())).toBe(true);
  return menu;
}

// Floating positioning settles a frame after open; wait for two identical
// consecutive on-page reads before asserting geometry.
async function settledBoundingBox(target: Locator) {
  let previous = JSON.stringify(await target.boundingBox());
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      const current = JSON.stringify(box);
      const settled = isPositionedOnPage(box) && current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
  return (await target.boundingBox())!;
}

async function expectMenuInsideCollisionPadding(menu: Locator, page: Page) {
  const viewport = page.viewportSize()!;
  const box = await settledBoundingBox(menu);
  expect(box.x).toBeGreaterThanOrEqual(MENU_COLLISION_PADDING - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - MENU_COLLISION_PADDING + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(MENU_COLLISION_PADDING - 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - MENU_COLLISION_PADDING + 0.5);
  return box;
}

function collectTruncatedLabels(menu: Locator) {
  return menu.evaluate((node) =>
    Array.from(node.querySelectorAll<HTMLElement>('button span'))
      .filter((span) => getComputedStyle(span).textOverflow === 'ellipsis')
      .map((span) => ({
        text: span.textContent?.trim() ?? '',
        overflow: span.scrollWidth - span.clientWidth,
      })),
  );
}

function isTransparent(color: string) {
  const normalized = color.replace(/\s+/g, '').toLowerCase();
  return (
    normalized === 'transparent' ||
    /rgba\([^)]*,0(?:\.0+)?\)$/.test(normalized) ||
    /color\([^)]*\/0(?:\.0+)?\)$/.test(normalized)
  );
}

async function inspectEditBox(control: Locator) {
  return control.evaluate((node) => {
    const decoration = node.parentElement!.querySelector<HTMLElement>(
      ':scope > [aria-hidden="true"]',
    )!;
    const controlRect = node.getBoundingClientRect();
    const decorationRect = decoration.getBoundingClientRect();
    const style = getComputedStyle(decoration);
    let overflowAncestor = decoration.parentElement?.parentElement ?? null;
    while (overflowAncestor) {
      const ancestorStyle = getComputedStyle(overflowAncestor);
      if (ancestorStyle.overflowX !== 'visible' || ancestorStyle.overflowY !== 'visible') break;
      overflowAncestor = overflowAncestor.parentElement;
    }
    const ancestorRect = overflowAncestor?.getBoundingClientRect();
    const clientRect =
      overflowAncestor && ancestorRect
        ? {
            left: ancestorRect.left + overflowAncestor.clientLeft,
            top: ancestorRect.top + overflowAncestor.clientTop,
            right: ancestorRect.left + overflowAncestor.clientLeft + overflowAncestor.clientWidth,
            bottom: ancestorRect.top + overflowAncestor.clientTop + overflowAncestor.clientHeight,
          }
        : null;
    return {
      margins: {
        left: controlRect.left - decorationRect.left,
        right: decorationRect.right - controlRect.right,
        top: controlRect.top - decorationRect.top,
        bottom: decorationRect.bottom - controlRect.bottom,
      },
      borderColor: style.borderTopColor,
      transitionDurations: style.transitionDuration.split(',').map((value) => value.trim()),
      hasOverflowAncestor: clientRect !== null,
      clipped:
        clientRect === null ||
        decorationRect.left < clientRect.left - 0.5 ||
        decorationRect.right > clientRect.right + 0.5 ||
        decorationRect.top < clientRect.top - 0.5 ||
        decorationRect.bottom > clientRect.bottom + 0.5,
    };
  });
}

async function expectValidEditBox(control: Locator) {
  const result = await inspectEditBox(control);
  expect(result.margins.left).toBeGreaterThanOrEqual(4);
  expect(result.margins.right).toBeGreaterThanOrEqual(4);
  expect(result.margins.top).toBeGreaterThanOrEqual(2);
  expect(result.margins.bottom).toBeGreaterThanOrEqual(2);
  expect(isTransparent(result.borderColor)).toBe(false);
  expect(result.transitionDurations.every((duration) => duration === '0s')).toBe(true);
  expect(result.hasOverflowAncestor).toBe(true);
  expect(result.clipped).toBe(false);
}

test('keeps the active workspace card branch label at normal weight, including hover and focus', async ({
  mount,
}) => {
  const component = await mount(WorkspaceProgressCardEditGeometryHost);
  const branch = component.locator('[data-sidebar-branch-label]');
  const repository = component.locator('[data-sidebar-repository-label]');
  const trigger = component.getByRole('button', { name: 'edit-geometry', exact: true });

  await expect(repository).toHaveCSS('font-weight', '400');
  await expect(branch).toHaveCSS('font-weight', '400');
  await trigger.hover();
  await expect(branch).toHaveCSS('font-weight', '400');
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(branch).toHaveCSS('font-weight', '400');
});

test('keeps the workspace title edit decoration visible, padded, unclipped, and motion-safe', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardEditGeometryHost);
  const idleDecoration = component.locator('[data-workspace-title-edit-decoration]');
  expect(
    isTransparent(await idleDecoration.evaluate((node) => getComputedStyle(node).borderTopColor)),
  ).toBe(true);

  await component.getByRole('button', { name: 'Geometry workspace' }).click();
  const input = component.getByRole('textbox');
  await expect(input).toBeFocused();
  await expectValidEditBox(input);
});

test('keeps the workspace status edit decoration visible, padded, unclipped, and motion-safe', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardEditGeometryHost);
  const idleDecoration = component.locator('[data-workspace-status-edit-decoration]');
  expect(
    isTransparent(await idleDecoration.evaluate((node) => getComputedStyle(node).borderTopColor)),
  ).toBe(true);

  await component.getByRole('button', { name: 'Edit workspace status' }).click();
  const input = component.getByRole('textbox', { name: 'Workspace status' });
  await expect(input).toBeFocused();
  await expectValidEditBox(input);
});

test('keeps the workspace actions menu inside the collision padding at a 320px viewport', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardEditGeometryHost);

  const menu = await openWorkspaceActionsMenu(component, page);
  const box = await expectMenuInsideCollisionPadding(menu, page);
  // The 12rem row floor still applies: a 320px viewport leaves room for it.
  const row = await settledBoundingBox(menu.getByRole('button').first());
  expect(row.width).toBeGreaterThanOrEqual(MENU_ROW_MIN_WIDTH_PX - 0.5);

  await page.screenshot({ path: testInfo.outputPath('workspace-actions-menu-320.png') });
  await testInfo.attach('geometry', {
    body: JSON.stringify({ viewport: page.viewportSize(), menu: box, row }),
    contentType: 'application/json',
  });
});

test('shows every workspace actions menu label untruncated at a normal viewport', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardEditGeometryHost);

  const menu = await openWorkspaceActionsMenu(component, page);
  const box = await expectMenuInsideCollisionPadding(menu, page);
  const row = await settledBoundingBox(menu.getByRole('button').first());
  expect(row.width).toBeGreaterThanOrEqual(MENU_ROW_MIN_WIDTH_PX - 0.5);

  const labels = await collectTruncatedLabels(menu);
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((label) => label.text.length > 0)).toBe(true);
  expect(labels.filter((label) => label.overflow > 0)).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath('workspace-actions-menu-900.png') });
  await testInfo.attach('geometry', {
    body: JSON.stringify({ viewport: page.viewportSize(), menu: box, row, labels }),
    contentType: 'application/json',
  });
});

test('aligns the Open in flyout borders and first rows and preserves keyboard return', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardEditGeometryHost, {
    props: { desktop: true },
    hooksConfig: { mockBackend: {} },
  });
  const root = await openWorkspaceActionsMenu(component, page);
  const rootBox = await settledBoundingBox(root);
  const parent = root.getByRole('menuitem', { name: 'Open in...', exact: true });
  await parent.focus();
  await page.keyboard.press('ArrowRight');

  const editor = page.getByRole('menuitem', { name: 'Open in Visual Studio Code', exact: true });
  await expect(editor).toBeFocused();
  const submenu = page.getByRole('menu').filter({ has: editor });
  const rowBox = await settledBoundingBox(parent);
  const editorBox = await settledBoundingBox(editor);
  const submenuBox = await settledBoundingBox(submenu);
  expect(Math.abs(submenuBox.y - rootBox.y)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(editorBox.y - rowBox.y)).toBeLessThanOrEqual(0.5);
  // Collision handling may flip the flyout to the left; either side stays outside its parent.
  expect(
    submenuBox.x >= rowBox.x + rowBox.width || submenuBox.x + submenuBox.width <= rowBox.x,
  ).toBe(true);
  expect(submenuBox.y + submenuBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  await page.screenshot({ path: testInfo.outputPath('workspace-open-in-top-aligned.png') });
  await testInfo.attach('submenu geometry', {
    body: JSON.stringify({ root: rootBox, parent: rowBox, submenu: submenuBox, editor: editorBox }),
    contentType: 'application/json',
  });
  await page.keyboard.press('ArrowLeft');
  await expect(editor).toHaveCount(0);
  await expect(parent).toBeFocused();
  await expect(root).toBeVisible();
});
