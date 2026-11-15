/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceHome } from '$shared/types/workspace-home';
import { homeMoveTargetKey, workspaceHomeView, type MoveHomeOption } from '../workspace-home';
import WorkspaceHomeBanner from './WorkspaceHomeBanner.svelte';
import MoveHomeDialog from './MoveHomeDialog.svelte';
import MoveHomeDialogHost from './MoveHomeDialogHost.svelte';
import Harness from './WorkspaceHomePanelGateHarness.svelte';
import { store } from '$store/renderer/store';
import {
  bulkUpdateWorkspaceEntities,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { moveHomeDialogClosed, moveHomeDialogOpened } from '../workspace-home-slice';
import { labelWorkspace } from '../../../test/fixtures/workspace-labels-state';

const HOME: WorkspaceHome = {
  homeId: 'h-1',
  nodeId: 'd-mac-studio',
  name: 'Mac Studio',
  state: 'attached',
  since: '2026-11-12T09:00:00Z',
  lastBackupAt: '2026-11-12T09:41:00Z',
};
const view = (home: Partial<WorkspaceHome>) => workspaceHomeView({ home: { ...HOME, ...home } })!;

describe('WorkspaceHomeBanner', () => {
  it('shows nothing for an attached home with working backups', () => {
    render(WorkspaceHomeBanner, { view: view({}), canMove: true });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a detached home offers Wait and, for owners and managers, Move home', async () => {
    const onWait = vi.fn();
    const onMove = vi.fn();
    render(WorkspaceHomeBanner, {
      view: view({ state: 'detached' }),
      canMove: true,
      onWait,
      onMove,
    });
    expect(screen.getByRole('status').textContent).toContain('Mac Studio');

    await fireEvent.click(screen.getByRole('button', { name: m.workspaceHome_wait_label() }));
    await fireEvent.click(screen.getByRole('button', { name: m.workspaceHome_move_label() }));
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('a collaborator can wait but not move', () => {
    render(WorkspaceHomeBanner, { view: view({ state: 'detached' }), canMove: false });
    expect(screen.getByRole('button', { name: m.workspaceHome_wait_label() })).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.workspaceHome_move_label() })).toBeNull();
  });

  it('Wait is disabled while a retry runs', () => {
    render(WorkspaceHomeBanner, { view: view({ state: 'detached' }), waiting: true });
    const wait = screen.getByRole('button', { name: new RegExp(m.workspaceHome_wait_label()) });
    expect((wait as HTMLButtonElement).disabled).toBe(true);
  });

  it('a moving home offers no action', () => {
    render(WorkspaceHomeBanner, { view: view({ state: 'moving' }), canMove: true });
    expect(document.querySelector('[data-workspace-home-banner="moving"]')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

const GARAGE = homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' });
const OLD = homeMoveTargetKey({ kind: 'machine', nodeId: 'd-old' });
const OPTIONS: MoveHomeOption[] = [
  {
    key: homeMoveTargetKey({ agentId: 'agent-1' }),
    kind: 'agent',
    label: 'Reviewer',
    machineName: 'Garage node',
    platform: null,
    disabled: false,
  },
  { key: GARAGE, kind: 'machine', label: 'Garage node', platform: null, disabled: false },
  { key: OLD, kind: 'machine', label: 'Old laptop', platform: null, disabled: true },
];

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: m.workspaceHome_moveDialog_submit(),
  }) as HTMLButtonElement;
}

describe('MoveHomeDialog', () => {
  it('sends the chosen target in the workspace.setHome shape', async () => {
    const onSubmit = vi.fn();
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: OPTIONS,
      onSubmit,
      onCancel: vi.fn(),
    });
    expect(submitButton().disabled).toBe(true);

    await fireEvent.click(screen.getByRole('radio', { name: /Reviewer/ }));
    await fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenLastCalledWith({ agentId: 'agent-1' });
  });

  it('cannot submit a machine that cannot be a home', async () => {
    const onSubmit = vi.fn();
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: OPTIONS,
      initialKey: OLD,
      onSubmit,
      onCancel: vi.fn(),
    });
    expect(submitButton().disabled).toBe(true);
  });

  it('warns about changes after the last backup only when the old home is detached', () => {
    const props = {
      open: true,
      static: true,
      options: OPTIONS,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };
    const attached = render(MoveHomeDialog, { ...props, view: view({}) });
    expect(document.querySelector('[data-move-home-warning]')).toBeNull();
    attached.unmount();

    render(MoveHomeDialog, { ...props, view: view({ state: 'detached' }) });
    expect(document.querySelector('[data-move-home-warning]')?.textContent).toContain('Mac Studio');
  });
});

