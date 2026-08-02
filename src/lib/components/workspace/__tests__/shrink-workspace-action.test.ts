/**
 * @vitest-environment jsdom
 *
 * Shrink-workspace action: launches an idle implementor chat agent (no
 * initialMessage — the agent must not start on its own), persists the canned
 * shrink prompt as the composer draft via `drafts.set` (PROTOCOL §5.16), and
 * opens the agent tab. ChatPanel's restore-on-mount then prefills the
 * composer from the draft.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workspace } from '$shared/types';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  draftsSet: vi.fn().mockResolvedValue({ ok: true, updatedAt: '2026-08-01T00:00:00Z' }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectEffectiveModel: { select: vi.fn(() => 'model-smart') },
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => 'implementor behavior') },
  selectEffectiveCodingAgent: { select: vi.fn(() => 'auggie') },
}));

vi.mock('$lib/client', () => ({
  appClient: { drafts: { set: mocks.draftsSet } },
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

const workspace = {
  id: 'ws-1',
  title: 'Disk Workspace',
  branch: 'main',
} as unknown as Workspace;

const session = { id: 'agent-1', name: 'Shrink workspace' };

describe('runShrinkWorkspaceAction', () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.draftsSet.mockClear();
    // Settle the launch action's promise like the creation middleware would.
    mocks.dispatch.mockImplementation((action: any) => {
      if (action?.type === 'agentSessions/launchAgentRequested') {
        action.success(session);
      }
      return action;
    });
  });

  it('launches an idle implementor agent, sets the draft, and opens the tab', async () => {
    const { runShrinkWorkspaceAction, SHRINK_WORKSPACE_PROMPT } = await import(
      '../shrink-workspace-action'
    );

    await runShrinkWorkspaceAction(workspace);

    const launchAction = mocks.dispatch.mock.calls
      .map(([a]) => a)
      .find((a) => a?.type === 'agentSessions/launchAgentRequested');
    expect(launchAction).toBeTruthy();
    const [wsId, config] = launchAction.payload;
    expect(wsId).toBe('ws-1');
    expect(config.initialMessage).toBeUndefined();
    expect(config.behaviorPrompt).toBe('implementor behavior');
    expect(config.model).toBe('model-smart');
    expect(config.provider).toBe('auggie');
    expect(config.metadata).toEqual({ specialist: 'implementor', source: 'shrink-workspace' });

    expect(mocks.draftsSet).toHaveBeenCalledOnce();
    expect(mocks.draftsSet).toHaveBeenCalledWith('ws-1', 'agent-1', SHRINK_WORKSPACE_PROMPT);

    const openAction = mocks.dispatch.mock.calls
      .map(([a]) => a)
      .find((a) => a?.type === 'appLayout/openAgentTabRequested');
    expect(openAction).toBeTruthy();
    expect(openAction.payload).toEqual(['ws-1', { agentId: 'agent-1' }]);
  });

  it('sets the draft before opening the agent tab', async () => {
    const order: string[] = [];
    mocks.draftsSet.mockImplementation(async () => {
      order.push('drafts.set');
      return { ok: true, updatedAt: '2026-08-01T00:00:00Z' };
    });
    mocks.dispatch.mockImplementation((action: any) => {
      if (action?.type === 'agentSessions/launchAgentRequested') action.success(session);
      if (action?.type === 'appLayout/openAgentTabRequested') order.push('openTab');
      return action;
    });

    const { runShrinkWorkspaceAction } = await import('../shrink-workspace-action');
    await runShrinkWorkspaceAction(workspace);

    expect(order).toEqual(['drafts.set', 'openTab']);
  });
});
