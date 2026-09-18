import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import Pickers from './initializer-pickers.preview.svelte';
import InitialAgentPicker from './initial-agent-picker.preview.svelte';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/github\.com\/fixture-owner\.png(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="lightgray"/></svg>',
    }),
  );
});

async function expectViewportBounded(menu: Locator) {
  await expect
    .poll(() =>
      menu.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
}

for (const scenario of ['local', 'clone'] as const) {
  test(`${scenario} sentence has word-sized gaps and aligned text without shrinking hit height`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 480 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Pickers, { props: { scenario } });
    const fixture = page.getByTestId('initializer-pickers-fixture');
    const triggers = fixture.getByRole('combobox');
    if (scenario === 'clone') {
      const avatar = triggers.first().locator('img');
      await expect
        .poll(() =>
          avatar.evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    if (scenario === 'local') {
      // The uncommitted-changes dot mounts once the async branch status resolves and widens
      // the branch trigger; wait for it so hover/focus is the only variable measured below.
      await expect(triggers.last().getByRole('button')).toBeVisible();
    }
    await page.evaluate(() => document.fonts.ready);
    const textBounds = await fixture.evaluate((element) => {
      const walker = document.createTreeWalker(element.firstElementChild!, NodeFilter.SHOW_TEXT);
      const bounds: { contentLeft: number; y: number; right: number; weight: string }[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim() || node.parentElement?.closest('[aria-hidden=true]'))
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const { x, y, right } = range.getBoundingClientRect();
        const weight = getComputedStyle(node.parentElement!).fontWeight;
        // A loaded owner avatar is visible picker content, not inter-word whitespace.
        const images = node.parentElement!.closest('[role=combobox]')?.querySelectorAll('img');
        const imageLefts = Array.from(images ?? [], (image) => image.getBoundingClientRect().left);
        bounds.push({ contentLeft: Math.min(x, ...imageLefts), y, right, weight });
      }
      return bounds;
    });
    expect(textBounds.length).toBeGreaterThanOrEqual(4);
    expect(textBounds.slice(0, 4).map(({ weight }) => weight)).toEqual([
      '400',
      '500',
      '400',
      '500',
    ]);
    for (let index = 1; index < 4; index += 1) {
      const gap = textBounds[index].contentLeft - textBounds[index - 1].right;
      expect(gap).toBeGreaterThanOrEqual(5);
      expect(gap).toBeLessThanOrEqual(7);
      expect(Math.abs(textBounds[index].y - textBounds[0].y)).toBeLessThanOrEqual(1);
    }
    for (const trigger of await triggers.all()) {
      await expect(trigger).toHaveCSS('padding-left', '4px');
      await expect(trigger).toHaveCSS('padding-right', '4px');
      const initial = (await trigger.boundingBox())!;
      expect(initial.height).toBeGreaterThanOrEqual(28);
      await trigger.hover();
      await trigger.focus();
      expect(await trigger.boundingBox()).toEqual(initial);
      await trigger.press('Enter');
      const menu = page.locator('[data-slot="select-content"]');
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  });
}

for (const { locale, fragments } of [
  { locale: 'en', fragments: 5 },
  // German appends a trailing verb after the branch, so every plain-text boundary is exercised.
  { locale: 'de', fragments: 6 },
] as const) {
  test(`remote sentence keeps word-sized gaps between plain text and pickers (${locale})`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 480 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Pickers, { props: { scenario: 'remote', locale } });
    const fixture = page.getByTestId('initializer-pickers-fixture');
    await page.evaluate(() => document.fonts.ready);
    const textBounds = await fixture.evaluate((element) => {
      const walker = document.createTreeWalker(element.firstElementChild!, NodeFilter.SHOW_TEXT);
      const bounds: { text: string; left: number; right: number }[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim() || node.parentElement?.closest('[aria-hidden=true]'))
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const { x, right } = range.getBoundingClientRect();
        bounds.push({ text: node.textContent.trim(), left: x, right });
      }
      return bounds;
    });
    expect(textBounds.length).toBeGreaterThanOrEqual(fragments);
    for (let index = 1; index < fragments; index += 1) {
      const gap = textBounds[index].left - textBounds[index - 1].right;
      expect(
        gap,
        `${textBounds[index - 1].text} → ${textBounds[index].text}`,
      ).toBeGreaterThanOrEqual(5);
      expect(gap, `${textBounds[index - 1].text} → ${textBounds[index].text}`).toBeLessThanOrEqual(
        7,
      );
    }
  });
}