describe('MoveHomeDialog while the home moves', () => {
  it('cannot submit once another move has started', async () => {
    const onSubmit = vi.fn();
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({ state: 'moving' }),
      options: OPTIONS,
      initialKey: GARAGE,
      onSubmit,
      onCancel: vi.fn(),
    });
    expect(submitButton().disabled).toBe(true);
    await fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('marks an agent on the current home machine as the current home', () => {
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: [
        { ...OPTIONS[0], key: homeMoveTargetKey({ agentId: 'agent-2' }), nodeId: 'd-mac-studio' },
      ],
      currentNodeId: 'd-mac-studio',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(screen.getByRole('radio').textContent).toContain(
      m.workspaceHome_moveDialog_currentHome(),
    );
  });
});

describe('MoveHomeDialogHost', () => {
  it('opens only in the surface of the workspace the dialog is for', async () => {
    store.init();
    for (const id of ['ws-a', 'ws-b']) {
      store.dispatch(setWorkspaceEntity(labelWorkspace(id, { home: { ...HOME, homeId: id } })));
    }
    render(MoveHomeDialogHost, { workspaceId: 'ws-a' });
    render(MoveHomeDialogHost, { workspaceId: 'ws-b' });

    store.dispatch(moveHomeDialogOpened('ws-b'));
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-move-home-dialog]')).toHaveLength(1),
    );
    store.dispatch(moveHomeDialogClosed());
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-move-home-dialog]')).toHaveLength(0),
    );
  });
});

describe('WorkspaceHomePanelGate', () => {
  it('keeps the panel mounted under the notice, so unsaved work survives a detach', async () => {
    store.init();
    store.dispatch(setWorkspaceEntity(labelWorkspace('ws-gate', { home: HOME })));
    render(Harness, { workspaceId: 'ws-gate' });
    const child = await vi.waitFor(() => {
      const el = document.querySelector('[data-gated-child]');
      expect(el).toBeTruthy();
      return el;
    });
    const setHome = (home: WorkspaceHome) =>
      store.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-gate', { home })]));

    setHome({ ...HOME, state: 'detached', since: '2026-11-12T09:42:00Z' });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-workspace-home-panel-notice]')).toBeTruthy(),
    );
    expect(document.querySelector('[data-gated-child]')).toBe(child);

    setHome({ ...HOME, since: '2026-11-12T09:50:00Z' });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-workspace-home-panel-notice]')).toBeNull(),
    );
    expect(document.querySelector('[data-gated-child]')).toBe(child);
  });
});

describe('WorkspaceHomePanelGate while a cloud home starts', () => {
  it('shows a calm notice, then remounts the panel once the home is attached', async () => {
    store.init();
    const starting: WorkspaceHome = { ...HOME, state: 'starting', since: '2026-11-15T09:00:00Z' };
    store.dispatch(setWorkspaceEntity(labelWorkspace('ws-start', { home: starting })));
    render(Harness, { workspaceId: 'ws-start' });

    const notice = await vi.waitFor(() => {
      const el = document.querySelector('[data-workspace-home-panel-notice="starting"]');
      expect(el).toBeTruthy();
      return el!;
    });
    // Calm: no Wait or Move home while it starts.
    expect(notice.querySelectorAll('button')).toHaveLength(0);
    const before = document.querySelector('[data-gated-child]');

    store.dispatch(
      bulkUpdateWorkspaceEntities([
        updateWorkspaceEntity('ws-start', {
          home: { ...HOME, state: 'attached', since: '2026-11-15T09:00:20Z' },
        }),
      ]),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-workspace-home-panel-notice]')).toBeNull(),
    );
    const after = document.querySelector('[data-gated-child]');
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });
});

describe('MoveHomeDialog cloud entries', () => {
  const CLOUD = homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'e2b-4x8' });
  const CLOUD_OPTIONS: MoveHomeOption[] = [
    ...OPTIONS,
    { key: CLOUD, kind: 'cloud', label: 'E2B 4x8', platform: null, disabled: false },
    {
      key: homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'northflank' }),
      kind: 'cloud',
      label: 'Northflank',
      platform: null,
      disabled: true,
      reason: 'Key rejected',
    },
  ];

  it('says a cloud entry starts a new sandbox and moves the home there', async () => {
    const onSubmit = vi.fn();
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: CLOUD_OPTIONS,
      onSubmit,
      onCancel: vi.fn(),
    });
    const cloud = screen.getByRole('radio', { name: /E2B 4x8/ });
    expect(cloud.textContent).toContain(m.workspaceHome_moveDialog_cloudStartsSandbox());
    await fireEvent.click(cloud);
    await fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenLastCalledWith({ kind: 'cloud', cloudMachineId: 'e2b-4x8' });
  });

  it('shows an unusable cloud entry disabled with its reason instead', () => {
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: CLOUD_OPTIONS,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    const blocked = screen.getByRole('radio', { name: /Northflank/ }) as HTMLButtonElement;
    expect(blocked.textContent).toContain('Key rejected');
    expect(blocked.textContent).not.toContain(m.workspaceHome_moveDialog_cloudStartsSandbox());
  });
});
