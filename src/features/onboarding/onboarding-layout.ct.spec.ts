import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../test/ct-test';
import Preview from './onboarding-layout.preview.svelte';

for (const width of [360, 960]) {
  for (const supported of [false, true]) {
    test(`full-instance setup ${supported ? 'supported' : 'requires update'} at ${width}px`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const instance = 'https://gitlab.example.test:8443/Parent/Forge';
      const component = await mount(Preview, {
        props: {
          step: 'forge',
          gitlabEnabled: true,
          gitlabSetupSupported: supported,
          gitlabInstanceBaseUrl: instance,
        },
      });
      await component.getByRole('button', { name: 'Connect GitLab', exact: true }).click();
      const form = component.getByTestId('gitlab-connect-form');
      const address = form.getByLabel('GitLab instance URL');
      await expect(address).toHaveValue(instance);
      await expect(form.getByRole('button', { name: 'Connect GitLab', exact: true })).toBeEnabled({
        enabled: supported,
      });
      await expect(address).toBeEnabled({ enabled: supported });
      const explanation = form.getByTestId('gitlab-instance-update-required');
      if (supported) {
        await expect(explanation).toHaveCount(0);
        await address.focus();
        await page.keyboard.press('Tab');
        await expect(
          form.getByRole('button', { name: 'Connect GitLab', exact: true }),
        ).toBeFocused();
      } else {
        await expect(explanation).toBeVisible();
        await expect(explanation).toContainText('Update this host');
      }
      expect(
        await form.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await testInfo.attach('full-instance-setup', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  }
}

for (const scenario of [
  {
    name: 'GitHub onboarding',
    forge: 'github-device',
    width: 720,
    uri: 'https://github.com/login/device',
    openLabel: 'Open GitHub',
    settings: false,
  },
  {
    name: 'narrow GitLab onboarding',
    forge: 'gitlab-device',
    width: 480,
    uri: 'https://gitlab.example.com/oauth/device',
    openLabel: 'Open GitLab',
    settings: false,
  },
  ...[360, 420, 720].map((width) => ({
    name: `GitLab settings at ${width}px with a long instance URI`,
    forge: 'gitlab-device' as const,
    width,
    uri: 'https://engineeringgitlabinstancewithaverylongunbrokensubdomain.internal.example.test:8443/company/platform/identity/authorization/device',
    openLabel: 'Open GitLab',
    settings: true,
  })),
] as const) {
  test(`${scenario.name} keeps the complete device URI selectable and actions usable`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const opened: unknown[] = [];
    const component = await mount(Preview, {
      props: {
        step: 'forge',
        forge: scenario.forge,
        gitlabEnabled: true,
        settings: scenario.settings,
        verificationUri: scenario.uri,
        onOpenExternal: (payload: unknown) => opened.push(payload),
      },
    });
    const uri = component.getByText(scenario.uri, { exact: true });
    await expect(uri).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (scenario.settings) {
      const title = component.getByText('GitLab', { exact: true });
      await expect(title).toBeVisible();
      const header = await title.evaluate((element) => {
        const content = element.parentElement!.parentElement!;
        const description = content.nextElementSibling!;
        const bounds = content.getBoundingClientRect();
        const descriptionBounds = description.getBoundingClientRect();
        const titleBounds = element.getBoundingClientRect();
        const statusElement = content.lastElementChild!;
        const statusBounds = statusElement.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(description);
        return {
          content: bounds.toJSON(),
          title: titleBounds.toJSON(),
          status: statusBounds.toJSON(),
          statusText: statusElement.textContent?.trim(),
          description: descriptionBounds.toJSON(),
          descriptionLines: [...text.getClientRects()].map((rect) => rect.toJSON()),
          width: content.clientWidth,
          scrollWidth: content.scrollWidth,
        };
      });
      expect(header.statusText).toBe('Waiting for authorization...');
      expect(header.scrollWidth).toBeLessThanOrEqual(header.width + 1);
      // The explanation gets the content width, independent of the status width.
      expect(Math.abs(header.description.left - header.content.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(header.description.right - header.content.right)).toBeLessThanOrEqual(1);
      expect(header.description.top).toBeGreaterThanOrEqual(header.status.bottom - 1);
      expect(
        header.status.left >= header.title.right - 1 ||
          header.status.top >= header.title.bottom - 1,
      ).toBe(true);
      for (const bounds of [header.title, header.status, ...header.descriptionLines]) {
        expect(bounds.left).toBeGreaterThanOrEqual(header.content.left - 1);
        expect(bounds.right).toBeLessThanOrEqual(header.content.right + 1);
      }
      await testInfo.attach('connection-header-layout', {
        body: JSON.stringify(header, null, 2),
        contentType: 'application/json',
      });
    }
    const geometry = await uri.evaluate((element) => {
      const paragraph = element.parentElement!;
      const bounds = paragraph.getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(element);
      const lines = [...text.getClientRects()].map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }));
      const introduction = document.createRange();
      introduction.selectNodeContents(paragraph);
      introduction.setEndBefore(element);
      return {
        text: element.textContent,
        width: paragraph.clientWidth,
        scrollWidth: paragraph.scrollWidth,
        left: bounds.left,
        right: bounds.right,
        bottom: bounds.bottom,
        introductionBottom: introduction.getBoundingClientRect().bottom,
        lines,
      };
    });
    expect(geometry.text).toBe(scenario.uri);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.lines.length).toBeGreaterThan(0);
    // The address starts after the explanation, rather than sharing its remaining line width.
    expect(geometry.lines[0]!.top).toBeGreaterThanOrEqual(geometry.introductionBottom - 1);
    for (const line of geometry.lines) {
      expect(line.left).toBeGreaterThanOrEqual(geometry.left - 1);
      expect(line.right).toBeLessThanOrEqual(geometry.right + 1);
      expect(line.bottom).toBeLessThanOrEqual(geometry.bottom + 1);
    }
    // A short final path segment fits intact; long host segments still have a wrap fallback.
    expect(
      await uri.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && !text.textContent?.includes('device')) text = walker.nextNode();
        if (!text) throw new Error('Complete final URI segment is missing');
        const range = document.createRange();
        range.setStart(text, text.textContent!.lastIndexOf('device'));
        range.setEnd(text, text.textContent!.length);
        return range.getClientRects().length;
      }),
    ).toBe(1);
    await testInfo.attach('device-uri-view', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await uri.dblclick();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(scenario.uri);
    const copy = component.getByRole('button', { name: 'Copy code', exact: true });
    await copy.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('WDJB-MJHT');
    await page.keyboard.press('Tab');
    const open = component.getByRole('button', { name: scenario.openLabel, exact: true });
    await expect(open).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => opened).toEqual([{ url: scenario.uri }]);
    await page.keyboard.press('Tab');
    if (scenario.forge === 'gitlab-device') {
      await expect(component.getByRole('button', { name: 'Use a token instead' })).toBeFocused();
      await page.keyboard.press('Tab');
    }
    await expect(component.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await testInfo.attach('device-uri-layout', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
  });
}

