import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import {
  hydrateHardwareConsoleKeyPins,
  pinWorkspaceToKey,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { selectHardwareConsoleKeySlots } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { WorkspaceStatus } from '$shared/types';
import type {
  SidebarMenuEntry,
  SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import { createMockWorkspace } from '../../../../test/factories/workspace.factory';
import { UNASSIGNED_KEY_PIN } from '../key-assignment';
import { createMicroKeyAssignmentItems, createWorkspaceMicroKeyMenu } from '../workspace-key-menu';

const workspace = createMockWorkspace({ id: WorkspaceId('menu-target') });
const occupant = createMockWorkspace({ id: WorkspaceId('menu-occupant') });
const spare = createMockWorkspace({ id: WorkspaceId('menu-spare') });
const excludedCases = [
  { name: 'archived status', workspace: { ...workspace, status: WorkspaceStatus.Archived } },
  { name: 'deleted status', workspace: { ...workspace, status: WorkspaceStatus.Deleted } },
  { name: 'legacy archived flag', workspace: { ...workspace, archived: true } },
  { name: 'Assistant workspace', workspace: { ...workspace, id: CHIEF_WORKSPACE_ID } },
  { name: 'missing workspace', workspace: undefined },
];
const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem;

beforeEach(() => {
  store.init();
  store.dispatch(replaceWorkspaceList([workspace, occupant, spare]));
  store.dispatch(
    hydrateHardwareConsoleKeyPins(
      [UNASSIGNED_KEY_PIN, occupant.id, ...Array(4).fill(UNASSIGNED_KEY_PIN)],
      [workspace.id],
    ),
  );
});

describe('Micro assignment eligibility', () => {
  it.each(excludedCases)('omits both menu forms for $name', ({ workspace: excluded }) => {
    store.dispatch(replaceWorkspaceList([...(excluded ? [excluded] : []), occupant, spare]));
    const before = store.state.hardwareConsole;
    const id = excluded?.id ?? workspace.id;
    expect(createMicroKeyAssignmentItems(id, vi.fn())).toEqual([]);
    expect(createWorkspaceMicroKeyMenu(id, { connected: true, onClose: vi.fn() })).toEqual([]);
    expect(store.state.hardwareConsole).toBe(before);
  });

  it.each(excludedCases.filter(({ name }) => name !== 'Assistant workspace'))(
    'rejects stale assignment after $name without overwriting saved slots or exclusions',
    ({ workspace: excluded }) => {
      const close = vi.fn();
      const commands = createMicroKeyAssignmentItems(workspace.id, close);
      store.dispatch(replaceWorkspaceList([...(excluded ? [excluded] : []), occupant, spare]));
      const before = store.state.hardwareConsole;
      item(commands, 'assign-micro-key-1').onClick();
      item(commands, 'assign-micro-key-2').onClick();
      expect(store.state.hardwareConsole).toBe(before);
      expect(selectHardwareConsoleKeySlots.select(store.state)).toEqual([
        null,
        occupant.id,
        null,
        null,
        null,
        null,
      ]);
      expect(close).toHaveBeenCalledTimes(2);
    },
  );

  it('does not unassign a replacement occupant through an old menu', () => {
    store.dispatch(pinWorkspaceToKey(0, workspace.id));
    const close = vi.fn();
    const commands = createMicroKeyAssignmentItems(workspace.id, close);
    store.dispatch(pinWorkspaceToKey(0, occupant.id));
    const before = store.state.hardwareConsole;
    item(commands, 'unassign-micro-key').onClick();
    expect(store.state.hardwareConsole).toBe(before);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not unassign an archived workspace through an old menu', () => {
    store.dispatch(pinWorkspaceToKey(0, workspace.id));
    const commands = createMicroKeyAssignmentItems(workspace.id, vi.fn());
    store.dispatch(replaceWorkspaceList([{ ...workspace, archived: true }, occupant, spare]));
    const before = store.state.hardwareConsole;
    item(commands, 'unassign-micro-key').onClick();
    expect(store.state.hardwareConsole).toBe(before);
  });
});
