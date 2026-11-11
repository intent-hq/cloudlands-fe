import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import type { DockLinkedContextSnapshot } from '$shared/dock-context-links';

type Box = { x: number; y: number; width: number; height: number };

/** Rects of every index row's title and time slot plus the scroller, to prove nothing moves. */
function layout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const overview = document.querySelector('[data-testid="dock-overview"]');
    return {
      overview: box(overview),
      rows: Array.from(document.querySelectorAll('.overview-row')).map((row) => ({
        id: row.querySelector('[data-workspace-id]')?.getAttribute('data-workspace-id') ?? null,
        title: box(row.querySelector('.row-copy')),
        slot: box(row.querySelector('[data-dock-row-slot]')),
      })),
    };
  });
}

/**
 * The linked index in the real notch shell (Svelte components, store, context-links saga):
 * search, arrow keys, link / relink / unlink by keyboard and pointer, the global "open
 * related" route, stale and other-machine contexts, an archived target and an app context.
 * The foreground feed is the harness's synthetic DOCK_CONTEXT observation (what main sends).
 */
test('linked index: search, keys, link and unlink keep the layout still', async ({
  mount,
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.dockConversation.loading),
    )
    .toBe(false);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.seedChoices(8);
    h.contextReady();
  });
  const receipts: Record<string, unknown> = {};
  const read = () =>
    page.evaluate(() =>
      (window as any).__dockComposerE2E.contextSnapshot(),
    ) as Promise<DockLinkedContextSnapshot | null>;
  const open = () =>
    page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.dockConversation.workspaceId,
    ) as Promise<string | null>;
  const origin = (await open())!;
  const draftLength = (workspaceId: string) =>
    page.evaluate((id) => {
      const map = (window as any).__dockComposerE2E.store.state.dockConversation.drafts?.map ?? {};
      const entry = Object.entries(map).find(([key]) => JSON.parse(key)[0] === id);
      return ((entry?.[1] as { text?: string } | undefined)?.text ?? '').length;
    }, workspaceId);
  const DRAFT = 'Keep this draft';
  await page.locator('.tiptap-editor').first().click();
  await page.keyboard.type(DRAFT);
  await expect.poll(() => draftLength(origin)).toBe(DRAFT.length);

  let sequence = 0;
  const observe = (
    version: string,
    target: { url: string } | { app: string; name: string },
    backend?: string,
  ) =>
    page.evaluate(
      ({ version, target, sequence, backend }) => {
        const h = (window as any).__dockComposerE2E;
        const app = 'app' in target;
        h.context({
          sequence,
          contextVersion: version,
          backendId: backend ?? h.store.state.connections.windowBackendId,
          identityKey: app ? `app:${target.app}` : `url:${target.url}`,
          identityKind: app ? 'app' : 'url',
          self: false,
          appId: app ? target.app : 'com.apple.Safari',
          appName: app ? target.name : 'Synthetic Safari',
          url: app ? null : target.url,
          icon: null,
        });
      },
      { version, target, sequence: ++sequence, backend },
    );
  const focusRequest = () =>
    page.evaluate(() =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'hud/dockFocusRequested',
        payload: [],
      }),
    );
  const backFocus: string[] = [];
  const toIndex = async () => {
    const from = await open();
    await page.evaluate(() => (window as any).__dockComposerE2E.close());
    await expect.poll(open).toBeNull();
    await expect(page.getByTestId('dock-overview')).toBeVisible();
    // Back returns the keyboard to the row of the conversation just left.
    await expect(page.locator(`[data-dock-row][data-workspace-id="${from}"]`)).toBeFocused();
    backFocus.push(from!);
    // A later focus press (intentional open) moves it to the search.
    await focusRequest();
  };
  const search = page.getByRole('searchbox');
  const row = (id: string) =>
    page.locator('.overview-row', { has: page.locator(`[data-workspace-id="${id}"]`) });
  const action = (id: string) => row(id).locator('[data-dock-row-action]');
  const order = () =>
    page.$$eval('.overview-row [data-workspace-id]', (els) =>
      els
        .map((el) => el.getAttribute('data-workspace-id'))
        // The Assistant entry is always in view below the list, also while searching.
        .filter((id) => id !== 'dock:assistant'),
    );
  // The visible short label fits its pill (the full name is the aria-label).
  const clipped = (id: string) =>
    action(id)
      .locator('[data-slot="button-label"]')
      .evaluate((el) => el.scrollWidth > el.clientWidth);
  const tagged = () =>
    page.$$eval('.overview-row', (rows) =>
      rows
        .filter((row) => row.querySelector('[data-dock-linked-tag]'))
        .map((row) => row.querySelector('[data-workspace-id]')?.getAttribute('data-workspace-id')),
    );

  // 1. An intentional open (focus request) of the index focuses the search; no context yet,
  // so no header label and no link controls (unknown context).
  await toIndex();
  await expect(search).toBeFocused();
  await expect(page.locator('[data-dock-context-label]')).toHaveCount(0);
  await expect(page.locator('[data-dock-row-action]')).toHaveCount(0);
  const initialOrder = await order();
  await page.screenshot({ path: info.outputPath('01-index-open-search-focused.png') });
  receipts.open = {
    backFocusedSourceRow: true,
    searchFocused: true,
    contextLabel: false,
    actions: 0,
    rows: initialOrder.length,
  };

  // 2. A tab context arrives (passive): the header names it, focus stays in the search.
  const A = 'https://github.com/example/linked/issues/1';
  await observe('v1', { url: A });
  await expect.poll(() => read().then((s) => s?.url)).toBe(A);
  const label = page.locator('[data-dock-context-label]');
  await expect(label).toBeVisible();
  await expect(search).toBeFocused();
  receipts.context = { label: await label.getAttribute('aria-label'), searchStillFocused: true };

  // 3. Keyboard: filter, ArrowDown to the row, Tab to its Link, Enter links (state-confirmed).
  await page.keyboard.type('workspace 1');
  await expect.poll(order).toEqual(['choice-1']);
  await page.keyboard.press('ArrowDown');
  await expect(row('choice-1').locator('[data-workspace-id]')).toBeFocused();
  const beforeKeys = await layout(page);
  await page.keyboard.press('Tab');
  await expect(action('choice-1')).toBeFocused();
  await expect(action('choice-1')).toHaveAttribute('data-dock-row-action', 'link');
  expect(await clipped('choice-1')).toBe(false);
  await expect(action('choice-1')).toHaveAttribute('aria-label', /Synthetic workspace 1/);
  const actionBox = (await action('choice-1').boundingBox()) as Box;
  const slotBox = (await row('choice-1').locator('[data-dock-row-slot]').boundingBox()) as Box;
  const titleBox = (await row('choice-1').locator('.row-copy').boundingBox()) as Box;
  // The action stays inside the reserved time cell and never covers the title.
  expect(actionBox.x).toBeGreaterThanOrEqual(slotBox.x - 0.5);
  expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(slotBox.x + slotBox.width + 0.5);
  expect(actionBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
  expect(await layout(page)).toEqual(beforeKeys);
  await page.screenshot({ path: info.outputPath('02-keyboard-link-focused.png') });
  await page.keyboard.press('Enter');
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe('choice-1');
  await expect.poll(tagged).toEqual(['choice-1']);
  // The same button now unlinks and keeps keyboard focus; the search text survives.
  await expect(action('choice-1')).toHaveAttribute('data-dock-row-action', 'unlink');
  expect(await clipped('choice-1')).toBe(false);
  await expect(action('choice-1')).toBeFocused();
  await expect(search).toHaveValue('workspace 1');
  expect(await layout(page)).toEqual(beforeKeys);
  await page.screenshot({ path: info.outputPath('03-keyboard-linked.png') });
  receipts.keyboardLink = {
    linked: 'choice-1',
    focusKept: true,
    queryKept: true,
    actionInsideSlot: { actionBox, slotBox },
  };

  // 4. Back to the search (Shift+Tab, ArrowUp from the first row), Escape clears it and the
  // index stays open; Home/End move through the full list.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.getByTestId('dock-overview')).toBeVisible();
  await expect.poll(order).toEqual(initialOrder);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  const endReached = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('[data-testid="dock-overview"] [data-dock-row]'),
    );
    return rows.length > 0 && document.activeElement === rows[rows.length - 1];
  });
  expect(endReached).toBe(true);
  await page.keyboard.press('Home');
  await expect(row(initialOrder[0]!).locator('[data-workspace-id]')).toBeFocused();
  receipts.keys = { escapeClearedFirst: true, indexStillOpen: true, endReached };

  // 5. Pointer relink from a scrolled list: hover reveals Link on another row in place,
  // a click relinks, the order, scroll and layout are unchanged.
  const scroller = page.locator('[data-testid="dock-overview"] [data-dock-scroll]');
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const target = initialOrder.includes('choice-6') ? 'choice-6' : 'choice-2';
  await row(target).scrollIntoViewIfNeeded();
  const scrollTop = await scroller.evaluate((el) => el.scrollTop);
  const beforeHover = await layout(page);
  await row(target).hover();
  await expect(action(target)).toBeVisible();
  await expect(action(target)).toHaveCSS('opacity', '1');
  expect(await layout(page)).toEqual(beforeHover);
  await page.screenshot({ path: info.outputPath('04-hover-link.png') });
  await action(target).click();
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe(target);
  await expect.poll(tagged).toEqual([target]);
  expect(await order()).toEqual(initialOrder);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(scrollTop);
  expect(await layout(page)).toEqual(beforeHover);
  receipts.pointerRelink = { from: 'choice-1', to: target, scrollKept: true, orderKept: true };

  // 6. The global "open related" (Ctrl+Shift+A) follows the new link; the source draft stays.
  await page.evaluate((url) => {
    const h = (window as any).__dockComposerE2E;
    h.shortcut({
      id: crypto.randomUUID(),
      backendId: h.store.state.connections.windowBackendId,
      action: 'related',
      url,
      identityKey: `url:${url}`,
      contextVersion: 'v1',
    });
  }, A);
  await expect.poll(open).toBe(target);
  expect(await draftLength(origin)).toBe(DRAFT.length);
  receipts.relatedRoute = { open: target, sourceDraftKept: true };

  // 7. Unlink by pointer; the tag goes and the row shows its time again.
  await toIndex();
  await expect(search).toBeFocused();
  await row(target).hover();
  await expect(action(target)).toHaveAttribute('data-dock-row-action', 'unlink');
  await action(target).click();
  await expect.poll(() => read().then((s) => s?.linkKey ?? null)).toBeNull();
  await expect.poll(tagged).toEqual([]);
  receipts.unlink = { linkedWorkspaceId: (await read())?.linkedWorkspaceId ?? null };

  // 8. A stale version and another machine's context change nothing.
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.contextAction('link', 'choice-0', 'v-older'),
  );
  await observe('v-other', { url: 'https://example.com/elsewhere' }, 'another-machine');
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a stale or foreign context must not link or replace anything
  await page.waitForTimeout(600);
  const afterStale = await read();
  expect(afterStale?.url).toBe(A);
  expect(afterStale?.linkKey ?? null).toBeNull();
  await expect.poll(tagged).toEqual([]);
  receipts.stale = { url: afterStale?.url, linkKey: afterStale?.linkKey ?? null };

  // 9. Archived target: link to choice-0, archive it; its row and tag leave the index and
  // the other rows keep their places.
  await page.evaluate(() => (window as any).__dockComposerE2E.contextAction('link', 'choice-0'));
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe('choice-0');
  await page.evaluate(() => (window as any).__dockComposerE2E.archiveWorkspace('choice-0'));
  await expect(row('choice-0')).toHaveCount(0);
  await expect.poll(tagged).toEqual([]);
  expect(await order()).toEqual(initialOrder.filter((id) => id !== 'choice-0'));
  receipts.archived = {
    rowGone: true,
    snapshotLinkedWorkspaceId: (await read())?.linkedWorkspaceId ?? null,
  };

  // 10. An app context: the header names the app, Link reads the app, the tag says "This app".
  await observe('v2', { app: 'com.figma.Desktop', name: 'Figma' });
  await expect.poll(() => read().then((s) => s?.identityKind)).toBe('app');
  await expect(label).toContainText('Figma');
  await row('choice-3').hover();
  await action('choice-3').click();
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe('choice-3');
  await expect(row('choice-3').locator('[data-dock-linked-tag]')).toContainText('This app');
  await page.mouse.move(5, 735);
  await page.screenshot({ path: info.outputPath('05-app-linked-dark.png') });

  // 11. Light theme: same layout, legible.
  const darkLayout = await layout(page);
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  });
  expect(await layout(page)).toEqual(darkLayout);
  await page.screenshot({ path: info.outputPath('06-app-linked-light.png') });
  receipts.app = { label: 'Figma', tag: 'This app', themeLayoutEqual: true };

  await writeFile(
    info.outputPath('linked-index-receipt.json'),
    JSON.stringify(
      {
        ...receipts,
        backFocus,
        scope:
          'Real notch shell, index, store and context-links saga in the component harness; synthetic DOCK_CONTEXT observations and FOCUS_DOCK contexts (what main sends). No OS key delivery, native sampling or daemon persistence.',
      },
      null,
      2,
    ),
  );
});
