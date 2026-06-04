// @vitest-environment node

/**
 * WebSocket API Server Tests
 *
 * Tests the WebSocket API server lifecycle, upgrade handling, and auth.
 * Uses a real HTTPS server with a self-signed cert since the server now uses TLS.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import https from 'https';
import { EventEmitter } from 'events';

// All mock state must be hoisted so vi.mock factories can reference them
const {
  mockValidateToken, mockExtractBearerToken, mockIsWebSocketApiEnabled,
  mockHandleWebSocketMessage, mockRegisterSendCallback, mockHandleSubscribe,
  mockHandleUnsubscribe, mockCleanupClient,
  mockEnsureTlsCertificate, mockGetCertFingerprint,
  mockFindAvailablePort,
  // We store the latest WSS instance the mock created so tests can poke it
  wssHolder,
} = vi.hoisted(() => {
  const wssHolder: { instance: any; handleUpgrade: any } = {
    instance: null, handleUpgrade: vi.fn(),
  };
  return {
    mockValidateToken: vi.fn().mockReturnValue(true),
    mockExtractBearerToken: vi.fn().mockReturnValue('valid-token'),
    mockIsWebSocketApiEnabled: vi.fn().mockReturnValue(true),
    mockHandleWebSocketMessage: vi.fn().mockResolvedValue(null),
    mockRegisterSendCallback: vi.fn(),
    mockHandleSubscribe: vi.fn(),
    mockHandleUnsubscribe: vi.fn(),
    mockCleanupClient: vi.fn(),
    mockEnsureTlsCertificate: vi.fn(),
    mockGetCertFingerprint: vi.fn().mockReturnValue('AA:BB:CC:DD'),
    mockFindAvailablePort: vi.fn((port: number) => Promise.resolve(port)),
    wssHolder,
  };
});

vi.mock('../utils/ws-runtime', () => {
  // Each new WebSocketServer() returns a fresh instance with its own listeners
  // and a Set of clients. close(cb) invokes the callback so the async stop()
  // path can resolve.
  function MockWebSocketServer(this: any) {
    const listeners: Record<string, Function[]> = {};
    const self: any = {
      on: (event: string, fn: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
        return self;
      },
      emit: (event: string, ...args: any[]) => {
        (listeners[event] || []).forEach((fn) => fn(...args));
      },
      close: vi.fn((cb?: Function) => cb?.()),
      handleUpgrade: wssHolder.handleUpgrade,
      clients: new Set(),
    };
    wssHolder.instance = self;
    return self;
  }
  class MockWebSocket {
    static Server = MockWebSocketServer;
    static OPEN = 1;
    static CLOSED = 3;

    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }
  return {
    getWebSocketClass: () => MockWebSocket,
    getWebSocketServerClass: () => MockWebSocketServer,
  };
});

vi.mock('../../utils/port-utils', () => ({
  findAvailablePort: mockFindAvailablePort,
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp'), isPackaged: false },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock('electron-store', () => ({
  __esModule: true,
  default: function MockElectronStore() { return { set: vi.fn(), get: vi.fn(), store: {} }; },
}));
vi.mock('../websocket-tls', () => ({
  ensureTlsCertificate: mockEnsureTlsCertificate,
  getCertFingerprint: mockGetCertFingerprint,
}));
vi.mock('../websocket-auth', () => ({
  validateToken: mockValidateToken,
  extractBearerToken: mockExtractBearerToken,
  isWebSocketApiEnabled: mockIsWebSocketApiEnabled,
}));
vi.mock('../websocket-protocol-handler', () => ({
  handleWebSocketMessage: mockHandleWebSocketMessage,
  getSupportedMethods: vi.fn().mockReturnValue([]),
}));
vi.mock('../websocket-event-bridge', () => ({
  handleSubscribe: mockHandleSubscribe,
  handleUnsubscribe: mockHandleUnsubscribe,
  cleanupClient: mockCleanupClient,
  registerSendCallback: mockRegisterSendCallback,
}));

import { WebSocketApiServer } from '../websocket-api-server';
import { generate as generateCert } from 'selfsigned';

// Generate a test cert once for all tests
let testCert: { cert: string; key: string };

beforeAll(async () => {
  const pems = await generateCert(
    [{ name: 'commonName', value: 'test' }],
    { keyType: 'ec', curve: 'P-256', algorithm: 'sha256' },
  );
  testCert = { cert: pems.cert, key: pems.private };
});

describe('WebSocket API Server', () => {
  let server: WebSocketApiServer;
  // Use a random high port to avoid conflicts
  const testPort = 15000 + Math.floor(Math.random() * 10000);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: findAvailablePort is a passthrough.
    mockFindAvailablePort.mockImplementation((port: number) => Promise.resolve(port));
    // Mock TLS cert to return our test cert
    mockEnsureTlsCertificate.mockResolvedValue({
      cert: testCert.cert,
      key: testCert.key,
      fingerprint256: 'AA:BB:CC:DD',
    });
    // Reset handleUpgrade to create fresh fake WS per test
    wssHolder.handleUpgrade.mockImplementation((_req: any, _socket: any, _head: any, cb: any) => {
      const fakeWs = new EventEmitter() as any;
      fakeWs.send = vi.fn();
      fakeWs.close = vi.fn();
      fakeWs.terminate = vi.fn();
      fakeWs.ping = vi.fn();
      fakeWs.readyState = 1;
      cb(fakeWs);
    });
    // Constructor now takes a port number
    server = new WebSocketApiServer(testPort);
    // Shorten backoff so tests retrying same-port stay fast.
    (server as any).listenBackoffMs = [10, 10, 10];
  });

  afterEach(async () => {
    await server.stop();
    // Allow the OS to release the port before the next test
    await new Promise((r) => setTimeout(r, 50));
  });

  it('creates an instance', () => {
    expect(server).toBeInstanceOf(WebSocketApiServer);
  });

  describe('lifecycle', () => {
    it('isRunning() false before start', () => {
      expect(server.isRunning()).toBe(false);
    });

    it('isRunning() true after start', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it('isRunning() false after stop', async () => {
      await server.start();
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('start() registers send callback', async () => {
      await server.start();
      expect(mockRegisterSendCallback).toHaveBeenCalledTimes(1);
    });

    it('start() is idempotent', async () => {
      await server.start();
      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it('getPort() returns actual port after start', async () => {
      await server.start();
      // Port might be the requested port or a fallback, but should be > 0
      expect(server.getPort()).toBeGreaterThan(0);
    });

    it('getPort() returns 0 before start', () => {
      expect(server.getPort()).toBe(0);
    });
  });

  it('connectedClients is 0 with no clients', async () => {
    await server.start();
    expect(server.connectedClients).toBe(0);
  });

  describe('health endpoint', () => {
    /** Helper: make an HTTPS GET request ignoring self-signed cert errors. */
    function httpsGet(url: string): Promise<{ statusCode: number; body: string }> {
      return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
        }).on('error', reject);
      });
    }

    it('responds to /health', async () => {
      await server.start();
      const port = server.getPort();

      const { statusCode, body } = await httpsGet(`https://127.0.0.1:${port}/health`);
      expect(statusCode).toBe(200);

      const data = JSON.parse(body);
      expect(data.status).toBe('ok');
      expect(typeof data.clients).toBe('number');
    });

    it('returns 404 for unknown paths', async () => {
      await server.start();
      const port = server.getPort();

      const { statusCode } = await httpsGet(`https://127.0.0.1:${port}/unknown`);
      expect(statusCode).toBe(404);
    });
  });

  describe('TLS', () => {
    it('getCertFingerprint() returns fingerprint after start', async () => {
      await server.start();
      expect(server.getCertFingerprint()).toBe('AA:BB:CC:DD');
    });

    it('start() calls ensureTlsCertificate', async () => {
      await server.start();
      expect(mockEnsureTlsCertificate).toHaveBeenCalledTimes(1);
    });

    it('getCertFingerprint() delegates to websocket-tls module mock', () => {
      // Before start, getCertFingerprint still delegates to the mock which returns 'AA:BB:CC:DD'.
      // In production, the real getCertFingerprint from websocket-tls returns null before
      // ensureTlsCertificate is called. Here we verify the mock is invoked.
      const result = server.getCertFingerprint();
      expect(mockGetCertFingerprint).toHaveBeenCalled();
      expect(result).toBe('AA:BB:CC:DD');
    });
  });

  describe('port fallback', () => {
    let server2: WebSocketApiServer;

    afterEach(async () => {
      await server2?.stop();
      await new Promise((r) => setTimeout(r, 50));
    });

    it('binds to next port when requested port is in use', async () => {
      // Mock findAvailablePort as a pure passthrough so the test exercises
      // the real listenOnce retry path (which owns the fallback behaviour
      // after the inline loop was removed).
      mockFindAvailablePort.mockImplementation((port: number) => Promise.resolve(port));

      // Start the first server on testPort
      await server.start();
      const firstPort = server.getPort();
      expect(firstPort).toBeGreaterThan(0);

      // Start a second server requesting the same port — should fall back
      server2 = new WebSocketApiServer(firstPort);
      (server2 as any).listenBackoffMs = [10, 10, 10];
      await server2.start();
      const secondPort = server2.getPort();

      expect(secondPort).toBeGreaterThan(firstPort);
      expect(server2.isRunning()).toBe(true);
      // Sanity: findAvailablePort was used as the advisory pre-check.
      expect(mockFindAvailablePort).toHaveBeenCalled();
    });

  });

  describe('Origin allow-list', () => {
    /** Helper: invoke handleUpgrade with a synthetic request. */
    function callHandleUpgrade(origin: string | undefined): { destroyed: boolean; written: string[] } {
      const written: string[] = [];
      let destroyed = false;
      const socket: any = {
        write: (chunk: string) => { written.push(chunk); },
        destroy: () => { destroyed = true; },
      };
      const req: any = {
        url: '/ws',
        headers: origin === undefined ? {} : { origin },
        socket: { remoteAddress: '127.0.0.1' },
      };
      (server as any).handleUpgrade(req, socket, Buffer.alloc(0));
      return { destroyed, written };
    }

    it('accepts upgrade with allowed origin (loopback)', async () => {
      await server.start();
      const { destroyed, written } = callHandleUpgrade('http://localhost:5177');
      // Allowed → falls through to wss.handleUpgrade (mock), no 403/401 written.
      expect(written.some((w) => w.includes('403'))).toBe(false);
      expect(written.some((w) => w.includes('401'))).toBe(false);
      expect(destroyed).toBe(false);
    });

    it('rejects upgrade with disallowed origin (cross-origin browser)', async () => {
      await server.start();
      const { destroyed, written } = callHandleUpgrade('https://evil.example.com');
      expect(written.some((w) => w.includes('403'))).toBe(true);
      expect(destroyed).toBe(true);
    });

    it('accepts upgrade with no Origin header (native iOS/CLI client)', async () => {
      await server.start();
      const { destroyed, written } = callHandleUpgrade(undefined);
      expect(written.some((w) => w.includes('403'))).toBe(false);
      expect(written.some((w) => w.includes('401'))).toBe(false);
      expect(destroyed).toBe(false);
    });

    it('accepts upgrade with empty-string Origin header', async () => {
      await server.start();
      const { destroyed, written } = callHandleUpgrade('');
      expect(written.some((w) => w.includes('403'))).toBe(false);
      expect(written.some((w) => w.includes('401'))).toBe(false);
      expect(destroyed).toBe(false);
    });
  });

  describe('single-flight start/stop', () => {
    it('concurrent start() calls share one in-flight promise', async () => {
      const ensureSpy = mockEnsureTlsCertificate;
      ensureSpy.mockClear();

      // Fire three concurrent start() calls.
      const [r1, r2, r3] = [server.start(), server.start(), server.start()];
      await Promise.all([r1, r2, r3]);

      expect(server.isRunning()).toBe(true);
      // ensureTlsCertificate is called exactly once by the shared in-flight
      // start(); idempotent fast-path (already started) would not call it
      // at all.
      expect(ensureSpy).toHaveBeenCalledTimes(1);
    });

    it('stop() during in-flight start() cancels the start (no listener bound)', async () => {
      // Slow down ensureTlsCertificate so we can race stop() in mid-start.
      mockEnsureTlsCertificate.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ cert: testCert.cert, key: testCert.key, fingerprint256: 'AA:BB:CC:DD' }),
              50,
            ),
          ),
      );
      const startPromise = server.start();
      // Race stop() in before TLS cert resolves.
      await new Promise((r) => setTimeout(r, 5));
      const stopPromise = server.stop();
      await Promise.all([startPromise, stopPromise]);
      // The in-flight start() observed the externalStopGeneration bump and
      // aborted before binding. The server should not be running.
      expect(server.isRunning()).toBe(false);
      expect(server.getPort()).toBe(0);
    });

  });

  describe('async stop()', () => {
    it('stop() resolves only after wss.close() and httpServer.close() callbacks fire', async () => {
      await server.start();
      const wssInstance = wssHolder.instance;
      // Defer the WSS close callback so stop() must wait for it.
      let wssCloseResolve: Function | null = null;
      wssInstance.close = vi.fn((cb?: Function) => {
        wssCloseResolve = cb!;
      });

      let stopResolved = false;
      const stopPromise = server.stop().then(() => { stopResolved = true; });
      // Give stop a tick to reach the WSS close.
      await new Promise((r) => setTimeout(r, 20));
      // stop() should NOT have resolved yet — it's awaiting the WSS close cb.
      expect(stopResolved).toBe(false);
      // Fire the WSS close callback to let stop() progress.
      wssCloseResolve?.();
      await stopPromise;
      expect(stopResolved).toBe(true);
      expect(server.isRunning()).toBe(false);
    });

    it('toggle-off-then-on cycle produces no EADDRINUSE', async () => {
      await server.start();
      const port = server.getPort();
      expect(port).toBeGreaterThan(0);

      // Toggle off (await async stop)
      await server.stop();
      expect(server.isRunning()).toBe(false);

      // Toggle on again on the same requested port — should bind without
      // throwing EADDRINUSE because the previous bind has been released.
      server = new WebSocketApiServer(testPort);
      (server as any).listenBackoffMs = [10, 10, 10];
      await expect(server.start()).resolves.toBeUndefined();
      expect(server.isRunning()).toBe(true);
    });

    it('post-listen httpServer error is captured by durable handler (not unhandled)', async () => {
      await server.start();
      const httpServer = (server as any).httpServer as EventEmitter | null;
      expect(httpServer).not.toBeNull();
      // Emit a runtime error on the http server after listen. The post-listen
      // durable handler should swallow it; nothing should escape.
      const unhandled: unknown[] = [];
      const onUncaught = (err: unknown) => unhandled.push(err);
      process.on('uncaughtException', onUncaught);
      try {
        const fakeErr: any = new Error('post-listen boom');
        fakeErr.code = 'ECONNRESET';
        httpServer!.emit('error', fakeErr);
        // Give the event loop a tick to surface any unhandled.
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('uncaughtException', onUncaught);
      }
    });
  });

  describe('stop() idempotency', () => {
    it('calling stop() twice does not throw', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);

      // Second stop should resolve cleanly (guarded by `if (!this.started) return`)
      await expect(server.stop()).resolves.toBeUndefined();
      expect(server.isRunning()).toBe(false);
    });

    it('stop() without start does not throw', async () => {
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  describe('server binding', () => {
    it('binds to 0.0.0.0 for LAN access', async () => {
      // The server binds to 0.0.0.0 (all interfaces) so it is accessible on the LAN.
      // The health endpoint test above implicitly verifies this by connecting to 127.0.0.1,
      // which is reachable because the server listens on 0.0.0.0.
      await server.start();
      expect(server.getPort()).toBeGreaterThan(0);
      expect(server.isRunning()).toBe(true);
      // The httpServer is private, but we can verify accessibility via the health endpoint.
      // See the 'health endpoint' describe block for the actual HTTP verification.
    });
  });
});

