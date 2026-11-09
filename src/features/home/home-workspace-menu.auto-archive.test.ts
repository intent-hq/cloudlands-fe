import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { setWorkspaceAutoArchiveDisabled } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import type {
  SidebarMenuEntry,
  SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import { labelWorkspace, workspaceLabelsState } from '../../test/fixtures/workspace-labels-state';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { createHomeWorkspaceMenu } from './home-workspace-menu';

const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem | undefined;

const close = vi.fn();
let dispatch: ReturnType<typeof vi.spyOn>;
let dispose: (() => void) | undefined;

function setup({
  target = labelWorkspace('ws-target'),
  supported = true,
  role = 'owner',
  autoArchiveIdleAfterDays = 7,
}: {
  target?: Workspace;
  supported?: boolean;
  role?: 'owner' | 'guest';
  autoArchiveIdleAfterDays?: number | null;
} = {}) {
  dispose = store.init(
    workspaceLabelsState({
      workspaces: [target],
      role,
      autoArchiveOptOut: supported,
      autoArchiveIdleAfterDays,
    }),
  );
  dispatch = vi.spyOn(store, 'dispatch').mockImplementation(() => undefined as never);
  return createHomeWorkspaceMenu(target, {
    pinned: false,
    microConnected: false,
    onOpen: vi.fn(),
    onClose: close,
    expandGroup: vi.fn(),
    getHomeElement: () => null,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  dispose?.();
  dispose = undefined;
});

describe('Home workspace Auto-archive switch', () => {
  it('offers the owner a switch that is on by default', () => {
    const toggle = item(setup(), 'auto-archive');
    expect(toggle?.checked).toBe(true);
    expect(toggle?.submenu).toBeUndefined();
  });

  it('turns the opt-out on when switched off and keeps the menu open', () => {
    item(setup(), 'auto-archive')!.onClick();
    expect(close).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceAutoArchiveDisabled('ws-target', true));
  });

  it('shows the switch off and turns the opt-out off when it is on', () => {
    const entries = setup({ target: labelWorkspace('ws-target', { autoArchiveDisabled: true }) });
    const toggle = item(entries, 'auto-archive')!;
    expect(toggle.checked).toBe(false);
    toggle.onClick();
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceAutoArchiveDisabled('ws-target', false));
  });

  it('is still offered on an archived workspace so the choice carries over to unarchive', () => {
    const entries = setup({
      target: labelWorkspace('ws-target', { status: WorkspaceStatusEnum.Archived }),
    });
    expect(item(entries, 'auto-archive')).toBeDefined();
  });

  it('toggles from the value current at click time, not when the menu opened', () => {
    const toggle = item(setup(), 'auto-archive')!;
    dispatch.mockRestore();
    store.dispatch(
      bulkUpdateWorkspaceEntities([
        updateWorkspaceEntity('ws-target', { autoArchiveDisabled: true }),
      ]),
    );
    dispatch = vi.spyOn(store, 'dispatch').mockImplementation(() => undefined as never);
    toggle.onClick();
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceAutoArchiveDisabled('ws-target', false));
  });

  it('is hidden on remote workspaces, which are never auto-archived', () => {
    expect(
      item(setup({ target: labelWorkspace('ws-target', { isRemote: true }) }), 'auto-archive'),
    ).toBeUndefined();
  });

  it('is hidden when the daemon does not advertise the opt-out', () => {
    const entries = setup({ supported: false });
    expect(item(entries, 'auto-archive')).toBeUndefined();
    expect(item(entries, 'archive')).toBeDefined();
  });

  it('is hidden while idle auto-archive is turned off in Settings', () => {
    const entries = setup({ autoArchiveIdleAfterDays: 0 });
    expect(item(entries, 'auto-archive')).toBeUndefined();
    expect(item(entries, 'archive')).toBeDefined();
  });

  it('is hidden even for an opted-out workspace while auto-archive is off', () => {
    const entries = setup({
      target: labelWorkspace('ws-target', { autoArchiveDisabled: true }),
      autoArchiveIdleAfterDays: 0,
    });
    expect(item(entries, 'auto-archive')).toBeUndefined();
  });

  it('is hidden until the auto-archive setting has been read', () => {
    const entries = setup({ autoArchiveIdleAfterDays: null });
    expect(item(entries, 'auto-archive')).toBeUndefined();
  });

  it('is hidden for a collaborator who does not own the workspace', () => {
    const entries = setup({
      target: labelWorkspace('ws-target', { myRole: 'collaborator' }),
      role: 'guest',
    });
    expect(item(entries, 'auto-archive')).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
