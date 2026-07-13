/**
 * Unit tests for healthCheckProbe socket behavior.
 *
 * Tests verify successful probe responses, timeout handling, error handling,
 * and socket cleanup across all code paths.
 */
import * as net from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { healthCheckProbe } from './intentd-sidecar';

// Mock fs.existsSync for socket path checks
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

// Mock net.connect for socket probe tests
vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    connect: vi.fn(),
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
          setTimeout(() => handler(Buffer.from('{"jsonrpc":"2.0","id":1,"result":[]}')), 100);
        }
      }),
    };
    mockConnect.mockReturnValue(mockSocket as any);

    const probePromise = healthCheckProbe('/test.sock', 3000);

    // Advance timers to trigger connect and data events
    await vi.advanceTimersByTimeAsync(150);

    const result = await probePromise;
    expect(result).toBe(true);
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('workspace.list'));
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

  it('sends a JSON-RPC workspace.list request', async () => {
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
    expect(writtenData).toContain('"method":"workspace.list"');
    expect(writtenData).toContain('"params":{"lite":true}');
    expect(writtenData).toContain('"jsonrpc":"2.0"');
  });
});
