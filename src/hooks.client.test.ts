import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  expectsElectronPreloadBridge: vi.fn(() => false),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { warning: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/utils/platform-capabilities', () => ({
  expectsElectronPreloadBridge: mocks.expectsElectronPreloadBridge,
}));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { logger } from '$shared/logger';
import { handleError } from './hooks.client';
import {
  daemonHealthReducer,
  initialState,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { DaemonHealthState } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { daemonHealthSaga } from '$store/renderer/slices/daemon-health/sagas/daemon-health-saga';

const statusPayload = {
  running: true,
  listenMode: 'uds',
  transports: ['uds'],
  port: null,
  clients: 1,
  agents: 1,
  protocolVersion: '2.6',
  host: { os: 'linux', arch: 'x64', hasDisplay: false, locality: 'local' },
};

function installConnectedBridge(): void {
  (window as any).electronAPI = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: { mode: 'external-ws', target: 'ws://127.0.0.1:5181/rpc' },
        };
      }
      return undefined;
    }),
    on: vi.fn(() => 'daemon-status-listener'),
    offById: vi.fn(),
  };
}

function startDaemonHealthWithReducer() {
  const input = stdChannel();
  let state = { daemonHealth: initialState };
  const dispatch = (action: unknown) => {
    state = { daemonHealth: daemonHealthReducer(state.daemonHealth, action as never) };
    input.put(action as never);
    return action;
  };
  const task = runSaga({ channel: input, dispatch, getState: () => state }, daemonHealthSaga);
  return { task, getState: (): DaemonHealthState => state.daemonHealth };
}

describe('client startup', () => {
  const originalElectronAPI = (window as any).electronAPI;
  let releaseBrowserMock: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', '');
    mocks.expectsElectronPreloadBridge.mockReturnValue(false);
    mocks.backendRequest.mockResolvedValue(statusPayload);
    window.history.replaceState({}, '', '/');
    delete (window as any).electronAPI;
  });

  afterEach(() => {
    releaseBrowserMock?.();
    releaseBrowserMock = undefined;
    vi.unstubAllEnvs();
    vi.doUnmock('$lib/browser-mock');
    (window as any).electronAPI = originalElectronAPI;
  });

  it('awaits the browser bridge before app sagas can observe startup', async () => {
    const browserMockReady = new Promise<void>((resolve) => {
      releaseBrowserMock = resolve;
    });
    vi.doMock('$lib/browser-mock', async () => {
      await browserMockReady;
      installConnectedBridge();
      return {};
    });

    const clientHooks = await import('./hooks.client');
    expect(clientHooks.init).toBeTypeOf('function');

    let initialized = false;
    const initPromise = clientHooks.init().then(() => {
      initialized = true;
    });
    await Promise.resolve();

    expect(initialized).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();

    releaseBrowserMock();
    await initPromise;

    const { task, getState } = startDaemonHealthWithReducer();
    await vi.waitFor(() => expect(getState().health).toBe('healthy'));
    expect(getState().transport).toEqual({
      mode: 'external-ws',
      target: 'ws://127.0.0.1:5181/rpc',
    });

    task.cancel();
    await task.toPromise();
  });
});

