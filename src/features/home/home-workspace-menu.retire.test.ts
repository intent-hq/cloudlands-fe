import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { createMockWorkspace } from '../../test/factories/workspace.factory';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import {
  type SidebarMenuEntry,
  type SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import { createHomeWorkspaceMenu } from './home-workspace-menu';

const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem | undefined;

function menuFor(overrides: Partial<Workspace>) {
  const target = createMockWorkspace({
    id: WorkspaceId('home-retire'),
    title: 'Target',
    myRole: 'owner',
    ...overrides,
  });
  store.dispatch(replaceWorkspaceList([target]));
  return createHomeWorkspaceMenu(target, {
    pinned: false,
    microConnected: false,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    expandPinned: vi.fn(),
    getHomeElement: () => null,
  });
}

beforeEach(() => {
  store.init();
  admitLegacyPrincipal();
});

describe('Home workspace menu retire actions', () => {
  it.each([
    ['active', { status: WorkspaceStatus.Active }],
    ['archived', { status: WorkspaceStatus.Archived, archived: true }],
  ] as const)('offers Retire on an %s workspace and opens the confirmation', (_, overrides) => {
    const retire = item(menuFor(overrides), 'retire');
    expect(retire?.label).toBe(m.workspace_retire_menu_label());
    retire!.onClick();
    expect(store.state.workspaceOperations.showRetireConfirm).toBe(true);
    expect(store.state.workspaceOperations.pendingRetireWorkspaceId).toBe('home-retire');
  });

  it('offers Restore as blank workspace (no Retire, no Archive) on a retired workspace', () => {
    const entries = menuFor({
      status: WorkspaceStatus.Retired,
      archived: true,
      retiredAt: '2026-10-20T00:00:00Z',
    });
    expect(item(entries, 'retire')).toBeUndefined();
    const restore = item(entries, 'archive');
    expect(restore?.label).toBe(m.workspace_retire_restore_label());
    expect(item(entries, 'delete')).toBeDefined();
  });
});
