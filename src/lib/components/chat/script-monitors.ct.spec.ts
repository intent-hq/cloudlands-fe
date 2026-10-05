import Preview from './script-monitors.preview.svelte';
import { test, expect } from '../../../test/ct-test';
test('monitor details and menu stay keyboard accessible at narrow width', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview);
  const row = component.getByTestId('script-monitor-row').first();
  const disclosure = row.getByRole('button', { name: 'Frontend checks' }).first();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByText(/Monitoring ends at/)).toBeVisible();
  const trigger = row.getByRole('button', { name: /Actions for/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /panel/i })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /bottom/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const bounds = await row.boundingBox();
  const control = await trigger.boundingBox();
  expect(control!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(control!.x + control!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
});

test('long multiline commands remain selectable and copyable without widening the footer', async ({
  mount,
  page,
  context,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const command = `  printf '%s' '${'unbroken-command-argument'.repeat(18)}'\n    pnpm test -- --run  `;
  const component = await mount(Preview, { props: { command } });
  const row = component.getByTestId('script-monitor-row').first();
  const disclosure = row.getByRole('button', { name: 'Frontend checks' }).first();
  const collapsedBounds = await row.boundingBox();
  await disclosure.click();
  const code = row.getByTestId('script-monitor-command');
  await expect(code).toBeVisible();
  expect(await code.textContent()).toBe(command);
  const geometry = await code.evaluate((element) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const bounds = element.getBoundingClientRect();
    const textRects = Array.from(range.getClientRects());
    return {
      selected: selection.toString(),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      textContained: textRects.every(
        (rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
      ),
    };
  });
  expect(geometry.selected).toBe(command);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  expect(geometry.textContained).toBe(true);
  const expandedBounds = await row.boundingBox();
  expect(expandedBounds!.width).toBe(collapsedBounds!.width);
  const copy = row.getByRole('button', { name: 'Copy command' });
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  await expect(row.getByRole('button', { name: 'Copied' })).toBeVisible();
  await disclosure.click();
  await expect(code).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Copied' })).toHaveCount(0);
});
