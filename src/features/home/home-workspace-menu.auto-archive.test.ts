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
  setWorkspaceHasLoaded,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  principalIdentityChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { createHomeWorkspaceMenu } from './home-workspace-menu';

const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem | undefined;

const close = vi.fn();
let dispatch: ReturnType<typeof vi.spyOn>;
let applyAction: typeof store.dispatch;
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
  applyAction = store.dispatch;
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

function readmitSamePrincipal() {
  const before = store.state.principal;
  applyAction(principalIdentityChanged(before.boundPrincipalId!));
  applyAction(
    principalReceived(
      {
        context: before.context!,
        invalidation: before.invalidation + 1,
        presentationVersion: before.presentationVersion,
      },
      before.snapshot!,
    ),
  );
  applyAction(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  dispose?.();
  dispose = undefined;
});

describe('Home workspace Disable auto-archive toggle', () => {
  it('offers the owner an unchecked toggle by default', () => {
    const toggle = item(setup(), 'disable-auto-archive');
    expect(toggle?.checked).toBe(false);
    expect(toggle?.submenu).toBeUndefined();
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

  it('toggles from the value current at click time, not when the menu opened', () => {
    const toggle = item(setup(), 'disable-auto-archive')!;
    applyAction(
      bulkUpdateWorkspaceEntities([
        updateWorkspaceEntity('ws-target', { autoArchiveDisabled: true }),
      ]),
    );
    toggle.onClick();
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceAutoArchiveDisabled('ws-target', false));

    dispatch.mockClear();
    readmitSamePrincipal();
    toggle.onClick();
    expect(dispatch).not.toHaveBeenCalled();

    // A current callback is also retired when closing the menu changes admission.
    const current = item(
      createHomeWorkspaceMenu(labelWorkspace('ws-target'), {
        pinned: false,
        microConnected: false,
        onOpen: vi.fn(),
        onClose: close,
        expandGroup: vi.fn(),
        getHomeElement: () => null,
      }),
      'disable-auto-archive',
    )!;
    expect(current).toBeDefined();
    close.mockImplementationOnce(readmitSamePrincipal);
    current.onClick();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('is hidden on remote workspaces, which are never auto-archived', () => {
    expect(
      item(
        setup({ target: labelWorkspace('ws-target', { isRemote: true }) }),
        'disable-auto-archive',
      ),
    ).toBeUndefined();
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
