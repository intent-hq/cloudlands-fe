import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../test/ct-test';
import Harness from './home-set-aside-harness.svelte';

type HookArgs = Parameters<Parameters<typeof test.beforeEach>[1]>;
type Page = HookArgs[0]['page'];
type TestInfo = HookArgs[1];
const artifacts = resolve(process.cwd(), '.demo-artifacts/home-set-aside');
const rerun =
  'CT_PORT=7544 corepack pnpm run test:ct -- src/features/home/home-set-aside.ct.spec.ts --workers=1';

const row = (page: Page, id: string) => page.locator(`[data-home-workspace="${id}"]`);
const shelf = (page: Page) => page.locator('[data-home-set-aside-toggle]');
const snapshot = (page: Page) => page.evaluate(() => window.__homeSetAside!.snapshot());
const errors = new WeakMap<Page, string[]>();

async function aside(page: Page, id: string) {
  await row(page, id).hover();
  await page.locator(`[data-home-set-aside-action="${id}"]`).click();
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain(id);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await mkdir(artifacts, { recursive: true });
  const path = resolve(artifacts, `${name}.png`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => {
          const effect = animation.effect;
          if (!effect || effect.getComputedTiming().iterations === Infinity) return false;
          return !(
            effect instanceof KeyframeEffect &&
            effect.target instanceof Element &&
            effect.target.closest('[data-sonner-toast]')
          );
        })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.use({ video: 'retain-on-failure' });

test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
});

