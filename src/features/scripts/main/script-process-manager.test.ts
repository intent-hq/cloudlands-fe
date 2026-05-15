import { EventEmitter } from 'events';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockSpawn, mockAccessSync, mockReadFileSync, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockAccessSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock(import('child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual, spawn: mockSpawn };
  return { ...patched, default: patched };
});

vi.mock('fs', () => {
  const mockFs = {
    accessSync: mockAccessSync,
    readFileSync: mockReadFileSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    existsSync: vi.fn(() => false),
    constants: { F_OK: 0, X_OK: 1, R_OK: 4, W_OK: 2 },
  };
  return { ...mockFs, default: mockFs };
});

vi.mock('../../../shared/git/git-env', () => ({
  createShellEnv: vi.fn((env: any) => env),
}));

vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

vi.mock('../../../shared/main/process-tree-kill', () => ({
  killProcessTree: vi.fn().mockResolvedValue(undefined),
  killChildProcessTree: vi.fn().mockResolvedValue(undefined),
}));

import { ScriptProcessManager } from './script-process-manager';
import type { WorkspaceScript } from './script-process-manager';

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function createMockChildProcess() {
  const child = new EventEmitter() as any;
  child.pid = 1234;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  return child;
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalComSpec = process.env.COMSPEC;

describe('ScriptProcessManager shell args', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COMSPEC;
    setPlatform('linux');
    mockReadFileSync.mockImplementation(() => {
      throw new Error('missing pid file');
    });
    mockSpawn.mockReturnValue(createMockChildProcess());
  });

  afterAll(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    if (originalComSpec === undefined) {
      delete process.env.COMSPEC;
    } else {
      process.env.COMSPEC = originalComSpec;
    }
  });

  it('uses EncodedCommand for Windows PowerShell without shell:true', () => {
    setPlatform('win32');
    mockAccessSync.mockImplementation((target: any) => {
      if (String(target).toLowerCase().includes('powershell.exe')) return;
      throw new Error('missing shell');
    });

    const command = 'foreach ($x in @(1,2,3)) { Write-Output $x }';
    const manager = new ScriptProcessManager('ws-1', 'C:\\workspace', 'C:\\workspace\\.intent');
    const script: WorkspaceScript = {
      id: 'script-1',
      name: 'PowerShell script',
      command,
      mode: 'command',
      source: 'user',
      createdAt: '2026-03-18T00:00:00Z',
    };

    manager.start(script);

    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell.exe',
      [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      expect.objectContaining({ cwd: 'C:\\workspace', windowsHide: true, detached: false }),
    );
    expect(mockSpawn.mock.calls[0]?.[2]).not.toHaveProperty('shell');
  });

  it('keeps cmd.exe on /c for Windows shells that are not PowerShell', () => {
    setPlatform('win32');
    mockAccessSync.mockImplementation((target: any) => {
      const value = String(target).toLowerCase();
      if (value.includes('cmd.exe')) return;
      throw new Error('missing shell');
    });

    const manager = new ScriptProcessManager('ws-1', 'C:\\workspace', 'C:\\workspace\\.intent');
    const script: WorkspaceScript = {
      id: 'script-2',
      name: 'cmd script',
      command: 'echo hello',
      mode: 'command',
      source: 'user',
      createdAt: '2026-03-18T00:00:00Z',
    };

    manager.start(script);

    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd.exe',
      ['/c', 'echo hello'],
      expect.objectContaining({ cwd: 'C:\\workspace', windowsHide: true, detached: false }),
    );
  });

  it('keeps Unix shell args unchanged', () => {
    mockAccessSync.mockImplementation((target: any) => {
      if (String(target) === '/bin/bash') return;
      throw new Error('missing shell');
    });

    const manager = new ScriptProcessManager('ws-1', '/workspace', '/workspace/.intent');
    const script: WorkspaceScript = {
      id: 'script-3',
      name: 'bash script',
      command: 'echo hello',
      mode: 'command',
      source: 'user',
      createdAt: '2026-03-18T00:00:00Z',
    };

    manager.start(script);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/bin/bash',
      ['-l', '-c', 'echo hello'],
      expect.objectContaining({ cwd: '/workspace', windowsHide: true, detached: false }),
    );
  });
});