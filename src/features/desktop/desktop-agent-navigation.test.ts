import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), show: vi.fn(), dispatch: vi.fn() }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigate }));
vi.mock('$lib/utils/show-workspace.client', () => ({ openAndShowWorkspace: mocks.show }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
import { navigateToDesktopAgent } from './desktop-agent-navigation';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.navigate.mockResolvedValue(undefined);
  mocks.show.mockResolvedValue(true);
});
it('opens the exact agent only after showing its owning workspace and tab', async () => {
  let shown = false;
  mocks.show.mockImplementation(async () => {
    shown = true;
    return true;
  });
  mocks.dispatch.mockImplementation(() => expect(shown).toBe(true));
  await navigateToDesktopAgent('space/#other', 'agent-a');
  expect(mocks.show).toHaveBeenCalledWith('space/#other');
  expect(mocks.dispatch).toHaveBeenCalledWith(
    openAgentTabRequested('space/#other', { agentId: 'agent-a' }),
  );
});
it('selects the controlling Assistant thread rather than a hidden workspace page', async () => {
  await navigateToDesktopAgent('__chief__', 'chief-a');
  expect(mocks.navigate).toHaveBeenCalledWith('/');
  expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
    setChiefActiveAgentId('chief-a'),
    openPanel('chief'),
  ]);
});
it('does not open an unrelated agent on missing identity or failed navigation', async () => {
  await navigateToDesktopAgent('', 'agent-a');
  await navigateToDesktopAgent('space-a', '');
  expect(mocks.show).not.toHaveBeenCalled();
  mocks.show.mockRejectedValueOnce(new Error('navigation failed'));
  await expect(navigateToDesktopAgent('space-a', 'agent-a')).rejects.toThrow('navigation failed');
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
it('does not open the agent when the workspace navigation did not land', async () => {
  mocks.show.mockResolvedValueOnce(false);
  await navigateToDesktopAgent('space-a', 'agent-a');
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