test.afterEach(async ({ page }, testInfo) => {
  const state = await page.evaluate(() => window.__homeSetAside?.snapshot());
  await mkdir(artifacts, { recursive: true });
  const report = {
    test: testInfo.title,
    status: testInfo.status,
    rerun,
    scope:
      'Real Home list, board, menus, chat, and production Home persistence/reactivation sagas. Daemon data enters through renderer action fixtures; native Electron and live background jobs are outside this browser flow.',
    state,
    pageErrors: errors.get(page),
  };
  const name = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const path = resolve(artifacts, `${name}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach('home-set-aside-evidence', { path, contentType: 'application/json' });
  expect(errors.get(page)).toEqual([]);
});

test('List supports set aside, Undo, search and Bring back', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await mount(Harness, { props: { height: 800 } });
  await expect(row(page, 'aside-idle')).toBeVisible();
  await row(page, 'aside-idle').hover();
  await capture(page, testInfo, 'before-light');
  await aside(page, 'aside-idle');
  await expect(row(page, 'aside-idle')).toHaveCount(0);
  await expect(shelf(page)).toHaveAttribute('aria-expanded', 'false');
  await page.mouse.move(1190, 790);
  await capture(page, testInfo, 'after-light');
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(row(page, 'aside-idle')).toBeVisible();
  await aside(page, 'aside-idle');
  await page.getByRole('searchbox').fill('keyboard');
  await expect(row(page, 'aside-idle')).toBeVisible();
  await page.locator('[data-home-set-aside-action="aside-idle"]').click();
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
});

test('Board keeps background work running and returns a new question', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await mount(Harness, { props: { view: 'board', height: 800 } });
  const asideColumn = page.locator('[data-home-board] [data-home-set-aside]');
  await expect(asideColumn).toBeVisible();
  await expect(asideColumn.locator('[data-home-workspace]')).toHaveCount(0);
  await row(page, 'aside-running').hover();
  await capture(page, testInfo, 'before-dark-board');
  const before = (await snapshot(page)).workspaces.find((item) => item.id === 'aside-running');
  await aside(page, 'aside-running');
  await expect(asideColumn.locator('[data-home-workspace="aside-running"]')).toBeVisible();
  await page.mouse.move(1190, 790);
  await capture(page, testInfo, 'after-dark-board');
  expect((await snapshot(page)).workspaces.find((item) => item.id === 'aside-running')).toEqual(
    before,
  );
  await page.evaluate(() =>
    window.__homeSetAside!.update('aside-running', {
      displayStatus: 'complete',
      activity: 'idle',
      attention: 'unread',
      statusMessage: 'A background turn finished.',
    }),
  );
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-running');
  await page.evaluate(() =>
    window.__homeSetAside!.update('aside-running', { displayStatus: 'needs_attention' }),
  );
  await expect(asideColumn.locator('[data-home-workspace="aside-running"]')).toHaveCount(0);
  await expect(row(page, 'aside-running')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-running');
  await page.locator('[data-home-set-aside-action="aside-running"]').focus();
  const mod = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? 'Meta' : 'Control'));
  await page.keyboard.press(`${mod}+Shift+s`);
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-running');
  const result = await snapshot(page);
  expect(result.actions.filter((type) => /archive|retire|stop|interrupt/i.test(type))).toEqual([]);
  expect(
    result.requests.filter(({ method }) => /archive|retire|stop|interrupt/i.test(method)),
  ).toEqual([]);
});

test('Board column supports Bring back, Undo, scopes and narrow layouts', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const component = await mount(Harness, { props: { view: 'board', height: 800 } });
  const board = page.locator('[data-home-board]');
  const asideColumn = board.locator('[data-home-set-aside]');
  const asideCard = asideColumn.locator('[data-home-workspace="aside-idle"]');
  await expect(asideColumn).toBeVisible();
  await capture(page, testInfo, 'kanban-column-empty-light');
  await aside(page, 'aside-idle');
  await expect(asideCard).toBeVisible();
  await expect(
    board
      .getByRole('region', { name: 'Done & idle', exact: true })
      .locator('[data-home-workspace="aside-idle"]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(asideCard).toHaveCount(0);
  await aside(page, 'aside-idle');
  await page.locator('[data-home-set-aside-action="aside-idle"]').focus();
  await page.keyboard.press('Enter');
  await expect(asideCard).toHaveCount(0);
  await expect(row(page, 'aside-idle')).toBeFocused();
  await aside(page, 'aside-idle');
  await page.evaluate(() => window.__homeSetAside!.configure({ groupBy: 'repository' }));
  await expect(asideCard).toBeVisible();
  await page.evaluate(() => window.__homeSetAside!.configure({ filter: 'archived' }));
  await expect(asideColumn).toHaveCount(0);
  await expect(row(page, 'aside-archived')).toBeVisible();
  await page.evaluate(() =>
    window.__homeSetAside!.configure({ filter: 'all', repoKey: 'acme/platform' }),
  );
  await expect(asideColumn).toBeVisible();
  await expect(asideCard).toHaveCount(0);
  await expect(row(page, 'aside-other-repo')).toBeVisible();
  await page.evaluate(() => window.__homeSetAside!.configure({ repoKey: null, groupBy: 'status' }));
  await expect(asideCard).toBeVisible();
  await page.getByRole('searchbox').fill('Explore keyboard navigation');
  await expect(asideCard).toBeVisible();
  await expect(board.locator('[data-home-workspace]')).toHaveCount(1);
  await page.getByRole('searchbox').clear();
  const clearToasts = page.getByRole('button', { name: /^Dismiss all \d+ notifications$/ });
  if (await clearToasts.isVisible()) await clearToasts.click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await asideCard.hover();
  await capture(page, testInfo, 'kanban-column-light');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await capture(page, testInfo, 'kanban-column-dark');
  await page.setViewportSize({ width: 390, height: 520 });
  await component.update({ props: { view: 'board', height: 520 } });
  await asideCard.scrollIntoViewIfNeeded();
  await capture(page, testInfo, 'kanban-column-narrow-dark');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await capture(page, testInfo, 'kanban-column-narrow-light');
  expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('Known attention stays aside until a new request, failure or review appears', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await page.evaluate(() => window.__homeSetAside!.question('aside-review', 'known-question'));
  await aside(page, 'aside-review');
  await page.evaluate(() => window.__homeSetAside!.reloadPreferences());
  await page.evaluate(() =>
    window.__homeSetAside!.update('aside-review', { title: 'A routine title refresh' }),
  );
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-review');
  await page.evaluate(() => window.__homeSetAside!.question('aside-review', 'new-question'));
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-review');
  await page.evaluate(() =>
    window.__homeSetAside!.blocker('aside-review', new Date(Date.now() - 10_000).toISOString()),
  );
  await aside(page, 'aside-review');
  await page.evaluate(() => window.__homeSetAside!.reloadPreferences());
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-review');
  await page.evaluate(() =>
    window.__homeSetAside!.blocker('aside-review', new Date().toISOString()),
  );
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-review');
  await aside(page, 'aside-idle');
  await page.evaluate(() =>
    window.__homeSetAside!.update('aside-idle', { displayStatus: 'failed' }),
  );
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
  await aside(page, 'aside-other-repo');
  await page.evaluate(() =>
    window.__homeSetAside!.update('aside-other-repo', { attention: 'review_required' }),
  );
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-other-repo');
});

test('Saved state survives reload and view reset while accounts and backends stay separate', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await aside(page, 'aside-idle');
  await expect.poll(async () => (await snapshot(page)).stored).toContain('aside-idle');
  await page.evaluate(() => window.__homeSetAside!.reloadPreferences());
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-idle');
  await page.evaluate(() => window.__homeSetAside!.resetView());
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-idle');
  await page.evaluate(() => window.__homeSetAside!.switchIdentity('another-person'));
  await expect.poll(async () => (await snapshot(page)).asideIds).toEqual([]);
  await page.evaluate(() => window.__homeSetAside!.switchIdentity('principal'));
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-idle');
  await page.evaluate(() => window.__homeSetAside!.switchIdentity('principal', 'another-backend'));
  await expect.poll(async () => (await snapshot(page)).asideIds).toEqual([]);
  await page.evaluate(() => window.__homeSetAside!.switchIdentity('principal'));
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-idle');
});

test('Another window can change personal organization without changing this window’s filters', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await aside(page, 'aside-idle');
  await page.getByRole('searchbox').fill('keyboard');
  const saved = await snapshot(page);
  const otherWindow = await page.context().newPage();
  try {
    await otherWindow.goto(new URL('/', page.url()).href);
    await otherWindow.evaluate(
      ({ key, stored }) => {
        const document = JSON.parse(stored!);
        const now = Date.now();
        document.configuration.query = 'A different window filter';
        document.setAside['aside-other-repo'] = { at: now, known: [], knownAt: now };
        localStorage.setItem(key!, JSON.stringify(document));
      },
      { key: saved.scope, stored: saved.stored },
    );
    await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-other-repo');
    await expect(page.getByRole('searchbox')).toHaveValue('keyboard');
    await otherWindow.evaluate((key) => {
      const document = JSON.parse(localStorage.getItem(key!)!);
      delete document.setAside;
      localStorage.setItem(key!, JSON.stringify(document));
    }, saved.scope);
    await expect.poll(async () => (await snapshot(page)).asideIds).toEqual([]);
    await expect(page.getByRole('searchbox')).toHaveValue('keyboard');
  } finally {
    await otherWindow.close();
  }
});

test('Bringing back work set aside in another window survives reload', async ({ mount, page }) => {
  await mount(Harness, { props: { view: 'board' } });
  const saved = await snapshot(page);
  const otherWindow = await page.context().newPage();
  try {
    await otherWindow.goto(new URL('/', page.url()).href);
    await otherWindow.evaluate(
      ({ key, stored }) => {
        const document = JSON.parse(stored!);
        const now = Date.now();
        document.setAside = { 'aside-idle': { at: now, known: [], knownAt: now } };
        localStorage.setItem(key!, JSON.stringify(document));
      },
      { key: saved.scope, stored: saved.stored },
    );
    await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-idle');
    await asideColumn(page).locator('[data-home-workspace="aside-idle"]').hover();
    await asideColumn(page).getByRole('button', { name: 'Bring back', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
    await expect
      .poll(() =>
        otherWindow.evaluate(
          (key) => JSON.parse(localStorage.getItem(key!)!).setAside?.['aside-idle'] ?? null,
          saved.scope,
        ),
      )
      .toBeNull();
    await page.evaluate(() => window.__homeSetAside!.reloadPreferences());
    await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
    await expect(row(page, 'aside-idle')).toBeVisible();
  } finally {
    await otherWindow.close();
  }
});

test('Reading preserves set-aside state and a draft; sending an instruction brings it back', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await mount(Harness);
  await row(page, 'aside-idle').click();
  const editor = page.locator('[data-home-detail] [contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.fill('Keep this draft while the workspace is aside.');
  await editor.evaluate(
    (element) => ((window as unknown as { __draftEditor: Element }).__draftEditor = element),
  );
  await aside(page, 'aside-idle');
  await expect(editor).toHaveText('Keep this draft while the workspace is aside.');
  expect(
    await editor.evaluate(
      (element) => (window as unknown as { __draftEditor: Element }).__draftEditor === element,
    ),
  ).toBe(true);
  await page.evaluate(() => window.__homeSetAside!.send('aside-idle'));
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
  await expect(editor).toHaveText('Keep this draft while the workspace is aside.');
});

test('Keyboard follows the configured shortcut and leaves text entry alone', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await row(page, 'aside-idle').locator('xpath=ancestor-or-self::*[@role="option"]').focus();
  const mod = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? 'Meta' : 'Control'));
  await page.keyboard.press(`${mod}+Shift+s`);
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-idle');
  await shelf(page).click();
  await row(page, 'aside-idle').locator('xpath=ancestor-or-self::*[@role="option"]').focus();
  await page.evaluate(() => window.__homeSetAside!.setShortcut('mod+alt+s'));
  await page.keyboard.press(`${mod}+Alt+s`);
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
  const search = page.getByRole('searchbox');
  await search.fill('keyboard');
  await page.keyboard.press(`${mod}+Alt+s`);
  await expect(search).toHaveValue('keyboard');
  await expect.poll(async () => (await snapshot(page)).asideIds).toEqual([]);
});

test('Narrow Home keeps aside actions reachable and repository scopes intact', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await mount(Harness, { props: { height: 760 } });
  await aside(page, 'aside-idle');
  await shelf(page).click();
  await expect(row(page, 'aside-idle').getByRole('button', { name: 'Bring back' })).toBeVisible();
  await row(page, 'aside-idle').hover();
  await capture(page, testInfo, 'after-narrow-light');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await capture(page, testInfo, 'after-narrow-dark');
  expect(
    await page
      .locator('[data-home-set-aside-review]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.evaluate(() => window.__homeSetAside!.configure({ query: 'Plan the release' }));
  await expect(row(page, 'aside-idle')).toHaveCount(0);
  await expect(row(page, 'aside-other-repo')).toBeVisible();
  await page.evaluate(() =>
    window.__homeSetAside!.configure({ query: '', repoKey: 'acme/platform' }),
  );
  await expect(shelf(page)).toHaveCount(0);
  await page.evaluate(() => window.__homeSetAside!.configure({ repoKey: 'acme/studio' }));
  await expect(shelf(page)).toBeVisible();
});

test('Moving a workspace preserves list scroll and gives keyboard focus a useful destination', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await mount(Harness);
  await page.evaluate(() => window.__homeSetAside!.addMany());
  const target = row(page, 'aside-extra-14');
  await target.scrollIntoViewIfNeeded();
  const scroll = page.locator('.workspace-list .overflow-y-auto').first();
  const before = await scroll.evaluate((element) => element.scrollTop);
  await target.locator('xpath=ancestor-or-self::*[@role="option"]').focus();
  const mod = await page.evaluate(() => (/Mac/i.test(navigator.platform) ? 'Meta' : 'Control'));
  await page.keyboard.press(`${mod}+Shift+s`);
  await expect.poll(async () => (await snapshot(page)).asideIds).toContain('aside-extra-14');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="option"], [data-home-set-aside-toggle]')),
      ),
    )
    .toBe(true);
  expect(Math.abs((await scroll.evaluate((element) => element.scrollTop)) - before)).toBeLessThan(
    60,
  );
});

test('Archive and deletion remain separate from personal organization', async ({ mount, page }) => {
  await mount(Harness);
  await aside(page, 'aside-idle');
  await page.evaluate(() => window.__homeSetAside!.archive('aside-idle'));
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
  await page.evaluate(() => window.__homeSetAside!.configure({ filter: 'archived' }));
  await expect(row(page, 'aside-idle')).toBeVisible();
  await expect(page.locator('[data-home-set-aside-action="aside-idle"]')).toHaveCount(0);
  await page.evaluate(() => window.__homeSetAside!.configure({ filter: 'all' }));
  await aside(page, 'aside-running');
  await page.evaluate(() => window.__homeSetAside!.remove('aside-running'));
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-running');
  await expect.poll(async () => (await snapshot(page)).stored).not.toContain('aside-running');
  await expect(row(page, 'aside-running')).toHaveCount(0);
});

const board = (page: Page) => page.locator('[data-home-board]');
const asideColumn = (page: Page) => board(page).locator('[data-home-set-aside]');
const setAsideCount = async (page: Page) =>
  (await snapshot(page)).actions.filter((type) => type === 'homeWorkspaces/setAside').length;

async function center(locator: ReturnType<Page['locator']>) {
  await expect(locator).toBeInViewport();
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 96) };
}

async function startDrag(page: Page, source: ReturnType<Page['locator']>) {
  await source.hover();
  const from = await center(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 4 });
}

async function dragOver(page: Page, target: ReturnType<Page['locator']>) {
  const to = await center(target);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.move(to.x + 4, to.y + 6, { steps: 4 });
}

async function dropOn(page: Page, target: ReturnType<Page['locator']>) {
  await dragOver(page, target);
  await page.mouse.up();
}

async function dropTargetState(page: Page) {
  const dragging = await board(page).getAttribute('data-home-dragging');
  const active = await asideColumn(page).evaluate((column) =>
    column.hasAttribute('data-home-drop-active'),
  );
  return `${dragging ?? ''}|${active ? 'drop-active' : ''}`;
}

async function draggable(locator: ReturnType<Page['locator']>) {
  return locator.evaluate(
    (element) =>
      Boolean(element.closest('[draggable="true"]')) ||
      Boolean(element.querySelector('[draggable="true"]')),
  );
}

async function clearToasts(page: Page) {
  const dismiss = page.getByRole('button', { name: /^Dismiss all \d+ notifications$/ });
  if (await dismiss.isVisible()) await dismiss.click();
  else {
    const close = page.getByRole('button', { name: 'Close notification', exact: true }).first();
    if (await close.isVisible()) await close.click();
  }
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
}

test('Dragging a card into Set aside sets it aside once and supports Undo and a normal click', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await mount(Harness, { props: { view: 'board', height: 800 } });
  const card = row(page, 'aside-idle');
  const asideCard = asideColumn(page).locator('[data-home-workspace="aside-idle"]');
  await expect(asideColumn(page)).toBeVisible();
  expect(await draggable(card)).toBe(true);
  const idle = await dropTargetState(page);
  await page.mouse.move(1190, 790);
  await capture(page, testInfo, 'drag-idle-light');
  const before = await setAsideCount(page);
  await startDrag(page, card);
  await dragOver(page, asideColumn(page));
  await expect.poll(() => dropTargetState(page)).toBe('aside-idle|drop-active');
  await capture(page, testInfo, 'drag-hover-light');
  await page.mouse.up();
  await expect(asideCard).toBeVisible();
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  expect((await snapshot(page)).asideIds).toContain('aside-idle');
  expect(await setAsideCount(page)).toBe(before + 1);
  expect((await snapshot(page)).selectedId).toBeNull();
  await page.mouse.move(1190, 790);
  await capture(page, testInfo, 'drag-drop-light');
  expect(await draggable(asideCard)).toBe(false);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(asideCard).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).asideIds).not.toContain('aside-idle');
  await row(page, 'aside-idle').click();
  await expect.poll(async () => (await snapshot(page)).selectedId).toBe('aside-idle');
  expect((await snapshot(page)).asideIds).not.toContain('aside-idle');
  expect(await setAsideCount(page)).toBe(before + 1);
});

test('Dragging running work into Set aside keeps it running in dark and narrow layouts', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const component = await mount(Harness, { props: { view: 'board', height: 800 } });
  const before = (await snapshot(page)).workspaces.find((item) => item.id === 'aside-running');
  await startDrag(page, row(page, 'aside-running'));
  await dragOver(page, asideColumn(page));
  await capture(page, testInfo, 'drag-hover-dark');
  await page.mouse.up();
  await expect(asideColumn(page).locator('[data-home-workspace="aside-running"]')).toBeVisible();
  await page.mouse.move(1190, 790);
  await clearToasts(page);
  await capture(page, testInfo, 'drag-drop-dark');
  const result = await snapshot(page);
  expect(result.workspaces.find((item) => item.id === 'aside-running')).toEqual(before);
  expect(result.actions.filter((type) => /archive|retire|stop|interrupt/i.test(type))).toEqual([]);
  expect(
    result.requests.filter(({ method }) => /archive|retire|stop|interrupt/i.test(method)),
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 1000 });
  await component.update({ props: { view: 'board', height: 1000 } });
  await board(page).evaluate((element) => (element.scrollTop = 0));
  await startDrag(page, row(page, 'aside-idle'));
  await dragOver(page, asideColumn(page));
  await capture(page, testInfo, 'drag-hover-narrow-dark');
  await page.mouse.up();
  await expect(asideColumn(page).locator('[data-home-workspace="aside-idle"]')).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await clearToasts(page);
  await capture(page, testInfo, 'drag-drop-narrow-light');
  expect(await board(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
});

test('Cancelled, outside and Escape drags leave Set aside unchanged', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  await mount(Harness, { props: { view: 'board', height: 800 } });
  const card = row(page, 'aside-idle');
  const idle = await dropTargetState(page);
  const before = await setAsideCount(page);
  await startDrag(page, card);
  await dragOver(page, asideColumn(page));
  await expect.poll(() => dropTargetState(page)).toBe('aside-idle|drop-active');
  await dropOn(page, board(page).getByRole('region', { name: 'Done & idle', exact: true }));
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  await startDrag(page, card);
  await dragOver(page, asideColumn(page));
  await page.mouse.move(1595, 795, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  await startDrag(page, card);
  await dragOver(page, asideColumn(page));
  await page.keyboard.press('Escape');
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  await page.mouse.move(1595, 795, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  const result = await snapshot(page);
  expect(result.asideIds).toEqual([]);
  expect(result.selectedId).toBeNull();
  expect(await setAsideCount(page)).toBe(before);
  await card.click();
  await expect.poll(async () => (await snapshot(page)).selectedId).toBe('aside-idle');
  await startDrag(page, card);
  await dropOn(page, asideColumn(page));
  await expect(asideColumn(page).locator('[data-home-workspace="aside-idle"]')).toBeVisible();
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  expect(await setAsideCount(page)).toBe(before + 1);
});

test('Set aside rejects foreign, archived, already-aside and stale drags', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await mount(Harness, { props: { view: 'board', height: 800 } });
  const idle = await dropTargetState(page);
  const before = await setAsideCount(page);
  await page.evaluate(() => {
    const foreign = document.createElement('div');
    foreign.id = 'foreign-drag';
    foreign.draggable = true;
    foreign.textContent = 'aside-idle';
    foreign.style.cssText = 'position:fixed;left:8px;bottom:8px;padding:8px;z-index:100';
    foreign.addEventListener('dragstart', (event) => {
      event.dataTransfer!.setData('text/plain', 'aside-idle');
      event.dataTransfer!.setData('text/uri-list', 'https://example.com/aside-idle');
    });
    document.body.append(foreign);
  });
  await startDrag(page, page.locator('#foreign-drag'));
  await dragOver(page, asideColumn(page));
  expect(await dropTargetState(page)).toBe(idle);
  await expect(asideColumn(page)).not.toHaveAttribute('data-home-drop-active');
  await page.mouse.up();
  await asideColumn(page).evaluate((column) => {
    const files = new DataTransfer();
    files.items.add(new File(['aside-idle'], 'aside-idle.txt', { type: 'text/plain' }));
    const text = new DataTransfer();
    text.setData('text/plain', 'aside-idle');
    for (const dataTransfer of [files, text])
      for (const type of ['dragenter', 'dragover', 'drop'])
        column.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
        );
  });
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  expect((await snapshot(page)).asideIds).toEqual([]);

  await startDrag(page, row(page, 'aside-idle'));
  await dragOver(page, asideColumn(page));
  await page.evaluate(() => window.__homeSetAside!.configure({ repoKey: 'acme/platform' }));
  await expect(row(page, 'aside-idle')).toHaveCount(0);
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  await page.mouse.up();
  await page.evaluate(() => window.__homeSetAside!.configure({ repoKey: null }));
  expect((await snapshot(page)).asideIds).toEqual([]);

  await startDrag(page, row(page, 'aside-idle'));
  await dragOver(page, asideColumn(page));
  await page.evaluate(() => window.__homeSetAside!.switchIdentity('another-person'));
  await page.mouse.up();
  expect((await snapshot(page)).asideIds).toEqual([]);
  await page.evaluate(() => window.__homeSetAside!.switchIdentity('principal'));
  await expect(asideColumn(page)).toBeVisible();
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  expect((await snapshot(page)).asideIds).toEqual([]);

  await startDrag(page, row(page, 'aside-other-repo'));
  await dragOver(page, asideColumn(page));
  await page.evaluate(() => window.__homeSetAside!.archive('aside-other-repo'));
  await page.mouse.up();
  await expect.poll(() => dropTargetState(page)).toBe(idle);
  expect((await snapshot(page)).asideIds).toEqual([]);
  expect(await setAsideCount(page)).toBe(before);

  await aside(page, 'aside-idle');
  const asideCard = asideColumn(page).locator('[data-home-workspace="aside-idle"]');
  expect(await draggable(asideCard)).toBe(false);
  await page.evaluate(() => window.__homeSetAside!.configure({ filter: 'archived' }));
  await expect(row(page, 'aside-archived')).toBeVisible();
  expect(await draggable(row(page, 'aside-archived'))).toBe(false);
  await page.evaluate(() => window.__homeSetAside!.configure({ filter: 'all' }));
  await expect(asideCard).toBeVisible();
  expect(await setAsideCount(page)).toBe(before + 1);
});
