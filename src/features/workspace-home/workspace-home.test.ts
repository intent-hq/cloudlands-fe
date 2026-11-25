import { describe, expect, it } from 'vitest';

import { AgentStatus, WorkspaceStatusEnum, type AgentSession } from '$shared/types';
import type { StartOnOption } from '$features/remote-machines/start-on';
import {
  homeMoveTargetKey,
  isHomeBackedTab,
  moveHomeMenuVisible,
  moveHomeTargets,
  parseMoveHomeTargetKey,
  setHomeErrorCode,
  workspaceHomeView,
  initialHomeRetry,
  nextHomeRetry,
  homeUnavailableError,
  homeErrorView,
} from './workspace-home';
import { homeRunDisabledReason, homeUnavailableText } from './workspace-home-copy';
import { m } from '$shared/paraglide/messages.js';
import { parseWorkspaceHome, type WorkspaceHome } from '$shared/types/workspace-home';

// Shapes from PROTOCOL `methods/nodes.md` → "Workspace homes".
const ATTACHED: WorkspaceHome = {
  homeId: 'h-1',
  nodeId: 'd-mac-studio',
  name: 'Mac Studio',
  state: 'attached',
  since: '2026-11-12T09:00:00Z',
  lastBackupAt: '2026-11-12T09:41:00Z',
};

describe('parseWorkspaceHome', () => {
  it('keeps a documented home as served', () => {
    const cloud = {
      homeId: 'h-2',
      cloudMachineId: 'e2b-team',
      name: 'E2B · Team',
      state: 'moving',
      since: '2026-11-12T10:00:00Z',
      backupWarning: true,
    };
    expect(parseWorkspaceHome(ATTACHED)).toEqual(ATTACHED);
    expect(parseWorkspaceHome(cloud)).toEqual(cloud);
  });

  it('drops a value outside the contract', () => {
    expect(parseWorkspaceHome(undefined)).toBeUndefined();
    expect(parseWorkspaceHome(null)).toBeUndefined();
    expect(parseWorkspaceHome({ ...ATTACHED, state: '' })).toBeUndefined();
    expect(parseWorkspaceHome({ ...ATTACHED, state: 7 })).toBeUndefined();
    expect(parseWorkspaceHome({ ...ATTACHED, name: undefined })).toBeUndefined();
    expect(parseWorkspaceHome({ ...ATTACHED, homeId: '' })).toBeUndefined();
  });
});

describe('parseWorkspaceHome: starting and states this app does not know', () => {
  it('keeps a starting cloud home (nodes.md "Cloud homes" 6)', () => {
    const starting = {
      ...ATTACHED,
      nodeId: undefined,
      cloudMachineId: 'e2b-team',
      state: 'starting',
    };
    expect(parseWorkspaceHome(starting)).toEqual(starting);
  });

  it('keeps a home whose state this app does not know, never dropping it', () => {
    expect(parseWorkspaceHome({ ...ATTACHED, state: 'hibernating' })).toEqual({
      ...ATTACHED,
      state: 'hibernating',
    });
  });
});

describe('workspaceHomeView', () => {
  it('a starting home is unavailable but calm: no banner, no marker, no Wait; Move stays possible', () => {
    const view = workspaceHomeView({ home: { ...ATTACHED, state: 'starting' } });
    expect(view).toMatchObject({
      state: 'starting',
      starting: true,
      unavailable: true,
      banner: null,
      marker: null,
      canWait: false,
      canMove: true,
      moveWarning: false,
    });
  });

  it('an unknown state is unavailable but neutral: no backup or loss warnings', () => {
    const view = workspaceHomeView({ home: { ...ATTACHED, state: 'hibernating' } });
    expect(view).toMatchObject({
      state: 'hibernating',
      starting: false,
      unavailable: true,
      banner: null,
      marker: null,
      canWait: false,
      canMove: true,
      moveWarning: false,
    });
  });

  it('is null for a workspace without a home (homes are gated)', () => {
    expect(workspaceHomeView(undefined)).toBeNull();
    expect(workspaceHomeView({})).toBeNull();
  });

  it('an attached home keeps files available and shows no banner', () => {
    const view = workspaceHomeView({ home: ATTACHED });
    expect(view).toMatchObject({ name: 'Mac Studio', state: 'attached', unavailable: false });
    expect(view?.banner).toBeNull();
    expect(view?.marker).toBeNull();
  });

  it('a detached home blocks files and offers Wait and Move home', () => {
    const view = workspaceHomeView({ home: { ...ATTACHED, state: 'detached' } });
    expect(view).toMatchObject({ unavailable: true, banner: 'detached', marker: 'detached' });
    expect(view?.lastBackupAt).toBe('2026-11-12T09:41:00Z');
    expect(view?.canWait).toBe(true);
    expect(view?.canMove).toBe(true);
  });

  it('a moving home blocks files and offers no second move', () => {
    const view = workspaceHomeView({ home: { ...ATTACHED, state: 'moving' } });
    expect(view).toMatchObject({ unavailable: true, banner: 'moving', marker: 'moving' });
    expect(view?.canWait).toBe(false);
    expect(view?.canMove).toBe(false);
  });

  it('a failing backup on an attached home warns without blocking files', () => {
    const view = workspaceHomeView({ home: { ...ATTACHED, backupWarning: true } });
    expect(view).toMatchObject({ unavailable: false, banner: 'backupWarning', marker: null });
    expect(view?.canMove).toBe(true);
  });

  it('detached wins over a backup warning', () => {
    const view = workspaceHomeView({
      home: { ...ATTACHED, state: 'detached', backupWarning: true },
    });
    expect(view?.banner).toBe('detached');
  });

  it('only the move-old-home warning applies when the old home is not attached', () => {
    expect(workspaceHomeView({ home: ATTACHED })?.moveWarning).toBe(false);
    expect(workspaceHomeView({ home: { ...ATTACHED, state: 'detached' } })?.moveWarning).toBe(true);
  });
});

