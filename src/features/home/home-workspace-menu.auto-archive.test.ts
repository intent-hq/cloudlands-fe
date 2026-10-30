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
import { createHomeWorkspaceMenu } from './home-workspace-menu';

const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem | undefined;
const ids = (entries: SidebarMenuEntry[]) =>
  entries.map((entry) => ('id' in entry ? entry.id : 'type' in entry ? entry.type : ''));

const close = vi.fn();
let dispatch: ReturnType<typeof vi.spyOn>;
let dispose: (() => void) | undefined;

function setup({
  target = labelWorkspace('ws-target'),
  supported = true,
  role = 'owner',
}: {
  target?: Workspace;
  supported?: boolean;
  role?: 'owner' | 'guest';
} = {}) {
  dispose = store.init(
    workspaceLabelsState({ workspaces: [target], role, autoArchiveOptOut: supported }),
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

describe('Home workspace Disable auto-archive toggle', () => {
  it('offers an unchecked checkbox above Archive for the owner by default', () => {
    const entries = setup();
    const toggle = item(entries, 'disable-auto-archive');
    expect(toggle?.label).toBe('Disable auto-archive');
    expect(toggle?.checked).toBe(false);
    expect(toggle?.submenu).toBeUndefined();
    const order = ids(entries);
    expect(order.indexOf('disable-auto-archive')).toBe(order.indexOf('archive') - 1);
    expect(order[order.indexOf('disable-auto-archive') - 1]).toBe('separator');
  });

  it('turns the opt-out on from an unchecked item', () => {
    item(setup(), 'disable-auto-archive')!.onClick();
    expect(close).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceAutoArchiveDisabled('ws-target', true));
  });

  it('shows the item checked and turns the opt-out off when it is on', () => {
    const entries = setup({ target: labelWorkspace('ws-target', { autoArchiveDisabled: true }) });
    const toggle = item(entries, 'disable-auto-archive')!;
    expect(toggle.checked).toBe(true);
    toggle.onClick();
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceAutoArchiveDisabled('ws-target', false));
  });

  it('is still offered on an archived workspace so the choice carries over to unarchive', () => {
    const entries = setup({
      target: labelWorkspace('ws-target', { status: WorkspaceStatusEnum.Archived }),
    });
    expect(item(entries, 'disable-auto-archive')).toBeDefined();
  });

  it('is hidden when the daemon does not advertise the opt-out', () => {
    const entries = setup({ supported: false });
    expect(item(entries, 'disable-auto-archive')).toBeUndefined();
    expect(item(entries, 'archive')).toBeDefined();
  });

  it('is hidden for a collaborator who does not own the workspace', () => {
    const entries = setup({
      target: labelWorkspace('ws-target', { myRole: 'collaborator' }),
      role: 'guest',
    });
    expect(item(entries, 'disable-auto-archive')).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
