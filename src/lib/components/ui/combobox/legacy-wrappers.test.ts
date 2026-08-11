import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LegacyWrappersHarness from './legacy-wrappers.test-harness.svelte';

describe('legacy searchable and grouped compatibility wrappers', () => {
  afterEach(cleanup);

  it('preserves searchable-select async search and custom-value entry', async () => {
    const onSearch = vi.fn(async () => [{ value: 'remote', label: 'Remote result' }]);
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
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('custom-person'));
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
});
