import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  handleLink: vi.fn(),
  agents: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$store/renderer/store', () => ({
  store: { state: {}, dispatch: mocks.dispatch, createSelector: () => ({ select: vi.fn() }) },
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: { select: mocks.agents },
}));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: mocks.handleLink }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.error } }));
vi.mock('$shared/paraglide/messages.js', () => ({
  m: new Proxy({}, { get: (_, key) => () => String(key) }),
}));
import { openDiscussionReference } from './discussion-reference-navigation';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agents.mockReturnValue([{ id: 'agent-1' }]);
});
describe('discussion reference navigation', () => {
  it('opens the actual workspace agent next to the discussion', async () => {
    await openDiscussionReference(
      { kind: 'agent', label: 'Astra', url: 'intent://local/ws/agent/agent-1' },
      'ws',
      'panel-1',
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'appLayout/openAgentTabRequested',
        payload: [
          'ws',
          { agentId: 'agent-1', sourcePanelId: 'panel-1', openInAdjacentPanel: true },
        ],
      }),
    );
  });
  it.each([
    { state: 'missing', agents: [] },
    { state: 'retired', agents: [{ id: 'agent-1', retiredAt: '2026-01-01' }] },
  ])(
    'reports a $state agent without opening a phantom tab',
    async ({ agents }) => {
      mocks.agents.mockReturnValue(agents);
      await openDiscussionReference(
        { kind: 'agent', label: 'Astra', url: 'intent://local/ws/agent/agent-1' },
        'ws',
      );
      expect(mocks.agents).toHaveBeenCalledWith({}, 'ws');
      expect(mocks.dispatch).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalled();
    },
  );
  it.each(['intent://local/file/src/a.ts', 'https://github.com/intent-hq/intent/pull/84'])(
    'uses the existing navigation handler for %s',
    async (url) => {
      const event = new MouseEvent('click');
      await openDiscussionReference(
        { kind: 'file', label: 'Reference', url },
        'ws',
        'panel-1',
        event,
      );
      expect(mocks.handleLink).toHaveBeenCalledWith(url, {
        workspaceId: 'ws',
        sourcePanelId: 'panel-1',
        openInAdjacentPanel: true,
        event,
      });
    },
  );
  it('revalidates incoming references before navigation', async () => {
    await openDiscussionReference({ kind: 'pr', label: 'PR', url: 'javascript:alert(1)' }, 'ws');
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.handleLink).not.toHaveBeenCalled();
  });
});
