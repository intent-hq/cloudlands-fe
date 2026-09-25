// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Combobox from './combobox.svelte';
import SearchableCombobox from '../searchable-combobox/searchable-combobox.svelte';
import CopyInput from '../copy-input/copy-input.svelte';
import FileInput from '../file-input/file-input.svelte';
import SidebarExpandableSearch from '../../workspace/sidebar/SidebarExpandableSearch.svelte';
import BrowserViewerTabHeader from '../../browser/BrowserViewerTabHeader.svelte';

const options = [{ value: 'ada', label: 'Ada' }];
afterEach(cleanup);

describe('composed text-entry keyboard focus', () => {
  it.each([
    ['canonical', () => render(Combobox, { props: { options, ariaLabel: 'Person' } })],
    [
      'searchable wrapper',
      () => render(SearchableCombobox, { props: { options, placeholder: 'Person' } }),
    ],
  ] as const)('retains the semantic outline for the %s combobox', async (_, mount) => {
    const view = mount();
    const trigger = view.getByRole('combobox');
    trigger.focus();
    await fireEvent.focus(trigger);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.classList.contains('focus-visible:outline-solid')).toBe(true);
    expect(trigger.classList.contains('focus-visible:outline-none')).toBe(false);
    expect(view.getByRole('listbox')).toBeTruthy();
  });

  it.each([
    ['file picker', () => render(FileInput, { props: { id: 'upload' } })],
    ['copy action', () => render(CopyInput, { props: { value: 'example' } })],
  ] as const)('keeps the global keyboard outline on the %s action', (_, mount) => {
    const trigger = mount().getByRole('button');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.className).not.toMatch(/(?:^|\s)(?:focus-visible:)?outline-none(?:\s|$)/);
  });

  it('restores an indicated search trigger after leaving the quiet editable field', async () => {
    const view = render(SidebarExpandableSearch, {
      props: { placeholder: 'Search', scope: 'agents' },
    });
    await fireEvent.click(view.getByRole('button', { name: 'Search' }));
    const input = view.getByRole('searchbox');
    expect(input.classList.contains('focus-visible:outline-none')).toBe(true);
    await fireEvent.keyDown(input, { key: 'Escape' });
    const trigger = view.getByRole('button', { name: 'Search' });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.classList.contains('focus-visible:outline-solid')).toBe(true);
  });

  it('uses the focus token for the address trigger while editing remains quiet', async () => {
    const view = render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev', host: { name: 'local', connected: true } },
    });
    const trigger = view.container.querySelector<HTMLButtonElement>(
      '.focus-visible\\:ring-focus-ring',
    )!;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.classList.contains('focus-visible:ring-1')).toBe(true);
    await fireEvent.click(trigger);
    expect(view.getByRole('textbox').classList.contains('focus-visible:outline-none')).toBe(true);
  });
});
