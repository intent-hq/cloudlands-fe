/**
 * AUDIT-P0-2 tests for `PermissionManager.clearRules()`.
 *
 * Locks in the contract that `clearRules` is async and rejects when the
 * underlying `saveRules` persistence call fails. The previous fire-and-
 * forget pattern silently swallowed save errors, so a UI element that
 * cleared rules looked successful while the disk/IPC write was failing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We exercise the browser/localStorage branch of saveRules — that is the
// path active when `isBrowser` is true at module-load (jsdom provides
// `window.localStorage`). The pure-Node fallback never throws by design,
// so it would not surface a failure to assert against here.
import { PermissionManager } from '../permission-manager';

describe('PermissionManager.clearRules (AUDIT-P0-2)', () => {
  beforeEach(() => {
    // Reset localStorage between tests so prior runs don't leak rules.
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
    vi.restoreAllMocks();
  });

  it('returns a Promise<void> that resolves on successful save', async () => {
    const manager = new PermissionManager();
    const ret = manager.clearRules();
    expect(ret).toBeInstanceOf(Promise);
    await expect(ret).resolves.toBeUndefined();
  });

  it('rejects when the underlying persistence (localStorage) throws (AUDIT-P0-2)', async () => {
    const manager = new PermissionManager();
    const original = window.localStorage.setItem.bind(window.localStorage);
    const spy = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation((key, value) => {
        if (key === 'acp_permission_rules') throw new Error('quota exceeded');
        original(key, value);
      });

    try {
      await expect(manager.clearRules()).rejects.toThrow('quota exceeded');
    } finally {
      // Restore explicitly: vi.restoreAllMocks() in beforeEach has been
      // observed to leave jsdom localStorage spies in place, which leaks
      // the throwing setItem into subsequent tests.
      spy.mockRestore();
    }
  });

  it('clears in-memory rules even when scope filter is provided', async () => {
    const manager = new PermissionManager();
    // Use the public addRule helper to seed a couple of rules.
    manager.addRule({ pattern: '*', action: 'allow', scope: 'session' });
    manager.addRule({ pattern: '*', action: 'deny', scope: 'global' });

    await manager.clearRules('session');
    const stats = manager.getStatistics();
    // The session-scoped rule is gone; the global-scoped one remains.
    expect(stats.activeRules).toBe(1);
    expect(stats.rulesByScope['global']).toBe(1);
  });

  it('clears every rule when no scope is provided', async () => {
    const manager = new PermissionManager();
    manager.addRule({ pattern: '*', action: 'allow', scope: 'session' });
    manager.addRule({ pattern: '*', action: 'deny', scope: 'global' });

    await manager.clearRules();
    expect(manager.getStatistics().activeRules).toBe(0);
  });
});
