import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    // The shell shows the conversation first (a real Back leaves a shown conversation).
    await expect(page.locator('[data-dock-conversation-back]')).toBeVisible();
    await page.evaluate(() => (window as any).__dockComposerE2E.close());
    await expect.poll(open).toBeNull();
    await expect(page.getByTestId('dock-overview')).toBeVisible();
    // Back returns the keyboard to the row of the conversation just left.
    await expect(page.locator(`[data-dock-row][data-workspace-id="${from}"]`)).toBeFocused();
    backFocus.push(from!);
    // A later focus press (intentional open) moves it to the search.
    await focusRequest();
  };
  const search = page.locator('[data-dock-search]');
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

  // 3. Keyboard: filter, Tab (past Clear) to the row, Tab to its Link, Enter links.
  await page.keyboard.type('workspace 1');
  await expect.poll(order).toEqual(['choice-1']);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
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
  // The short labels against the pill's real font and chrome, every catalog (measured, not
  // rendered): the pill must fit its slot or the label truncates (the aria-label is full).
  const labels: [string, string, string][] = [];
  for (const locale of ['en', 'de', 'es', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW']) {
    const catalog = JSON.parse(
      await readFile(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'),
    );
    for (const key of ['dock_linkedTab_link_label', 'dock_linkedTab_unlink_label'])
      labels.push([locale, key, catalog[key]]);
  }
  const fit = await action('choice-1').evaluate((el, labels) => {
    const label = el.querySelector('[data-slot="button-label"]')!;
    const style = getComputedStyle(label);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const slot = el.closest('[data-dock-row-slot]')!.getBoundingClientRect().width;
    const chrome = el.getBoundingClientRect().width - label.getBoundingClientRect().width;
    return labels.map(([locale, key, text]) => {
      const width = context.measureText(text).width;
      return {
        locale,
        key,
        text,
        pill: Math.ceil(width + chrome),
        slot,
        fits: width + chrome <= slot,
      };
    });
  }, labels);
  expect(fit.filter((row) => !row.fits)).toEqual([]);
  receipts.labelFit = fit;
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
  await page.keyboard.press('Tab');
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

  // 5b. Search edge cases: zero results are announced and Enter opens nothing (never the
  // Assistant); modified arrows stay native; Enter opens the first match; the query survives
  // opening that conversation and coming Back.
  await search.focus();
  await page.keyboard.type('zzz');
  await expect(page.locator('.overview-search [role="status"]')).toHaveText(
    'No matching workspaces',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(search).toBeFocused();
  expect(await open()).toBeNull();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.locator('.overview-search [role="status"]')).toHaveText('');
  await page.keyboard.type('workspace 4');
  await page.keyboard.press('Enter');
  await expect.poll(open).toBe('choice-4');
  await toIndex();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('workspace 4');
  await expect.poll(order).toEqual(['choice-4']);
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  receipts.search = {
    zeroResultsAnnounced: true,
    enterOnZeroOpensNothing: true,
    modifiedArrowNative: true,
    enterOpensFirstMatch: 'choice-4',
    queryKeptAcrossConversation: true,
  };

  // 6. The global "open related" (Ctrl+Shift+A) follows the new link; the source draft stays.
  await page.evaluate((url) => {
    const h = (window as any).__dockComposerE2E;
    h.shortcut({
      id: crypto.randomUUID(),
      backendId: h.store.state.connections.windowBackendId,
      action: 'focus',
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
  // A click the saga refuses (not settled yet) changes nothing and claims nothing: the
  // button still says Unlink, so click it again, as a person would.
  let unlinkClicks = 0;
  await expect(async () => {
    if ((await action(target).getAttribute('data-dock-row-action')) === 'unlink') {
      await row(target).hover();
      await action(target).click();
      unlinkClicks += 1;
    }
    expect((await read())?.linkKey ?? null).toBeNull();
  }).toPass({ intervals: [1000, 2000, 3000], timeout: 20_000 });
  await expect.poll(tagged).toEqual([]);
  receipts.unlink = {
    linkedWorkspaceId: (await read())?.linkedWorkspaceId ?? null,
    clicks: unlinkClicks,
  };

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

  // 12. A full close (outside click collapses the dock) clears the search; the next
  // intentional open starts empty.
  await focusRequest();
  await expect(search).toBeFocused();
  await page.keyboard.type('workspace');
  // eslint-disable-next-line intent/no-unarmed-outside-click-in-ct -- no bits-ui layer: the dock shell's own window pointerdown handler collapses it
  await page.mouse.click(900, 700);
  await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
  await focusRequest();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  receipts.fullClose = { queryCleared: true };

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

/**
 * Follow-up: repository tiles (repo name, no image fetch) with the workspace-avatar fallback,
 * plain-key-only row navigation, held gestures that refuse to complete after the context
 * changes under them, a gesture-less (assistive technology) click, and a narrow index.
 */
test('linked index follow-up: repo tiles, held gestures, modified keys, narrow', async ({
  mount,
  page,
}, info) => {
  test.setTimeout(120_000);
  // GitHub avatar requests fail here (never the network): rows show the repo initial.
  await page.route('https://github.com/**', (route) => route.fulfill({ status: 404, body: '' }));
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
    h.seedChoices(4);
    h.contextReady();
    const collection = h.store.state.workspace.workspaces;
    const rows: any[] = Object.values(collection.map ?? collection.entities ?? collection);
    const base = (id: string) => rows.find((row) => row?.id === id);
    h.seedWorkspace({
      ...base('choice-0'),
      repositoryOwner: 'intent-hq',
      repositoryName: 'cloudlands-fe',
    });
    h.seedWorkspace({
      ...base('choice-1'),
      repositoryOwner: undefined,
      repositoryName: undefined,
      repositoryPath: '/work/scratchpad',
    });
  });
  const receipts: Record<string, unknown> = {};
  const read = () =>
    page.evaluate(() =>
      (window as any).__dockComposerE2E.contextSnapshot(),
    ) as Promise<DockLinkedContextSnapshot | null>;
  let sequence = 0;
  const observe = (version: string, url: string) =>
    page.evaluate(
      ({ version, url, sequence }) => {
        const h = (window as any).__dockComposerE2E;
        h.context({
          sequence,
          contextVersion: version,
          backendId: h.store.state.connections.windowBackendId,
          identityKey: `url:${url}`,
          identityKind: 'url',
          self: false,
          appId: 'com.apple.Safari',
          appName: 'Synthetic Safari',
          url,
          icon: null,
        });
      },
      { version, url, sequence: ++sequence },
    );
  const row = (id: string) =>
    page.locator('.overview-row', { has: page.locator(`[data-workspace-id="${id}"]`) });
  const action = (id: string) => row(id).locator('[data-dock-row-action]');
  const rowButton = (id: string) => row(id).locator('[data-workspace-id]');
  await page.evaluate(() => (window as any).__dockComposerE2E.close());
  await expect(page.getByTestId('dock-overview')).toBeVisible();
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({
      type: 'hud/dockFocusRequested',
      payload: [],
    }),
  );
  await expect(page.locator('[data-dock-search]')).toBeFocused();

  // 1. Repository tiles: initials from the repo name, no image request; no repo → fallback.
  await expect(
    row('choice-0').locator('[data-dock-repo-avatar="intent-hq/cloudlands-fe"]'),
  ).toHaveText('C');
  await expect(row('choice-1').locator('[data-dock-repo-avatar="scratchpad"]')).toHaveText('S');
  await expect(row('choice-2').locator('[data-dock-repo-avatar]')).toHaveCount(0);
  await expect(page.locator('[data-dock-repo-avatar] img')).toHaveCount(0);
  const tile = await row('choice-0')
    .locator('[data-dock-repo-avatar] > *')
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.width, height: style.height, radius: style.borderRadius };
    });
  expect(tile).toEqual({ width: '32px', height: '32px', radius: '9px' });
  await page.screenshot({ path: info.outputPath('07-repo-tiles-and-fallback.png') });
  receipts.repoTiles = {
    'choice-0': 'intent-hq/cloudlands-fe → C',
    'choice-1': 'repositoryPath scratchpad → S',
    'choice-2': 'no repository → workspace avatar',
    images: 0,
    tile,
  };

  // 2. Modified arrow / Home / End on a row stay native; plain keys still move.
  await page.keyboard.press('Tab');
  const first = page.locator('[data-dock-row]:focus');
  const firstId = await first.getAttribute('data-workspace-id');
  for (const key of ['Alt+ArrowDown', 'Shift+ArrowDown', 'Meta+End', 'Control+Home']) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-workspace-id')),
    ).toBe(firstId);
  }
  await page.keyboard.press('ArrowDown');
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('data-workspace-id')),
  ).not.toBe(firstId);
  receipts.modifiedRowKeys = {
    native: ['Alt+ArrowDown', 'Shift+ArrowDown', 'Meta+End', 'Control+Home'],
    plainMoves: true,
  };

  // 3. Held pointer gesture: press Link, the context changes, release → nothing is saved.
  await observe('v1', 'https://github.com/example/one/issues/1');
  await expect.poll(() => read().then((s) => s?.contextVersion ?? '')).toContain('v1');
  await row('choice-1').hover();
  const box = (await action('choice-1').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await observe('v2', 'https://github.com/example/two/issues/2');
  await expect.poll(() => read().then((s) => s?.contextVersion ?? '')).toContain('v2');
  await page.mouse.up();
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a cancelled gesture must not save anything afterwards
  await page.waitForTimeout(600);
  expect((await read())?.linkKey ?? null).toBeNull();
  expect((await read())?.linkedWorkspaceId ?? null).toBeNull();

  // 4. Held keyboard gesture: Space down on Link, the context changes, Space up → nothing.
  await rowButton('choice-1').focus();
  await page.keyboard.press('Tab');
  await expect(action('choice-1')).toBeFocused();
  await page.keyboard.down(' ');
  await observe('v3', 'https://github.com/example/three/issues/3');
  await expect.poll(() => read().then((s) => s?.contextVersion ?? '')).toContain('v3');
  await page.keyboard.up(' ');
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a cancelled gesture must not save anything afterwards
  await page.waitForTimeout(600);
  expect((await read())?.linkKey ?? null).toBeNull();
  receipts.heldGesture = { pointerCancelled: true, keyboardCancelled: true };

  // 5. Controls: an undisturbed Enter links; a gesture-less click (assistive tech) relinks.
  await expect(action('choice-1')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe('choice-1');
  await action('choice-2').evaluate((el) => (el as HTMLElement).click());
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe('choice-2');
  receipts.controls = { keyboardLink: 'choice-1', assistiveClickRelink: 'choice-2' };

  // 6. Narrow index (overview constrained to 260px): the fixed slot keeps its width, the
  // action stays inside it, titles truncate before it, Unlink still fits.
  await page.locator('[data-testid="dock-overview"]').evaluate((el) => {
    (el as HTMLElement).style.width = '260px';
    (el as HTMLElement).style.maxWidth = '260px';
  });
  await row('choice-2').hover();
  await expect(action('choice-2')).toHaveAttribute('data-dock-row-action', 'unlink');
  const narrow = await row('choice-2').evaluate((el) => {
    const r = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
    const slot = r('[data-dock-row-slot]');
    const copy = r('.row-copy');
    const pill = r('[data-dock-row-action]');
    const label = el.querySelector('[data-dock-row-action] [data-slot="button-label"]')!;
    return {
      rowWidth: Math.round(el.getBoundingClientRect().width),
      slotWidth: Math.round(slot.width),
      pillInside: pill.left >= slot.left - 0.5 && pill.right <= slot.right + 0.5,
      titleBeforeSlot: copy.right <= slot.left + 0.5,
      labelClipped: label.scrollWidth > label.clientWidth,
    };
  });
  expect(narrow).toMatchObject({
    slotWidth: 72,
    pillInside: true,
    titleBeforeSlot: true,
    labelClipped: false,
  });
  await page.screenshot({ path: info.outputPath('08-narrow-260.png') });
  receipts.narrow = {
    ...narrow,
    note: 'overview width constrained in the page; the shell fixture width is fixed',
  };

  await writeFile(
    info.outputPath('linked-index-followup-receipt.json'),
    JSON.stringify(receipts, null, 2),
  );
});

