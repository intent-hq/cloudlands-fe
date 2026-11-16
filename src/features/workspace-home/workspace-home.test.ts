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
} from './workspace-home';
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

function agent(id: string, fields: Partial<AgentSession>): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: AgentStatus.Active,
    ...fields,
  } as AgentSession;
}

const MACHINE_ROWS: StartOnOption[] = [
  { id: '', label: 'First available machine', platform: null, disabled: false },
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
  it('lists agents on a live machine, then machine rows, without the backend row', () => {
    const targets = moveHomeTargets({
      agents: [
        agent('a-remote', { nodeId: 'd-garage', nodeName: 'Garage node', nodeState: 'ready' }),
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
      'agent:a-remote',
      'machine:d-garage',
      'machine:d-old',
      'cloud:e2b-team',
    ]);
    expect(targets.find((target) => target.key === 'agent:a-remote')).toMatchObject({
      kind: 'agent',
      machineName: 'Garage node',
      nodeId: 'd-garage',
      disabled: false,
    });
    expect(targets.find((target) => target.key === 'machine:d-old')).toMatchObject({
      disabled: true,
      reason: 'Needs an update',
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
  const at = (seconds: number, unavailable: boolean, workspaceId = 'ws-1') => ({
    workspaceId,
    loaded: true,
    unavailable,
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