for (const scenario of ['clone', 'long', 'remote'] as const) {
  test(`${scenario} sentence wraps inside a narrow form without losing picker access`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 480 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Pickers, { props: { scenario } });
    const fixture = page.getByTestId('initializer-pickers-fixture');
    expect(
      await fixture.evaluate((element) => {
        const row = element.firstElementChild!;
        const bounds = row.getBoundingClientRect();
        return (
          row.scrollWidth <= row.clientWidth &&
          [...row.querySelectorAll('[role=combobox]')].every((trigger) => {
            const box = trigger.getBoundingClientRect();
            return box.left >= bounds.left && box.right <= bounds.right;
          })
        );
      }),
    ).toBe(true);
    const repo = fixture.getByRole('combobox').first();
    await repo.focus();
    await repo.press('Enter');
    await page.getByRole('button', { name: 'Copy local repo', exact: true }).click();
    await page
      .getByTestId('recent-repositories')
      .getByRole('button', { name: /^tools/ })
      .click();
    await expect(page.getByTestId('initializer-selection')).toContainText(
      '"repoPath":"/fixture/tools"',
    );
    const branch = fixture.getByRole('combobox').nth(1);
    await branch.focus();
    await branch.press('Enter');
    const menu = page.locator('[data-slot="select-content"]');
    await menu.locator('input').fill('feature/task-29');
    await menu.locator('input').press('Enter');
    await expect(page.getByTestId('initializer-selection')).toContainText(
      '"branch":"feature/task-29"',
    );
    await expect(menu).toHaveCount(0);
  });
}

for (const { name, width, height, position } of [
  { name: 'normal desktop', width: 1000, height: 800, position: 'top' },
  { name: 'narrow bottom edge', width: 360, height: 480, position: 'bottom' },
  { name: 'short viewport', width: 360, height: 320, position: 'top' },
] as const) {
  test(`initializer menus fit ${name} and preserve selection`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Pickers, { props: { position } });
    const triggers = page.getByTestId('initializer-pickers-fixture').getByRole('combobox');
    const repoTrigger = triggers.first();
    await repoTrigger.click();
    const menu = page.locator('[data-slot="select-content"]');
    await expectViewportBounded(menu);
    await page.evaluate(() => document.fonts.ready);
    // Labels may wrap, but every rendered line must remain readable and operable.
    for (const label of ['Pick a repo', 'New repo', 'Copy local repo']) {
      const mode = menu.getByRole('button', { name: label, exact: true });
      await mode.click();
      if (label === 'Pick a repo') {
        await expect(menu.getByPlaceholder('owner/repo', { exact: true })).toBeVisible();
      } else if (label === 'New repo') {
        await expect(menu.getByPlaceholder('new-project', { exact: true })).toBeVisible();
      } else {
        await expect(page.getByTestId('recent-repositories')).toBeVisible();
      }
      await expectViewportBounded(menu);
      await expect
        .poll(() =>
          mode.evaluate((element) => {
            const button = element.getBoundingClientRect();
            const popup = element.closest('[data-slot="select-content"]')!.getBoundingClientRect();
            const style = getComputedStyle(element);
            const content = {
              left: button.left + parseFloat(style.paddingLeft),
              right: button.right - parseFloat(style.paddingRight),
              top: button.top + parseFloat(style.paddingTop),
              bottom: button.bottom - parseFloat(style.paddingBottom),
            };
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const lines: DOMRect[] = [];
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!node.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              lines.push(...Array.from(range.getClientRects()));
            }
            return {
              hasText: lines.some((line) => line.width > 0 && line.height > 0),
              contained:
                button.left >= popup.left &&
                button.right <= popup.right &&
                button.top >= popup.top &&
                button.bottom <= popup.bottom &&
                lines.every(
                  (line) =>
                    line.left >= content.left &&
                    line.right <= content.right &&
                    line.top >= content.top &&
                    line.bottom <= content.bottom,
                ),
            };
          }),
        )
        .toEqual({ hasText: true, contained: true });
    }
    await page
      .getByTestId('recent-repositories')
      .getByRole('button', { name: /^tools/ })
      .click();
    await expect(page.getByTestId('initializer-selection')).toContainText(
      '"repoPath":"/fixture/tools"',
    );
    await expect(menu).toHaveCount(0);
    const branchTrigger = triggers.nth(1);
    await branchTrigger.click();
    await expectViewportBounded(menu);
    const search = menu.getByPlaceholder('Search or enter branch name...');
    await expect(search).toBeFocused();
    const warning = menu.getByText(/Uncommitted changes/);
    await expect(warning).toBeVisible();
    await expectViewportBounded(menu);
    // Read both rects in one frame: the warning mounts asynchronously and the menu
    // repositions when it grows, so separate boundingBox() reads can straddle that move.
    const { warningBottom, searchTop } = await warning.evaluate(
      (element, input) => ({
        warningBottom: element.getBoundingClientRect().bottom,
        searchTop: input!.getBoundingClientRect().top,
      }),
      await search.elementHandle(),
    );
    expect(warningBottom).toBeLessThanOrEqual(searchTop);
    const results = page.getByTestId('branch-results');
    expect(await results.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await results.hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => results.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await search.fill('feature/task-29');
    await search.press('Enter');
    await expect(page.getByTestId('initializer-selection')).toContainText(
      '"branch":"feature/task-29"',
    );
    await expect(menu).toHaveCount(0);
    await branchTrigger.click();
    const direct = menu.getByRole('button', { name: /Work directly/ });
    await direct.scrollIntoViewIfNeeded();
    const directBounds = (await direct.boundingBox())!;
    expect(directBounds.y).toBeGreaterThanOrEqual(0);
    expect(directBounds.y + directBounds.height).toBeLessThanOrEqual(height);
    await direct.click();
    await expect(page.getByTestId('initializer-selection')).toContainText('"skipIsolation":true');
    await expect(menu).toHaveCount(0);
    await branchTrigger.click();
    await menu.locator('input').press('Escape');
    await expect(branchTrigger).toBeFocused();
  });
}

