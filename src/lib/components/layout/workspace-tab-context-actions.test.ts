import { describe, expect, it, vi } from 'vitest';
import { isSeparator } from '$lib/components/ui/sidebar-context-menu/types';
import {
  buildWorkspaceTabContextMenu,
  getWorkspaceTabBulkCloseIds,
} from './workspace-tab-context-actions';

describe('workspace tab context actions', () => {
  const order = ['first', 'middle', 'last'];

  it('closes every tab except the target for Close Others', () => {
    expect(getWorkspaceTabBulkCloseIds(order, 'middle', 'others')).toEqual(['first', 'last']);
  });

  it('closes only ordered tabs to the right', () => {
    expect(getWorkspaceTabBulkCloseIds(order, 'first', 'right')).toEqual(['middle', 'last']);
    expect(getWorkspaceTabBulkCloseIds(order, 'middle', 'right')).toEqual(['last']);
    expect(getWorkspaceTabBulkCloseIds(order, 'last', 'right')).toEqual([]);
  });

  it('does nothing for a missing or sole tab', () => {
    expect(getWorkspaceTabBulkCloseIds(['only'], 'only', 'others')).toEqual([]);
    expect(getWorkspaceTabBulkCloseIds(order, 'missing', 'right')).toEqual([]);
  });

  function menu(overrides: Partial<Parameters<typeof buildWorkspaceTabContextMenu>[0]> = {}) {
    const handlers = { onClose: vi.fn(), onCloseTabs: vi.fn() };
    const entries = buildWorkspaceTabContextMenu({
      order,
      workspaceId: 'middle',
      ...handlers,
      ...overrides,
    });
    const ids = entries.map((entry) => (isSeparator(entry) ? '-' : entry.id));
    return { entries, ids, handlers };
  }

  it('builds close, close-others, and close-right wired to the bulk ids', () => {
    const { entries, ids, handlers } = menu();
    expect(ids).toEqual(['close', '-', 'close-others', 'close-right']);

    for (const entry of entries) if ('onClick' in entry) entry.onClick();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onCloseTabs).toHaveBeenNthCalledWith(1, ['first', 'last'], 'middle');
    expect(handlers.onCloseTabs).toHaveBeenNthCalledWith(2, ['last']);
  });

  it('disables bulk closes that would close nothing', () => {
    const { entries } = menu({ order: ['only'], workspaceId: 'only' });
    const disabled = entries.flatMap((entry) =>
      'onClick' in entry && entry.disabled ? [entry.id] : [],
    );
    expect(disabled).toEqual(['close-others', 'close-right']);
    for (const entry of entries) {
      if ('onClick' in entry && entry.disabled) expect(entry.disabledReason).toBeTruthy();
    }
  });
});
