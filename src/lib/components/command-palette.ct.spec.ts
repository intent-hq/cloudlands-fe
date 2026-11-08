import { expect, installPausedClock, test } from '../../test/ct-test';
import CommandPalettePreview from './command-palette.preview.svelte';

test('ordinary open clears the visible recovery filter without disrupting typing or go-to-line', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(CommandPalettePreview, {
    props: { initialQuery: 'provider profiles', withoutWorkspace: true },
    hooksConfig: { previewScene: { scene: 'command-palette', state: 'provider-profiles' } },
  });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  await expect(input).toHaveValue('provider profiles');
  await component.update({ props: { initialQuery: '', withoutWorkspace: true } });
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  await input.fill('my search');
  await component.update({ props: { initialQuery: '', withoutWorkspace: false } });
  await expect(input).toHaveValue('my search');
  await component.update({ props: { initialQuery: ':', withoutWorkspace: false } });
  await expect(input).toHaveValue(':');
  await input.fill(':42');
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
});

for (const width of [1280, 360]) {
  test(`palette keeps results and filters on one line at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(CommandPalettePreview, {
      hooksConfig: { previewScene: { scene: 'command-palette', state: 'grouped' } },
    });
    const dialog = page.getByRole('dialog');
    const input = dialog.getByRole('textbox');
    await expect(input).toBeFocused();
    const rows = dialog.locator('[data-palette-result]');
    await expect(rows).toHaveCount(7);
    const geometry = await rows.evaluateAll((elements) =>
      elements.map((row) => {
        const box = row.getBoundingClientRect();
        const content = row
          .querySelector('[data-slot="action-row-content"]')!
          .getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          contentTop: content.top,
          contentBottom: content.bottom,
          contentHeight: content.height,
          lineHeight: parseFloat(getComputedStyle(row).lineHeight),
          overflow: row.scrollHeight - row.clientHeight,
        };
      }),
    );
    for (const row of geometry) {
      expect(row.contentTop).toBeGreaterThanOrEqual(row.top);
      expect(row.contentBottom).toBeLessThanOrEqual(row.bottom);
      expect(row.contentHeight).toBeLessThanOrEqual(row.lineHeight + 1);
      expect(row.overflow).toBeLessThanOrEqual(1);
    }
    for (let index = 1; index < geometry.length; index++) {
      expect(geometry[index].top).toBeGreaterThanOrEqual(geometry[index - 1].bottom);
    }
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(
      await dialog.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    const filters = dialog.getByRole('group', { name: 'Filter results' });
    const filterTops = await filters
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
    expect(Math.max(...filterTops) - Math.min(...filterTops)).toBeLessThanOrEqual(1);
    await testInfo.attach(`single-line-palette-${width}px`, {
      body: await dialog.screenshot(),
      contentType: 'image/png',
    });
    await input.press('Shift+Tab');
    await expect(input).toHaveValue('~');
    const lastFilter = filters.getByRole('button', { name: 'Changes', exact: true });
    await expect(lastFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(lastFilter).toBeInViewport({ ratio: 1 });
    await input.press('Tab');
    await expect(input).toHaveValue('');
    await expect(filters.getByRole('button', { name: 'All', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(input).toBeFocused();
  });
}

async function filterStripGeometry(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog');
  const filters = dialog.getByRole('group', { name: 'Filter results' });
  return filters.evaluate((group) => {
    const strip = group.parentElement!;
    const stripBox = strip.getBoundingClientRect();
    const dialogBox = group.closest('[role="dialog"]')!.getBoundingClientRect();
    const buttons = [...group.querySelectorAll('button')].map((button) => {
      const box = button.getBoundingClientRect();
      return { label: button.textContent!.trim(), left: box.left, right: box.right };
    });
    return {
      overflow: strip.scrollWidth - strip.clientWidth,
      stripContentWidth: strip.scrollWidth,
      stripLeft: stripBox.left,
      stripRight: stripBox.right,
      dialogWidth: dialogBox.width,
      buttons,
    };
  });
}

// The palette grows to fit its filter row, so every filter is reachable by pointer
// without sideways scrolling on desktop widths.
test('palette widens to show every filter without scrolling at 1280px', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(CommandPalettePreview, {
    hooksConfig: { previewScene: { scene: 'command-palette', state: 'owner' } },
  });
  const dialog = page.getByRole('dialog');
  const filters = dialog.getByRole('group', { name: 'Filter results' });
  await expect(filters.getByRole('button', { name: 'Browser', exact: true })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Terminals', exact: true })).toBeVisible();
  const geometry = await filterStripGeometry(page);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  for (const button of geometry.buttons) {
    expect(button.left, button.label).toBeGreaterThanOrEqual(geometry.stripLeft - 1);
    expect(button.right, button.label).toBeLessThanOrEqual(geometry.stripRight + 1);
  }
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await testInfo.attach('palette-all-filters-1280px', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });

  // Entering and leaving go-to-line mode must not make the palette jump in width.
  const input = dialog.getByRole('textbox');
  await input.fill(':');
  await expect(filters).toBeHidden();
  expect((await dialog.boundingBox())!.width).toBeCloseTo(box.width, 0);
  await input.fill('');
  await expect(filters).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeCloseTo(box.width, 0);
});

// Long result titles and long queries truncate rather than stretching the palette past
// its filter row.
test('long result titles and queries do not widen the palette beyond its filter row', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(CommandPalettePreview, {
    props: { initialQuery: '#' },
    hooksConfig: { previewScene: { scene: 'command-palette', state: 'long-names' } },
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-palette-result]').first()).toBeVisible();
  const geometry = await filterStripGeometry(page);
  expect(geometry.overflow).toBeLessThanOrEqual(1);

  await component.update({ props: { initialQuery: `no-match-${'x'.repeat(240)}` } });
  await expect(dialog.locator('[data-palette-result]')).toHaveCount(0);
  expect((await dialog.boundingBox())!.width).toBeCloseTo(geometry.dialogWidth, 0);
});

test('palette show-more filtering preserves keyboard focus and scrolls the current row into view', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(CommandPalettePreview, {
    hooksConfig: { previewScene: { scene: 'command-palette', state: 'grouped' } },
  });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  await dialog.getByRole('button', { name: /Show .* more notes/ }).click();
  await expect(input).toHaveValue('#');
  await expect(input).toBeFocused();
  const rows = dialog.locator('[data-palette-result]');
  await expect(rows).toHaveCount(16);
  for (let index = 0; index < 20; index++) await input.press('ArrowDown');
  await expect(rows.last()).toHaveAttribute('aria-current', 'true');
  const viewport = dialog.locator('[data-palette-results]');
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(rows.last()).toBeInViewport();
  await expect(input).toBeFocused();
  await input.press('ArrowUp');
  await expect(rows.nth(14)).toHaveAttribute('aria-current', 'true');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(dialog).toBeVisible();
  await input.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('category controls preserve the query, support keyboard cycling, and recover from empty results', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 740 });
  await mount(CommandPalettePreview, {
    hooksConfig: { previewScene: { scene: 'command-palette', state: 'grouped' } },
  });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');
  const filters = dialog.getByRole('group', { name: 'Filter results' });
  await input.fill('context');
  await filters.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(input).toHaveValue('#context');
  await expect(input).toBeFocused();
  await expect(dialog.locator('[data-palette-result]')).toHaveCount(16);
  await input.press('Tab');
  await expect(input).toHaveValue('/context');
  await input.press('Shift+Tab');
  await expect(input).toHaveValue('#context');
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(input).toHaveValue('context');

  await filters.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(input).toHaveValue('~context');
  await expect(input).toBeFocused();
  await input.fill('~');
  await expect(dialog.locator('[data-palette-result]')).toHaveCount(2);

  await input.fill('#no-matching-context-xyz');
  await expect(dialog.getByText('No results found for "no-matching-context-xyz"')).toBeVisible();
  await testInfo.attach('empty-results', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await testInfo.attach('command-palette-redesigned', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  await input.press('Escape');
  await expect(dialog).toHaveCount(0);
});

// ── Repos and blended ranking (intent-hq/intent#8292) ─────────────────────

type PaletteFixtureHook = 'repoLoads' | 'landRepos' | 'releaseFiles';
type CtPage = Parameters<Parameters<typeof test>[2]>[0]['page'];

function paletteFixture(page: CtPage, hook: PaletteFixtureHook) {
  return page.evaluate(
    (name) =>
      (
        window as unknown as {
          __commandPaletteFixture: Record<PaletteFixtureHook, () => number | void>;
        }
      ).__commandPaletteFixture[name](),
    hook,
  );
}

function readPrefill(page: CtPage) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('workspace-prefill');
    return raw ? JSON.parse(raw) : null;
  });
}

async function mountRepoScene(
  mount: Parameters<Parameters<typeof test>[2]>[0]['mount'],
  page: CtPage,
  state: string,
  props?: { initialQuery: string },
) {
  await page.setViewportSize({ width: 960, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(CommandPalettePreview, {
    ...(props ? { props } : {}),
    hooksConfig: { previewScene: { scene: 'command-palette', state } },
  });
  const dialog = page.getByRole('dialog');
  const rows = dialog.locator('[data-palette-result]');
  const inCategory = (name: string) =>
    rows.filter({ has: page.locator('[data-palette-category]', { hasText: name }) });
  return {
    dialog,
    input: dialog.getByRole('textbox'),
    rows,
    repoRows: inCategory('Repo'),
    fileRows: inCategory('File'),
    current: dialog.locator('[data-palette-result][aria-current="true"]'),
  };
}

test('a typed query shows one blended list with a category on every row; the empty palette keeps its groups', async ({
  mount,
  page,
}, testInfo) => {
  const { dialog, input, rows } = await mountRepoScene(mount, page, 'blended');
  await expect(input).toHaveValue('in');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(dialog.locator('[data-palette-group]')).toHaveCount(0);
  const categories = await rows.evaluateAll((elements) =>
    elements.map((row) => row.querySelector('[data-palette-category]')?.textContent?.trim() ?? ''),
  );
  expect(categories.every(Boolean)).toBe(true);
  expect(new Set(categories).size).toBeGreaterThan(1);
  expect(categories).toContain('Repo');
  await testInfo.attach('blended-list', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });

  await input.fill('');
  await expect(dialog.locator('[data-palette-group]').first()).toBeVisible();
  await expect(dialog.locator('[data-palette-category]')).toHaveCount(0);
});

test('one repo with a local clone and a GitHub entry lists two rows labeled by source', async ({
  mount,
  page,
}, testInfo) => {
  const { dialog, rows, repoRows } = await mountRepoScene(mount, page, 'repos');
  await expect(repoRows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('intent-hq/cloudlands-fe');
  await expect(rows.nth(0)).toContainText('/Users/dev/code/cloudlands-fe');
  await expect(rows.nth(1)).toContainText('intent-hq/cloudlands-fe');
  await expect(rows.nth(1)).toContainText('GitHub');
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await testInfo.attach('repo-rows-two-sources', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
});

const repoSources = [
  {
    source: 'local clone',
    query: 'cloudl',
    arrows: 0,
    prefill: { repoPath: '/Users/dev/code/cloudlands-fe' },
  },
  {
    source: 'GitHub',
    query: 'cloudl',
    arrows: 1,
    prefill: { githubUrl: 'https://github.com/intent-hq/cloudlands-fe' },
  },
  {
    source: 'GitLab',
    query: 'billing',
    arrows: 0,
    prefill: {
      repositoryCheckoutDraft: {
        instanceBaseUrl: 'https://gitlab.com',
        projectPath: 'acme/platform/billing',
      },
    },
  },
];
for (const { source, query, arrows, prefill } of repoSources) {
  test(`Enter on a ${source} repo opens New Workspace with that repo prefilled`, async ({
    mount,
    page,
  }) => {
    const { dialog, input, current } = await mountRepoScene(mount, page, 'repos');
    await input.fill(query);
    await expect(current).toContainText(
      source === 'GitLab' ? 'acme/platform/billing' : 'cloudlands-fe',
    );
    for (let index = 0; index < arrows; index++) await input.press('ArrowDown');
    await expect(current).toContainText(source === 'GitHub' ? 'GitHub' : query);
    await input.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-command-palette-preview]')).toHaveAttribute(
      'data-new-workspace-open',
      'true',
    );
    expect(await readPrefill(page)).toEqual(prefill);
  });
}

test('+ lists only repos, most recent first, and the Repos chip joins Tab cycling', async ({
  mount,
  page,
}, testInfo) => {
  const { dialog, input, rows } = await mountRepoScene(mount, page, 'repo-filter');
  const filters = dialog.getByRole('group', { name: 'Filter results' });
  const reposChip = filters.getByRole('button', { name: 'Repos', exact: true });
  await expect(reposChip).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(4);
  const details = ['/Users/dev/code/cloudlands-fe', 'acme/platform/billing', 'GitHub', 'intentd'];
  for (const [index, text] of details.entries()) await expect(rows.nth(index)).toContainText(text);
  await testInfo.attach('repo-filter', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });

  await input.press('Tab');
  await expect(input).not.toHaveValue('+');
  await expect(reposChip).toHaveAttribute('aria-pressed', 'false');
  await input.press('Shift+Tab');
  await expect(input).toHaveValue('+');
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(input).toHaveValue('');
  await reposChip.click();
  await expect(input).toHaveValue('+');
});

test('repos and the Repos chip are hidden when New Workspace is hidden', async ({
  mount,
  page,
}) => {
  const { dialog, input, rows } = await mountRepoScene(mount, page, 'repos-hidden');
  const filters = dialog.getByRole('group', { name: 'Filter results' });
  await expect(filters.getByRole('button', { name: 'All', exact: true })).toBeVisible();
  await expect(filters.getByRole('button', { name: 'Repos', exact: true })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'cloudlands-fe' })).toHaveCount(0);
  await input.fill('new work');
  await expect(rows.filter({ hasText: 'New Workspace' })).toHaveCount(0);
  await input.fill('+');
  await expect(rows).toHaveCount(0);
});

test('typing "new work" finds New Workspace below matching repos', async ({ mount, page }) => {
  const { input, rows } = await mountRepoScene(mount, page, 'repos');
  await input.fill('new work');
  await expect(rows.first()).toContainText('New Workspace');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
});

test('the highlight stays on the moved-to item while a late file result lands above it', async ({
  mount,
  page,
}) => {
  const { input, rows, fileRows, current } = await mountRepoScene(mount, page, 'repos');
  await input.fill('intent');
  await expect(rows.nth(2)).toContainText('intent-hq/intentd');
  await expect(current).toContainText('/Users/dev/code/cloudlands-fe');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');

  // The held file is named exactly "intent": it outranks the repos but never row 1.
  await expect
    .poll(async () => {
      await paletteFixture(page, 'releaseFiles');
      return fileRows.count();
    })
    .toBe(1);
  await expect(rows.nth(1).locator('[data-palette-category]')).toHaveText('File');
  await expect(rows.nth(0)).toContainText('/Users/dev/code/cloudlands-fe');
  await expect(rows.nth(3)).toHaveAttribute('aria-current', 'true');
  await expect(current).toContainText('intent-hq/intentd');

  await input.press('Enter');
  expect(await readPrefill(page)).toEqual({ repoPath: '/Users/dev/code/intentd' });
});

test('each keystroke puts the highlight back on row 1', async ({ mount, page }) => {
  const { input, rows, current } = await mountRepoScene(mount, page, 'repos');
  await input.fill('intent');
  await expect(rows.nth(2)).toContainText('intent-hq/intentd');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await input.press('-');
  await expect(input).toHaveValue('intent-');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(current).toHaveCount(1);
});

test('Enter right after a paste acts on results for the new text, not the previous list', async ({
  mount,
  page,
}) => {
  const { input, current } = await installPausedClock(page, () =>
    mountRepoScene(mount, page, 'repos', { initialQuery: '' }),
  );
  await input.fill('intentd');
  await page.clock.runFor(100);
  await expect(current).toContainText('intent-hq/intentd');
  // With the clock paused the scheduled rebuild cannot run; Enter must run it.
  await input.fill('cloudlands');
  await input.press('Enter');
  expect(await readPrefill(page)).toEqual({ repoPath: '/Users/dev/code/cloudlands-fe' });
});

test('one repo load per open; a load landing mid-typing waits for the next keystroke to lead', async ({
  mount,
  page,
}) => {
  const { input, rows, repoRows, current } = await installPausedClock(page, () =>
    mountRepoScene(mount, page, 'repos'),
  );
  // Step time so each rebuild runs before the next event.
  const settle = () => page.clock.runFor(100);
  await input.fill('clou');
  await settle();
  await input.press('d');
  await settle();
  await expect(input).toHaveValue('cloud');
  await expect(repoRows).toHaveCount(2);
  await expect(current).toContainText('/Users/dev/code/cloudlands-fe');
  expect(await paletteFixture(page, 'repoLoads')).toBe(1);

  await paletteFixture(page, 'landRepos');
  await settle();
  await expect(repoRows).toHaveCount(3);
  await expect(rows.first()).toContainText('/Users/dev/code/cloudlands-fe');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');

  await input.press('Backspace');
  await settle();
  await input.press('d');
  await settle();
  await expect(rows.first()).not.toContainText('cloudlands-fe');
  await expect(rows.first()).toContainText('/Users/dev/code/cloud');
  expect(await paletteFixture(page, 'repoLoads')).toBe(1);
});

test('server-only note hits take three rows plus a See all row that opens the notes filter', async ({
  mount,
  page,
}) => {
  const { dialog, input, rows } = await mountRepoScene(mount, page, 'repos');
  await input.fill('roadmap');
  await expect(rows.filter({ hasText: 'Planning' })).toHaveCount(3);
  const seeAll = dialog.locator('[data-palette-see-all="note"]');
  await expect(seeAll).toBeVisible();
  await seeAll.click();
  await expect(input).toHaveValue('#roadmap');
  await expect(rows.filter({ hasText: 'Planning' })).toHaveCount(5);
});

test('when only a chat message matches, it becomes row 1 as it arrives', async ({
  mount,
  page,
}) => {
  const { input, rows } = await mountRepoScene(mount, page, 'repos');
  await input.fill('zebra');
  await expect(rows.first().locator('[data-palette-category]')).toHaveText('Message');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
});
