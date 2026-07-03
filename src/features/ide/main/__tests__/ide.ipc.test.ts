import { EventEmitter } from 'events';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * Wire-contract tests for ide.ipc.ts.
 *
 * Per PROTOCOL.md §5.14, editor DETECTION is delegated to the daemon via
 * `host.listInstalledEditors` (catalog enumeration with source / path /
 * flatpakId) and `host.findBinary` (routed through the shared find-binary
 * helper). Launch itself stays laptop-local (spawn / `open -a` / `flatpak
 * run` / execAsync). These tests assert the exact request payloads sent on
 * the wire, verbatim consumption of the PROTOCOL-shaped mock responses, and
 * honest degradation on RPC failure (no `which` / `flatpak info` / `.app`
 * `access()` fallbacks).
 */

const { mockRequest, mockSpawn, mockExecAsync, mockFindBinary, mockFindVSCodeAsync, loggerSpies } =
  vi.hoisted(() => ({
    mockRequest: vi.fn(),
    mockSpawn: vi.fn(),
    mockExecAsync: vi.fn(),
    mockFindBinary: vi.fn(),
    mockFindVSCodeAsync: vi.fn(),
    loggerSpies: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));

vi.mock(import('child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual, spawn: mockSpawn };
  return { ...patched, default: patched };
});

vi.mock('../../../../shared/git/git-env', () => ({
  execAsync: mockExecAsync,
}));

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: mockFindBinary,
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  findVSCodeAsync: mockFindVSCodeAsync,
}));

vi.mock('$lib/utils/logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

type IdeModule = typeof import('../ide.ipc');

async function loadFreshModule(): Promise<IdeModule> {
  vi.resetModules();
  return (await import('../ide.ipc')) as IdeModule;
}

function createMockChild() {
  const child = new EventEmitter() as any;
  child.pid = 4242;
  child.unref = vi.fn();
  // Fire `spawn` on next tick so the launch code's `await` settles.
  queueMicrotask(() => child.emit('spawn'));
  return child;
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function restorePlatform() {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
}

function resetAllMocks() {
  mockRequest.mockReset();
  mockSpawn.mockReset();
  mockExecAsync.mockReset();
  mockFindBinary.mockReset();
  mockFindVSCodeAsync.mockReset();
  loggerSpies.debug.mockReset();
  loggerSpies.info.mockReset();
  loggerSpies.warn.mockReset();
  loggerSpies.error.mockReset();
}

describe('openInVSCode (host.listInstalledEditors flatpak wire contract)', () => {
  beforeEach(() => {
    resetAllMocks();
    setPlatform('linux');
    mockSpawn.mockImplementation(() => createMockChild());
  });

  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
  });

  it('sends `host.listInstalledEditors` with no params when local `code` is absent on Linux, and launches via `flatpak run <flatpakId>` verbatim', async () => {
    mockFindBinary.mockResolvedValue(null);
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'vscode', installed: true, source: 'flatpak', flatpakId: 'com.visualstudio.code' },
      ],
    });

    const { openInVSCode } = await loadFreshModule();
    const result = await openInVSCode('/tmp/project');

    expect(result).toEqual({ success: true });
    expect(mockRequest).toHaveBeenCalledWith('host.listInstalledEditors');
    expect(mockSpawn).toHaveBeenCalledWith(
      'flatpak',
      ['run', 'com.visualstudio.code', '-n', '--skip-add-to-recently-opened', '/tmp/project'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    // No local detection probes.
    expect(mockExecAsync).not.toHaveBeenCalledWith(expect.stringMatching(/flatpak info/), expect.anything());
    expect(mockExecAsync).not.toHaveBeenCalledWith(expect.stringMatching(/^which /));
  });

  it('does not launch via Flatpak when host reports vscode installed via `binary` (no flatpakId hijack)', async () => {
    mockFindBinary.mockResolvedValue(null);
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'vscode', installed: true, source: 'binary', path: '/usr/bin/code', flatpakId: 'com.visualstudio.code' },
      ],
    });

    const { openInVSCode } = await loadFreshModule();
    await openInVSCode('/tmp/project');

    // We must not spawn `flatpak run` when the daemon says the install source is binary,
    // even if the payload also carries a flatpakId hint.
    for (const call of mockSpawn.mock.calls) {
      expect(call[0]).not.toBe('flatpak');
    }
  });

  it('does not launch via Flatpak when the vscode entry is `installed:false` (no verbose truthy coercion)', async () => {
    mockFindBinary.mockResolvedValue(null);
    mockRequest.mockResolvedValue({
      editors: [{ id: 'vscode', installed: false, source: 'flatpak', flatpakId: 'com.visualstudio.code' }],
    });

    const { openInVSCode } = await loadFreshModule();
    await openInVSCode('/tmp/project');

    for (const call of mockSpawn.mock.calls) {
      expect(call[0]).not.toBe('flatpak');
    }
    expect(mockExecAsync).not.toHaveBeenCalledWith(expect.stringMatching(/flatpak info/), expect.anything());
  });

  it('degrades to no flatpak launch (no `flatpak info` shell-out) when the wire call rejects', async () => {
    mockFindBinary.mockResolvedValue(null);
    mockRequest.mockRejectedValue(new Error('transport down'));

    const { openInVSCode } = await loadFreshModule();
    await openInVSCode('/tmp/project');

    expect(mockRequest).toHaveBeenCalledWith('host.listInstalledEditors');
    for (const call of mockSpawn.mock.calls) {
      expect(call[0]).not.toBe('flatpak');
    }
    expect(mockExecAsync).not.toHaveBeenCalledWith(expect.stringMatching(/flatpak info/), expect.anything());
  });
});


