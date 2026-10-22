import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import ContextPickerComposerHost from './ContextPickerComposerHost.svelte';

const crowdedResults = Array.from({ length: 8 }, (_, index) => ({
  id: `long-result-${index}`,
  type: 'file' as const,
  label: `3-${index}-context-picker-result-with-a-long-descriptive-filename.ts`,
  subtitle: `packages/frontend/src/features/context-picker/results/group-${index}/deeply-nested-directory/file.ts`,
  uri: `file:///fixture/long-result-${index}.ts`,
}));

for (const scenario of [
  { name: 'narrow keyboard access', width: 320, keyboard: true },
  { name: 'wide path click target', width: 1000, keyboard: false },
]) {
  test(`context result readability: ${scenario.name}`, async ({ mount, page }, info) => {
    await page.setViewportSize({ width: scenario.width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(ContextPickerComposerHost, { props: { searchCandidates: crowdedResults } });
    await page.getByTestId('prompt-actions-trigger').click();
    await page.getByRole('menuitem', { name: /Add Context/ }).hover();
    const picker = page.getByRole('dialog', { name: /Select context panels/i });
    const search = picker.getByRole('combobox');
    await search.fill('3');
    const results = picker.getByRole('option');
    await expect(results).toHaveCount(crowdedResults.length);
    await page.evaluate(() => document.fonts.ready);
    await expectGutters(picker, page);

    const geometry = await results.evaluateAll((nodes) =>
      nodes.map((node) => {
        const text = node.querySelector('div')!;
        const title = text.children[0] as HTMLElement;
        const path = text.children[1] as HTMLElement;
        return {
          row: node.getBoundingClientRect().toJSON(),
          title: title.getBoundingClientRect().toJSON(),
          path: path.getBoundingClientRect().toJSON(),
          titleLineHeight: parseFloat(getComputedStyle(title).lineHeight),
          pathLineHeight: parseFloat(getComputedStyle(path).lineHeight),
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
        };
      }),
    );
    for (const [index, bounds] of geometry.entries()) {
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
      expect(bounds.title.height).toBeGreaterThanOrEqual(bounds.titleLineHeight);
      expect(bounds.path.height).toBeGreaterThanOrEqual(bounds.pathLineHeight);
      expect(bounds.path.y).toBeGreaterThanOrEqual(bounds.title.bottom);
      expect(bounds.title.y).toBeGreaterThanOrEqual(bounds.row.y);
      expect(bounds.path.bottom).toBeLessThanOrEqual(bounds.row.bottom);
      expect(bounds.path.right).toBeLessThanOrEqual(bounds.row.right);
      if (index > 0) expect(bounds.row.y).toBeGreaterThanOrEqual(geometry[index - 1].row.bottom);
    }
    await info.attach('long-result-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await info.attach('long-result-rows', {
      body: await page.screenshot({ path: `.demo-artifacts/context-picker-${scenario.width}.png` }),
      contentType: 'image/png',
    });

    const chosenIndex = scenario.keyboard ? crowdedResults.length - 1 : 1;
    const chosen = crowdedResults[chosenIndex];
    const option = results.nth(chosenIndex);
    if (scenario.keyboard) {
      // Wrapping to the final result must scroll it into view without moving input focus.
      await search.press('ArrowUp');
      await expect(search).toBeFocused();
      await expect(search).toHaveAttribute(
        'aria-activedescendant',
        (await option.getAttribute('id'))!,
      );
      await expect(option).toHaveAttribute('aria-selected', 'true');
      await expect(option).toBeInViewport({ ratio: 1 });
      await search.press('Enter');
    } else {
      // The secondary path is part of the same usable click target as the filename.
      await option.getByText(chosen.subtitle, { exact: true }).click();
    }
    await expect(picker.getByRole('checkbox', { name: chosen.label })).toBeChecked();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.getByRole('menu')).toBeVisible();
  });
}

async function expectGutters(surface: Locator, page: Page) {
  await expect(surface).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = (await surface.boundingBox())!;
      return Math.min(
        box.x,
        box.y,
        viewport.width - box.x - box.width,
        viewport.height - box.y - box.height,
      );
    })
    .toBeGreaterThanOrEqual(7.5);
}

