import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

/**
 * Follow-up: repository tiles (repo name, no image fetch) with the workspace-avatar fallback,
 * plain-key-only row navigation, held gestures that refuse to complete after the context
 * changes under them, a gesture-less (assistive technology) click, and a narrow index.
 */
test('linked index follow-up: repo tiles and modified row keys', async ({ mount, page }, info) => {
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
  const row = (id: string) =>
    page.locator('.overview-row', { has: page.locator(`[data-workspace-id="${id}"]`) });
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

  // 10. Tab reaches the rows (one stop each, no Link in the list); focusing a row makes it
  // the active one.
  await page.keyboard.press('Tab');
  const focusedRow = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-workspace-id'),
  );
  expect(focusedRow).toBeTruthy();
  await expect(
    page.locator('.overview-row [data-dock-row-action], [data-dock-linked-tag]'),
  ).toHaveCount(0);
  await page.keyboard.press('Tab');
  const moved = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-workspace-id'),
  );
  expect(moved).toBeTruthy();
  expect(moved).not.toBe(focusedRow);
  await search.focus();
  await expect(search).toBeFocused();
  expect((await activeState()).active).toBe(moved);
  receipts.tab = { firstRow: focusedRow, nextTabStop: moved, rowFocusSyncsActive: moved };

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
      const firstTime = box('.overview-row[role="row"] .row-time');
      const inputStyle = getComputedStyle(input);
      return {
        textLeft: input.getBoundingClientRect().left + parseFloat(inputStyle.paddingLeft),
        titleLefts: [...new Set(titles.map((x) => Math.round(x * 10) / 10))],
        viewportRight: rows.getBoundingClientRect().right,
        frameRight: frame.right,
        rowRight: firstRow.right,
        timeInset: firstRow.right - firstTime.right,
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
    // The timestamp keeps a 6px inset inside the row's highlight.
    expect(Math.abs(m.timeInset - 6)).toBeLessThan(0.5);
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
