import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarOverflowMenu from './SidebarOverflowMenu.svelte';

afterEach(cleanup);

describe('SidebarOverflowMenu ActionMenu adapter', () => {
  it('preserves grouped entries and dispatches legacy callbacks', async () => {
    const onRename = vi.fn();
    render(SidebarOverflowMenu, {
      props: {
        ariaLabel: 'Workspace actions',
        items: [
          { id: 'rename', label: 'Rename', onClick: onRename },
          { type: 'separator' },
          { id: 'delete', label: 'Delete', destructive: true, onClick: vi.fn() },
        ],
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Workspace actions' }));
    expect(document.querySelectorAll('[data-slot="menu-separator"]')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
