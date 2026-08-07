/**
 * Unit tests for healthCheckProbe socket behavior and watchdog integration.
 *
 * Tests verify successful probe responses, timeout handling, error handling,
 * socket cleanup, and the N-strikes restart policy with graceful kill escalation.
 */

// Mock fs.existsSync for socket path checks
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

import type { ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  healthCheckProbe,
  stopIntentdSidecar,
  __resetIntentdSidecarForTesting,
  __setSidecarProcessForTesting,
  __startWatchdogForTesting,
  __SIDECAR_READY_TIMING_FOR_TESTING,
} from './intentd-sidecar';

// Mock net.connect for socket probe tests
vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    connect: vi.fn(),
  };
});

// Mock child_process.spawn for watchdog integration tests
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

describe('healthCheckProbe', () => {
  const mockConnect = vi.mocked(net.connect);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when daemon responds within timeout', async () => {
    const mockSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'connect') {
          // Immediately call the connect handler
          setTimeout(() => handler(), 0);
        } else if (event === 'data') {
          // Simulate daemon response after a short delay
          setTimeout(
            () => handler(Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"status":"running"}}')),
            100,
          );
        }
      }),
    };
    mockConnect.mockReturnValue(mockSocket as any);

    const probePromise = healthCheckProbe('/test.sock', 3000);

    // Advance timers to trigger connect and data events
    await vi.advanceTimersByTimeAsync(150);

    const result = await probePromise;
    expect(result).toBe(true);
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('system.status'));
    expect(mockSocket.destroy).toHaveBeenCalled();
  });

  it('returns false when daemon does not respond within timeout', async () => {
    const mockSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'connect') {
          setTimeout(() => handler(), 0);
        }
        // No data event - daemon doesn't respond
      }),
    };
    mockConnect.mockReturnValue(mockSocket as any);

    const probePromise = healthCheckProbe('/test.sock', 3000);

    // Advance timers past the timeout
    await vi.advanceTimersByTimeAsync(3500);

    const result = await probePromise;
    expect(result).toBe(false);
    expect(mockSocket.destroy).toHaveBeenCalled();
  });

  it('returns false on connection error', async () => {
    const mockSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error('Connection refused')), 0);
        }
      }),
    };
    mockConnect.mockReturnValue(mockSocket as any);

    const probePromise = healthCheckProbe('/test.sock', 3000);
    await vi.advanceTimersByTimeAsync(100);

    const result = await probePromise;
    expect(result).toBe(false);
  });

  it('uses the specified timeout value', async () => {
    const mockSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'connect') {
          setTimeout(() => handler(), 0);
        }
      }),
    };
    mockConnect.mockReturnValue(mockSocket as any);

    const probePromise = healthCheckProbe('/test.sock', 1000);

    // Should timeout after 1000ms, not the default 3000ms
    await vi.advanceTimersByTimeAsync(1100);

    const result = await probePromise;
    expect(result).toBe(false);
  });

  it('sends a JSON-RPC system.status request', async () => {
    const mockSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'connect') {
          setTimeout(() => handler(), 0);
        } else if (event === 'data') {
          setTimeout(() => handler(Buffer.from('{}')), 50);
        }
      }),
    };
    mockConnect.mockReturnValue(mockSocket as any);

    const probePromise = healthCheckProbe('/test.sock', 3000);
    await vi.advanceTimersByTimeAsync(100);
    await probePromise;

    expect(mockSocket.write).toHaveBeenCalledTimes(1);
    const writtenData = mockSocket.write.mock.calls[0][0];
    expect(writtenData).toContain('"method":"system.status"');
    expect(writtenData).not.toContain('"params"');
    expect(writtenData).toContain('"jsonrpc":"2.0"');
  });
});

