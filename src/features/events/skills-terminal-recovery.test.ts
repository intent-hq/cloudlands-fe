import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectTerminalsForWorkspace: {
    select: (s: any, id: string) => Object.values(s.terminals.workspaces[id]?.terminals.map ?? {}),
  },
}));
vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: vi.fn() } }));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActionContext: { select: (s: { authority: string }) => s.authority },
}));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectHostRole: { select: () => 'owner' },
  selectPrincipalActionContext: { select: (s: { authority: string }) => s.authority },
}));
vi.mock('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors', () => ({
  selectMountedWorkspaceIds: { select: (s: { mounted: string[] }) => s.mounted },
}));
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { skillsReducer, setSkills } from '$store/renderer/slices/skills/skills-slice';
import {
  terminalsReducer,
  loadWorkspaceTerminals,
} from '$store/renderer/slices/terminals/terminals-slice';
import type { StoreState } from '$store/renderer/types';
import { RendererEventRecovery } from './renderer-event-recovery';
import { installSkillsRecovery, skillsRecoveryKey } from './skills-recovery';
import { installTerminalListRecovery, terminalsRecoveryKey } from './terminal-list-recovery';
async function settle() {
  for (let i = 0; i < 150; i++) await Promise.resolve();
}
function harness(active = true) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let receive!: (n: RecoveryNotification) => void;
  let state = {
    authority: 'A',
    mounted: active ? ['ws'] : [],
    skills: skillsReducer(undefined, setSkills('ws', [{ name: 'old', location: '/old' }])),
    terminals: terminalsReducer(
      undefined,
      loadWorkspaceTerminals('ws', [{ id: 'old', name: 'Old' }]),
    ),
  };
  const listeners = new Set<() => void>();
  const store = {
    getState: () => state as unknown as StoreState,
    dispatch: (action: { type: string }) => {
      state = {
        ...state,
        skills: skillsReducer(state.skills, action),
        terminals: terminalsReducer(state.terminals, action),
      };
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe') return { subscriptionId: 'lease', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'skill.list') return [{ name: 'new', location: '/new' }];
    if (method === 'terminal.list') return { terminals: [], daemonBootId: 'boot' };
    throw new Error(method);
  });
  const registry = new RendererEventRecovery();
  registry.onSession((scope) => {
    const stops = [installSkillsRecovery(scope, store), installTerminalListRecovery(scope, store)];
    return () => stops.forEach((stop) => stop());
  });
  const scope = registry.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onNotification: (fn) => {
        receive = fn;
        return () => {};
      },
      onRetired: () => () => {},
      request: async (m, p, observe) => {
        const result = await request(m, p);
        observe?.(result);
        return result;
      },
      dispose: () => {},
    }),
  );
  return {
    registry,
    scope,
    request,
    state: () => state,
    change: (patch: Partial<typeof state>) => {
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    loss: () =>
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'lease', generation: '1', scope: { workspaceId: null } },
      }),
  };
}
afterEach(() => vi.useRealTimers());
describe('skills and terminal list recovery', () => {
  it('recovers a final skill edit and terminal removal into actual reducers with exact bounded reads', async () => {
    const h = harness();
    await h.scope.subscribe({ eventTypes: ['*'] }, { recover: true });
    const old = h.registry.capture(terminalsRecoveryKey('ws'));
    h.loss();
    await settle();
    expect(h.state().skills.byWorkspaceId.ws.skills.map((s) => s.name)).toEqual(['new']);
    expect(h.state().terminals.workspaces.ws.terminals.ids).toEqual([]);
    expect(h.request.mock.calls.filter(([m]) => m === 'skill.list')).toHaveLength(1);
    expect(h.request.mock.calls.filter(([m]) => m === 'terminal.list')).toHaveLength(1);
    expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(4);
    expect(
      old.commit(() => {
        throw new Error('obsolete terminal reply');
      }),
    ).toBe(false);
    h.registry.dispose();
  });
  it('defers inactive rows until their actual workspace is mounted', async () => {
    const h = harness(false);
    await h.scope.subscribe({ eventTypes: ['*'] }, { recover: true });
    h.loss();
    await settle();
    expect(
      h.request.mock.calls.filter(([m]) => m === 'skill.list' || m === 'terminal.list'),
    ).toHaveLength(0);
    h.change({ mounted: ['ws'] });
    await settle();
    expect(h.state().skills.byWorkspaceId.ws.skills.map((s) => s.name)).toEqual(['new']);
    expect(h.state().terminals.workspaces.ws.terminals.ids).toEqual([]);
    h.registry.dispose();
  });
  it('never re-admits the same authority after an observed A B A transition without factory renewal', async () => {
    const h = harness();
    await h.scope.subscribe({ eventTypes: ['*'] }, { recover: true });
    const old = h.registry.capture(skillsRecoveryKey('ws'));
    h.change({ authority: 'B' });
    h.change({ authority: 'A' });
    expect(old.commit(() => {})).toBe(false);
    expect(h.registry.capture(skillsRecoveryKey('ws')).commit(() => {})).toBe(false);
    expect(h.registry.capture(terminalsRecoveryKey('ws')).commit(() => {})).toBe(false);
    h.registry.dispose();
  });
});