/**
 * Command-palette index: the search keeps the keyboard while one workspace is the active
 * result (first by default; plain Up/Down move it; Enter opens it), it survives link and list
 * updates while still shown, and falls back when removed; zero matches have none. GitHub
 * owners get their avatar image (github.com requests are served locally here), with the repo
 * initial on failure and no request for non-GitHub owners. The search has no surface.
 */
test('linked index palette: active result, GitHub avatars, plain search', async ({
  mount,
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1000, height: 740 });
  const avatarRequests: string[] = [];
  const png = await readFile(
    join(process.cwd(), 'src/assets/icons/Icon-iOS-ClearDark-128x128@1x.png'),
  );
  await page.route('https://github.com/**', async (route) => {
    const url = route.request().url();
    avatarRequests.push(new URL(url).pathname);
    if (url.includes('/missing-owner.png')) await route.fulfill({ status: 404, body: 'not found' });
    else await route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.dockConversation.loading),
    )
    .toBe(false);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.seedChoices(6);
    h.contextReady();
    const collection = h.store.state.workspace.workspaces;
    const rows: any[] = Object.values(collection.map ?? collection.entities ?? collection);
    const base = (id: string) => rows.find((row) => row?.id === id);
    const repo = (id: string, owner: string | undefined, name: string | undefined, path?: string) =>
      h.seedWorkspace({
        ...base(id),
        repositoryOwner: owner,
        repositoryName: name,
        repositoryPath: path,
      });
    repo('choice-0', 'tracecomputing', 'trace');
    repo('choice-1', 'intent-hq', 'intent');
    repo('choice-2', 'missing-owner', 'gone');
    repo('choice-3', 'group/sub', 'nested');
    repo('choice-4', undefined, undefined, '/work/scratchpad');
  });
  const receipts: Record<string, unknown> = {};
  const open = () =>
    page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.dockConversation.workspaceId,
    ) as Promise<string | null>;
  const focusRequest = () =>
    page.evaluate(() =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'hud/dockFocusRequested',
        payload: [],
      }),
    );
  const search = page.getByRole('combobox');
  const row = (id: string) =>
    page.locator('.overview-row', { has: page.locator(`[data-workspace-id="${id}"]`) });
  const order = () =>
    page.$$eval('[role="grid"] [role="row"] [data-workspace-id]', (els) =>
      els.map((el) => el.getAttribute('data-workspace-id')!),
    );
  // The active result as the search reports it, and as the rows show it.
  const activeState = () =>
    page.evaluate(() => {
      const input = document.querySelector('[data-dock-search]') as HTMLInputElement;
      const ref = input.getAttribute('aria-activedescendant');
      const row = ref ? document.getElementById(ref) : null;
      const selected = Array.from(document.querySelectorAll('[role="row"][aria-selected="true"]'));
      const shown = Array.from(document.querySelectorAll('.overview-row[data-active="true"]'));
      const id = (el: Element | null) =>
        el?.querySelector('[data-workspace-id]')?.getAttribute('data-workspace-id') ?? null;
      return {
        focused: document.activeElement === input,
        active: id(row),
        selected: selected.map(id),
        highlighted: shown.map(id),
      };
    });
  await page.evaluate(() => (window as any).__dockComposerE2E.close());
  await expect(page.getByTestId('dock-overview')).toBeVisible();
  await focusRequest();
  await expect(search).toBeFocused();

  // 1. Avatars: GitHub owners load their image; a failing one falls back to the repo
  // initial; nested-group and path-only repos never request one.
  await expect
    .poll(() =>
      row('choice-0')
        .locator('img.repo-avatar-img')
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(row('choice-1').locator('img.repo-avatar-img')).toBeVisible();
  await expect(row('choice-2').locator('[data-dock-repo-avatar]')).toHaveText('G');
  await expect(row('choice-3').locator('[data-dock-repo-avatar]')).toHaveText('N');
  await expect(row('choice-4').locator('[data-dock-repo-avatar]')).toHaveText('S');
  await expect(row('choice-5').locator('[data-dock-repo-avatar]')).toHaveCount(0);
  const requested = [...new Set(avatarRequests)].sort();
  expect(requested).toEqual(['/intent-hq.png', '/missing-owner.png', '/tracecomputing.png']);
  receipts.avatars = {
    requested,
    loaded: ['choice-0 tracecomputing', 'choice-1 intent-hq'],
    fallback: {
      'choice-2 missing-owner (404)': 'G',
      'choice-3 group/sub': 'N (no request)',
      'choice-4 path': 'S (no request)',
      'choice-5': 'workspace avatar',
    },
    imageSource: 'github.com requests fulfilled locally with the app icon PNG',
  };

  // 2. Plain search: no surface, body-size text, 32px field.
  const style = await page.evaluate(() => {
    const box = document.querySelector('.overview-search') as HTMLElement;
    const input = document.querySelector('[data-dock-search]') as HTMLElement;
    const title = document.querySelector('.overview-row .row-copy .type-body') as HTMLElement;
    const b = getComputedStyle(box);
    const i = getComputedStyle(input);
    return {
      wrapperBackground: b.backgroundColor,
      wrapperShadow: b.boxShadow,
      inputBackground: i.backgroundColor,
      inputBorder: i.borderTopWidth,
      inputShadow: i.boxShadow,
      inputOutline: i.outlineStyle,
      inputFont: i.fontSize,
      bodyFont: getComputedStyle(title).fontSize,
      height: Math.round(box.getBoundingClientRect().height),
    };
  });
  expect(style).toMatchObject({
    wrapperBackground: 'rgba(0, 0, 0, 0)',
    wrapperShadow: 'none',
    inputBackground: 'rgba(0, 0, 0, 0)',
    inputBorder: '0px',
    inputShadow: 'none',
    inputOutline: 'none',
    height: 32,
  });
  expect(style.inputFont).toBe(style.bodyFont);
  receipts.search = style;

  // 3. Blank query: the first row is already active; Down/Up move it; Up clamps; focus stays.
  const initial = await order();
  expect(await activeState()).toEqual({
    focused: true,
    active: initial[0],
    selected: [initial[0]],
    highlighted: [initial[0]],
  });
  await page.keyboard.press('ArrowDown');
  expect((await activeState()).active).toBe(initial[1]);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await activeState()).toMatchObject({ focused: true, active: initial[0] });

  // 4. Typing resets to the first match; Down picks the second while the caret stays.
  await page.keyboard.type('synthetic');
  const matches = await order();
  expect((await activeState()).active).toBe(matches[0]);
  await page.keyboard.press('ArrowDown');
  const chosen = matches[1]!;
  expect(await activeState()).toMatchObject({
    focused: true,
    active: chosen,
    highlighted: [chosen],
  });
  await page.screenshot({ path: info.outputPath('09-palette-active-while-typing.png') });

  // 5. A link/context update and a reorder keep the active workspace while it is shown.
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.context({
      sequence: 1,
      contextVersion: 'p1',
      backendId: h.store.state.connections.windowBackendId,
      identityKey: 'url:https://github.com/example/palette/issues/1',
      identityKind: 'url',
      self: false,
      appId: 'com.apple.Safari',
      appName: 'Synthetic Safari',
      url: 'https://github.com/example/palette/issues/1',
      icon: null,
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__dockComposerE2E.contextSnapshot()?.url))
    .toBe('https://github.com/example/palette/issues/1');
  await page.evaluate(() => (window as any).__dockComposerE2E.contextAction('link', 'choice-5'));
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.contextSnapshot()?.linkedWorkspaceId),
    )
    .toBe('choice-5');
  expect((await activeState()).active).toBe(chosen);
  // A row above the active one leaves: the active workspace moves up and stays active.
  const above = matches[0]!;
  await page.evaluate((id) => (window as any).__dockComposerE2E.archiveWorkspace(id), above);
  await expect(row(above)).toHaveCount(0);
  const reordered = await order();
  expect(reordered.indexOf(chosen)).toBe(matches.indexOf(chosen) - 1);
  expect(await activeState()).toMatchObject({ focused: true, active: chosen });
  receipts.keep = {
    chosen,
    orderBefore: matches,
    orderAfter: reordered,
    linkedDuringSearch: 'choice-5',
  };

  // 6. Removal: the active workspace is archived → the first shown match becomes active.
  await page.evaluate((id) => (window as any).__dockComposerE2E.archiveWorkspace(id), chosen);
  await expect(row(chosen)).toHaveCount(0);
  const afterRemoval = await order();
  expect(await activeState()).toMatchObject({ focused: true, active: afterRemoval[0] });
  receipts.removal = { removed: chosen, nowActive: afterRemoval[0] };

  // 7. Enter opens the active result; Back returns focus to that row (one highlight: the
  // row's focus, no palette highlight); the next focus press makes it the active result.
  const target = afterRemoval[0]!;
  await page.keyboard.press('Enter');
  await expect.poll(open).toBe(target);
  await expect(page.locator('[data-dock-conversation-back]')).toBeVisible();
  await page.evaluate(() => (window as any).__dockComposerE2E.close());
  await expect(page.locator(`[data-dock-row][data-workspace-id="${target}"]`)).toBeFocused();
  expect((await activeState()).highlighted).toEqual([]);
  await focusRequest();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('synthetic');
  expect(await activeState()).toMatchObject({
    focused: true,
    active: target,
    highlighted: [target],
  });
  receipts.enter = {
    opened: target,
    backFocusedRow: true,
    highlightsAfterBack: 0,
    activeAfterRefocus: target,
  };

  // 8. Zero matches: nothing active, Enter does nothing.
  await page.keyboard.type('zzz');
  expect(await activeState()).toEqual({
    focused: true,
    active: null,
    selected: [],
    highlighted: [],
  });
  await page.keyboard.press('Enter');
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: Enter with no result must not open anything
  await page.waitForTimeout(400);
  expect(await open()).toBeNull();
  receipts.zero = { active: null, enterOpened: null };

  // 9. Editing stays native: composition and modified arrows leave the active result; Home
  // moves the caret.
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  const start = (await activeState()).active;
  await search.evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  expect((await activeState()).active).toBe(start);
  await page.keyboard.type('syn');
  const typed = (await activeState()).active;
  expect(typed).toBeTruthy();
  await page.keyboard.press('Home');
  expect(await search.evaluate((el) => (el as HTMLInputElement).selectionStart)).toBe(0);
  expect((await activeState()).active).toBe(typed);
  await page.keyboard.press('Escape');
  receipts.editing = { imeKeydownIgnored: true, modifiedArrowsIgnored: true, homeMovesCaret: true };

  // 10. Tab reaches the active row and its Link; focusing a row makes it the active one.
  await page.keyboard.press('Tab');
  const focusedRow = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-workspace-id'),
  );
  expect(focusedRow).toBeTruthy();
  await page.keyboard.press('Tab');
  await expect(row(focusedRow!).locator('[data-dock-row-action]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowDown');
  const moved = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-workspace-id'),
  );
  await search.focus();
  await expect(search).toBeFocused();
  expect((await activeState()).active).toBe(moved);
  receipts.tab = { rowThenLink: focusedRow, rowFocusSyncsActive: moved };

  await writeFile(
    info.outputPath('linked-index-palette-receipt.json'),
    JSON.stringify(receipts, null, 2),
  );
});

