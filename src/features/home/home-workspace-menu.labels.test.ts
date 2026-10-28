import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import type { Workspace } from '$shared/types';
import {
  setWorkspaceLabel,
  togglePinWorkspace,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { toSidebarActions } from '$lib/components/ui/sidebar-context-menu/actions';
import type {
  SidebarMenuEntry,
  SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import { labelWorkspace, workspaceLabelsState } from '../../test/fixtures/workspace-labels-state';
import { createHomeWorkspaceMenu } from './home-workspace-menu';
import { homeNewLabel } from './home-new-label.svelte';

const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem | undefined;
const ids = (entries: readonly SidebarMenuEntry[] | undefined) =>
  (entries ?? []).map((entry) => ('id' in entry ? entry.id : 'type' in entry ? entry.type : ''));

const close = vi.fn();
const expandGroup = vi.fn();
let dispatch: ReturnType<typeof vi.spyOn>;
let dispose: (() => void) | undefined;

function setup({
  target = labelWorkspace('ws-target'),
  others = [labelWorkspace('ws-b', { label: 'Later' }), labelWorkspace('ws-c', { label: 'Alpha' })],
  supported = true,
  role = 'owner',
  pinned = [],
}: {
  target?: Workspace;
  others?: Workspace[];
  supported?: boolean;
  role?: 'owner' | 'guest';
  pinned?: string[];
} = {}) {
  dispose = store.init(
    workspaceLabelsState({ workspaces: [target, ...others], supported, role, pinned }),
  );
  dispatch = vi.spyOn(store, 'dispatch').mockImplementation(() => undefined as never);
  return createHomeWorkspaceMenu(target, {
    pinned: pinned.includes(target.id) || (supported && target.label === 'pinned'),
    microConnected: false,
    onOpen: vi.fn(),
    onClose: close,
    expandGroup,
    getHomeElement: () => null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  dispose?.();
  dispose = undefined;
  homeNewLabel.close();
});

describe('Home workspace Label submenu', () => {
  it('lists custom labels A–Z, then New label, for an unlabeled workspace', () => {
    const label = item(setup(), 'label');
    expect(label?.selection).toBe('single');
    expect(label?.submenu?.map((child) => child.label)).toEqual(['Alpha', 'Later', 'New label…']);
    expect(label?.submenu?.filter((child) => child.checked)).toEqual([]);
    expect(ids(label?.submenu)).not.toContain('remove-label');
  });

  it('offers only New label when no custom label exists yet', () => {
    const label = item(setup({ others: [] }), 'label');
    expect(ids(label?.submenu)).toEqual(['new-label']);
  });

  it('checks the current custom label and offers Remove label', () => {
    const entries = setup({ target: labelWorkspace('ws-target', { label: 'Later' }) });
    const label = item(entries, 'label')!;
    expect(label.submenu?.find((child) => child.checked)?.label).toBe('Later');
    expect(ids(label.submenu)).toEqual(['label:Alpha', 'label:Later', 'new-label', 'remove-label']);
    item(label.submenu!, 'remove-label')!.onClick();
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceLabel('ws-target', null));
    expect(close).toHaveBeenCalled();
  });

  it('checks nothing and hides Remove label for a pinned workspace', () => {
    const entries = setup({ target: labelWorkspace('ws-target', { label: 'pinned' }) });
    const label = item(entries, 'label')!;
    expect(label.submenu?.filter((child) => child.checked)).toEqual([]);
    expect(ids(label.submenu)).not.toContain('remove-label');
    expect(item(entries, 'pin')?.label).toBe('Unpin');
  });

  it('replaces the current label when a different label is picked and expands its group', () => {
    const entries = setup({ target: labelWorkspace('ws-target', { label: 'pinned' }) });
    item(item(entries, 'label')!.submenu!, 'label:Alpha')!.onClick();
    expect(dispatch).toHaveBeenCalledWith(setWorkspaceLabel('ws-target', 'Alpha'));
    expect(expandGroup).toHaveBeenCalledWith('label:Alpha');
    expect(close).toHaveBeenCalled();
  });

  it('does not rewrite the label when the current label is picked again', () => {
    const entries = setup({ target: labelWorkspace('ws-target', { label: 'Later' }) });
    item(item(entries, 'label')!.submenu!, 'label:Later')!.onClick();
    expect(dispatch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('opens the New label dialog for this workspace', () => {
    const target = labelWorkspace('ws-target');
    item(item(setup({ target }), 'label')!.submenu!, 'new-label')!.onClick();
    expect(close).toHaveBeenCalled();
    expect(homeNewLabel.request).toMatchObject({ workspaceId: 'ws-target', expandGroup });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('renders label choices as one radio group followed by the label commands', () => {
    const entries = setup({ target: labelWorkspace('ws-target', { label: 'Later' }) });
    const [submenu] = toSidebarActions([item(entries, 'label')!]);
    expect(submenu).toMatchObject({ kind: 'submenu' });
    const children = (submenu as { children: { kind: string; id: string }[] }).children;
    expect(children.map((child) => child.kind)).toEqual(['radio-group', 'action', 'action']);
    expect(children[0]).toMatchObject({ value: 'label:Later' });
    expect(children.slice(1).map((child) => child.id)).toEqual(['new-label', 'remove-label']);
  });
});

describe('Home workspace label and pin gating', () => {
  it('lets the owner on a label-capable daemon pin and label', () => {
    const entries = setup();
    expect(item(entries, 'label')).toBeDefined();
    item(entries, 'pin')!.onClick();
    expect(dispatch).toHaveBeenCalledWith(togglePinWorkspace('ws-target'));
    expect(expandGroup).toHaveBeenCalledWith('pinned');
  });

  it('hides Pin and Label from a collaborator on a label-capable daemon', () => {
    const entries = setup({
      target: labelWorkspace('ws-target', { myRole: 'collaborator' }),
      role: 'guest',
    });
    expect(item(entries, 'pin')).toBeUndefined();
    expect(item(entries, 'label')).toBeUndefined();
    expect(item(entries, 'open')).toBeDefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps local Pin for a collaborator on an older daemon but hides Label', () => {
    const entries = setup({
      target: labelWorkspace('ws-target', { myRole: 'collaborator' }),
      role: 'guest',
      supported: false,
    });
    expect(item(entries, 'label')).toBeUndefined();
    item(entries, 'pin')!.onClick();
    expect(dispatch).toHaveBeenCalledWith(togglePinWorkspace('ws-target'));
  });

  it('keeps Pin but hides Label for an owner on an older daemon', () => {
    const entries = setup({ supported: false, pinned: ['ws-target'] });
    expect(item(entries, 'label')).toBeUndefined();
    expect(item(entries, 'pin')?.label).toBe('Unpin');
  });
});