test('starter suggestions preserve containment, keyboard selection, and shuffle', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 900 });
  const component = await mount(Preview);
  const editor = component.locator('.rich-textarea [contenteditable=true]');
  const options = component.getByRole('option');
  await expect(options).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  const geometry = await options.evaluateAll((elements) =>
    elements.map((element) => ({
      right: element.getBoundingClientRect().right,
      listRight: element.closest('[role=listbox]')!.getBoundingClientRect().right,
    })),
  );
  geometry.forEach((box) => expect(box.right).toBeLessThanOrEqual(box.listRight));
  const original = await options.first().innerText();
  await editor.focus();
  await page.keyboard.press('ArrowDown');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(options.first()).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(editor).toContainText(original.trim());
  await expect(options).toHaveCount(0);
  // Use the editor's select-all keybinding, not fill's DOM-only Range selection:
  // ProseMirror must own the selection that the following delete key consumes.
  await editor.press('ControlOrMeta+A');
  await expect
    .poll(() => editor.evaluate(() => window.getSelection()?.toString().trim()))
    .toBe(original.trim());
  await editor.press('Backspace');
  await expect(editor).toHaveText('');
  await expect(options).toHaveCount(4);
  await testInfo.attach('starter-suggestions-after-keyboard-clear', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const before = await options.allTextContents();
  await component.locator('#suggestion-shuffle').click();
  await expect.poll(() => options.allTextContents()).not.toEqual(before);
  await editor.focus();
  await page.keyboard.press('ArrowUp');
  await expect(component.locator('#suggestion-shuffle')).toHaveAttribute('aria-selected', 'true');
});

