/**
 * applyReasoningEffort — the session-level reasoning-effort writer behind the
 * chat-input effort control. FAKE seams only: `$lib/client` and
 * `$store/renderer/store` are mocked so nothing reaches a real daemon.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetReasoningEffort = vi.hoisted(() =>
  vi.fn(
    async (_params: { agentId: string; workspaceId: string; reasoningEffort: string | null }) =>
      ({ success: true }) as { success: boolean; error?: string },
  ),
);
const mockDispatch = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('$lib/client', () => ({
  appClient: { agents: { setReasoningEffort: mockSetReasoningEffort } },
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mockDispatch } }));
vi.mock('svelte-sonner', () => ({ toast: { error: mockToastError } }));

import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { applyReasoningEffort } from './reasoning-effort';

describe('applyReasoningEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetReasoningEffort.mockResolvedValue({ success: true });
  });

  it('dispatches the session field optimistically then forwards the mutation', async () => {
    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'high', null);

    expect(applied).toBe(true);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      updateSession('agent-1', { reasoningEffort: 'high' }),
    );
    expect(mockSetReasoningEffort).toHaveBeenCalledWith({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
    });
  });

  it('forwards an explicit null to clear back to the provider default', async () => {
    await applyReasoningEffort('agent-1', 'ws-1', null, 'high');

    expect(mockSetReasoningEffort).toHaveBeenCalledWith({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      reasoningEffort: null,
    });
  });

  it('reverts to the previous effort and surfaces the error on rejection', async () => {
    mockSetReasoningEffort.mockResolvedValue({ success: false, error: 'unsupported' });

    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'xhigh', 'low');

    expect(applied).toBe(false);
    expect(mockDispatch).toHaveBeenLastCalledWith(
      updateSession('agent-1', { reasoningEffort: 'low' }),
    );
    expect(mockToastError).toHaveBeenCalledWith('unsupported');
  });
});