describe('handleError call-TypeError classification', () => {
  type HandleErrorInput = Parameters<typeof handleError>[0];

  const BUNDLED_FRAMES = [
    '    at app://workspaces/app/immutable/chunks/CuKvStvg.js:8:6761',
    '    at app://workspaces/app/immutable/chunks/BQ9p2Xk1.js:1:2210',
  ].join('\n');

  const BITS_UI_FRAMES = [
    '    at DismissibleLayerState.#handleFocus (node_modules/bits-ui/dist/bits/utilities/dismissible-layer/use-dismissable-layer.svelte.js:70:41)',
    '    at app://workspaces/app/immutable/chunks/CuKvStvg.js:8:6761',
  ].join('\n');

  const URL_SENTINEL = 'token=SECRET-URL-SENTINEL';
  const ROUTE_ID = '/(app)/workspaces/[id]';

  let errorSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  function invoke(error: unknown): ReturnType<typeof handleError> {
    const event = {
      url: new URL(`http://localhost/workspaces/ws-1?${URL_SENTINEL}`),
      route: { id: ROUTE_ID },
    } as unknown as HandleErrorInput['event'];
    return handleError({
      error,
      event,
      status: 500,
      message: 'Internal Error',
    } as HandleErrorInput);
  }

  function typeErrorWithStack(message: string, stack: string): TypeError {
    const error = new TypeError(message);
    error.stack = `TypeError: ${message}\n${stack}`;
    return error;
  }

  function reportedDetails(): Record<string, unknown> {
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, details] = errorSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    return details;
  }

  function everythingLogged(): string {
    return JSON.stringify([...errorSpy.mock.calls, ...consoleSpy.mock.calls]);
  }

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suppresses the genuine bits-ui teardown TypeError', () => {
    const error = typeErrorWithStack('n.call is not a function', BITS_UI_FRAMES);

    expect(invoke(error)).toEqual({ message: '' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reports an unrelated call TypeError with a minified receiver', () => {
    const error = typeErrorWithStack('n.call is not a function', BUNDLED_FRAMES);

    expect(invoke(error)?.message).not.toBe('');
    const details = reportedDetails();
    expect(details.name).toBe('TypeError');
    expect(details.message).toBe('n.call is not a function');
    expect(details.stack).toBe(error.stack);
    expect(details.routeId).toBe(ROUTE_ID);
  });

  it('reports an unrelated call TypeError with a non-bits bundled stack', () => {
    const error = typeErrorWithStack('this.scheduler.flush.call is not a function', BUNDLED_FRAMES);

    expect(invoke(error)?.message).not.toBe('');
    const details = reportedDetails();
    expect(details.name).toBe('TypeError');
    expect(details.message).toBe('this.scheduler.flush.call is not a function');
    expect(details.stack).toBe(error.stack);
  });

  it('reports a string rejection carrying the minified call message', () => {
    expect(invoke('n.call is not a function')?.message).not.toBe('');
    expect(reportedDetails().message).toBe('n.call is not a function');
  });

  it('reports a bits-ui stack whose message is not the minified teardown shape', () => {
    const error = typeErrorWithStack('handler.call is not a function', BITS_UI_FRAMES);

    expect(invoke(error)?.message).not.toBe('');
    expect(reportedDetails().message).toBe('handler.call is not a function');
  });

  describe('bounded diagnostic', () => {
    it('never logs the page URL, only the route id', () => {
      invoke(typeErrorWithStack('n.call is not a function', BUNDLED_FRAMES));

      expect(everythingLogged()).not.toContain(URL_SENTINEL);
      expect(everythingLogged()).not.toContain('http://localhost');
      expect(reportedDetails().routeId).toBe(ROUTE_ID);
    });

    it('does not log the payload of a non-Error object rejection', () => {
      const PAYLOAD_SENTINEL = 'SECRET-PAYLOAD-SENTINEL';
      const rejection = {
        message: 'n.call is not a function',
        workspaceState: { token: PAYLOAD_SENTINEL },
      };

      expect(invoke(rejection)?.message).not.toBe('');
      expect(everythingLogged()).not.toContain(PAYLOAD_SENTINEL);
      expect(reportedDetails()).toEqual({
        name: 'object',
        message: 'n.call is not a function',
        stack: null,
        routeId: ROUTE_ID,
      });
    });

    it('logs only the first stack frames', () => {
      const frames = Array.from(
        { length: 30 },
        (_, i) => `    at fn${i} (app://workspaces/app/immutable/chunks/chunk${i}.js:1:${i})`,
      );
      const error = typeErrorWithStack('n.call is not a function', frames.join('\n'));

      invoke(error);
      const logged = String(reportedDetails().stack);
      expect(logged).toContain('at fn0 ');
      expect(logged).not.toContain('at fn29 ');
      expect(logged.split('\n').length).toBeLessThan(frames.length);
      expect(everythingLogged()).not.toContain('at fn29 ');
    });

    it('truncates an oversized message', () => {
      const oversized = `n.call is not a function ${'x'.repeat(5000)}END-SENTINEL`;

      invoke(typeErrorWithStack(oversized, BUNDLED_FRAMES));
      const message = String(reportedDetails().message);
      expect(message.length).toBeLessThan(oversized.length);
      expect(message.startsWith('n.call is not a function')).toBe(true);
      expect(everythingLogged()).not.toContain('END-SENTINEL');
    });

    it('logs a single allowlisted diagnostic and nothing to console.error', () => {
      invoke(typeErrorWithStack('n.call is not a function', BUNDLED_FRAMES));

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(Object.keys(reportedDetails()).sort()).toEqual(
        ['message', 'name', 'routeId', 'stack'].sort(),
      );
    });
  });
});
