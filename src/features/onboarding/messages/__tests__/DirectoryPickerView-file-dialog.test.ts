/**
 * @vitest-environment jsdom
 *
 * DirectoryPickerView as the in-app stand-in for native file dialogs:
 * save mode (default name, extension, overwrite confirmation), multi-select
 * and extension filters.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import type { DirectoryPickerListing } from '$store/renderer/slices/directory-picker/directory-picker-slice';
import DirectoryPickerView from '../DirectoryPickerView.svelte';

const listing: DirectoryPickerListing = {
  path: '/home/me',
  parent: '/home',
  home: '/home/me',
  entries: [
    { name: 'Downloads', path: '/home/me/Downloads', isDirectory: true, isGitRepo: false },
    { name: 'a.png', path: '/home/me/a.png', isDirectory: false, isGitRepo: false },
    { name: 'b.png', path: '/home/me/b.png', isDirectory: false, isGitRepo: false },
    { name: 'report.zip', path: '/home/me/report.zip', isDirectory: false, isGitRepo: false },
    { name: 'notes.txt', path: '/home/me/notes.txt', isDirectory: false, isGitRepo: false },
  ],
};

beforeAll(() => {
  if (!('scrollTo' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'scrollTo', { value: () => {}, configurable: true });
  }
});

afterEach(() => cleanup());

function renderView(props: Record<string, unknown>) {
  const onSelect = vi.fn();
  const onSelectMany = vi.fn();
  const onNavigate = vi.fn();
  render(DirectoryPickerView, {
    props: {
      open: true,
      listing,
      loading: false,
      error: null,
      pathError: null,
      selectLabel: 'Go',
      onClose: vi.fn(),
      onSelect,
      onSelectMany,
      onNavigate,
      onNavigateToPath: vi.fn(),
      onClearPathError: vi.fn(),
      ...props,
    },
  });
  return { onSelect, onSelectMany, onNavigate };
}

const option = (name: string) => screen.getByRole('option', { name: new RegExp(name) });
const goButton = () => screen.getByRole('button', { name: /^(Go|Replace|Select \d+ files)$/ });

describe('save mode', () => {
  it('saves the default file name in the current folder', async () => {
    const { onSelect } = renderView({
      mode: 'save',
      defaultFileName: 'new.zip',
      extensions: ['zip'],
    });
    await fireEvent.click(goButton());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/home/me/new.zip');
  });

  it('adds the filter extension to a bare name', async () => {
    const { onSelect } = renderView({
      mode: 'save',
      defaultFileName: 'bundle',
      extensions: ['zip'],
    });
    await fireEvent.click(goButton());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/home/me/bundle.zip');
  });

  it('asks before replacing an existing file and saves on the second press', async () => {
    const { onSelect } = renderView({
      mode: 'save',
      defaultFileName: 'report.zip',
      extensions: ['zip'],
    });
    await fireEvent.click(goButton());
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('directory-picker-replace-confirm').textContent).toContain(
      'report.zip',
    );
    expect(goButton().textContent?.trim()).toBe('Replace');
    await fireEvent.click(goButton());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/home/me/report.zip');
  });

  it('drops the replace prompt when the name changes', async () => {
    renderView({ mode: 'save', defaultFileName: 'report.zip', extensions: ['zip'] });
    await fireEvent.click(goButton());
    const input = screen.getByRole('textbox', { name: 'File name' });
    await fireEvent.input(input, { target: { value: 'other.zip' } });
    expect(screen.queryByTestId('directory-picker-replace-confirm')).toBeNull();
  });

  it('opens a folder whose name was typed instead of saving over it', async () => {
    const { onSelect, onNavigate } = renderView({ mode: 'save', defaultFileName: 'Downloads' });
    await fireEvent.click(goButton());
    expect(onSelect).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith('/home/me/Downloads');
  });

  it('hides files the filter does not allow', () => {
    renderView({ mode: 'save', defaultFileName: 'x.zip', extensions: ['zip'] });
    expect(screen.queryByRole('option', { name: /notes\.txt/ })).toBeNull();
    expect(option('report.zip')).toBeTruthy();
  });
});

describe('file mode', () => {
  it('returns every picked file with multiple', async () => {
    const { onSelect, onSelectMany } = renderView({
      mode: 'file',
      multiple: true,
      extensions: ['png'],
    });
    await fireEvent.click(option('a.png'));
    await fireEvent.click(option('b.png'));
    expect(goButton().textContent?.trim()).toBe('Select 2 files');
    await fireEvent.click(goButton());
    expect(onSelectMany).toHaveBeenCalledExactlyOnceWith(['/home/me/a.png', '/home/me/b.png']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('toggles a picked file off again', async () => {
    const { onSelectMany } = renderView({ mode: 'file', multiple: true });
    await fireEvent.click(option('a.png'));
    await fireEvent.click(option('b.png'));
    await fireEvent.click(option('a.png'));
    await fireEvent.click(goButton());
    expect(onSelectMany).toHaveBeenCalledExactlyOnceWith(['/home/me/b.png']);
  });

  it('keeps a single pick without multiple', async () => {
    const { onSelect } = renderView({ mode: 'file' });
    await fireEvent.click(option('a.png'));
    await fireEvent.click(option('b.png'));
    await fireEvent.click(goButton());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/home/me/b.png');
  });
});