describe('openInJetBrains (host.listInstalledEditors wire contract)', () => {
  beforeEach(() => {
    resetAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    restorePlatform();
    vi.restoreAllMocks();
  });

  it('sends `host.listInstalledEditors` (no params) and never probes locally with `which` / `flatpak info` / `.app` access', async () => {
    setPlatform('linux');
    mockRequest.mockResolvedValue({
      editors: [{ id: 'intellij', installed: true, source: 'binary', path: '/usr/bin/idea' }],
    });

    const { openInJetBrains } = await loadFreshModule();
    await openInJetBrains('/tmp/project');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('host.listInstalledEditors');
    for (const [cmd] of mockExecAsync.mock.calls) {
      expect(cmd).not.toMatch(/^which /);
      expect(cmd).not.toMatch(/^flatpak info /);
    }
  });

  it('consumes `source:"binary"` + `path` verbatim on Linux and launches with the daemon-reported path', async () => {
    setPlatform('linux');
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'intellij', installed: true, source: 'binary', path: '/usr/local/bin/idea' },
      ],
    });

    const { openInJetBrains } = await loadFreshModule();
    const result = await openInJetBrains('/tmp/project');

    expect(result).toEqual({ success: true });
    expect(mockExecAsync).toHaveBeenCalledWith('/usr/local/bin/idea "/tmp/project"');
  });

  it('consumes `source:"flatpak"` + `flatpakId` verbatim and launches via `flatpak run <id>`', async () => {
    setPlatform('linux');
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'intellij', installed: false },
        { id: 'intellij-ce', installed: true, source: 'flatpak', flatpakId: 'com.jetbrains.IntelliJ-IDEA-Community' },
      ],
    });

    const { openInJetBrains } = await loadFreshModule();
    const result = await openInJetBrains({ folder: '/tmp/project' });

    expect(result).toEqual({ success: true });
    expect(mockExecAsync).toHaveBeenCalledWith(
      'flatpak run com.jetbrains.IntelliJ-IDEA-Community "/tmp/project"',
    );
  });

  it('consumes `source:"macAppBundle"` verbatim on macOS and launches via `open -a "AppName"`', async () => {
    setPlatform('darwin');
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'webstorm', installed: true, source: 'macAppBundle', path: '/Applications/WebStorm.app' },
      ],
    });

    const { openInJetBrains } = await loadFreshModule();
    const result = await openInJetBrains('/tmp/project');

    expect(result).toEqual({ success: true });
    expect(mockExecAsync).toHaveBeenCalledWith('open -a "WebStorm" "/tmp/project"');
  });

  it('reconstructs the macOS inner tool binary from the host-provided `.app` `path` (no local `access()` probe)', async () => {
    setPlatform('darwin');
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'intellij', installed: true, source: 'macAppBundle', path: '/Applications/IntelliJ IDEA.app' },
      ],
    });

    const { openInJetBrains } = await loadFreshModule();
    await openInJetBrains({ folder: '/tmp/project', file: '/tmp/project/src/main.ts' });

    expect(mockExecAsync).toHaveBeenCalledWith('open -a "IntelliJ IDEA" "/tmp/project"');
    expect(mockExecAsync).toHaveBeenCalledWith(
      '"/Applications/IntelliJ IDEA.app/Contents/MacOS/idea" "/tmp/project/src/main.ts"',
    );
  });

  it('returns a failure error when host reports every editor as `installed:false`, without any local probe', async () => {
    setPlatform('linux');
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'intellij', installed: false },
        { id: 'webstorm', installed: false },
      ],
    });

    const { openInJetBrains } = await loadFreshModule();
    const result = await openInJetBrains('/tmp/project');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No JetBrains IDE found/);
    for (const [cmd] of mockExecAsync.mock.calls) {
      expect(cmd).not.toMatch(/^which /);
      expect(cmd).not.toMatch(/^flatpak info /);
    }
  });

  it('degrades to failure (no local probes) when the wire call rejects', async () => {
    setPlatform('linux');
    mockRequest.mockRejectedValue(new Error('transport down'));

    const { openInJetBrains } = await loadFreshModule();
    const result = await openInJetBrains('/tmp/project');

    expect(result.success).toBe(false);
    expect(mockRequest).toHaveBeenCalledWith('host.listInstalledEditors');
    expect(mockExecAsync).not.toHaveBeenCalledWith(expect.stringMatching(/^which /));
    expect(mockExecAsync).not.toHaveBeenCalledWith(expect.stringMatching(/^flatpak info /));
  });

  it('picks the first `installed:true` entry in ideCommands order (idea before webstorm)', async () => {
    setPlatform('linux');
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'webstorm', installed: true, source: 'binary', path: '/usr/bin/webstorm' },
        { id: 'intellij', installed: true, source: 'binary', path: '/usr/bin/idea' },
      ],
    });

    const { openInJetBrains } = await loadFreshModule();
    await openInJetBrains('/tmp/project');

    // ideCommands starts with 'idea' -> intellij, so idea wins.
    expect(mockExecAsync).toHaveBeenCalledWith('/usr/bin/idea "/tmp/project"');
    expect(mockExecAsync).not.toHaveBeenCalledWith('/usr/bin/webstorm "/tmp/project"');
  });
});