test('closed branch menu cannot refocus its input from a queued autofocus frame', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Pickers);
  const trigger = page.getByTestId('initializer-pickers-fixture').getByRole('combobox').nth(1);
  await trigger.focus();
  const frames = await trigger.evaluateHandle((trigger) => {
    const request = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 0;
    let flushed = 0;
    let closedInputWasConnected = false;
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++next, callback);
      return next;
    };
    window.cancelAnimationFrame = (id) => {
      callbacks.delete(id);
    };
    const flushAfterClose = (event: Event) => {
      if (event.target !== trigger || trigger.getAttribute('aria-expanded') !== 'false') return;
      const input = document.querySelector('[data-slot="select-content"] input');
      if (!input?.isConnected) return;
      // Reproduce a pending frame after focus restoration, before closing DOM is removed.
      closedInputWasConnected = true;
      const pending = [...callbacks.values()];
      callbacks.clear();
      flushed += pending.length;
      pending.forEach((callback) => callback(performance.now()));
    };
    trigger.addEventListener('focus', flushAfterClose);
    return {
      get state() {
        return { flushed, closedInputWasConnected };
      },
      restore() {
        trigger.removeEventListener('focus', flushAfterClose);
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        callbacks.forEach((callback) => request(callback));
        callbacks.clear();
      },
    };
  });
  try {
    await trigger.press('Enter');
    const input = page.locator('[data-slot="select-content"] input');
    await expect(input).toBeAttached();
    await input.press('Escape');
    const state = await frames.evaluate((frames) => frames.state);
    expect(state.flushed).toBeGreaterThan(0);
    expect(state.closedInputWasConnected).toBe(true);
    await expect(trigger).toBeFocused();
    await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0);
  } finally {
    await frames.evaluate((frames) => frames.restore());
  }
});

test('portalled branch menu escapes clipping and paints over panel tabs', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Pickers, { props: { position: 'stacked' } });
  const trigger = page.getByTestId('initializer-pickers-fixture').getByRole('combobox').nth(1);
  await trigger.click();
  const menu = page.locator('[data-slot="select-content"]');
  await expect(menu.getByText(/Uncommitted changes/)).toBeVisible();
  await expect(
    page.getByTestId('branch-results').getByRole('button', { name: 'main default', exact: true }),
  ).toBeVisible();
  await expectViewportBounded(menu);
  await expect(
    page.getByTestId('initializer-pickers-fixture').locator('[data-slot="select-content"]'),
  ).toHaveCount(0);
  // Floating placement settles after the async branch list changes the menu's height.
  await expect
    .poll(() =>
      menu.evaluate((element) => {
        const menu = element.getBoundingClientRect();
        const tabs = document
          .querySelector('[data-testid="stacked-tabs"]')!
          .getBoundingClientRect();
        const left = Math.max(menu.left, tabs.left);
        const right = Math.min(menu.right, tabs.right);
        const top = Math.max(menu.top, tabs.top);
        const bottom = Math.min(menu.bottom, tabs.bottom);
        return {
          overlaps: left < right && top < bottom,
          menuOnTop: element.contains(
            document.elementFromPoint((left + right) / 2, (top + bottom) / 2),
          ),
        };
      }),
    )
    .toEqual({ overlaps: true, menuOnTop: true });
  const output = page.getByTestId('initializer-selection');
  const initial = JSON.parse((await output.textContent())!);
  await menu.getByRole('button', { name: 'Refresh branches' }).click();
  await expect
    .poll(async () => JSON.parse((await output.textContent())!).refreshes)
    .toBeGreaterThan(initial.refreshes);
  await menu.locator('input').press('Escape');
  await expect(trigger).toBeFocused();
});

for (const theme of ['light', 'dark']) {
  test(`specialist trigger is transparent with matching state radii in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    await mount(InitialAgentPicker, { props: { state: 'populated' } });
    const trigger = page.locator('.specialist-trigger');
    const surface = trigger.locator('[data-slot="button-surface"]');
    await expect(trigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(trigger).toHaveCSS('border-style', 'solid');
    await expect(trigger).toHaveCSS('border-width', '1px');
    await expect(trigger).not.toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
    const rect = await trigger.boundingBox();
    for (const state of ['hover', 'focus', 'open']) {
      if (state === 'hover') await trigger.hover();
      if (state === 'focus') await trigger.focus();
      if (state === 'open') await trigger.press('Enter');
      const radius = await trigger.evaluate((e) => getComputedStyle(e).borderRadius);
      await expect(surface).toHaveCSS('border-radius', radius);
      expect(await trigger.boundingBox()).toEqual(rect);
    }
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}