describe('workspaceHomeView: opening the home (nodes.md "Opening the home")', () => {
  const withSetup = (setup: WorkspaceHome['setup'], fields: Partial<WorkspaceHome> = {}) =>
    workspaceHomeView({ home: { ...ATTACHED, lastBackupAt: undefined, ...fields, setup } });

  it('parses a served setup, and drops only setup when it is outside the contract', () => {
    const setup = { state: 'running', startedAt: '2026-11-12T09:00:05Z' } as const;
    expect(parseWorkspaceHome({ ...ATTACHED, setup })).toEqual({ ...ATTACHED, setup });
    expect(parseWorkspaceHome({ ...ATTACHED, setup: { state: 'warming' } })).toEqual(ATTACHED);
  });

  it('pending: "Setting up home" while the machine prepares the checkout', () => {
    const view = withSetup({ state: 'pending' });
    expect(view).toMatchObject({
      banner: 'opening',
      setup: { phase: 'preparing' },
      unavailable: false,
      marker: null,
    });
  });

  it('running: the setup script step', () => {
    expect(withSetup({ state: 'running' })).toMatchObject({
      banner: 'opening',
      setup: { phase: 'runningSetup' },
    });
  });

  it('starting -> ready: completed or skipped leaves no setup and no banner', () => {
    for (const state of ['completed', 'skipped'] as const) {
      const view = withSetup({ state });
      expect(view?.setup).toBeNull();
      expect(view?.banner).toBeNull();
    }
    expect(withSetup(undefined)?.setup).toBeNull();
  });

  it('starting -> failed: an open that failed keeps its reason', () => {
    const view = withSetup({ state: 'failed', error: 'node-checkout-failed: fetch failed' });
    expect(view).toMatchObject({
      banner: 'setupFailed',
      setup: { phase: 'openFailed', error: 'node-checkout-failed: fetch failed' },
    });
  });

  it('starting -> failed: a setup script that failed keeps its exit code or timeout', () => {
    expect(withSetup({ state: 'failed', exitCode: 2, startedAt: 't' })?.setup).toEqual({
      phase: 'setupFailed',
      exitCode: 2,
      timedOut: false,
      error: null,
    });
    expect(
      withSetup({ state: 'failed', error: 'node-setup-timeout: 30 minutes', startedAt: 't' })
        ?.setup,
    ).toEqual({ phase: 'setupFailed', exitCode: null, timedOut: true, error: null });
    // Any other failure of a started setup keeps its reason.
    expect(
      withSetup({ state: 'failed', error: 'node-setup-failed: no main checkout', startedAt: 't' })
        ?.setup,
    ).toEqual({
      phase: 'setupFailed',
      exitCode: null,
      timedOut: false,
      error: 'node-setup-failed: no main checkout',
    });
  });

  it('a detached or moving home shows its own banner, not the setup', () => {
    expect(withSetup({ state: 'pending' }, { state: 'detached' })?.banner).toBe('detached');
    expect(withSetup({ state: 'failed', error: 'x' }, { state: 'moving' })?.banner).toBe('moving');
  });

  it('opening wins over a backup warning', () => {
    expect(withSetup({ state: 'pending' }, { backupWarning: true })?.banner).toBe('opening');
  });
});

