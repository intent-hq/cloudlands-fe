import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { hydrateHardwareConsoleKeyPins } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { selectHardwareConsoleKeySlots } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
import { UNASSIGNED_KEY_PIN } from '$features/hardware-console/assignment/key-assignment';
import { createMockWorkspace } from '../../test/factories/workspace.factory';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import {
  type SidebarMenuEntry,
  type SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import { createHomeWorkspaceMenu } from './home-workspace-menu';

const workspace = createMockWorkspace({ id: WorkspaceId('home-menu'), title: 'Target' });
const occupant = createMockWorkspace({
  id: WorkspaceId('home-occupant'),
  title: 'Other workspace',
});
const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem | undefined;
const close = vi.fn();
function menu(connected = true, target = workspace) {
  return createHomeWorkspaceMenu(target, {
    pinned: false,
    microConnected: connected,
    onOpen: vi.fn(),
    onClose: close,
    expandPinned: vi.fn(),
    getHomeElement: () => null,
  });
}
beforeEach(() => {
  store.init();
  vi.clearAllMocks();
  store.dispatch(replaceWorkspaceList([workspace, occupant]));
  store.dispatch(
    hydrateHardwareConsoleKeyPins(
      [
        UNASSIGNED_KEY_PIN,
        occupant.id,
        UNASSIGNED_KEY_PIN,
        UNASSIGNED_KEY_PIN,
        UNASSIGNED_KEY_PIN,
        UNASSIGNED_KEY_PIN,
      ],
      [workspace.id],
    ),
  );
});

describe('Home workspace Micro menu', () => {
  it('assigns an unnumbered workspace to any slot and retains occupied-slot semantics', () => {
    const assign = item(menu(), 'assign-micro-key');
    expect(assign?.submenu).toHaveLength(6);
    expect(item(menu(), 'unassign-micro-key')).toBeUndefined();
    expect(assign?.submenu?.[1].label).toContain('Other workspace');
    assign!.submenu![1].onClick();
    expect(store.state.hardwareConsole.keyPins[1]).toBe(workspace.id);
    expect(store.state.hardwareConsole.excludedWorkspaceIds).not.toContain(workspace.id);
    expect(selectHardwareConsoleKeySlots.select(store.state)[1]).toBe(workspace.id);
    expect(close).toHaveBeenCalledOnce();
    expect(item(menu(), 'assign-micro-key')?.submenu?.[1].checked).toBe(true);
    item(menu(), 'assign-micro-key')!.submenu![5].onClick();
    expect(selectHardwareConsoleKeySlots.select(store.state).indexOf(workspace.id)).toBe(5);
    item(menu(), 'unassign-micro-key')!.onClick();
    expect(store.state.hardwareConsole.keyPins[5]).toBe(UNASSIGNED_KEY_PIN);
    expect(store.state.hardwareConsole.excludedWorkspaceIds).toContain(workspace.id);
    expect(selectHardwareConsoleKeySlots.select(store.state)).not.toContain(workspace.id);
  });

  it('keeps Home list and board actions but omits assignment for archived workspaces', () => {
    const archived = { ...workspace, status: WorkspaceStatus.Archived };
    store.dispatch(replaceWorkspaceList([archived, occupant]));
    const entries = menu(true, archived);
    expect(item(entries, 'assign-micro-key')).toBeUndefined();
    expect(item(entries, 'unassign-micro-key')).toBeUndefined();
    expect(item(entries, 'open')).toBeDefined();
    expect(item(entries, 'pin')).toBeDefined();
  });

  it('hides assignment when disconnected without changing saved assignments or other actions', () => {
    const before = store.state.hardwareConsole;
    expect(item(menu(false), 'assign-micro-key')).toBeUndefined();
    expect(item(menu(false), 'unassign-micro-key')).toBeUndefined();
    expect(item(menu(false), 'open')).toBeDefined();
    expect(item(menu(false), 'pin')).toBeDefined();
    expect(store.state.hardwareConsole).toBe(before);
  });
});
