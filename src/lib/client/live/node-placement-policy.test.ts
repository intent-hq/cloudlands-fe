import { describe, expect, it, vi } from 'vitest';
import { prepareNodeRequest } from './node-placement-policy';
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
        { workspaceId: 'ws', specialistId: 'builder' },
        request,
        () => false,
      ),
    ).toEqual({
      workspaceId: 'ws',
      specialistId: 'builder',
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
  it('does not guess a task-resolved specialist while Labs is off', async () => {
    await expect(
      prepareNodeRequest(
        'agent.delegate',
        { workspaceId: 'ws', taskNoteId: 'task' },
        fixture(),
        () => false,
      ),
    ).rejects.toThrow();
  });
  it('keeps ordinary creation compatible with an older daemon', async () => {
    const input = { workspaceId: 'ws' };
    const request = vi.fn(async () => ({ server: { capabilities: {} } }));
    expect(await prepareNodeRequest('agent.create', input, request, () => false)).toBe(input);
  });
  it.each(['agent.create', 'agent.delegate'])(
    'requires an explicit choice without defaults: %s',
    async (method) => {
      const choose = vi.fn(async () => ({ target: 'local', checkout: 'worktree' }) as const);
      const result = await prepareNodeRequest(
        method,
        { workspaceId: 'ws', taskNoteId: 'task' },
        fixture(),
        () => false,
        choose,
      );
      expect(choose).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ placement: { target: 'local', checkout: 'worktree' } });
    },
  );
  it('task-only delegation uses the workspace default without guessing a specialist', async () => {
    const request = fixture({ target: 'local', checkout: 'isolated' });
    expect(
      await prepareNodeRequest(
        'agent.delegate',
        { workspaceId: 'ws', taskNoteId: 'task' },
        request,
        () => false,
      ),
    ).toMatchObject({ placement: { target: 'local', checkout: 'isolated' } });
    expect(request.mock.calls.some(([method]) => method === 'specialist.get')).toBe(false);
  });
  it('remote specialist requires an explicit local answer, with no field merging', async () => {
    const choose = vi.fn(async () => ({ target: 'local', checkout: 'isolated' }) as const);
    const request = fixture(
      { target: 'local', checkout: 'shared' },
      { target: 'remote', checkout: 'isolated', exclusive: true, nodeId: 'n' },
    );
    expect(
      await prepareNodeRequest(
        'agent.create',
        { workspaceId: 'ws', specialist: 'builder' },
        request,
        () => false,
        choose,
      ),
    ).toMatchObject({ placement: { target: 'local', checkout: 'isolated' } });
    expect(choose).toHaveBeenCalledOnce();
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
  it('reapplies local selection when Labs turns off during default reads', async () => {
    let enabled = true;
    const request = fixture();
    request.mockImplementation(async (method) => {
      if (method === 'workspace.get') {
        enabled = false;
        return { workspace: {} };
      }
      return { server: { capabilities } };
    });
    const choose = vi.fn(async () => ({ target: 'local', checkout: 'shared' }) as const);
    expect(
      await prepareNodeRequest(
        'agent.create',
        { workspaceId: 'ws' },
        request,
        () => enabled,
        choose,
      ),
    ).toMatchObject({ placement: { target: 'local', checkout: 'shared' } });
    expect(choose).toHaveBeenCalledOnce();
  });
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
  it('wakeOrCreate pins only its new branch and leaves wake identity unchanged', async () => {
    const choose = vi.fn(async () => ({ target: 'local', checkout: 'worktree' }) as const);
    const result = await prepareNodeRequest(
      'agent.wakeOrCreate',
      { workspaceId: 'ws', name: 'existing-remote', create: { name: 'new' } },
      fixture(),
      () => false,
      choose,
    );
    expect(result).toEqual({
      workspaceId: 'ws',
      name: 'existing-remote',
      create: { name: 'new', placement: { target: 'local', checkout: 'worktree' } },
    });
  });
  it('rechecks capability after the local choice dialog', async () => {
    const request = fixture();
    const choose = vi.fn(async () => {
      request.mockResolvedValue({ server: { capabilities: { agentNodes: 1 } } });
      return { target: 'local', checkout: 'isolated' } as const;
    });
    await expect(
      prepareNodeRequest('agent.create', {}, request, () => false, choose),
    ).rejects.toThrow();
  });
  it('guards wakeOrCreate creation even when the optional create object is absent', async () => {
    const choose = vi.fn(async () => ({ target: 'local', checkout: 'worktree' }) as const);
    const input = { taskNoteId: 'task', contextMessage: 'Continue' };
    expect(
      await prepareNodeRequest('agent.wakeOrCreate', input, fixture(), () => false, choose),
    ).toEqual({
      ...input,
      create: { placement: { target: 'local', checkout: 'worktree' } },
    });
    expect(choose).toHaveBeenCalledOnce();
  });
});