function agent(id: string, fields: Partial<AgentSession>): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: AgentStatus.Active,
    ...fields,
  } as AgentSession;
}

const MACHINE_ROWS: StartOnOption[] = [
  { id: 'host:', label: 'Build box', platform: null, disabled: false },
  { id: 'd-garage', label: 'Garage node', platform: 'Linux x64', disabled: false },
  {
    id: 'd-old',
    label: 'Old box',
    platform: null,
    disabled: true,
    reason: 'Needs an update',
  },
  { id: 'cloud:e2b-team', label: 'E2B · Team', platform: null, disabled: false, kind: 'cloud' },
];

describe('moveHomeTargets', () => {
  it('lists the machine list once, naming the live agents on each machine', () => {
    const targets = moveHomeTargets({
      agents: [
        agent('a-remote', { nodeId: 'd-garage', nodeName: 'Garage node', nodeState: 'ready' }),
        agent('a-second', { nodeId: 'd-garage', nodeState: 'ready' }),
        agent('a-offline', { nodeId: 'd-garage', nodeState: 'offline' }),
        agent('a-local', {}),
        agent('a-failed', {
          nodeId: 'd-garage',
          placementError: { code: 'no-agent-machine', detail: '' },
        }),
        agent('a-deleted', { nodeId: 'd-garage', status: AgentStatus.Deleted }),
        agent('a-retired', { nodeId: 'd-garage', retiredAt: '2026-11-01T00:00:00Z' }),
      ],
      machineRows: MACHINE_ROWS,
    });

    expect(targets.map((target) => target.key)).toEqual([
      'machine:d-garage',
      'machine:d-old',
      'cloud:e2b-team',
    ]);
    expect(targets[0]).toMatchObject({
      kind: 'machine',
      label: 'Garage node',
      nodeId: 'd-garage',
      agents: ['Agent a-remote', 'Agent a-second'],
      platform: 'Linux x64',
      disabled: false,
    });
    expect(targets[1]).toMatchObject({ agents: [], disabled: true, reason: 'Needs an update' });
  });

  it('adds one row per sandbox an agent runs on, after its cloud entry', () => {
    const sandbox = (id: string, nodeId: string, cloudMachineId?: string) =>
      agent(id, {
        nodeId,
        nodeName: `Sandbox ${nodeId}`,
        ...(cloudMachineId
          ? { placement: { target: 'e2b', checkout: 'isolated', cloudMachineId } }
          : {}),
      });
    const targets = moveHomeTargets({
      agents: [
        sandbox('a-orphan', 'sb-gone'),
        sandbox('a-1', 'sb-1', 'e2b-team'),
        sandbox('a-2', 'sb-1', 'e2b-team'),
        sandbox('a-3', 'sb-2', 'e2b-team'),
      ],
      machineRows: [
        ...MACHINE_ROWS,
        { id: 'cloud:other', label: 'Other', platform: null, disabled: false, kind: 'cloud' },
      ],
    });

    expect(targets.map((target) => target.key)).toEqual([
      'machine:d-garage',
      'machine:d-old',
      'cloud:e2b-team',
      'agent:a-1',
      'agent:a-3',
      'cloud:other',
      'agent:a-orphan',
    ]);
    expect(targets[3]).toMatchObject({
      kind: 'agent',
      label: 'Sandbox sb-1',
      nodeId: 'sb-1',
      agents: ['Agent a-1', 'Agent a-2'],
      disabled: false,
    });
  });

  it('maps every target to the documented workspace.setHome `to` shape', () => {
    expect(parseMoveHomeTargetKey(homeMoveTargetKey({ agentId: 'a-1' }))).toEqual({
      agentId: 'a-1',
    });
    expect(
      parseMoveHomeTargetKey(homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' })),
    ).toEqual({ kind: 'machine', nodeId: 'd-garage' });
    expect(
      parseMoveHomeTargetKey(homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'e2b-team' })),
    ).toEqual({ kind: 'cloud', cloudMachineId: 'e2b-team' });
    expect(parseMoveHomeTargetKey('')).toBeNull();
    expect(parseMoveHomeTargetKey('machine:')).toBeNull();
  });
});

