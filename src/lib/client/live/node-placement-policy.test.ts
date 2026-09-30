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
});
