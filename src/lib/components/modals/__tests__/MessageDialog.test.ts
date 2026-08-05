/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const PROPS = {
  open: true,
  title: 'File Already Exists',
  message: 'A file named "a.txt" already exists at this location. What would you like to do?',
  type: 'warning' as const,
  buttons: ['Skip', 'Rename', 'Overwrite'],
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../MessageDialog.svelte'));

describe('MessageDialog', () => {
  it('renders title, message, and one button per label; clicks resolve the button index', async () => {
    const onSelect = vi.fn();
    const MessageDialog = (await import('../MessageDialog.svelte')).default;

    render(MessageDialog, { props: { ...PROPS, onSelect } });

    expect(await screen.findByRole('alertdialog', { name: 'File Already Exists' })).toBeTruthy();
    expect(screen.getByText(PROPS.message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('resolves the cancel index (default 0) on Escape', async () => {
    const onSelect = vi.fn();
    const MessageDialog = (await import('../MessageDialog.svelte')).default;

    render(MessageDialog, { props: { ...PROPS, onSelect } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'File Already Exists' });
    await fireEvent.keyDown(dialogEl, { key: 'Escape' });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('does not dismiss on backdrop click — an explicit choice is required', async () => {
    const onSelect = vi.fn();
    const MessageDialog = (await import('../MessageDialog.svelte')).default;

    render(MessageDialog, { props: { ...PROPS, onSelect } });

    const dialogEl = await screen.findByRole('alertdialog', { name: 'File Already Exists' });
    await fireEvent.click(dialogEl.parentElement!);

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'File Already Exists' })).toBeTruthy();
  });

  it('renders nothing when closed', async () => {
    const MessageDialog = (await import('../MessageDialog.svelte')).default;

    render(MessageDialog, { props: { ...PROPS, open: false, onSelect: vi.fn() } });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
