/**
 * @vitest-environment jsdom
 *
 * PathSettingField — readonly path textbox + picker button + clear button,
 * with an optional OK/Cancel confirmation shown before any picker opens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(async ({ openModal }: { openModal: () => void }) => openModal()),
  pickFile: vi.fn(async ({ openModal }: { openModal: () => void }) => openModal()),
}));

vi.mock('$lib/directory-picker-service', () => ({
  pickDirectory: mocks.pickDirectory,
  pickFile: mocks.pickFile,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

// The real modal reads directory listings from the store; stub it with the
// existing mock that renders a "mock select" button reporting /Users/me/src.
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (
    await import('$features/onboarding/messages/__tests__/mocks/MockDirectoryPickerModal.svelte')
  ).default,
}));

import PathSettingField from './PathSettingField.svelte';
import { warmImport } from '../../../test/warm-import';

const flush = async () => {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};

const input = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;
const browseButton = () => screen.getByRole('button', { name: 'Choose folder' });
const clearButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Clear path and restore default' }) as HTMLButtonElement;

const CONFIRM = { title: 'Move workspaces?', message: 'Existing data will be moved.' };

afterEach(() => {
  cleanup();
  mocks.pickDirectory.mockClear();
  mocks.pickFile.mockClear();
});

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('$features/onboarding/messages/__tests__/mocks/MockDirectoryPickerModal.svelte'));

describe('PathSettingField', () => {
  it('renders the value in a readonly textbox', () => {
    render(PathSettingField, { props: { value: '/data/workspaces' } });

    expect(input().value).toBe('/data/workspaces');
    expect(input().readOnly).toBe(true);
  });

  it('opens the directory picker via the service seam without a confirm prop', async () => {
    const onchange = vi.fn();
    render(PathSettingField, {
      props: { value: '/data/workspaces', pickerTitle: 'Pick a folder', onchange },
    });

    await fireEvent.click(browseButton());
    await flush();

    expect(mocks.pickDirectory).toHaveBeenCalledOnce();
    expect(mocks.pickDirectory.mock.calls[0][0]).toMatchObject({
      title: 'Pick a folder',
      defaultPath: '/data/workspaces',
    });

    // The service mock invoked openModal (remote case) — selecting in the
    // modal commits the path and fires onchange.
    await fireEvent.click(screen.getByTestId('mock-picker-select'));
    await flush();

    expect(onchange).toHaveBeenCalledExactlyOnceWith('/Users/me/src');
    expect(input().value).toBe('/Users/me/src');
  });

  it('uses pickFile in file mode', async () => {
    render(PathSettingField, { props: { mode: 'file' as const } });

    await fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    await flush();

    expect(mocks.pickFile).toHaveBeenCalledOnce();
    expect(mocks.pickDirectory).not.toHaveBeenCalled();
  });

  it('shows the confirm dialog before any picker opens; OK proceeds', async () => {
    render(PathSettingField, { props: { confirm: CONFIRM } });

    await fireEvent.click(browseButton());
    await flush();

    expect(mocks.pickDirectory).not.toHaveBeenCalled();
    expect(screen.getByText(CONFIRM.title)).toBeTruthy();
    expect(screen.getByText(CONFIRM.message)).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await flush();

    expect(mocks.pickDirectory).toHaveBeenCalledOnce();
  });

  it('confirm Cancel aborts: no picker opens', async () => {
    render(PathSettingField, { props: { confirm: CONFIRM } });

    await fireEvent.click(browseButton());
    await flush();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();

    expect(mocks.pickDirectory).not.toHaveBeenCalled();
    expect(mocks.pickFile).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM.title)).toBeNull();
  });

  it('clear empties the value and fires onchange', async () => {
    const onchange = vi.fn();
    render(PathSettingField, { props: { value: '/data/workspaces', onchange } });

    await fireEvent.click(clearButton());
    await flush();

    expect(onchange).toHaveBeenCalledExactlyOnceWith('');
    expect(input().value).toBe('');
    expect(clearButton().disabled).toBe(true);
  });

  it('disables the clear button when the value is already empty', () => {
    render(PathSettingField, { props: { value: '' } });

    expect(clearButton().disabled).toBe(true);
  });
});
