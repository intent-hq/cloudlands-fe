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
    expandGroup: vi.fn(),
    getHomeElement: () => null,
  });
}

beforeEach(() => {
  store.init();
  admitLegacyPrincipal();
});

describe('Home workspace menu archive and purge actions', () => {
  it('offers only Archive (no purge) on an active workspace', () => {
    const entries = menuFor({ status: WorkspaceStatus.Active });
    expect(item(entries, 'archive')?.label).toBe(m.workspace_card_archive_label());
    expect(item(entries, 'purge')).toBeUndefined();
    expect(item(entries, 'retire')).toBeUndefined();
  });

  it('offers Unarchive and Purge workspace folder on an archived workspace', () => {
    const entries = menuFor({ status: WorkspaceStatus.Archived, archived: true });
    expect(item(entries, 'archive')?.label).toBe(m.ui_workspaceActions_unarchiveSpace_label());
    const purge = item(entries, 'purge');
    expect(purge?.label).toBe(m.workspace_purge_menu_label());
    purge!.onClick();
    expect(store.state.workspaceOperations.showRetireConfirm).toBe(true);
    expect(store.state.workspaceOperations.pendingRetireWorkspaceId).toBe('home-retire');
  });

  it('presents a purged workspace as archived: Unarchive, no purge', () => {
    const entries = menuFor({
      status: WorkspaceStatus.Retired,
      archived: true,
      retiredAt: '2026-10-20T00:00:00Z',
    });
    expect(item(entries, 'purge')).toBeUndefined();
    const unarchive = item(entries, 'archive');
    expect(unarchive?.label).toBe(m.ui_workspaceActions_unarchiveSpace_label());
    unarchive!.onClick();
    expect(item(entries, 'delete')).toBeDefined();
  });
});
