/**
 * Regression guard for renderer diagnostics that must reach console-output.log.
 *
 * `forwardRendererConsoleToMainLog()` drops info-level renderer console
 * messages to keep the log bounded. That silently defeated the retention
 * fingerprint, whose entire purpose is to populate a debug bundle: every
 * sample was generated in the renderer and thrown away, so a user's bundle
 * contained none of them.
 *
 * Two things have to hold for a forwarded diagnostic to survive on a real
 * user's machine, and both are asserted here:
 *   1. the allowlisted info message is forwarded at all, and
 *   2. it is logged under a category pinned to INFO — the production
 *      defaultLevel is WARN, so an unpinned category drops the line in exactly
 *      the packaged builds debug bundles come from.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), dock: undefined },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  screen: { getPrimaryDisplay: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: { createFromPath: vi.fn() },
}));

vi.mock('../state', () => ({ getMainWindow: vi.fn(), setMainWindow: vi.fn() }));
vi.mock('../../features/deeplink/deep-link-handler', () => ({ DeepLinkHandler: class {} }));
vi.mock('../utils/resolve-app-title', () => ({
  resolveAppTitle: () => 'Intent',
  registerWindowTitleListener: vi.fn(),
}));

const { forwardRendererConsoleToMainLog } = await import('../window');
const { LOGGING_CONFIG, LogLevel, getLogLevel } = await import('../../shared/logging-config');
const { collectRetentionFingerprint, formatRetentionFingerprint } =
  await import('../../store/renderer/retention-fingerprint');
const { createElectronIpcBackendTransport } =
  await import('../../lib/client/live/electron-ipc-transport');

type ConsoleMessage = {
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  sourceId?: string;
  lineNumber?: number;
};

/** Wire up the forwarder and return an emitter for fake console-message events. */
function attachForwarder() {
  let handler: ((details: ConsoleMessage) => void) | undefined;
  const window = {
    webContents: {
      on: (event: string, cb: (details: ConsoleMessage) => void) => {
        if (event === 'console-message') handler = cb;
      },
    },
  };

  forwardRendererConsoleToMainLog(
    window as unknown as Parameters<typeof forwardRendererConsoleToMainLog>[0],
  );

  return (details: ConsoleMessage) => {
    if (!handler) throw new Error('forwarder did not subscribe to console-message');
    handler({ sourceId: 'app://renderer.js', lineNumber: 1, ...details });
  };
}

const FINGERPRINT_LINE =
  '[2026-08-12T05:00:00.000Z] [INFO] [retention-fingerprint] [RetentionFingerprint] sample=1 workspaces=126';

describe('renderer console forwarding', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
  });

  it('forwards the allowlisted info diagnostic so it reaches console-output.log', () => {
    const emit = attachForwarder();

    emit({ level: 'info', message: FINGERPRINT_LINE });

    const forwarded = logged.filter((line) => line.includes('[RetentionFingerprint]'));
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toContain('sample=1 workspaces=126');
    // The logger context already supplies the category; the literal tag would stutter.
    expect(forwarded[0].match(/RendererConsole/g)).toHaveLength(1);
  });

  it('logs it under a category pinned to INFO, so packaged builds keep it', () => {
    // The bug this guards: production defaultLevel is WARN. Without an explicit
    // category entry the line is dropped on exactly the machines that produce
    // debug bundles. Logger re-reads the level from config on every call and
    // ignores its constructor `level` option, so the category entry is the only
    // mechanism that works.
    expect(LOGGING_CONFIG.categories.RendererConsole).toBe(LogLevel.INFO);
    expect(getLogLevel('RendererConsole')).toBeLessThanOrEqual(LogLevel.INFO);
    expect(getLogLevel('RendererConsole')).toBeLessThanOrEqual(LOGGING_CONFIG.defaultLevel);
  });

  it('still drops ordinary info and debug chatter', () => {
    const emit = attachForwarder();

    emit({ level: 'info', message: 'routine renderer chatter' });
    emit({ level: 'debug', message: 'noisy debug detail' });

    expect(logged.filter((line) => line.includes('renderer chatter'))).toHaveLength(0);
    expect(logged.filter((line) => line.includes('noisy debug detail'))).toHaveLength(0);
  });

  it('still forwards warnings and errors', () => {
    const emit = attachForwarder();

    emit({ level: 'warning', message: 'a renderer warning' });
    emit({ level: 'error', message: 'a renderer error' });

    expect(logged.filter((line) => line.includes('a renderer warning'))).toHaveLength(1);
    expect(logged.filter((line) => line.includes('a renderer error'))).toHaveLength(1);
  });

  it('forwards a real full-width sample whole, fan-out breakout included', () => {
    // The per-channel `fanout.*` fields are appended at the END of the line, so
    // they are the first thing a size cap would eat. Assert against a real
    // collected sample rather than a hand-written fixture: this is the check
    // that the numbers actually reach console-output.log, not just that the
    // collector produces them.
    const emit = attachForwarder();
    // Minimal preload bridge so a real subscription registers in the fan-out
    // and the sample carries a per-channel field.
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      on: () => 'listener-1',
      offById: () => {},
    };
    const transport = createElectronIpcBackendTransport();
    const dispose = transport.onNotification(() => {});
    const line = formatRetentionFingerprint(
      collectRetentionFingerprint({}, { sample: 1, uptimeMs: 10_000 }),
    );
    dispose();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;

    emit({ level: 'info', message: `[INFO] [retention-fingerprint] ${line}` });

    const forwarded = logged.filter((entry) => entry.includes('[RetentionFingerprint]'));
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toContain('ipcBackendListeners=');
    expect(forwarded[0]).toContain('fanoutSubscribers=1');
    expect(forwarded[0]).toContain('fanout.backend:notification=1');
    expect(forwarded[0]).not.toContain('truncated');
  });

  it('does not let a repeated fingerprint suppress later distinct samples', () => {
    const emit = attachForwarder();

    emit({ level: 'info', message: `${FINGERPRINT_LINE} uptimeMs=10000` });
    emit({ level: 'info', message: `${FINGERPRINT_LINE} uptimeMs=310000` });

    expect(logged.filter((line) => line.includes('[RetentionFingerprint]'))).toHaveLength(2);
  });
});