/**
 * Watchdog N-strikes policy and graceful kill escalation tests.
 *
 * These tests verify the watchdog state machine per STAB-6 requirements:
 * - Probe uses system.status (not workspace.list)
 * - Single failure does not trigger kill
 * - 3rd consecutive failure triggers SIGTERM
 * - Successful probe resets failure counter
 * - SIGTERM → SIGKILL escalation with ~5s grace period
 *
 * The N-strikes regime only applies once the daemon has answered at least one
 * probe, so these tests start the watchdog with `daemonAlreadyResponded=true`.
 * The pre-first-response (startup readiness) regime is covered separately in
 * "Watchdog startup readiness budget" below.
 */
describe('Watchdog N-strikes policy', () => {
  const mockConnect = vi.mocked(net.connect);

  beforeEach(() => {
    vi.clearAllMocks();
    __resetIntentdSidecarForTesting();
  });

  afterEach(() => {
    __resetIntentdSidecarForTesting();
    vi.useRealTimers();
  });

  it('probe sends system.status method (not workspace.list)', async () => {
    const mockSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'connect') {
          setTimeout(() => handler(), 0);
        } else if (event === 'data') {
          setTimeout(() => handler(Buffer.from('{"result":{}}')), 10);
        }
      }),
    };
    mockConnect.mockReturnValue(mockSocket as any);

    await healthCheckProbe('/test.sock');

    const writtenData = mockSocket.write.mock.calls[0][0];
    expect(writtenData).toContain('"method":"system.status"');
    expect(writtenData).not.toContain('workspace.list');
    expect(writtenData).not.toContain('"params"');
  });

  it('single probe failure does NOT kill process', async () => {
    vi.useFakeTimers();

    // Mock socket to make probe fail (no 'data' event)
    mockConnect.mockImplementation(
      () =>
        ({
          write: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, handler: any) => {
            if (event === 'connect') setTimeout(() => handler(), 0);
            // No 'data' event - probe will timeout and fail
          }),
        }) as any,
    );

    const mockProcess = {
      kill: vi.fn(() => true),
      killed: false,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
    __setSidecarProcessForTesting(mockProcess);

    // Start watchdog with 100ms delay (steady-state regime)
    __startWatchdogForTesting('/test.sock', 100, true);

    // Advance to trigger first probe (100ms + 3000ms timeout)
    await vi.advanceTimersByTimeAsync(3200);

    // Process should NOT be killed after single failure
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it('3rd consecutive failure triggers SIGTERM', async () => {
    vi.useFakeTimers();

    // Mock socket to make all probes fail
    mockConnect.mockImplementation(
      () =>
        ({
          write: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, handler: any) => {
            if (event === 'connect') setTimeout(() => handler(), 0);
            // No 'data' event - all probes fail
          }),
        }) as any,
    );

    const mockProcess = {
      kill: vi.fn(() => true),
      killed: false,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
    __setSidecarProcessForTesting(mockProcess);

    // Start watchdog with 100ms delay (steady-state regime)
    __startWatchdogForTesting('/test.sock', 100, true);

    // First failure (100ms + 3s timeout)
    await vi.advanceTimersByTimeAsync(3200);
    expect(mockProcess.kill).not.toHaveBeenCalled();

    // Second failure (10s interval + 3s timeout)
    await vi.advanceTimersByTimeAsync(13100);
    expect(mockProcess.kill).not.toHaveBeenCalled();

    // Third failure - should trigger SIGTERM
    await vi.advanceTimersByTimeAsync(13100);
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProcess.kill).toHaveBeenCalledTimes(1);
  });

  it('successful probe resets failure counter', async () => {
    vi.useFakeTimers();

    let probeCount = 0;
    // Mock socket: fail, fail, success, fail pattern
    mockConnect.mockImplementation(() => {
      probeCount++;
      return {
        write: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, handler: any) => {
          if (event === 'connect') setTimeout(() => handler(), 0);
          // Third probe succeeds, others fail
          if (event === 'data' && probeCount === 3) {
            setTimeout(() => handler(Buffer.from('{"result":{}}')), 10);
          }
        }),
      } as any;
    });

    const mockProcess = {
      kill: vi.fn(() => true),
      killed: false,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
    __setSidecarProcessForTesting(mockProcess);

    // Start watchdog with 100ms delay (steady-state regime)
    __startWatchdogForTesting('/test.sock', 100, true);

    // First failure
    await vi.advanceTimersByTimeAsync(3200);
    expect(mockProcess.kill).not.toHaveBeenCalled();
    expect(probeCount).toBe(1);

    // Second failure
    await vi.advanceTimersByTimeAsync(13100);
    expect(mockProcess.kill).not.toHaveBeenCalled();
    expect(probeCount).toBe(2);

    // Third probe succeeds - counter resets
    await vi.advanceTimersByTimeAsync(13100);
    expect(mockProcess.kill).not.toHaveBeenCalled();
    expect(probeCount).toBe(3);

    // Fourth probe fails - this is now "first" failure after reset
    await vi.advanceTimersByTimeAsync(13100);
    expect(mockProcess.kill).not.toHaveBeenCalled();
    expect(probeCount).toBe(4);
  });

  it('SIGKILL sent after 5s grace period if process does not exit', async () => {
    vi.useFakeTimers();

    // Mock socket to make all probes fail
    mockConnect.mockImplementation(
      () =>
        ({
          write: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, handler: any) => {
            if (event === 'connect') setTimeout(() => handler(), 0);
            // No 'data' event - all probes fail
          }),
        }) as any,
    );

    const mockProcess = {
      kill: vi.fn((signal?: NodeJS.Signals | number) => {
        // Mimic real Node.js behavior: killed becomes true after any successful kill()
        if (signal) mockProcess.killed = true;
        return true;
      }),
      killed: false,
      exitCode: null, // Process remains alive
      signalCode: null, // No signal received yet
    } as unknown as ChildProcess;
    __setSidecarProcessForTesting(mockProcess);

    // Start watchdog with 100ms delay (steady-state regime)
    __startWatchdogForTesting('/test.sock', 100, true);

    // Trigger 3 failures to get SIGTERM
    await vi.advanceTimersByTimeAsync(3200); // 1st failure
    await vi.advanceTimersByTimeAsync(13100); // 2nd failure
    await vi.advanceTimersByTimeAsync(13100); // 3rd failure -> SIGTERM
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProcess.kill).toHaveBeenCalledTimes(1);

    // Wait for 5s grace period
    await vi.advanceTimersByTimeAsync(5100);

    // SIGKILL should be sent
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockProcess.kill).toHaveBeenCalledTimes(2);
  });

  it('SIGKILL NOT sent if process exits gracefully within grace period', async () => {
    vi.useFakeTimers();

    // Mock socket to make all probes fail
    mockConnect.mockImplementation(
      () =>
        ({
          write: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, handler: any) => {
            if (event === 'connect') setTimeout(() => handler(), 0);
            // No 'data' event - all probes fail
          }),
        }) as any,
    );

    const mockProcess = {
      kill: vi.fn((signal?: NodeJS.Signals | number) => {
        // Mimic real Node.js behavior: killed becomes true after any successful kill()
        if (signal) mockProcess.killed = true;
        return true;
      }),
      killed: false,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
    __setSidecarProcessForTesting(mockProcess);

    // Start watchdog with 100ms delay (steady-state regime)
    __startWatchdogForTesting('/test.sock', 100, true);

    // Trigger 3 failures
    await vi.advanceTimersByTimeAsync(3200); // 1st
    await vi.advanceTimersByTimeAsync(13100); // 2nd
    await vi.advanceTimersByTimeAsync(13100); // 3rd -> SIGTERM
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProcess.kill).toHaveBeenCalledTimes(1);

    // Simulate process exiting gracefully before grace period expires
    mockProcess.exitCode = 0;
    mockProcess.killed = true;

    // Wait for grace period
    await vi.advanceTimersByTimeAsync(5100);

    // SIGKILL should NOT be sent (only SIGTERM)
    expect(mockProcess.kill).toHaveBeenCalledTimes(1);
    expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL');
  });
});

