import { expect, test } from '../../../../../test/ct-test';
import MentionResultsPreview from '../mention-results.preview.svelte';

// Normal composer width and minimum supported narrow preview width.
for (const width of [420, 240]) {
  test(`mixed mention rows stay separate and bounded at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 640 });
    await mount(MentionResultsPreview);
    const rows = page.locator('.mention-item');
    await expect(rows).toHaveCount(5);
    await page.evaluate(() => document.fonts.ready);
    const geometry = await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const row = element.getBoundingClientRect();
        const label = element.querySelector('.mention-label')!.getBoundingClientRect();
        const subtitle = element.querySelector('.mention-subtitle')!.getBoundingClientRect();
        return {
          x: row.x,
          y: row.y,
          width: row.width,
          bottom: row.bottom,
          right: row.right,
          labelBottom: label.bottom,
          subtitleY: subtitle.y,
          contentOverflow: element.scrollWidth > element.clientWidth + 1,
        };
      }),
    );
    await page.screenshot({ path: testInfo.outputPath('mixed-results.png') });
    await testInfo.attach('row-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    for (const [index, row] of geometry.entries()) {
      expect(row.right).toBeLessThanOrEqual(width);
      expect(row.contentOverflow).toBe(false);
      expect(row.subtitleY).toBeGreaterThanOrEqual(row.labelBottom);
      if (index > 0) {
        expect(row.y).toBeGreaterThanOrEqual(geometry[index - 1].bottom);
        expect(Math.abs(row.width - geometry[0].width)).toBeLessThan(1);
      }
    }
    await page.getByRole('textbox').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('mention-selection')).toHaveText(
      'specialist:specialist-developer',
    );
  });
}

test('filtering to no matches clears stale selection, then recovers', async ({ mount, page }) => {
  await mount(MentionResultsPreview);
  const input = page.getByRole('textbox');
  await input.fill('no-such-result');
  await expect(page.locator('.mention-item')).toHaveCount(0);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByTestId('mention-selection')).toBeEmpty();
  await input.fill('service');
  await expect(page.locator('.mention-item')).toHaveCount(1);
  await input.press('Enter');
  await expect(page.getByTestId('mention-selection')).toHaveText('script:script-development');
  await input.press('Escape');
  await expect(page.locator('.enhanced-mention-list')).toHaveCount(0);
  await expect(input).toBeFocused();
});

test('keyboard wrap scrolls the newly selected row into view immediately', async ({
  mount,
  page,
}) => {
  await mount(MentionResultsPreview, { props: { state: 'many' } });
  const input = page.getByRole('textbox');
  await input.focus();
  await input.press('ArrowUp');
  const last = page.locator('.mention-item').last();
  await expect(last).toHaveClass(/selected/);
  await expect
    .poll(() =>
      last.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const list = element.closest('.mention-items')!.getBoundingClientRect();
        return row.top >= list.top && row.bottom <= list.bottom + 1;
      }),
    )
    .toBe(true);
  await input.press('Enter');
  await expect(page.getByTestId('mention-selection')).toHaveText('file:file-23');
});

test('composer filtering, keyboard and mouse preserve mention insertion and focus', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 560, height: 720 });
  await mount(MentionResultsPreview, { props: { state: 'composer' } });
  const editor = page.getByRole('textbox', { name: 'Mention composer' });
  await editor.fill('@devel');
  await expect(page.locator('.mention-item')).toHaveCount(5);
  await editor.press('ArrowDown');
  await editor.press('Enter');
  await expect(editor.locator('[data-type="specialist"]')).toHaveAttribute(
    'data-uri',
    'devspace://specialist/developer',
  );
  await expect(editor).toBeFocused();
  await expect(page.locator('.mention-popup')).toHaveCount(0);
  await editor.fill('@service');
  await expect(page.locator('.mention-item')).toHaveCount(1);
  await page.locator('.mention-item').click();
  await expect(editor.locator('[data-type="script"]')).toHaveAttribute(
    'data-uri',
    'devspace://script/development',
  );
  await expect(editor).toBeFocused();
  await editor.fill('@devel');
  await expect(page.locator('.mention-item')).toHaveCount(5);
  await editor.press('Escape');
  await expect(page.locator('.mention-popup')).toHaveCount(0);
  await expect(editor).toBeFocused();
});

test('composer popup fits limited viewport space without hiding its scroll area', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 240, height: 280 });
  await mount(MentionResultsPreview, { props: { state: 'composer', composerTop: 100 } });
  const editor = page.getByRole('textbox', { name: 'Mention composer' });
  await editor.fill('@devel');
  await expect(page.locator('.mention-item')).toHaveCount(5);
  const geometry = await page.locator('.enhanced-mention-list').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const scroller = element.querySelector('.mention-items')!;
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(280);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(240);
  expect(geometry.clientHeight).toBeGreaterThan(0);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  await page.screenshot({ path: testInfo.outputPath('limited-viewport.png') });
});

test('loading and empty results remain inert and recover to selectable rows', async ({
  mount,
  page,
}) => {
  const component = await mount(MentionResultsPreview, { props: { state: 'loading' } });
  const input = page.getByRole('textbox');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByTestId('mention-selection')).toBeEmpty();
  await component.update({ props: { state: 'empty' } });
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page.getByTestId('mention-selection')).toBeEmpty();
  await component.update({ props: { state: 'mixed' } });
  await page.locator('.mention-item').first().click();
  await expect(page.getByTestId('mention-selection')).toHaveText('agent:mention-preview-agent');
  await expect(input).toBeFocused();
});