for (const scenario of [
  {
    name: 'rightward row alignment',
    width: 1000,
    height: 800,
    placement: 'left' as const,
    top: 300,
    side: 'right',
  },
  {
    name: 'left flip at right edge',
    width: 1000,
    height: 800,
    placement: 'right' as const,
    top: 300,
    side: 'left',
  },
  {
    name: 'narrow short viewport shift',
    width: 360,
    height: 320,
    placement: 'left' as const,
    top: 100,
    side: null,
  },
  {
    name: 'minimum-width vertical fallback',
    width: 320,
    height: 640,
    placement: 'left' as const,
    top: 260,
    side: null,
  },
]) {
  test(`nested context picker: ${scenario.name}, pointer selection and retained parent`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(ContextPickerComposerHost, {
      props: { placement: scenario.placement, top: scenario.top },
    });
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId('prompt-actions-trigger').click();
    const menu = page.getByRole('menu');
    const command = menu.getByRole('menuitem', { name: /Add Context/ });
    await command.hover();
    const picker = page.getByRole('dialog', { name: /Select context panels/i });
    await expect(picker.getByRole('combobox')).toBeFocused();
    await expect(menu).toBeVisible();
    await expect(command.locator('[data-slot="menu-sub-chevron"] svg')).toBeVisible();
    expect(
      await picker.evaluate((node) => node.parentElement?.closest('[role="menu"]')),
    ).toBeNull();
    await info.attach('context-picker-placement', {
      body: JSON.stringify(
        await picker.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return {
            side: node.getAttribute('data-side'),
            bounds: box.toJSON(),
            availableHeight: getComputedStyle(node).getPropertyValue(
              '--bits-popover-content-available-height',
            ),
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        }),
      ),
      contentType: 'application/json',
    });
    await expectGutters(menu, page);
    await expectGutters(picker, page);
    if (scenario.side) {
      await expect(picker).toHaveAttribute('data-side', scenario.side);
      const rowBox = (await command.boundingBox())!;
      const pickerBox = (await picker.boundingBox())!;
      expect(Math.abs(pickerBox.y - rowBox.y)).toBeLessThanOrEqual(1);
      if (scenario.side === 'right') expect(pickerBox.x).toBeGreaterThan(rowBox.x + rowBox.width);
      else expect(pickerBox.x + pickerBox.width).toBeLessThan(rowBox.x);
    } else {
      await expect(picker).toHaveAttribute('data-side', /top|bottom/);
      const rowBox = (await command.boundingBox())!;
      const pickerBox = (await picker.boundingBox())!;
      expect(
        pickerBox.y >= rowBox.y + rowBox.height || pickerBox.y + pickerBox.height <= rowBox.y,
      ).toBe(true);
    }
    const note = picker.getByRole('checkbox', { name: /Project notes/ });
    await note.check();
    await expect(note).toBeChecked();
    const selection = picker.getByRole('checkbox', { name: /Selected project excerpt/ });
    await selection.uncheck();
    await expect(selection).not.toBeChecked();
    await expect(menu).toBeVisible();
    await expectGutters(picker, page);
    await expectGutters(selection, page);
    await info.attach('nested-context-picker', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await selection.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(command).toBeFocused();
    await command.press('ArrowRight');
    await expect(note).toBeChecked();
    await expect(selection).not.toBeChecked();
    await note.focus();
    await note.press('ArrowLeft');
    await expect(picker).toHaveCount(0);
    await expect(command).toBeFocused();
    await command.press('Escape');
    await expect(page.getByTestId('prompt-actions-trigger')).toBeFocused();
  });
}

test('nested context search keeps file selections open and closes both layers for a mention', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ContextPickerComposerHost);
  const plus = page.getByTestId('prompt-actions-trigger');
  await plus.press('Enter');
  const menu = page.getByRole('menu');
  const command = menu.getByRole('menuitem', { name: /Add Context/ });
  await command.focus();
  await command.press('ArrowRight');
  const picker = page.getByRole('dialog', { name: /Select context panels/i });
  const search = picker.getByRole('combobox');
  await expect(search).toBeFocused();
  await search.fill('Search result');
  const fileResult = picker.getByRole('option', { name: /Search result.ts/ });
  await expect(fileResult).toBeVisible();
  await expect(search).toHaveAttribute('aria-busy', 'false');
  await search.press('End');
  await search.press('ArrowLeft');
  await expect(search).toBeFocused();
  expect(await search.evaluate((node: HTMLInputElement) => node.selectionStart)).toBe(
    'Search result'.length - 1,
  );
  await expect(picker).toBeVisible();
  const label = fileResult.getByText('Search result.ts', { exact: true });
  const labelBox = (await label.boundingBox())!;
  const iconBox = (await fileResult.locator('svg').boundingBox())!;
  const firstLineHeight = await label.evaluate((node) =>
    parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(
    Math.abs(iconBox.y + iconBox.height / 2 - labelBox.y - firstLineHeight / 2),
  ).toBeLessThanOrEqual(1);
  const subtitleBox = (await fileResult
    .getByText('src/features/context/search-result.ts', { exact: true })
    .boundingBox())!;
  expect(subtitleBox.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height);
  await info.attach('context-search-first-line-icon', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await search.press('Enter');
  await expect(picker.getByRole('checkbox', { name: /Search result.ts/ })).toBeChecked();
  await expect(search).toHaveValue('');
  await expect(menu).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill('Build terminal');
  const terminal = picker.getByRole('option', { name: /Build terminal/ });
  await expect(terminal).toBeVisible();
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    (await terminal.getAttribute('id'))!,
  );
  await search.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  const editor = page.getByRole('textbox');
  await expect(editor.locator('[data-mention="true"]')).toHaveCount(1);
  await expect(editor).toBeFocused();
  await expect
    .poll(async () => JSON.parse((await page.getByTestId('context-search-queries').textContent())!))
    .toEqual([
      { query: 'Search result', workspaceId: 'context-picker-fixture' },
      { query: 'Build terminal', workspaceId: 'context-picker-fixture' },
    ]);
});

test('the attach-context command still opens the standalone picker without the action menu', async ({
  mount,
  page,
}) => {
  await mount(ContextPickerComposerHost);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('chat:attach-context')));
  const picker = page.getByRole('dialog', { name: /Select context panels/i });
  await expect(picker.getByRole('combobox')).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const note = picker.getByRole('checkbox', { name: /Project notes/ });
  await note.check();
  await expect(note).toBeChecked();
  await note.press('Escape');
  await expect(picker).toHaveCount(0);
});
