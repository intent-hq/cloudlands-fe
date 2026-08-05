/**
 * Tests for navigation.client.ts
 *
 * The HUD pop-out window must never navigate away from /hud: navigateToRoute
 * is a logged no-op there and delegates to SvelteKit's goto() everywhere else.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { navigateToRoute, isHudWindowRenderer } from '../navigation.client';

const gotoMock = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
}));

describe('navigation.client', () => {
  beforeEach(() => {
    gotoMock.mockClear();
    gotoMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  describe('isHudWindowRenderer', () => {
    it('returns true when the pathname starts with /hud', () => {
      window.history.pushState({}, '', '/hud');
      expect(isHudWindowRenderer()).toBe(true);
    });

    it('returns false on other routes', () => {
      window.history.pushState({}, '', '/workspace/ws-123');
      expect(isHudWindowRenderer()).toBe(false);
    });
  });

  describe('navigateToRoute', () => {
    it('no-ops in the HUD window (pathname /hud)', async () => {
      window.history.pushState({}, '', '/hud');

      await navigateToRoute('/workspace/ws-123');

      expect(gotoMock).not.toHaveBeenCalled();
    });

    it('no-ops on /hud sub-paths', async () => {
      window.history.pushState({}, '', '/hud/whatever');

      await navigateToRoute('/settings');

      expect(gotoMock).not.toHaveBeenCalled();
    });

    it('calls goto outside the HUD window', async () => {
      window.history.pushState({}, '', '/workspace/ws-abc');

      await navigateToRoute('/workspace/ws-123');

      expect(gotoMock).toHaveBeenCalledTimes(1);
      expect(gotoMock).toHaveBeenCalledWith('/workspace/ws-123');
    });

    it('calls goto from the home route', async () => {
      window.history.pushState({}, '', '/');

      await navigateToRoute('/settings');

      expect(gotoMock).toHaveBeenCalledWith('/settings');
    });
  });
});
