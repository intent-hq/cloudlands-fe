import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockWorkspace } from '../../../test/factories/workspace.factory';
import { WorkspaceId } from '$shared/types/branded-ids';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { store } from '$store/renderer/store';
import { hydrateHardwareConsoleKeyPins } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { UNASSIGNED_KEY_PIN } from '$features/hardware-console/assignment/key-assignment';
import { type SidebarMenuItem, isSeparator } from '$lib/components/ui/sidebar-context-menu/types';
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

describe('workspace tab hardware assignment', () => {
  beforeEach(() => {
    store.init();
    store.dispatch(replaceWorkspaceList([createMockWorkspace({ id: WorkspaceId('target') })]));
    store.dispatch(hydrateHardwareConsoleKeyPins(Array(6).fill(UNASSIGNED_KEY_PIN), ['target']));
  });

  function hardwareMenu(microConnected = true) {
    const onDismiss = vi.fn();
    const onClose = vi.fn();
    const entries = buildWorkspaceTabContextMenu({
      order: ['target', 'other'],
      workspaceId: 'target',
      microConnected,
      onClose,
      onCloseTabs: vi.fn(),
      onDismiss,
    });
    const item = (id: string) =>
      entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem | undefined;
    return { item, onDismiss, onClose };
  }

  it('assigns an initially unnumbered tab and dismisses without closing the tab', () => {
    const { item, onDismiss, onClose } = hardwareMenu();
    expect(item('unassign-micro-key')).toBeUndefined();
    const choices = item('assign-micro-key')?.submenu;
    expect(choices).toHaveLength(6);
    choices![5].onClick();
    expect(store.state.hardwareConsole.keyPins[5]).toBe('target');
    expect(store.state.hardwareConsole.excludedWorkspaceIds).not.toContain('target');
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    const assigned = hardwareMenu();
    expect(assigned.item('assign-micro-key')?.submenu?.[5].checked).toBe(true);
    assigned.item('unassign-micro-key')!.onClick();
    expect(store.state.hardwareConsole.keyPins[5]).toBe(UNASSIGNED_KEY_PIN);
    expect(store.state.hardwareConsole.excludedWorkspaceIds).toContain('target');
  });

  it('keeps close actions while disconnected and preserves saved assignments', () => {
    store.dispatch(hydrateHardwareConsoleKeyPins(['target', ...Array(5).fill(UNASSIGNED_KEY_PIN)]));
    const before = store.state.hardwareConsole;
    const { item } = hardwareMenu(false);
    expect(item('assign-micro-key')).toBeUndefined();
    expect(item('unassign-micro-key')).toBeUndefined();
    expect(item('close')).toBeDefined();
    expect(item('close-others')).toBeDefined();
    expect(item('close-right')).toBeDefined();
    expect(store.state.hardwareConsole).toBe(before);
  });
});