describe('setHomeErrorCode', () => {
  it('reads the documented codes from a JSON-RPC error', () => {
    const rpc = (rpcCode: number, code?: string) =>
      Object.assign(new Error('x'), { rpcCode, data: code ? { code } : undefined });
    expect(setHomeErrorCode(rpc(-32602, 'home-moving'))).toBe('home-moving');
    expect(setHomeErrorCode(rpc(-32602, 'home-target-unavailable'))).toBe(
      'home-target-unavailable',
    );
    expect(setHomeErrorCode(rpc(-32602, 'machine-update-required'))).toBe(
      'machine-update-required',
    );
    expect(setHomeErrorCode(rpc(-32602, 'homes-unsupported'))).toBe('homes-unsupported');
    expect(setHomeErrorCode(rpc(-32003))).toBe('forbidden');
    expect(setHomeErrorCode(rpc(-32603, 'something-else'))).toBeNull();
    expect(setHomeErrorCode('boom')).toBeNull();
  });
});

describe('homeUnavailableError (a call failed because the home is away)', () => {
  // 09-error-codes.md: -32603 `home-unavailable` with
  // `{ nodeId?, cloudMachineId?, name, lastBackupAt?, moving?, starting?, retryable }`.
  const rpc = (rpcCode: number, data: unknown) => ({ rpcCode, data });
  const base = { code: 'home-unavailable', name: 'E2B · Team', retryable: true };

  it('reads a starting, moving and detached home from the error data', () => {
    expect(homeUnavailableError(rpc(-32603, { ...base, starting: true }))).toEqual({
      name: 'E2B · Team',
      lastBackupAt: null,
      state: 'starting',
    });
    expect(homeUnavailableError(rpc(-32603, { ...base, moving: true }))?.state).toBe('moving');
    expect(
      homeUnavailableError(
        rpc(-32603, { ...base, nodeId: 'd-1', lastBackupAt: '2026-11-12T09:41:00Z' }),
      ),
    ).toEqual({ name: 'E2B · Team', lastBackupAt: '2026-11-12T09:41:00Z', state: 'detached' });
  });

  it('is null for any other error', () => {
    expect(homeUnavailableError(rpc(-32602, { ...base, starting: true }))).toBeNull();
    expect(homeUnavailableError(rpc(-32603, { code: 'home-reply-too-large' }))).toBeNull();
    expect(homeUnavailableError(rpc(-32603, 'home-unavailable'))).toBeNull();
    expect(homeUnavailableError(rpc(-32603, null))).toBeNull();
    expect(homeUnavailableError(null)).toBeNull();
    expect(homeUnavailableError(new Error('Internal error'))).toBeNull();
  });

  it('keeps the reason when the name is missing or not a string', () => {
    expect(homeUnavailableError(rpc(-32603, { code: 'home-unavailable', starting: true }))).toEqual(
      { name: '', lastBackupAt: null, state: 'starting' },
    );
  });

  it('shows the same reason a panel shows for that state, without Wait', () => {
    const view = (data: object) => homeErrorView(homeUnavailableError(rpc(-32603, data))!);
    expect(view({ ...base, starting: true })).toMatchObject({ starting: true, canWait: false });
    expect(homeUnavailableText(view({ ...base, starting: true }))).toBe(
      m.workspaceHome_starting_label(),
    );
    expect(homeUnavailableText(view({ ...base, moving: true }))).toBe(
      m.workspaceHome_banner_moving(),
    );
    const detached = view(base);
    expect(detached).toMatchObject({ state: 'detached', canWait: false });
    expect(homeUnavailableText(detached)).toBe(
      m.workspaceHome_banner_detachedNoBackup({ name: 'E2B · Team' }),
    );
  });
});

describe('homeRunDisabledReason', () => {
  const view = (state: string) => workspaceHomeView({ home: { ...ATTACHED, state } });

  it('is null without a home or while it is attached', () => {
    expect(homeRunDisabledReason(null)).toBeNull();
    expect(homeRunDisabledReason(view('attached'))).toBeNull();
  });

  it('is the home reason while it is detached, moving, starting or unknown', () => {
    for (const state of ['detached', 'moving', 'starting', 'paused-forever']) {
      const v = view(state)!;
      expect(homeRunDisabledReason(v)).toBe(homeUnavailableText(v));
    }
    expect(homeRunDisabledReason(view('starting'))).toBe(m.workspaceHome_starting_label());
  });
});

describe('isHomeBackedTab by tab type', () => {
  it('gates the panels that read the home checkout or run on the home', () => {
    for (const type of [
      'file',
      'diff',
      'terminal',
      'changes',
      'local-changes',
      'code-review',
      'chat-changes',
      'activity-changes',
    ]) {
      expect(isHomeBackedTab({ type })).toBe(true);
    }
    // Served by the orchestrator itself: chats, notes, discussions, hook code,
    // settings and overviews keep working while the home is away.
    for (const type of [
      'agent',
      'agent-overview',
      'note',
      'discussion',
      'browser',
      'settings',
      'workspace',
      'overview',
      'hook-script',
    ]) {
      expect(isHomeBackedTab({ type })).toBe(false);
    }
  });
});

