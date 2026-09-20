import { expect, test } from '@playwright/experimental-ct-svelte';
import Preview from './onboarding-layout.preview.svelte';

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