for (const gitlabEnabled of [false, true]) {
  test(`forge setup preserves keyboard access with GitLab Labs ${gitlabEnabled ? 'on' : 'off'}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    const component = await mount(Preview, { props: { step: 'forge', gitlabEnabled } });
    const github = component.getByRole('button', { name: 'Connect GitHub', exact: true });
    await github.focus();
    await page.keyboard.press('Tab');
    if (gitlabEnabled) {
      const gitlab = component.getByRole('button', { name: 'Connect GitLab', exact: true });
      await expect(gitlab).toBeFocused();
      await page.keyboard.press('Enter');
      const host = component.locator('input[type=text]');
      await expect(host).toBeVisible();
      const form = component.getByTestId('gitlab-connect-form');
      expect(await form.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    } else {
      await expect(component.getByRole('button', { name: /Skip for now/ })).toBeFocused();
      await expect(
        component.getByRole('button', { name: 'Connect GitLab', exact: true }),
      ).toHaveCount(0);
    }
  });
}

interface StripState {
  scrollLeft: number;
  stripLeft: number;
  stripRight: number;
  columnLeft: number;
  columnRight: number;
  cards: { id: string; left: number; right: number }[];
  /** Cards fully inside the strip's viewport. */
  visible: string[];
}

function readStrip(strip: Locator): Promise<StripState> {
  return strip.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    // The welcome actions row that follows the strip spans the content column.
    const column = element.nextElementSibling!.getBoundingClientRect();
    const cards = [...element.querySelectorAll<HTMLElement>('[data-provider-id]')].map((card) => {
      const rect = card.getBoundingClientRect();
      return { id: card.dataset.providerId!, left: rect.left, right: rect.right };
    });
    return {
      scrollLeft: element.scrollLeft,
      stripLeft: bounds.left,
      stripRight: bounds.right,
      columnLeft: column.left,
      columnRight: column.right,
      cards,
      visible: cards
        .filter((card) => card.left >= bounds.left - 1 && card.right <= bounds.right + 1)
        .map((card) => card.id),
    };
  });
}

function waitFrames(strip: Locator, frames: number): Promise<void> {
  return strip.evaluate(
    (_, count) =>
      new Promise<void>((resolve) => {
        let remaining = count;
        const tick = () => (--remaining <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/** Waits for a press to move the strip away from `from`, then for the scroll to come to rest. */
async function settleStrip(strip: Locator, from: number): Promise<StripState> {
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).not.toBe(from);
  await strip.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let last = element.scrollLeft;
        let still = 0;
        const tick = () => {
          still = element.scrollLeft === last ? still + 1 : 0;
          last = element.scrollLeft;
          if (still >= 6) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  return readStrip(strip);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('welcome provider strip', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  // At 1440px the content column is centered; at 600px the strip falls back to
  // its fixed gutter and the arrows share a tight row with Let's go.
  for (const width of [1440, 600]) {
    test(`arrows page through every provider at ${width}px`, async ({ mount, page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const component = await mount(Preview, { props: { step: 'welcome', allProviders: true } });
      const strip = component.locator('#onboarding-provider-strip');
      await expect(strip.locator('[data-provider-id]')).toHaveCount(10);
      const back = component.getByRole('button', { name: 'Previous providers', exact: true });
      const next = component.getByRole('button', { name: 'Next providers', exact: true });
      const letsGo = component.getByRole('button', { name: /Let's go/ });
      await expect(back).toHaveAttribute('aria-disabled', 'true');
      await expect(next).toHaveAttribute('aria-disabled', 'false');
      const capture = async (name: string) => {
        await component.locator('[role=log]').evaluate((log) => (log.scrollTop = log.scrollHeight));
        await testInfo.attach(`${name}-${width}px`, {
          body: await component.screenshot(),
          contentType: 'image/png',
        });
      };

      const start = await readStrip(strip);
      // The arrows stay clear of Let's go and inside the content column.
      const goBox = (await letsGo.boundingBox())!;
      for (const arrow of [back, next]) {
        const box = (await arrow.boundingBox())!;
        expect(overlaps(box, goBox)).toBe(false);
        expect(box.x).toBeGreaterThanOrEqual(start.columnLeft - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(start.columnRight + 1);
      }
      await capture('provider-strip-start');

      const seen = new Set(start.visible);
      const pages = [start];
      while ((await next.getAttribute('aria-disabled')) === 'false') {
        const before = pages.at(-1)!;
        const firstHidden = before.cards.find((card) => card.right > before.stripRight + 1)!;
        await next.click();
        const after = await settleStrip(strip, before.scrollLeft);
        expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft);
        // A press never skips a card the user has not seen in full.
        expect(after.visible).toContain(firstHidden.id);
        after.visible.forEach((id) => seen.add(id));
        pages.push(after);
        if (pages.length === 2) await capture('provider-strip-next');
        expect(pages.length).toBeLessThan(12);
      }
      const end = pages.at(-1)!;
      // Next dims only once the last card is fully in view.
      expect(end.visible).toContain(end.cards.at(-1)!.id);
      expect(seen.size).toBe(end.cards.length);
      await expect(back).toHaveAttribute('aria-disabled', 'false');
      await capture('provider-strip-end');

      // The exhausted arrow keeps focus and ignores further presses.
      await next.focus();
      await page.keyboard.press('Enter');
      await waitFrames(strip, 10);
      await expect(next).toBeFocused();
      expect((await readStrip(strip)).scrollLeft).toBe(end.scrollLeft);

      let current = end;
      while ((await back.getAttribute('aria-disabled')) === 'false') {
        const lastHidden = current.cards.findLast((card) => card.left < current.stripLeft - 1)!;
        await back.click();
        const after = await settleStrip(strip, current.scrollLeft);
        expect(after.scrollLeft).toBeLessThan(current.scrollLeft);
        expect(after.visible).toContain(lastHidden.id);
        current = after;
        expect(current.scrollLeft).toBeGreaterThanOrEqual(0);
      }
      expect(current.scrollLeft).toBe(0);
      expect(current.visible).toContain(current.cards[0]!.id);
      await testInfo.attach(`provider-strip-pages-${width}px`, {
        body: JSON.stringify(
          pages.map(({ scrollLeft, visible }) => ({ scrollLeft, visible })),
          null,
          2,
        ),
        contentType: 'application/json',
      });
    });
  }

  test('presses during a scroll each advance a page', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { step: 'welcome', allProviders: true } });
    const strip = component.locator('#onboarding-provider-strip');
    const next = component.getByRole('button', { name: 'Next providers', exact: true });
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    await next.click();
    const first = await settleStrip(strip, 0);
    await next.click();
    const second = await settleStrip(strip, first.scrollLeft);
    await strip.evaluate((element) => element.scrollTo({ left: 0, behavior: 'instant' }));
    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBe(0);
    // Both clicks land before the first smooth scroll starts moving.
    await next.dblclick();
    expect((await settleStrip(strip, 0)).scrollLeft).toBe(second.scrollLeft);
  });

  test('focusing a hidden card scrolls it into the content column', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { step: 'welcome', allProviders: true } });
    const strip = component.locator('#onboarding-provider-strip');
    await expect(strip.locator('[data-provider-id]')).toHaveCount(10);
    const start = await readStrip(strip);
    const hidden = start.cards.find((card) => !start.visible.includes(card.id))!;
    await strip.locator(`[data-provider-id="${hidden.id}"] [role=button]`).first().focus();
    const after = await settleStrip(strip, 0);
    const card = after.cards.find(({ id }) => id === hidden.id)!;
    expect(card.left).toBeGreaterThanOrEqual(after.columnLeft - 1);
    expect(card.right).toBeLessThanOrEqual(after.columnRight + 1);
  });

  test('hides the arrows when every provider fits', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { step: 'welcome' } });
    const strip = component.locator('#onboarding-provider-strip');
    await expect(strip.locator('[data-provider-id]')).toHaveCount(3);
    await waitFrames(strip, 10);
    await expect(component.getByRole('button', { name: 'Next providers' })).toHaveCount(0);
    await expect(component.getByRole('button', { name: 'Previous providers' })).toHaveCount(0);
  });
});

test.describe('welcome provider strip with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('arrows jump without animating', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { step: 'welcome', allProviders: true } });
    const strip = component.locator('#onboarding-provider-strip');
    const next = component.getByRole('button', { name: 'Next providers', exact: true });
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    await next.click();
    const immediate = await strip.evaluate((element) => element.scrollLeft);
    expect(immediate).toBeGreaterThan(0);
    await waitFrames(strip, 10);
    expect((await readStrip(strip)).scrollLeft).toBe(immediate);
  });
});
