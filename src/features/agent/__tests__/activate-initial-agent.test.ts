/**
 * Tests for activateInitialAgent lock-based deduplication.
 *
 * These tests verify the locking, deduplication, timeout, and cleanup
 * behavior of the activateInitialAgent method without importing the
 * full AgentService (which has heavy side-effects).
 *
 * We replicate the method logic in a minimal harness so we can test
 * it in isolation with fake timers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentSession } from '../../../../shared/types/agent-session';

// ---------------------------------------------------------------------------
// Minimal harness that mirrors activateInitialAgent from agent.service.ts
// ---------------------------------------------------------------------------

interface Workspace {
  id: string;
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
};

/**
 * Minimal class that replicates the activateInitialAgent logic
 * exactly as implemented in RefactoredAgentService.
 */
class ActivateInitialAgentHarness {
  initialAgentActivationLocks = new Map<string, Promise<AgentSession | null>>();
  private getSessionFn: (agentId: string) => AgentSession | undefined;

  constructor(getSessionFn: (agentId: string) => AgentSession | undefined) {
    this.getSessionFn = getSessionFn;
  }

  async activateInitialAgent(
    agentId: string,
    workspace: Workspace,
    createFn: () => Promise<AgentSession | null>,
  ): Promise<AgentSession | null> {
    const key = `${workspace.id}:${agentId}`;

    // If already activated, return existing session
    const existing = this.getSessionFn(agentId);
    if (existing?.backendSessionId) {
      mockLogger.info('activateInitialAgent: already activated', {
        agentId,
        workspaceId: workspace.id,
      });
      return existing;
    }

    // If activation in progress, await it
    const pending = this.initialAgentActivationLocks.get(key);
    if (pending) {
      mockLogger.info('activateInitialAgent: awaiting existing activation', {
        agentId,
        workspaceId: workspace.id,
      });
      return pending;
    }

    // Start activation with timeout guard
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const promise = Promise.race([
      createFn(),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => {
          mockLogger.warn('activateInitialAgent: timeout after 60s, releasing lock', { key });
          resolve(null);
        }, 60_000);
      }),
    ]).finally(() => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      this.initialAgentActivationLocks.delete(key);
    });
    this.initialAgentActivationLocks.set(key, promise);
    return promise;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_ID = 'agent-test-123';
const WORKSPACE: Workspace = { id: 'ws-456' };

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT_ID as any,
    backendSessionId: 'backend-789' as any,
    workspaceId: WORKSPACE.id as any,
    name: 'Test Agent',
    status: 'active' as any,
    messages: [],
    model: 'test-model',
    systemPrompt: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    isStreaming: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('activateInitialAgent', () => {
  let harness: ActivateInitialAgentHarness;
  let getSessionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock = vi.fn().mockReturnValue(undefined);
    harness = new ActivateInitialAgentHarness(getSessionMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns existing session if already activated', async () => {
    const existingSession = makeSession();
    getSessionMock.mockReturnValue(existingSession);

    const createFn = vi.fn();
    const result = await harness.activateInitialAgent(AGENT_ID, WORKSPACE, createFn);

    expect(result).toBe(existingSession);
    expect(createFn).not.toHaveBeenCalled();
  });

  it('second caller awaits first caller\'s promise (createFn called once)', async () => {
    let resolveCreate!: (s: AgentSession | null) => void;
    const createFn = vi.fn(
      () => new Promise<AgentSession | null>((r) => (resolveCreate = r)),
    );

    const p1 = harness.activateInitialAgent(AGENT_ID, WORKSPACE, createFn);
    const p2 = harness.activateInitialAgent(AGENT_ID, WORKSPACE, createFn);

    expect(createFn).toHaveBeenCalledTimes(1);

    const session = makeSession();
    resolveCreate(session);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(session);
    expect(r2).toBe(session);
  });

  it('lock is cleaned up after success', async () => {
    const session = makeSession();
    const createFn = vi.fn().mockResolvedValue(session);

    await harness.activateInitialAgent(AGENT_ID, WORKSPACE, createFn);

    expect(harness.initialAgentActivationLocks.size).toBe(0);
  });

  it('lock is cleaned up after failure', async () => {
    const createFn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(
      harness.activateInitialAgent(AGENT_ID, WORKSPACE, createFn),
    ).rejects.toThrow('boom');

    expect(harness.initialAgentActivationLocks.size).toBe(0);
  });

  it('timeout releases lock after 60s and returns null', async () => {
    vi.useFakeTimers();

    // createFn returns a promise that never resolves
    const createFn = vi.fn(() => new Promise<AgentSession | null>(() => {}));

    const resultPromise = harness.activateInitialAgent(AGENT_ID, WORKSPACE, createFn);

    // Lock should exist while activation is in progress
    expect(harness.initialAgentActivationLocks.size).toBe(1);

    // Advance past the 60s timeout
    await vi.advanceTimersByTimeAsync(60_000);

    const result = await resultPromise;
    expect(result).toBeNull();
    expect(harness.initialAgentActivationLocks.size).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'activateInitialAgent: timeout after 60s, releasing lock',
      expect.objectContaining({ key: `${WORKSPACE.id}:${AGENT_ID}` }),
    );
  });
});
