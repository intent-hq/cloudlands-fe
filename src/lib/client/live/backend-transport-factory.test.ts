/**
 * Selection tests for `backend-transport-factory.ts`.
 *
 * The factory caches its pick at module level, so each test re-imports the
 * module after `vi.resetModules()`. The Electron preload bridge is simulated
 * by stubbing `window.electronAPI` (the global test-setup installs a mock; it
 * is removed for the plain-browser cases) and the WebSocket URL comes from
 * `vi.stubEnv("VITE_INTENTD_WS_URL", ...)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function resolveFreshTransport() {
  vi.resetModules();
  const [factory, browser] = await Promise.all([
    import("./backend-transport-factory"),
    import("./browser-websocket-transport"),
  ]);
  return {
    transport: factory.resolveBackendTransport(),
    BrowserWebSocketTransport: browser.BrowserWebSocketTransport,
  };
}

describe("resolveBackendTransport", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("picks the Electron IPC transport when the preload bridge is present", async () => {
    // The global test-setup installs a mock window.electronAPI.
    expect(window.electronAPI).toBeDefined();
    vi.stubEnv("VITE_INTENTD_WS_URL", "ws://localhost:9100/rpc");
    const { transport, BrowserWebSocketTransport } = await resolveFreshTransport();
    expect(transport).not.toBeInstanceOf(BrowserWebSocketTransport);
    expect(transport.isAvailable()).toBe(true);
  });

  it("picks the browser WebSocket transport when the bridge is absent and a WS URL is set", async () => {
    vi.stubGlobal("window", { ...window, electronAPI: undefined });
    vi.stubEnv("VITE_INTENTD_WS_URL", "ws://localhost:9100/rpc?token=abc");
    const { transport, BrowserWebSocketTransport } = await resolveFreshTransport();
    expect(transport).toBeInstanceOf(BrowserWebSocketTransport);
    expect(transport.isAvailable()).toBe(true);
  });

  it("prefers the WS transport over the dev browser mock's electronAPI (dev:web + VITE_INTENTD_WS_URL)", async () => {
    // The dev browser mock installs an electronAPI with the 0.0.0-browser
    // sentinel version; it must not shadow a configured WS URL.
    vi.stubGlobal("window", {
      ...window,
      electronAPI: {
        ...window.electronAPI,
        versions: { node: "20.0.0", chrome: "120.0.0", electron: "0.0.0-browser" },
      },
    });
    vi.stubEnv("VITE_INTENTD_WS_URL", "ws://localhost:9100/rpc?token=abc");
    const { transport, BrowserWebSocketTransport } = await resolveFreshTransport();
    expect(transport).toBeInstanceOf(BrowserWebSocketTransport);
    expect(transport.isAvailable()).toBe(true);
  });

  it("falls back to the IPC transport (mock-backed) when the mock is installed and no WS URL is set", async () => {
    vi.stubGlobal("window", {
      ...window,
      electronAPI: {
        ...window.electronAPI,
        versions: { node: "20.0.0", chrome: "120.0.0", electron: "0.0.0-browser" },
      },
    });
    vi.stubEnv("VITE_INTENTD_WS_URL", "");
    const { transport, BrowserWebSocketTransport } = await resolveFreshTransport();
    expect(transport).not.toBeInstanceOf(BrowserWebSocketTransport);
    // The IPC fallback re-checks window.electronAPI per call, so the mock
    // bridge keeps it available.
    expect(transport.isAvailable()).toBe(true);
  });

  it("falls back to the degraded Electron IPC transport when no WS URL is configured", async () => {
    vi.stubGlobal("window", { ...window, electronAPI: undefined });
    vi.stubEnv("VITE_INTENTD_WS_URL", "");
    const { transport, BrowserWebSocketTransport } = await resolveFreshTransport();
    expect(transport).not.toBeInstanceOf(BrowserWebSocketTransport);
    expect(transport.isAvailable()).toBe(false);
  });

  it("ignores a non-websocket VITE_INTENTD_WS_URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", { ...window, electronAPI: undefined });
    vi.stubEnv("VITE_INTENTD_WS_URL", "http://localhost:9100/rpc");
    const { transport, BrowserWebSocketTransport } = await resolveFreshTransport();
    expect(transport).not.toBeInstanceOf(BrowserWebSocketTransport);
    warn.mockRestore();
  });

  it("caches the selected transport across calls", async () => {
    vi.resetModules();
    const factory = await import("./backend-transport-factory");
    expect(factory.resolveBackendTransport()).toBe(factory.resolveBackendTransport());
  });
});
