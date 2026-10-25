import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), dispatch: vi.fn() }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigate }));
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
});
it('opens the exact agent only after navigating to its owning workspace', async () => {
  let navigated = false;
  mocks.navigate.mockImplementation(async () => {
    navigated = true;
  });
  mocks.dispatch.mockImplementation(() => expect(navigated).toBe(true));
  await navigateToDesktopAgent('space/#other', 'agent-a');
  expect(mocks.navigate).toHaveBeenCalledWith('/workspace/space%2F%23other');
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
  expect(mocks.navigate).not.toHaveBeenCalled();
  mocks.navigate.mockRejectedValue(new Error('navigation failed'));
  await expect(navigateToDesktopAgent('space-a', 'agent-a')).rejects.toThrow('navigation failed');
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
