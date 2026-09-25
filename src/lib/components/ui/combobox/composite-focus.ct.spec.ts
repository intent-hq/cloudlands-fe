import { test, expect } from '../../../../test/ct-test';
import Combobox from './combobox.svelte';
import BrowserViewerTabHeader from '../../browser/BrowserViewerTabHeader.svelte';
import SearchableCombobox from '../searchable-combobox/searchable-combobox.svelte';
import FileInput from '../file-input/file-input.svelte';
import CopyInput from '../copy-input/copy-input.svelte';
import Input from '../input/input.svelte';
import Textarea from '../textarea/textarea.svelte';
import SidebarExpandableSearch from '../../workspace/sidebar/SidebarExpandableSearch.svelte';

for (const kind of ['combobox', 'searchable', 'file', 'copy', 'sidebar'] as const) {
  test(`${kind} has one semantic outline on keyboard focus`, async ({ mount, page }) => {
    if (kind === 'combobox') await mount(Combobox, { props: { ariaLabel: 'Person', options: [] } });
    else if (kind === 'searchable')
      await mount(SearchableCombobox, { props: { placeholder: 'Person', options: [] } });
    else if (kind === 'file') await mount(FileInput, { props: { id: 'upload' } });
    else if (kind === 'copy') await mount(CopyInput, { props: { value: 'example' } });
    else
      await mount(SidebarExpandableSearch, { props: { placeholder: 'Search', scope: 'agents' } });
    const trigger = page.getByRole(
      kind === 'combobox' || kind === 'searchable' ? 'combobox' : 'button',
    );
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveCSS('outline-style', 'solid');
    await expect(trigger).toHaveCSS('outline-width', '1px');
    if (kind === 'combobox' || kind === 'searchable') {
      const outlineExtent = await trigger.evaluate((node) => {
        const style = getComputedStyle(node);
        return parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      });
      expect(outlineExtent).toBeLessThanOrEqual(0);
    } else {
      await expect(trigger).toHaveCSS('outline-offset', '2px');
    }
    const colors = await trigger.evaluate((node) => {
      const style = getComputedStyle(node);
      const token = document.createElement('span');
      token.style.color = `hsl(${style.getPropertyValue('--focus-ring')})`;
      document.body.appendChild(token);
      const expected = getComputedStyle(token).color;
      token.remove();
      return { expected };
    });
    await expect(trigger).toHaveCSS('outline-color', colors.expected);
    if (kind === 'sidebar') {
      await page.keyboard.press('Enter');
      await expect(page.getByRole('searchbox')).toBeFocused();
      await expect(page.getByRole('searchbox')).toHaveCSS('outline-style', 'none');
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveCSS('outline-style', 'solid');
    }
  });
}

for (const kind of ['input', 'textarea'] as const) {
  test(`${kind} uses caret-only keyboard focus by default`, async ({ mount, page }) => {
    if (kind === 'input') await mount(Input, { props: { 'aria-label': 'Text' } });
    else await mount(Textarea, { props: { 'aria-label': 'Text' } });
    const field = page.getByRole('textbox');
    const restShadow = await field.evaluate((node) => getComputedStyle(node).boxShadow);
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
    await expect(field).toHaveCSS('outline-style', 'none');
    const textColor = await field.evaluate((node) => getComputedStyle(node).color);
    await expect(field).toHaveCSS('caret-color', textColor);
    await expect(field).toHaveCSS('box-shadow', restShadow);
  });

  test(`${kind} stays quiet on keyboard focus with noFocusStyle`, async ({ mount, page }) => {
    if (kind === 'input')
      await mount(Input, { props: { 'aria-label': 'Text', noFocusStyle: true } });
    else await mount(Textarea, { props: { 'aria-label': 'Text', noFocusStyle: true } });
    const field = page.getByRole('textbox');
    const restShadow = await field.evaluate((node) => getComputedStyle(node).boxShadow);
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
    await expect(field).toHaveCSS('outline-style', 'none');
    await expect(field).toHaveCSS('box-shadow', restShadow);
  });
}

test('browser address trigger has a semantic ring and its editor stays quiet', async ({
  mount,
  page,
}) => {
  await mount(BrowserViewerTabHeader, {
    props: { url: 'https://intentapp.dev', host: { name: 'local', connected: true } },
  });
  const trigger = page.getByRole('button', { name: 'Edit browser address' });
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('Tab');
    if (await trigger.evaluate((node) => node === document.activeElement)) break;
  }
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('outline-style', 'none');
  const expectedColor = await trigger.evaluate((node) => {
    const token = document.createElement('span');
    token.style.color = `hsl(${getComputedStyle(node).getPropertyValue('--focus-ring')})`;
    document.body.appendChild(token);
    const color = getComputedStyle(token).color;
    token.remove();
    return color;
  });
  await expect
    .poll(() => trigger.evaluate((node) => getComputedStyle(node).boxShadow))
    .toContain(expectedColor);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox')).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveCSS('outline-style', 'none');
});
