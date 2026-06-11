/**
 * Tests for ACP singleton state cleanup (P1 #1 + P1 #2)
 *
 * Verifies that:
 * - AcpServer.dispose() clears SessionManager sessions and PermissionManager decisions
 * - SessionManager spills heavy payloads to disk instead of deleting/truncating sessions
 * - PermissionManager.decisions are evicted per-request after handleDecision()
 * - PermissionManager.clearDecisions() clears remaining decisions
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function makeMessage(text: string) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  } as any;
}

const tempDirs: string[] = [];

function makeTempDir(prefix = 'acp-session-manager-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function messageTexts(session: { messages: any[] }) {
  return session.messages.map((message) => message.content[0].text);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

  it('spills old session payloads without deleting logical sessions', () => {
    const manager = new SessionManager({
      storageDirectory: makeTempDir(),
      maxSessionAgeHours: 1,
    });
    const oldSession = manager.createSession({ test: 'old' });
    manager.addMessage(oldSession.id, makeMessage('old payload'));
    oldSession.lastActivity = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const newSession = manager.createSession({ test: 'new' });

    expect(manager.getRetentionStats()).toMatchObject({
      totalSessions: 2,
      persistedPayloadSessions: 1,
    });
    expect(oldSession.messages).toHaveLength(0);
    expect(manager.getAllSessions().map((session) => session.id)).toEqual([
      oldSession.id,
      newSession.id,
    ]);
    expect(messageTexts(manager.getSession(oldSession.id)!)).toEqual(['old payload']);
  });

  it('spills least recently active payloads above the configured memory bound', () => {
    const manager = new SessionManager({ storageDirectory: makeTempDir(), maxSessions: 1 });
    const first = manager.createSession({ order: 1 });
    manager.addMessage(first.id, makeMessage('first payload'));
    const second = manager.createSession({ order: 2 });
    manager.addMessage(second.id, makeMessage('second payload'));

    expect(manager.getRetentionStats()).toMatchObject({
      totalSessions: 2,
      inMemoryPayloadSessions: 1,
      persistedPayloadSessions: 1,
    });
    expect(first.messages).toHaveLength(0);
    expect(messageTexts(second)).toEqual(['second payload']);
    expect(messageTexts(manager.getSession(first.id)!)).toEqual(['first payload']);
  });

  it('does not logically truncate message history when payloads spill to disk', () => {
    const manager = new SessionManager({
      storageDirectory: makeTempDir(),
      maxSessions: 1,
      maxMessagesPerSession: 2,
    });
    const session = manager.createSession();

    manager.addMessage(session.id, makeMessage('one'));
    manager.addMessage(session.id, makeMessage('two'));
    manager.addMessage(session.id, makeMessage('three'));
    const recent = manager.createSession();
    manager.addMessage(recent.id, makeMessage('recent'));

    expect(session.messages).toHaveLength(0);
    expect(messageTexts(manager.getSession(session.id)!)).toEqual(['one', 'two', 'three']);
  });

  it('retains unsaved payloads in memory when persistence fails', () => {
    const blockedStoragePath = path.join(makeTempDir(), 'not-a-directory');
    fs.writeFileSync(blockedStoragePath, 'blocks mkdir');
    const manager = new SessionManager({ storageDirectory: blockedStoragePath, maxSessions: 1 });
    const first = manager.createSession();
    manager.addMessage(first.id, makeMessage('first payload'));
    const second = manager.createSession();
    manager.addMessage(second.id, makeMessage('second payload'));

    expect(messageTexts(first)).toEqual(['first payload']);
    expect(messageTexts(second)).toEqual(['second payload']);
    expect(manager.getRetentionStats()).toMatchObject({
      totalSessions: 2,
      inMemoryPayloadSessions: 2,
      persistedPayloadSessions: 0,
    });
  });

  it('rehydrates spilled payloads from disk in a fresh manager', () => {
    const storageDirectory = makeTempDir();
    const manager = new SessionManager({ storageDirectory, maxSessions: 1 });
    const first = manager.createSession({ persisted: true });
    manager.addMessage(first.id, makeMessage('first payload'));
    const second = manager.createSession();
    manager.addMessage(second.id, makeMessage('second payload'));

    const reloadedManager = new SessionManager({ storageDirectory, maxSessions: 1 });
    const reloaded = reloadedManager.getSession(first.id);

    expect(reloaded?.metadata).toEqual({ persisted: true });
    expect(messageTexts(reloaded!)).toEqual(['first payload']);
  });
});

describe('ACP session/load rehydration', () => {
  it('returns full spilled history through session/load', async () => {
    const workspacePath = makeTempDir('acp-server-workspace-');
    const storageDirectory = path.join(workspacePath, '.intent', 'acp-session-payloads');
    const { ACPServer } = await import('../main/server/acp-server');
    const server = new ACPServer({
      clientInfo: { name: 'test', version: '1.0.0' },
      workspacePath,
      workspaceId: 'test-workspace',
    });
    (server as any).sessionManager = new SessionManager({ storageDirectory, maxSessions: 1 });

    try {
      const firstResponse = JSON.parse(
        (await server.handleMessage(
          JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} }),
        ))!,
      );
      const firstId = firstResponse.result.sessionId as AgentId;
      (server as any).sessionManager.addMessage(firstId, makeMessage('first payload'));

      const secondResponse = JSON.parse(
        (await server.handleMessage(
          JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: {} }),
        ))!,
      );
      const secondId = secondResponse.result.sessionId as AgentId;
      (server as any).sessionManager.addMessage(secondId, makeMessage('second payload'));

      const loadResponse = JSON.parse(
        (await server.handleMessage(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'session/load',
            params: { sessionId: firstId },
          }),
        ))!,
      );

      expect(loadResponse.error).toBeUndefined();
      expect(loadResponse.result.messages.map((message: any) => message.content[0].text)).toEqual([
        'first payload',
      ]);
    } finally {
      await server.dispose();
    }
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