/**
 * Layout: the search text starts where the workspace titles start, and the list's scroll
 * viewport reaches the dock's inner right edge (its scrollbar at the edge) while the rows keep
 * their inset; normal and narrow frames.
 */
test('linked index layout: search text lines up, scrollbar at the edge', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1000, height: 740 });
  await page.route('https://github.com/**', (route) => route.fulfill({ status: 404, body: '' }));
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
    h.close();
    h.store.dispatch({ type: 'hud/dockFocusRequested', payload: [] });
  });
  await expect(page.locator('[data-dock-search]')).toBeFocused();
  await page.keyboard.type('syn');
  const measure = () =>
    page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const input = document.querySelector('[data-dock-search]') as HTMLInputElement;
      const rows = document.querySelector(
        '[data-testid="dock-overview"] [data-dock-scroll]',
      ) as HTMLElement;
      const frame = box('.overview-frame');
      const titles = Array.from(document.querySelectorAll('.overview-row .row-copy')).map(
        (el) => el.getBoundingClientRect().left,
      );
      const firstRow = box('.overview-row[role="row"]');
      const inputStyle = getComputedStyle(input);
      return {
        textLeft: input.getBoundingClientRect().left + parseFloat(inputStyle.paddingLeft),
        titleLefts: [...new Set(titles.map((x) => Math.round(x * 10) / 10))],
        viewportRight: rows.getBoundingClientRect().right,
        frameRight: frame.right,
        rowRight: firstRow.right,
        scrollbar: rows.offsetWidth - rows.clientWidth,
        scrolls: rows.scrollHeight > rows.clientHeight,
        horizontalOverflow: rows.scrollWidth > rows.clientWidth,
      };
    });
  const check = (m: Awaited<ReturnType<typeof measure>>) => {
    expect(m.titleLefts).toHaveLength(1);
    expect(Math.abs(m.textLeft - m.titleLefts[0]!)).toBeLessThan(0.5);
    expect(Math.abs(m.viewportRight - m.frameRight)).toBeLessThan(0.5);
    // Rows keep the 12px gutter inside the viewport (beside a classic scrollbar, if any).
    expect(Math.abs(m.viewportRight - 12 - m.scrollbar - m.rowRight)).toBeLessThan(0.5);
    expect(m.horizontalOverflow).toBe(false);
  };
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  const normal = await measure();
  expect(normal.scrolls).toBe(true);
  check(normal);
  await page.screenshot({ path: info.outputPath('14-layout-normal.png') });
  await page.locator('.overview-frame').evaluate((el) => {
    (el as HTMLElement).style.right = 'auto';
    (el as HTMLElement).style.width = '300px';
  });
  const narrow = await measure();
  check(narrow);
  await page.screenshot({ path: info.outputPath('15-layout-narrow-300.png') });
  await writeFile(
    info.outputPath('linked-index-layout-receipt.json'),
    JSON.stringify(
      { normal, narrow, narrowNote: 'frame constrained to 300px in the page' },
      null,
      2,
    ),
  );
});