/**
 * Startup readiness regime: before the daemon has ever answered a probe, a slow
 * boot (heavy FSEvents/MCP init on a loaded machine) must not be mistaken for an
 * unhealthy daemon. The watchdog waits out a documented budget, then kills.
 */
describe('Watchdog startup readiness budget', () => {
  const mockConnect = vi.mocked(net.connect);
  const { budgetMs, probeIntervalMs, probeTimeoutMs } = __SIDECAR_READY_TIMING_FOR_TESTING;

  /** Socket mock: probes fail until `succeedFrom`, then answer system.status. */
  function mockProbesFailingUntil(succeedFrom: number): { count: () => number } {
    let probeCount = 0;
    mockConnect.mockImplementation(() => {
      probeCount++;
      const succeed = probeCount >= succeedFrom;
      return {
        write: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, handler: any) => {
          if (event === 'connect') setTimeout(() => handler(), 0);
          if (event === 'data' && succeed) {
            setTimeout(() => handler(Buffer.from('{"result":{}}')), 10);
          }
        }),
      } as any;
    });
    return { count: () => probeCount };
  }

  function mockAliveProcess(): ChildProcess {
    return {
      kill: vi.fn(() => true),
      killed: false,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetIntentdSidecarForTesting();
  });

  afterEach(() => {
    __resetIntentdSidecarForTesting();
    vi.useRealTimers();
  });

  it('documents a startup budget of at least 60s with sub-budget probe intervals', () => {
    expect(budgetMs).toBeGreaterThanOrEqual(60_000);
    expect(probeIntervalMs).toBeGreaterThan(0);
    expect(probeIntervalMs).toBeLessThan(budgetMs);
    expect(probeTimeoutMs).toBeLessThan(budgetMs);
  });

  it('does not kill a daemon that takes 10s to answer its first probe', async () => {
    vi.useFakeTimers();
    // 7+s fseventsd registrations: the daemon answers only from the 3rd probe.
    const probes = mockProbesFailingUntil(3);
    const mockProcess = mockAliveProcess();
    __setSidecarProcessForTesting(mockProcess);

    __startWatchdogForTesting('/test.sock', 100);

    // Two failed probes (each ~3s timeout + 1s interval), then a success.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(probes.count()).toBeGreaterThanOrEqual(3);
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it('keeps probing across the whole budget without killing the process', async () => {
    vi.useFakeTimers();
    mockProbesFailingUntil(Number.POSITIVE_INFINITY);
    const mockProcess = mockAliveProcess();
    __setSidecarProcessForTesting(mockProcess);

    __startWatchdogForTesting('/test.sock', 100);

    // Well past the old ~3s tolerance but inside the readiness budget.
    await vi.advanceTimersByTimeAsync(budgetMs - probeTimeoutMs - probeIntervalMs);
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it('kills the process once the readiness budget is exhausted', async () => {
    vi.useFakeTimers();
    mockProbesFailingUntil(Number.POSITIVE_INFINITY);
    const mockProcess = mockAliveProcess();
    __setSidecarProcessForTesting(mockProcess);

    __startWatchdogForTesting('/test.sock', 100);

    // Past the budget plus one full probe cycle so the deadline check fires.
    await vi.advanceTimersByTimeAsync(budgetMs + probeTimeoutMs + probeIntervalMs + 100);
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stops waiting immediately when the daemon process is gone (crash short-circuit)', async () => {
    vi.useFakeTimers();
    const probes = mockProbesFailingUntil(Number.POSITIVE_INFINITY);
    const mockProcess = mockAliveProcess();
    __setSidecarProcessForTesting(mockProcess);

    __startWatchdogForTesting('/test.sock', 100);

    // First probe fails; the daemon then crashes (the real 'exit' handler
    // nulls the process handle), so the readiness wait must not continue.
    await vi.advanceTimersByTimeAsync(probeTimeoutMs + 200);
    const probesBeforeCrash = probes.count();
    expect(probesBeforeCrash).toBeGreaterThanOrEqual(1);

    __setSidecarProcessForTesting(null);
    await vi.advanceTimersByTimeAsync(budgetMs * 2);

    expect(probes.count()).toBe(probesBeforeCrash);
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it('never signals a replacement child with a stale probe result after crash + restart', async () => {
    vi.useFakeTimers();
    mockProbesFailingUntil(Number.POSITIVE_INFINITY);
    const crashedProcess = mockAliveProcess();
    __setSidecarProcessForTesting(crashedProcess);

    __startWatchdogForTesting('/test.sock', 100);

    // Run out the readiness budget and stop mid-probe, so a probe armed against
    // the old child is still in flight when it crashes.
    await vi.advanceTimersByTimeAsync(budgetMs + probeIntervalMs);
    expect(crashedProcess.kill).not.toHaveBeenCalled();

    // Crash + restart backoff installs a fresh child with its own readiness
    // window while that probe is in flight.
    const replacementProcess = mockAliveProcess();
    __setSidecarProcessForTesting(replacementProcess);

    // The stale probe now times out: its result belongs to the dead child and
    // must not kill the replacement.
    await vi.advanceTimersByTimeAsync(probeTimeoutMs + 500);

    expect(replacementProcess.kill).not.toHaveBeenCalled();
    expect(crashedProcess.kill).not.toHaveBeenCalled();
  });

  it('switches to the 3-strikes steady-state regime after the first response', async () => {
    vi.useFakeTimers();
    // First probe succeeds, every later probe fails.
    let probeCount = 0;
    mockConnect.mockImplementation(() => {
      probeCount++;
      const succeed = probeCount === 1;
      return {
        write: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, handler: any) => {
          if (event === 'connect') setTimeout(() => handler(), 0);
          if (event === 'data' && succeed) {
            setTimeout(() => handler(Buffer.from('{"result":{}}')), 10);
          }
        }),
      } as any;
    });
    const mockProcess = mockAliveProcess();
    __setSidecarProcessForTesting(mockProcess);

    __startWatchdogForTesting('/test.sock', 100);

    // Ready on the first probe, then 3 steady-state failures (10s + 3s each).
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(13_100);
    expect(mockProcess.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(13_100);
    expect(mockProcess.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(13_100);
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

/**
 * External mode: `sidecarProcess === null` (we adopted a daemon we did not
 * spawn). No kill path may ever run — we must never signal an unowned PID.
 */
describe('no kill path when sidecarProcess is null (external mode)', () => {
  const mockConnect = vi.mocked(net.connect);

  beforeEach(() => {
    vi.clearAllMocks();
    __resetIntentdSidecarForTesting();
  });

  afterEach(() => {
    __resetIntentdSidecarForTesting();
    vi.useRealTimers();
  });

  it('watchdog never probes or kills when sidecarProcess is null', async () => {
    vi.useFakeTimers();
    __setSidecarProcessForTesting(null);

    __startWatchdogForTesting('/test.sock', 100);

    // Run well past several probe intervals and kill grace periods.
    await vi.advanceTimersByTimeAsync(60_000);

    // The watchdog bails out before probing: no socket connection is ever
    // opened, so no kill decision can be reached.
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('stopIntentdSidecar returns without signalling when sidecarProcess is null', async () => {
    __setSidecarProcessForTesting(null);
    // Must resolve immediately without touching any process handle; a throw
    // or a stray kill would fail the test (there is no process to signal).
    await expect(stopIntentdSidecar(100)).resolves.toBeUndefined();
  });
});
