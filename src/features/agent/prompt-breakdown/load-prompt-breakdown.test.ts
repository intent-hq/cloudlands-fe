import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendRequest = vi.fn();
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: (...args: unknown[]) => backendRequest(...args),
}));

const { loadPromptBreakdown } = await import('./load-prompt-breakdown');

function sessionWith(promptBreakdown: unknown) {
  return { session: { id: 'agent', harnessVersion: '3.12', messages: [], promptBreakdown } };
}

const available = {
  available: true,
  harnessVersion: '3.12',
  recordedAt: '2026-11-10T12:00:00Z',
  systemPromptChars: 400,
  toolDescriptionChars: 0,
  totalChars: 400,
  estTokens: 100,
  sections: [
    {
      id: 'doctrine',
      label: 'Intent instructions',
      owner: 'intent',
      location: 'systemPrompt',
      chars: 400,
      estTokens: 100,
    },
  ],
  hiddenSkills: [],
};

describe('loadPromptBreakdown', () => {
  beforeEach(() => backendRequest.mockReset());

  it('reads agent.getSession with the agent and workspace ids', async () => {
    backendRequest.mockResolvedValue(sessionWith(available));
    const view = await loadPromptBreakdown('agent-wire', 'ws-1');
    expect(backendRequest).toHaveBeenCalledWith('agent.getSession', {
      agentId: 'agent-wire',
      workspaceId: 'ws-1',
    });
    expect(view?.estTokens).toBe(100);
    expect(view?.rows.map((row) => row.id)).toEqual(['doctrine']);
  });

  it('omits the workspace id when it is unknown', async () => {
    backendRequest.mockResolvedValue(sessionWith(available));
    await loadPromptBreakdown('agent-no-ws', undefined);
    expect(backendRequest).toHaveBeenCalledWith('agent.getSession', { agentId: 'agent-no-ws' });
  });

  it('resolves null for the unavailable arm', async () => {
    backendRequest.mockResolvedValue(
      sessionWith({ available: false, reason: 'harness-predates-breakdown' }),
    );
    await expect(loadPromptBreakdown('agent-old', 'ws-1')).resolves.toBeNull();
  });

  it('reads again on every call, so a respawn shows the new breakdown', async () => {
    backendRequest.mockResolvedValueOnce(sessionWith({ available: false, reason: 'not-recorded' }));
    await expect(loadPromptBreakdown('agent-respawn', 'ws-1')).resolves.toBeNull();
    backendRequest.mockResolvedValueOnce(sessionWith(available));
    await expect(loadPromptBreakdown('agent-respawn', 'ws-1')).resolves.not.toBeNull();
    expect(backendRequest).toHaveBeenCalledTimes(2);
  });

  it('resolves null when the read fails', async () => {
    backendRequest.mockRejectedValueOnce(new Error('offline'));
    await expect(loadPromptBreakdown('agent-offline', 'ws-1')).resolves.toBeNull();
  });
});
