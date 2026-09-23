import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LegacyWrappersHarness from './legacy-wrappers.test-harness.svelte';
import type { ComboboxOption } from './types';

describe('legacy searchable and grouped compatibility wrappers', () => {
  afterEach(cleanup);

  it('preserves searchable-select async search and custom-value entry', async () => {
    let settleCustomSearch!: (options: ComboboxOption[]) => void;
    const customSearch = new Promise<ComboboxOption[]>((resolve) => {
      settleCustomSearch = resolve;
    });
    const onSearch = vi
      .fn()
      .mockResolvedValueOnce([{ value: 'remote', label: 'Remote result' }])
      .mockReturnValueOnce(customSearch);
    const onChange = vi.fn();
    render(LegacyWrappersHarness, {
      props: { mode: 'select', selectSearch: onSearch, onChange },
    });
    const input = screen.getByRole('combobox');
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'remote' } });
    expect(await screen.findByRole('option', { name: 'Remote result' })).toBeTruthy();
    expect(onSearch).toHaveBeenCalledWith('remote');

    await fireEvent.input(input, { target: { value: 'custom-person' } });
    expect(input.getAttribute('aria-busy')).toBe('true');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect((input as HTMLInputElement).value).toBe('custom-person');
    settleCustomSearch([]);
    const custom = await screen.findByRole('option', { name: 'Use custom-person' });
    await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBe(custom.id));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('custom-person'));
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves searchable-combobox callbacks, search, snippets, and rename context', async () => {
    const onSearch = vi.fn(() => [{ value: 'remote', label: 'Remote result' }]);
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onRename = vi.fn();
    render(LegacyWrappersHarness, {
      props: { mode: 'searchable', searchableSearch: onSearch, onOpen, onClose, onRename },
    });
    const input = screen.getByRole('combobox');
    await fireEvent.focus(input);
    expect(input.className).toContain('legacy-trigger');
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText('People header')).toBeTruthy();
    expect(screen.getAllByTestId('option-description')).toHaveLength(2);
    expect(screen.getByTestId('legacy-footer')).toBeTruthy();
    expect(screen.getAllByTestId('rename-action')).toHaveLength(2);
    await fireEvent.click(screen.getAllByTestId('rename-action')[0]);
    const renameInput = screen.getByRole('textbox', { name: 'Rename Ada Lovelace' });
    await fireEvent.input(renameInput, { target: { value: 'Ada Byron' } });
    await fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ value: 'ada' }), 'Ada Byron');
    await fireEvent.input(input, { target: { value: 'remote' } });
    expect(await screen.findByRole('option', { name: /Remote result/ })).toBeTruthy();
    expect(onSearch).toHaveBeenCalledWith('remote');
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('renders and commits inline rename with itemActions alone', async () => {
    const onRename = vi.fn();
    render(LegacyWrappersHarness, {
      props: { mode: 'searchable', includeOptionDescription: false, onRename },
    });
    const input = screen.getByRole('combobox');
    await fireEvent.focus(input);
    expect(screen.queryByTestId('option-description')).toBeNull();
    await fireEvent.click(screen.getAllByTestId('rename-action')[0]);
    const renameInput = screen.getByRole('textbox', { name: 'Rename Ada Lovelace' });
    await fireEvent.input(renameInput, { target: { value: 'Ada Byron' } });
    await fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ value: 'ada' }), 'Ada Byron');
  });

  it('preserves grouped search, group/header/footer snippets, and expanded groups', async () => {
    const onSearch = vi.fn(() => [
      { key: 'remote', label: 'Remote', options: [{ value: 'remote', label: 'Remote result' }] },
    ]);
    render(LegacyWrappersHarness, { props: { mode: 'grouped', groupedSearch: onSearch } });
    const input = screen.getByRole('combobox');
    await fireEvent.focus(input);
    expect(screen.getByText('Grouped header')).toBeTruthy();
    expect(screen.getAllByTestId('group-description')).toHaveLength(2);
    expect(screen.getAllByTestId('group-action')).toHaveLength(2);
    expect(screen.getByTestId('header-action')).toBeTruthy();
    expect(screen.getByTestId('legacy-footer')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Linus Torvalds/ })).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'remote' } });
    expect(await screen.findByRole('option', { name: /Remote result/ })).toBeTruthy();
    expect(onSearch).toHaveBeenCalledWith('remote');
  });

  it('preserves grouped collapsed-state controls and open/close callbacks', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(LegacyWrappersHarness, {
      props: { mode: 'grouped', defaultCollapsed: true, onOpen, onClose },
    });
    const input = screen.getByRole('combobox');
    await fireEvent.focus(input);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('option', { name: /Linus Torvalds/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Toggle Others' }));
    expect(screen.getByRole('option', { name: /Linus Torvalds/ })).toBeTruthy();
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it.each(['select', 'searchable', 'grouped'] as const)(
    'forwards naming and recoverable search errors through %s',
    async (mode) => {
      const error = new Error('offline');
      const onSearchError = vi.fn();
      const remote = { value: 'remote', label: 'Remote result' };
      const results =
        mode === 'grouped' ? [{ key: 'remote', label: 'Remote', options: [remote] }] : [remote];
      const onSearch = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(results);
      render(LegacyWrappersHarness, {
        mode,
        ariaLabel: 'Reviewers',
        onSearchError,
        selectSearch: onSearch,
        searchableSearch: onSearch,
        groupedSearch: onSearch,
      });
      const input = screen.getByRole('combobox', { name: 'Reviewers' });
      await fireEvent.focus(input);
      await fireEvent.input(input, { target: { value: 'Remote' } });
      const retry = await screen.findByRole('button', { name: 'Retry' });
      expect(onSearchError).toHaveBeenCalledExactlyOnceWith(error, 'Remote');
      await fireEvent.click(retry);
      const option = await screen.findByRole('option', { name: /Remote result/ });
      await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
      await waitFor(() => expect(screen.getByTestId('legacy-value').textContent).toBe('remote'));
      expect(screen.getByRole('combobox', { name: 'Reviewers' })).toBe(input);
    },
  );

  it('resets grouped search on close and preserves collapsed group controls', async () => {
    render(LegacyWrappersHarness, { mode: 'grouped', defaultCollapsed: true });
    const input = screen.getByRole('combobox');
    await fireEvent.focus(input);
    expect(
      screen.getByRole('button', { name: 'Toggle Others' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByText('No options available')).toBeNull();
    await fireEvent.input(input, { target: { value: 'Linus' } });
    expect(screen.getByRole('option', { name: /Linus Torvalds/ })).toBeTruthy();
    await fireEvent.keyDown(input, { key: 'Escape' });
    await fireEvent.focus(input);
    expect(screen.queryByRole('option', { name: /Linus Torvalds/ })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Toggle Others' });
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('option', { name: /Linus Torvalds/ })).toBeTruthy();
  });

  it('does not select a row when activating its nested rename action', async () => {
    const onChange = vi.fn();
    render(LegacyWrappersHarness, { mode: 'searchable', onChange });
    const input = screen.getByRole('combobox');
    await fireEvent.focus(input);
    const rename = screen.getAllByTestId('rename-action')[0];
    await fireEvent.pointerUp(rename, { button: 0, pointerType: 'mouse' });
    await fireEvent.click(rename);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Rename Ada Lovelace' })).toBeTruthy();
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });
});
