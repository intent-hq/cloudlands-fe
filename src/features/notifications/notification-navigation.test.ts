import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  dispatch: vi.fn(),
}));

vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigate }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }),
}));

import { handleNotificationNavigate } from './notification-navigation';

describe('handleNotificationNavigate auxiliary route guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it.each(['/hud', '/hud/status', '/dock', '/dock/status'])(
    'does not replace the auxiliary route %s',
    async (route) => {
      window.history.pushState({}, '', route);

      await handleNotificationNavigate({ workspaceId: 'workspace-1' });

      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe(route);
    },
  );

  it('navigates a normal app renderer to the notification workspace', async () => {
    window.history.pushState({}, '', '/settings');

    await handleNotificationNavigate({ workspaceId: 'workspace-1' });

    expect(mocks.navigate).toHaveBeenCalledWith('/workspace/workspace-1');
  });
});
