import { EventEmitter } from 'events';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock(import('child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual, spawn: mockSpawn };
  return { ...patched, default: patched };
});

vi.mock('../../../../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    error = vi.fn();
    info = vi.fn();
    warn = vi.fn();
  },
}));

// Mock git-env to avoid transitive child_process issues
vi.mock('../../../../../../shared/git/git-env', () => ({
  gitEnv: { GIT_TERMINAL_PROMPT: '0' },
  createShellEnv: vi.fn((env: any) => env),
}));

// Mock process-tree-kill to avoid transitive child_process/exec issues
vi.mock('../../../../../../shared/main/process-tree-kill', () => ({
  killChildProcessTree: vi.fn().mockResolvedValue(undefined),
  killProcessTree: vi.fn().mockResolvedValue(undefined),
}));

import { TerminalHandler } from '../terminal';

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function createMockChildProcess() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  return child;
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

describe('TerminalHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('linux');
  });

  afterAll(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('routes risky Windows commands through -EncodedCommand', async () => {
    setPlatform('win32');
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child as any);

    const command = 'foreach ($x in @(1,2,3)) { Write-Output $x }';
    const handler = new TerminalHandler('C:\\workspace');
    await handler.createTerminal(command);

    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell',
      [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(`& '${command.replace(/'/g, "''")}'`, 'utf16le').toString('base64'),
      ],
      expect.objectContaining({ cwd: 'C:\\workspace', windowsHide: true }),
    );
    expect(mockSpawn.mock.calls[0]?.[2]).not.toHaveProperty('shell');
  });

  it('routes simple Windows commands through -EncodedCommand too', async () => {
    setPlatform('win32');
    mockSpawn.mockReturnValue(createMockChildProcess() as any);

    const command = 'git status';
    const handler = new TerminalHandler('C:\\workspace');
    await handler.createTerminal(command);

    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell',
      [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(`& '${command.replace(/'/g, "''")}'`, 'utf16le').toString('base64'),
      ],
      expect.objectContaining({ cwd: 'C:\\workspace', windowsHide: true }),
    );
  });

  it('preserves args when routing Windows commands through -EncodedCommand', async () => {
    setPlatform('win32');
    mockSpawn.mockReturnValue(createMockChildProcess() as any);

    const handler = new TerminalHandler('C:\\workspace');
    await handler.createTerminal('git', ['status', "path with spaces's.txt"]);

    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell',
      [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from("& 'git' 'status' 'path with spaces''s.txt'", 'utf16le').toString('base64'),
      ],
      expect.objectContaining({ cwd: 'C:\\workspace', windowsHide: true }),
    );
  });

  it('preserves non-Windows behavior even for risky commands', async () => {
    mockSpawn.mockReturnValue(createMockChildProcess() as any);

    const handler = new TerminalHandler('/workspace');
    await handler.createTerminal('foreach ($x in @(1,2,3)) { Write-Output $x }');

    expect(mockSpawn).toHaveBeenCalledWith(
      'foreach ($x in @(1,2,3)) { Write-Output $x }',
      [],
      expect.objectContaining({ cwd: '/workspace', shell: true, windowsHide: true }),
    );
  });
});