import { expect, test } from '../../test/ct-test';
import Preview from './onboarding-layout.preview.svelte';

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

for (const width of [720, 1280]) {
  for (const step of ['welcome', 'forge', 'project', 'configuring'] as const) {
    test(`${step} shares the content edge at ${width}px`, async ({ mount, page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const component = await mount(Preview, { props: { step } });
      const heading = component.locator('h1,h2').first();
      await expect(heading).toBeVisible();
      const root = await component.boundingBox();
      const expectedLeft = root!.x + Math.max(36, (root!.width - 1024) / 2);
      await expect
        .poll(async () => Math.abs((await heading.boundingBox())!.x - expectedLeft))
        .toBeLessThanOrEqual(1);
      const content =
        step === 'welcome'
          ? component.locator('div[role=button]').first()
          : step === 'configuring'
            ? component.locator('.rich-input-container')
            : step === 'forge'
              ? component.getByRole('button', { name: /Connect GitHub/, exact: true })
              : component.getByRole('button', { name: /Let's go/ });
      await expect
        .poll(async () => Math.abs((await content.boundingBox())!.x - expectedLeft))
        .toBeLessThanOrEqual(1);
      if (step === 'configuring') {
        const metadata = component.locator('.onboarding-metadata-row').first();
        const action = component.getByRole('button', { name: /Create workspace/ });
        expect(Math.abs((await metadata.boundingBox())!.x - expectedLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs((await action.boundingBox())!.x - expectedLeft)).toBeLessThanOrEqual(1);
      }
    });
  }
}

for (const compact of [false, true]) {
  test(`${compact ? 'New Workspace' : 'Step4'} leaves top space inside the empty and typed editor`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    const component = await mount(Preview, { props: { compact } });
    const editor = component.locator('.rich-textarea [contenteditable=true]');
    await expect(editor).toBeVisible();
    const measure = () =>
      editor.evaluate((element) => {
        const paragraph = element.querySelector('p')!;
        return {
          top: paragraph.getBoundingClientRect().top - element.getBoundingClientRect().top,
          padding: parseFloat(getComputedStyle(element).paddingTop),
        };
      });
    const empty = await measure();
    expect(empty.padding).toBeGreaterThanOrEqual(12);
    expect(empty.top).toBeGreaterThanOrEqual(12);
    await editor.fill('A comfortable place to start a workspace.');
    await expect(editor).toContainText('A comfortable place to start a workspace.');
    expect(await measure()).toEqual(empty);
  });
}

test('starter suggestions have tight text gaps and preserve keyboard selection and shuffle', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 900 });
  const component = await mount(Preview);
  const editor = component.locator('.rich-textarea [contenteditable=true]');
  const options = component.getByRole('option');
  await expect(options).toHaveCount(4);
  // Inter is `font-display: swap`: until the woff2 lands, the fallback-font heading above the
  // composer wraps to a second 48px line, so a baseline measured before the swap is stale.
  await page.evaluate(() => document.fonts.ready);
  const measureGeometry = () =>
    options.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const list = element.closest('[role=listbox]')!.getBoundingClientRect();
        const title = element
          .querySelector('[data-slot="action-row-title"]')!
          .getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          right: box.right,
          listRight: list.right,
          textTop: title.top,
          textBottom: title.bottom,
        };
      }),
    );
  const geometry = await measureGeometry();
  geometry
    .slice(1)
    .forEach((box, i) => expect(Math.abs(box.top - geometry[i]!.bottom)).toBeLessThanOrEqual(1));
  geometry.forEach((box) => expect(box.right).toBeLessThanOrEqual(box.listRight));
  // Touching row boxes alone misses the padding that separates visible suggestion text.
  geometry.forEach((box) => expect(box.height).toBe(24));
  geometry.slice(1, -1).forEach((box, i) => {
    const textGap = box.textTop - geometry[i]!.textBottom;
    expect(textGap).toBeGreaterThanOrEqual(0);
    expect(textGap).toBeLessThanOrEqual(4);
  });
  await options.first().hover();
  expect(await measureGeometry()).toEqual(geometry);
  await options.first().focus();
  expect(await measureGeometry()).toEqual(geometry);
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
