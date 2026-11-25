/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceHome } from '$shared/types/workspace-home';
import { homeMoveTargetKey, workspaceHomeView, type MoveHomeOption } from '../workspace-home';
import WorkspaceHomeBanner from './WorkspaceHomeBanner.svelte';
import MoveHomeDialog from './MoveHomeDialog.svelte';
import WorkspaceHomeLine from './WorkspaceHomeLine.svelte';
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

describe('WorkspaceHomeBanner while the home opens (nodes.md "Opening the home")', () => {
  const OPENING = { lastBackupAt: undefined } as const;

  it('a home still opening shows its step and opens the output log on request', async () => {
    const onToggleOutput = vi.fn();
    const { rerender } = render(WorkspaceHomeBanner, {
      view: view({ ...OPENING, setup: { state: 'running', startedAt: 't' } }),
      onToggleOutput,
    });
    expect(screen.getByRole('status').textContent).toContain('Mac Studio');
    expect(screen.queryByRole('alert')).toBeNull();
    const toggle = screen.getByRole('button', { name: m.remoteAgent_setup_showOutput() });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle);
    expect(onToggleOutput).toHaveBeenCalledTimes(1);

    await rerender({
      view: view({ ...OPENING, setup: { state: 'running', startedAt: 't' } }),
      onToggleOutput,
      outputOpen: true,
      output: 'pnpm install\n',
    });
    const hide = screen.getByRole('button', { name: m.remoteAgent_setup_hideOutput() });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    const log = screen.getByRole('log');
    expect(log.textContent).toContain('pnpm install');
    expect(document.getElementById(hide.getAttribute('aria-controls')!)?.contains(log)).toBe(true);
    // Opening is calm: no dismiss and no Move home.
    expect(
      screen.queryByRole('button', { name: m.workspaceHome_setupFailed_dismiss() }),
    ).toBeNull();
  });

  it('a failed open is announced with its reason, Move home for managers and dismiss', async () => {
    const onMove = vi.fn();
    const onDismiss = vi.fn();
    render(WorkspaceHomeBanner, {
      view: view({
        ...OPENING,
        setup: { state: 'failed', error: 'node-checkout-failed: could not fetch' },
      }),
      canMove: true,
      onMove,
      onDismiss,
      onToggleOutput: () => {},
    });
    expect(screen.getByRole('alert').textContent).toContain('Mac Studio');
    expect(document.body.textContent).toContain('could not fetch');
    expect(document.body.textContent).not.toContain('node-checkout-failed');
    await fireEvent.click(screen.getByRole('button', { name: m.workspaceHome_move_label() }));
    await fireEvent.click(
      screen.getByRole('button', { name: m.workspaceHome_setupFailed_dismiss() }),
    );
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a failed setup script offers no Move home: the home works', () => {
    render(WorkspaceHomeBanner, {
      view: view({ ...OPENING, setup: { state: 'failed', exitCode: 2, startedAt: 't' } }),
      canMove: true,
      onDismiss: () => {},
      onToggleOutput: () => {},
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.workspaceHome_move_label() })).toBeNull();
    expect(
      screen.getByRole('button', { name: m.workspaceHome_setupFailed_dismiss() }),
    ).toBeTruthy();
  });

  it('a ready home shows no banner', () => {
    render(WorkspaceHomeBanner, {
      view: view({ ...OPENING, setup: { state: 'completed', exitCode: 0 } }),
      onToggleOutput: () => {},
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

const GARAGE = homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' });
const OLD = homeMoveTargetKey({ kind: 'machine', nodeId: 'd-old' });
const OPTIONS: MoveHomeOption[] = [
  {
    key: GARAGE,
    kind: 'machine',
    label: 'Garage node',
    nodeId: 'd-garage',
    agents: ['Builder'],
    platform: 'Linux x64',
    disabled: false,
  },
  {
    key: OLD,
    kind: 'machine',
    label: 'Old laptop',
    nodeId: 'd-old',
    agents: [],
    platform: null,
    disabled: true,
  },
  {
    key: homeMoveTargetKey({ agentId: 'agent-1' }),
    kind: 'agent',
    label: 'Sandbox 1',
    nodeId: 'sb-1',
    agents: ['Reviewer', 'Tester'],
    platform: null,
    disabled: false,
  },
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

    await fireEvent.click(screen.getByRole('radio', { name: /Sandbox 1/ }));
    await fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenLastCalledWith({ agentId: 'agent-1' });
  });

  it('shows each machine once, with the agents that run there', () => {
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: OPTIONS,
      currentKey: GARAGE,
      currentNodeId: 'd-garage',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    const garage = screen.getByRole('radio', { name: /Garage node/ });
    expect(garage.textContent).toContain(
      m.workspaceHome_moveDialog_agentDescription({ agent: 'Builder' }),
    );
    expect(garage.textContent).toContain(m.workspaceHome_moveDialog_currentHome());
    expect(garage.textContent).toContain('Linux x64');
    expect(screen.getByRole('radio', { name: /Sandbox 1/ }).textContent).toContain(
      m.workspaceHome_moveDialog_agentsDescription({ agents: 'Reviewer and Tester' }),
    );
    expect(
      radios.filter((radio) =>
        radio.textContent?.includes(m.workspaceHome_moveDialog_currentHome()),
      ),
    ).toHaveLength(1);
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

  it('marks a sandbox row on the current home machine as the current home', () => {
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: [
        { ...OPTIONS[2], key: homeMoveTargetKey({ agentId: 'agent-2' }), nodeId: 'd-mac-studio' },
      ],
      currentNodeId: 'd-mac-studio',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(screen.getByRole('radio').textContent).toContain(
      m.workspaceHome_moveDialog_currentHome(),
    );
  });

  it('marks only the sandbox of a cloud home, not its cloud entry', () => {
    render(MoveHomeDialog, {
      open: true,
      static: true,
      view: view({}),
      options: [
        {
          key: homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'e2b-team' }),
          kind: 'cloud',
          label: 'E2B · Team',
          platform: null,
          disabled: false,
        },
        { ...OPTIONS[2], nodeId: 'sb-home' },
      ],
      currentKey: homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'e2b-team' }),
      currentNodeId: 'sb-home',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    const current = screen
      .getAllByRole('radio')
      .filter((radio) => radio.textContent?.includes(m.workspaceHome_moveDialog_currentHome()));
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('Sandbox 1');
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
    let nowMs = 0;
    render(Harness, { workspaceId: 'ws-gate', clock: () => nowMs });
    const child = await vi.waitFor(() => {
      const el = document.querySelector('[data-gated-child]');
      expect(el).toBeTruthy();
      return el;
    });
    const setHome = (home: WorkspaceHome) =>
      store.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-gate', { home })]));

    // The panel has been usable for a while (past the wake window) before the detach.
    nowMs = 60_000;
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

  it('keeps a panel that reported loaded content across a brief early disconnect', async () => {
    store.init();
    store.dispatch(setWorkspaceEntity(labelWorkspace('ws-loaded', { home: HOME })));
    render(Harness, { workspaceId: 'ws-loaded', reportsContent: true });
    const child = await vi.waitFor(() => {
      const el = document.querySelector('[data-gated-child]');
      expect(el).toBeTruthy();
      return el;
    });
    const setHome = (home: WorkspaceHome) =>
      store.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-loaded', { home })]));

    setHome({ ...HOME, state: 'detached', since: '2026-11-16T02:00:02Z' });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-workspace-home-panel-notice]')).toBeTruthy(),
    );
    setHome({ ...HOME, state: 'attached', since: '2026-11-16T02:00:09Z' });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-workspace-home-panel-notice]')).toBeNull(),
    );
    expect(document.querySelector('[data-gated-child]')).toBe(child);
  });

  it('retries a panel whose own read woke a paused cloud home', async () => {
    store.init();
    // A paused cloud home reports attached until a read wakes it.
    store.dispatch(setWorkspaceEntity(labelWorkspace('ws-paused', { home: HOME })));
    render(Harness, { workspaceId: 'ws-paused' });
    const before = await vi.waitFor(() => {
      const el = document.querySelector('[data-gated-child]');
      expect(el).toBeTruthy();
      return el;
    });
    const setHome = (home: WorkspaceHome) =>
      store.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-paused', { home })]));

    setHome({ ...HOME, state: 'starting', since: '2026-11-16T02:00:01Z' });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-workspace-home-panel-notice="starting"]')).toBeTruthy(),
    );
    setHome({ ...HOME, state: 'attached', since: '2026-11-16T02:00:15Z' });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-workspace-home-panel-notice]')).toBeNull(),
    );
    expect(document.querySelector('[data-gated-child]')).not.toBe(before);
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
    { key: CLOUD, kind: 'cloud', label: 'E2B 4x8', agents: [], platform: null, disabled: false },
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

describe('WorkspaceHomeLine while the home starts', () => {
  it('keeps the entry name and announces "Starting home…" once', () => {
    render(WorkspaceHomeLine, {
      view: view({ name: 'E2B · Team', state: 'starting', since: '2026-11-16T02:00:00Z' }),
    });
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toContain(m.workspaceHome_starting_label());
    expect(document.body.textContent).toContain('E2B · Team');
    // No detached or moving marker while it starts.
    expect(document.querySelector('[data-workspace-home-marker]')).toBeNull();
  });
});
