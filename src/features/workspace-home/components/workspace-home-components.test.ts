/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceHome } from '$shared/types/workspace-home';
import { homeMoveTargetKey, workspaceHomeView, type MoveHomeOption } from '../workspace-home';
import WorkspaceHomeBanner from './WorkspaceHomeBanner.svelte';
import MoveHomeDialog from './MoveHomeDialog.svelte';

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
    render(WorkspaceHomeBanner, { view: view({ state: 'detached' }), canMove: true, onWait, onMove });
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
    expect(document.querySelector('[data-move-home-warning]')?.textContent).toContain(
      'Mac Studio',
    );
  });
});
