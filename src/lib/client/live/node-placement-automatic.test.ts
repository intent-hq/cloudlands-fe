import { describe, expect, it, vi } from 'vitest';
import { prepareNodeRequest } from './node-placement-policy';

const capabilities = { agentNodes: 1, localNodeIsolation: 1 };
function request(defaultAgentPlacement?: unknown) {
  return vi.fn(async (method: string) => {
    if (method === 'client.hello') return { server: { capabilities } };
    if (method === 'workspace.get') return { workspace: { defaultAgentPlacement } };
    throw new Error(`Unexpected ${method}`);
  });
}

describe('launch without a manual placement step', () => {
  it.each([
    ['agent.create', { workspaceId: 'ws', prompt: 'Build' }],
    ['agent.delegate', { workspaceId: 'ws', taskNoteId: 'task' }],
    ['agent.wakeOrCreate', { workspaceId: 'ws', name: 'Builder' }],
    ['workspace.create', { checkoutMode: 'cow', initialAgent: { prompt: 'Build' } }],
  ])('leaves omitted placement to the head for %s with Labs off', async (method, input) => {
    await expect(
      prepareNodeRequest(method as string, input, request(), () => false),
    ).resolves.toEqual(input);
  });

  it('preserves legacy worktree intent instead of injecting a shared choice', async () => {
    const input = { workspaceId: 'ws', isolation: 'worktree' };
    await expect(
      prepareNodeRequest('agent.create', input, request(), () => false),
    ).resolves.toEqual(input);
  });

  it('does not replace an inherited remote choice when Labs is off', async () => {
    await expect(
      prepareNodeRequest(
        'agent.create',
        { workspaceId: 'ws' },
        request({ target: 'remote', checkout: 'isolated' }),
        () => false,
      ),
    ).rejects.toThrow(/Labs/);
  });

  it('preserves isolated intent without prompting', async () => {
    const placement = { target: 'local', checkout: 'isolated' };
    await expect(
      prepareNodeRequest('agent.create', { workspaceId: 'ws' }, request(placement), () => false),
    ).resolves.toEqual({ workspaceId: 'ws', placement });
  });
});
