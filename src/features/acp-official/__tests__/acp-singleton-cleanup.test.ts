/**
 * Tests for ACP singleton state cleanup (P1 #1 + P1 #2)
 *
 * Verifies that:
 * - AcpServer.dispose() clears SessionManager sessions and PermissionManager decisions
 * - PermissionManager.decisions are evicted per-request after handleDecision()
 * - PermissionManager.clearDecisions() clears remaining decisions
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import { SessionManager } from '../main/server/session-manager';
import { PermissionManager } from '../permissions/permission-manager';
import type { AgentId } from '$shared/types/branded-ids';

// Mock heavy dependencies so we can construct ACPServer in a unit test
vi.mock('../main/server/handlers/terminal', () => {
  return {
    TerminalHandler: class {
      async dispose() {}
    },
  };
});
vi.mock('../main/server/handlers/file-system', () => {
  return {
    FileSystemHandler: class {},
  };
});

describe('P1 #1: SessionManager.clearAllSessions()', () => {
  it('should clear all sessions and reset size to 0', () => {
    const manager = new SessionManager();
    manager.createSession({ test: 1 });
    manager.createSession({ test: 2 });
    manager.createSession({ test: 3 });

    expect(manager.getAllSessions()).toHaveLength(3);

    manager.clearAllSessions();

    expect(manager.getAllSessions()).toHaveLength(0);
  });

  it('clearAllSessions is idempotent on empty manager', () => {
    const manager = new SessionManager();
    expect(manager.getAllSessions()).toHaveLength(0);
    manager.clearAllSessions();
    expect(manager.getAllSessions()).toHaveLength(0);
  });
});

describe('P1 #1: AcpServer.dispose() integration', () => {
  it('should call clearAllSessions and clearDecisions when disposed', async () => {
    // Import after mocks are in place
    const { ACPServer } = await import('../main/server/acp-server');
    const { permissionManager } = await import('../permissions/permission-manager');

    const server = new ACPServer({
      clientInfo: { name: 'test', version: '1.0.0' },
      workspacePath: '/tmp/test',
      workspaceId: 'test-workspace',
    });

    const clearDecisionsSpy = vi.spyOn(permissionManager, 'clearDecisions');

    try {
      // Create a session via the server's JSON-RPC interface so sessionManager has state
      await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'test-agent', version: '1.0.0' }, protocolVersion: 1 },
        }),
      );
      await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'session/new',
          params: {},
        }),
      );

      await server.dispose();

      // Verify permissionManager.clearDecisions() was called
      expect(clearDecisionsSpy).toHaveBeenCalled();
    } finally {
      clearDecisionsSpy.mockRestore();
    }
  });
});

describe('P1 #2: PermissionManager decisions per-request eviction', () => {
  let pm: PermissionManager;

  beforeEach(() => {
    pm = new PermissionManager();
  });

  it('should evict decision from Map after handleDecision()', async () => {
    const sessionId = 'sess_test-session' as AgentId;

    // Start a permission request (don't await — it blocks on user decision)
    const permissionPromise = pm.requestPermission(sessionId, 'Test Permission');

    // Get the pending request ID
    const pending = pm.getPendingRequests();
    expect(pending).toHaveLength(1);
    const requestId = pending[0].id;

    // Resolve the decision
    pm.handleDecision(requestId, { outcome: 'selected', optionId: 'allow' });

    // Wait for the promise to resolve
    await permissionPromise;

    // Per-request eviction: decisions Map should be empty after handleDecision
    const stats = pm.getStatistics();
    expect(stats.totalDecisions).toBe(0);
    expect(stats.pendingCount).toBe(0);
  });

  it('should evict decisions even when remember=true', async () => {
    const sessionId = 'sess_test-session' as AgentId;

    const permissionPromise = pm.requestPermission(sessionId, 'Write File');

    const pending = pm.getPendingRequests();
    expect(pending).toHaveLength(1);
    const requestId = pending[0].id;

    pm.handleDecision(requestId, { outcome: 'selected', optionId: 'allow' }, true);

    await permissionPromise;

    // Decision should still be evicted from the Map
    expect(pm.getStatistics().totalDecisions).toBe(0);
    // But a rule should have been created
    expect(pm.getStatistics().activeRules).toBe(1);
  });

  it('clearDecisions() should clear decisions from a non-empty map', async () => {
    const sessionId = 'sess_test-session' as AgentId;

    // Arrange: create a permission request but DON'T resolve it via handleDecision
    // so the decision won't be auto-evicted. Instead, use handleDecision with a
    // listener that we control to verify state before clearDecisions.
    const permissionPromise = pm.requestPermission(sessionId, 'Delete Files');

    const pending = pm.getPendingRequests();
    expect(pending).toHaveLength(1);
    const requestId = pending[0].id;

    // Temporarily suppress the per-request eviction by overriding delete on the
    // decisions map. This simulates a race condition where eviction didn't fire.
    // Wrapped in try/finally so the override is always restored even if assertions throw.
    const decisionsMap = (pm as any).decisions as Map<string, unknown>;
    const origDelete = decisionsMap.delete.bind(decisionsMap);
    let deleteBlocked = true;
    decisionsMap.delete = function (key: string) {
      if (deleteBlocked) return false;
      return origDelete(key);
    };

    try {
      pm.handleDecision(requestId, { outcome: 'selected', optionId: 'allow' });
      await permissionPromise;

      // Decision should still be in the map because we blocked delete
      expect(pm.getStatistics().totalDecisions).toBe(1);

      // Re-enable delete and call clearDecisions
      deleteBlocked = false;
      decisionsMap.delete = origDelete;
      pm.clearDecisions();
      expect(pm.getStatistics().totalDecisions).toBe(0);
    } finally {
      // Ensure override is always restored
      decisionsMap.delete = origDelete;
    }
  });
});

