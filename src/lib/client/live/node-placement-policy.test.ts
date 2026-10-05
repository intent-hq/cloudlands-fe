import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareNodeRequest as prepareWithCapabilities } from './node-placement-policy';
function prepareNodeRequest(
  ...args: [string, unknown, (method: string, params?: unknown) => Promise<unknown>, () => boolean]
) {
  return prepareWithCapabilities(...args, () => args[2]('client.hello', {}));
}
import { setLocale } from '$shared/paraglide/runtime.js';
afterEach(() => setLocale('en', { reload: false }));
const capabilities = { agentNodes: 1, localNodeIsolation: 1 };
function fixture(defaultPlacement?: unknown, runsOn?: unknown) {
  return vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'client.hello') return { server: { capabilities } };
    if (method === 'workspace.get')
      return { workspace: { defaultAgentPlacement: defaultPlacement } };
    if (method === 'specialist.get') return { specialist: { runsOn } };
    throw new Error(`Unexpected ${method}`);
  });
}
describe('creation boundary policy', () => {
  it('localizes retired, incompatible and unavailable-specialist errors', async () => {
    setLocale('fr', { reload: false });
    await expect(
      prepareNodeRequest('agent.create', { isolation: 'cow' }, fixture(), () => false),
    ).rejects.toThrow('L’isolation CoW par agent n’est plus disponible.');
    await expect(
      prepareNodeRequest(
        'agent.create',
        { isolation: 'worktree', placement: { target: 'local', checkout: 'shared' } },
        fixture(),
        () => false,
      ),
    ).rejects.toThrow('Le placement ne peut pas être combiné');
    const request = vi.fn(async () => ({ server: { capabilities } }));
    await expect(
      prepareNodeRequest('agent.create', { specialist: 'missing' }, request, () => false),
    ).rejects.toThrow('Le spécialiste sélectionné est indisponible.');
  });
  it('rejects an inherited remote workspace default with Labs off', async () => {
    const request = fixture({ target: 'remote', checkout: 'isolated' });
    await expect(
      prepareNodeRequest('agent.create', { workspaceId: 'ws' }, request, () => false),
    ).rejects.toThrow();
    expect(request.mock.calls.map(([method]) => method)).toEqual(['client.hello', 'workspace.get']);
  });
  it('retains local isolated defaults and applies whole-object specialist precedence', async () => {
    const request = fixture(
      { target: 'remote', checkout: 'isolated', nodeId: 'remote' },
      { target: 'local', checkout: 'isolated' },
    );
    expect(
      await prepareNodeRequest(
        'agent.create',
        { workspaceId: 'ws', workspacePath: '/project/checkout', specialistId: 'builder' },
        request,
        () => false,
      ),
    ).toEqual({
      workspaceId: 'ws',
      specialistId: 'builder',
      workspacePath: '/project/checkout',
      placement: { target: 'local', checkout: 'isolated' },
    });
    expect(request.mock.calls.some(([method]) => method === 'workspace.get')).toBe(false);
  });
  it('explicit local overrides a remote default without reading it', async () => {
    const request = fixture({ target: 'remote', checkout: 'isolated' });
    const input = { workspaceId: 'ws', placement: { target: 'local', checkout: 'shared' } };
    expect(await prepareNodeRequest('agent.create', input, request, () => false)).toEqual(input);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('preserves workspace checkoutMode cow when guarding its initial agent', async () => {
    const input = {
      checkoutMode: 'cow',
      initialAgent: { placement: { target: 'local', checkout: 'isolated' } },
    };
    expect(await prepareNodeRequest('workspace.create', input, fixture(), () => false)).toEqual(
      input,
    );
  });
  it('rejects a stale remote workspace default write and allows clearing it', async () => {
    const request = fixture();
    await expect(
      prepareNodeRequest(
        'workspace.update',
        { defaultAgentPlacement: { target: 'remote', checkout: 'isolated' } },
        request,
        () => false,
      ),
    ).rejects.toThrow();
    expect(
      await prepareNodeRequest(
        'workspace.update',
        { defaultAgentPlacement: null },
        request,
        () => false,
      ),
    ).toEqual({ defaultAgentPlacement: null });
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects retired per-agent CoW before any request', async () => {
    const request = fixture();
    await expect(
      prepareNodeRequest('agent.delegate', { isolation: 'cow' }, request, () => true),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('leaves task-only delegation to the documented head defaults', async () => {
    const input = { workspaceId: 'ws', taskNoteId: 'task' };
    await expect(
      prepareNodeRequest('agent.delegate', input, fixture(), () => false),
    ).resolves.toEqual(input);
  });
  it('keeps ordinary creation compatible with an older daemon', async () => {
    const input = { workspaceId: 'ws' };
    const request = vi.fn(async () => ({ server: { capabilities: {} } }));
    expect(await prepareNodeRequest('agent.create', input, request, () => false)).toBe(input);
  });
  it.each([
    { target: 'local', checkout: 'shared' },
    { target: 'remote', checkout: 'isolated' },
  ])('leaves task-only specialist and workspace resolution to the daemon: %j', async (defaults) => {
    const request = fixture(defaults, { target: 'remote', checkout: 'isolated' });
    const input = { workspaceId: 'ws', taskNoteId: 'task' };
    expect(await prepareNodeRequest('agent.delegate', input, request, () => true)).toBe(input);
    expect(request.mock.calls.map(([method]) => method)).toEqual(['client.hello']);
  });
  it('keeps omission per batch task while resolving explicit specialist and task overrides', async () => {
    const request = fixture(
      { target: 'local', checkout: 'shared' },
      { target: 'remote', checkout: 'isolated' },
    );
    const input = {
      workspaceId: 'ws',
      workspacePath: '/project/checkout',
      tasks: [
        'implicit-string',
        { taskNoteId: 'implicit-object' },
        { taskNoteId: 'selected', specialist: 'builder' },
        { taskNoteId: 'explicit', placement: { target: 'local', checkout: 'worktree' } },
      ],
    };
    expect(await prepareNodeRequest('agent.delegate', input, request, () => true)).toEqual({
      ...input,
      tasks: [
        { taskNoteId: 'implicit-string' },
        { taskNoteId: 'implicit-object' },
        {
          taskNoteId: 'selected',
          specialist: 'builder',
          placement: { target: 'remote', checkout: 'isolated' },
        },
        input.tasks[3],
      ],
    });
    expect(request.mock.calls.filter(([method]) => method === 'specialist.get')).toHaveLength(1);
    expect(request.mock.calls.some(([method]) => method === 'workspace.get')).toBe(false);
  });
  it('rejects a remote specialist with Labs off without replacing its isolation', async () => {
    const request = fixture(
      { target: 'local', checkout: 'shared' },
      { target: 'remote', checkout: 'isolated', exclusive: true, nodeId: 'n' },
    );
    await expect(
      prepareNodeRequest(
        'agent.create',
        { workspaceId: 'ws', specialist: 'builder' },
        request,
        () => false,
      ),
    ).rejects.toThrow(/Labs/);
  });
  it('does not silently continue with an unknown selected specialist', async () => {
    const request = fixture();
    request.mockImplementation(async (method) =>
      method === 'client.hello' ? { server: { capabilities } } : {},
    );
    await expect(
      prepareNodeRequest('agent.create', { specialist: 'missing' }, request, () => false),
    ).rejects.toThrow(/specialist/);
  });
  it('pins the default read before a later workspace change', async () => {
    let calls = 0;
    const request = vi.fn(async (method: string) => {
      if (method === 'workspace.get')
        return { workspace: { defaultAgentPlacement: { target: 'local', checkout: 'isolated' } } };
      calls++;
      return { server: { capabilities } };
    });
    expect(
      await prepareNodeRequest('agent.create', { workspaceId: 'ws' }, request, () => false),
    ).toMatchObject({ placement: { target: 'local', checkout: 'isolated' } });
    expect(calls).toBe(2);
  });
  it.each([undefined, { target: 'remote', checkout: 'isolated' }])(
    'rechecks Labs after default reads without prompting: %s',
    async (placement) => {
      let enabled = true;
      const request = vi.fn(async (method: string) => {
        if (method === 'workspace.get') {
          enabled = false;
          return { workspace: { defaultAgentPlacement: placement } };
        }
        return { server: { capabilities } };
      });
      const result = prepareNodeRequest(
        'agent.create',
        { workspaceId: 'ws' },
        request,
        () => enabled,
      );
      if (placement) await expect(result).rejects.toThrow(/Labs/);
      else await expect(result).resolves.toEqual({ workspaceId: 'ws' });
    },
  );
  it('lets Labs-on unresolved placement use the documented inherited path', async () => {
    const input = { workspaceId: 'ws' };
    expect(await prepareNodeRequest('agent.create', input, fixture(), () => true)).toBe(input);
  });
  it('old daemon rejects new workspace placement configuration', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'client.hello'
        ? {}
        : { workspace: { defaultAgentPlacement: { target: 'local', checkout: 'isolated' } } },
    );
    await expect(
      prepareNodeRequest('agent.create', { workspaceId: 'ws' }, request, () => false),
    ).rejects.toThrow();
  });
  it('per-task local placement wins over the remote call default', async () => {
    const result = await prepareNodeRequest(
      'agent.delegate',
      {
        placement: { target: 'remote', checkout: 'isolated' },
        tasks: [{ taskNoteId: 'task', placement: { target: 'local', checkout: 'worktree' } }],
      },
      fixture(),
      () => false,
    );
    expect(result).toEqual({
      tasks: [{ taskNoteId: 'task', placement: { target: 'local', checkout: 'worktree' } }],
    });
  });
  it('wakeOrCreate preserves the new branch default and wake identity without prompting', async () => {
    const input = { workspaceId: 'ws', name: 'existing-remote', create: { name: 'new' } };
    await expect(
      prepareNodeRequest('agent.wakeOrCreate', input, fixture(), () => false),
    ).resolves.toEqual(input);
  });
  it('rechecks capability after reading a local isolated default', async () => {
    let calls = 0;
    const request = vi.fn(async (method: string) => {
      if (method === 'workspace.get')
        return { workspace: { defaultAgentPlacement: { target: 'local', checkout: 'isolated' } } };
      return { server: { capabilities: ++calls === 1 ? capabilities : { agentNodes: 1 } } };
    });
    await expect(
      prepareNodeRequest('agent.create', { workspaceId: 'ws' }, request, () => false),
    ).rejects.toThrow(/unavailable/);
  });
  it('does not insert an absent wakeOrCreate creation branch', async () => {
    const input = { taskNoteId: 'task', contextMessage: 'Continue' };
    await expect(
      prepareNodeRequest('agent.wakeOrCreate', input, fixture(), () => false),
    ).resolves.toEqual(input);
  });
  it('resolves a supplied project path instead of the conflicting user specialist', async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'client.hello') return { server: { capabilities } };
      if (method === 'specialist.get')
        return {
          specialist: {
            runsOn:
              (params as { workspacePath?: string }).workspacePath === '/project/checkout'
                ? { target: 'local', checkout: 'isolated' }
                : { target: 'local', checkout: 'shared' },
          },
        };
      throw new Error(`Unexpected ${method}`);
    });
    const input = {
      workspaceId: 'ws',
      workspacePath: '/project/checkout',
      specialistId: 'builder',
    };
    expect(await prepareNodeRequest('agent.create', input, request, () => false)).toEqual({
      ...input,
      placement: { target: 'local', checkout: 'isolated' },
    });
    expect(request).toHaveBeenCalledWith('specialist.get', {
      id: 'builder',
      workspaceId: 'ws',
      workspacePath: '/project/checkout',
    });
  });
  it.each([
    {
      worktreePath: '/workspace/checkout',
      repositoryPath: '/repo',
      expected: '/workspace/checkout',
    },
    { repositoryPath: '/repo', expected: '/repo' },
  ])(
    'resolves ID-only delegation using the workspace checkout: $expected',
    async ({ expected, ...workspace }) => {
      const request = vi.fn(async (method: string, params?: unknown) => {
        if (method === 'client.hello') return { server: { capabilities } };
        if (method === 'workspace.get')
          return {
            workspace: {
              ...workspace,
              nodePath: '/remote/never-use',
              defaultAgentPlacement: { target: 'local', checkout: 'worktree' },
            },
          };
        if (method === 'specialist.get')
          return {
            specialist: {
              runsOn:
                (params as { workspacePath?: string }).workspacePath === expected
                  ? { target: 'local', checkout: 'isolated' }
                  : { target: 'local', checkout: 'shared' },
            },
          };
        throw new Error(`Unexpected ${method}`);
      });
      const input = { workspaceId: 'ws', taskNoteId: 'task', specialist: 'builder' };
      expect(await prepareNodeRequest('agent.delegate', input, request, () => false)).toEqual({
        ...input,
        placement: { target: 'local', checkout: 'isolated' },
      });
      expect(request).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws' });
      expect(request).toHaveBeenCalledWith('specialist.get', {
        id: 'builder',
        workspaceId: 'ws',
        workspacePath: expected,
      });
    },
  );
  it('task and call overrides avoid all specialist-tier reads', async () => {
    const request = fixture();
    const input = {
      workspaceId: 'ws',
      specialist: 'builder',
      placement: { target: 'local', checkout: 'worktree' },
      tasks: [
        { taskNoteId: 'one', placement: { target: 'local', checkout: 'isolated' } },
        { taskNoteId: 'two' },
      ],
    };
    expect(await prepareNodeRequest('agent.delegate', input, request, () => false)).toEqual({
      workspaceId: 'ws',
      specialist: 'builder',
      tasks: [
        { taskNoteId: 'one', placement: { target: 'local', checkout: 'isolated' } },
        { taskNoteId: 'two', placement: { target: 'local', checkout: 'worktree' } },
      ],
    });
    expect(request.mock.calls.every(([method]) => method === 'client.hello')).toBe(true);
  });
  it('reuses the workspace read if the project specialist has no placement', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'client.hello') return { server: { capabilities } };
      if (method === 'workspace.get')
        return {
          workspace: {
            worktreePath: '/project/checkout',
            defaultAgentPlacement: { target: 'local', checkout: 'isolated' },
          },
        };
      if (method === 'specialist.get') return { specialist: {} };
      throw new Error(`Unexpected ${method}`);
    });
    expect(
      await prepareNodeRequest(
        'agent.create',
        { workspaceId: 'ws', specialistId: 'builder' },
        request,
        () => false,
      ),
    ).toMatchObject({ placement: { target: 'local', checkout: 'isolated' } });
    expect(request.mock.calls.filter(([method]) => method === 'workspace.get')).toHaveLength(1);
  });
});