describe('moveHomeMenuVisible', () => {
  const base = { status: WorkspaceStatusEnum.Active, home: ATTACHED };
  it('offers Move home to owners and managers of a workspace with a movable home', () => {
    expect(moveHomeMenuVisible(base, true)).toBe(true);
    expect(moveHomeMenuVisible({ ...base, home: { ...ATTACHED, state: 'detached' } }, true)).toBe(
      true,
    );
  });

  it('hides it without a home, for collaborators, while moving and on a purged workspace', () => {
    expect(moveHomeMenuVisible({ status: WorkspaceStatusEnum.Active }, true)).toBe(false);
    expect(moveHomeMenuVisible(base, false)).toBe(false);
    expect(moveHomeMenuVisible({ ...base, home: { ...ATTACHED, state: 'moving' } }, true)).toBe(
      false,
    );
    // A Retired workspace shows no Move home dialog, so the item must not open one.
    expect(moveHomeMenuVisible({ ...base, status: WorkspaceStatusEnum.Retired }, true)).toBe(false);
  });
});

describe('isHomeBackedTab', () => {
  it('keeps saved-script output readable: its logs stay on the orchestrator', () => {
    expect(isHomeBackedTab({ type: 'terminal', terminalId: 't-1' })).toBe(true);
    expect(isHomeBackedTab({ type: 'terminal', scriptId: 'build' })).toBe(false);
    expect(isHomeBackedTab({ type: 'file' })).toBe(true);
    expect(isHomeBackedTab({ type: 'note' })).toBe(false);
  });
});

describe('nextHomeRetry (retry once the home is attached)', () => {
  const T0 = Date.parse('2026-11-16T02:00:00Z');
  const at = (
    seconds: number,
    unavailable: boolean,
    workspaceId = 'ws-1',
    contentLoaded = false,
  ) => ({
    workspaceId,
    loaded: true,
    unavailable,
    contentLoaded,
    now: T0 + seconds * 1000,
  });

  it('retries a panel that opened while the home was starting, once it is attached', () => {
    let retry = nextHomeRetry(initialHomeRetry, at(0, true));
    retry = nextHomeRetry(retry, at(5, true));
    expect(retry.generation).toBe(0);
    retry = nextHomeRetry(retry, at(20, false));
    expect(retry).toMatchObject({ generation: 1, waited: false });
    expect(retry.usableSince).not.toBeNull();
    expect(nextHomeRetry(retry, at(25, false))).toBe(retry);
  });

  it('retries a panel whose own read woke a paused cloud home (attached at mount)', () => {
    // A paused home reports attached; the panel's read starts it, waits 10 s, then fails.
    let retry = nextHomeRetry(initialHomeRetry, at(0, false));
    retry = nextHomeRetry(retry, at(2, true));
    retry = nextHomeRetry(retry, at(30, false));
    expect(retry.generation).toBe(1);
  });

  it('never remounts a panel that was usable well before the home went away', () => {
    let retry = nextHomeRetry(initialHomeRetry, at(0, false));
    retry = nextHomeRetry(retry, at(60, true));
    retry = nextHomeRetry(retry, at(90, false));
    expect(retry.generation).toBe(0);
  });

  it('never remounts a panel that reported loaded content, even soon after it opened', () => {
    // An editor that loaded keeps its undo history across a brief early disconnect.
    let retry = nextHomeRetry(initialHomeRetry, at(0, false));
    retry = nextHomeRetry(retry, at(3, true, 'ws-1', true));
    retry = nextHomeRetry(retry, at(20, false, 'ws-1', true));
    expect(retry.generation).toBe(0);
  });

  it('starts over when the panel shows another workspace', () => {
    let retry = nextHomeRetry(initialHomeRetry, at(0, false, 'ws-a'));
    retry = nextHomeRetry(retry, at(100, true, 'ws-b'));
    retry = nextHomeRetry(retry, at(120, false, 'ws-b'));
    expect(retry).toMatchObject({ workspaceId: 'ws-b', generation: 1, waited: false });
  });

  it('waits for the workspace row before deciding anything', () => {
    const retry = nextHomeRetry(initialHomeRetry, { ...at(0, false), loaded: false });
    expect(retry).toBe(initialHomeRetry);
  });
});
