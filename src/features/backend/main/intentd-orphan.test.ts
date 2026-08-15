/**
 * Tests for orphaned-sidecar detection (#2444): pidfile parsing, executable
 * path resolution, and the bundle-containment check that separates a true
 * orphan (executable inside our resourcesPath) from an external daemon.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  detectOrphanedSidecar,
  getProcessExecutablePath,
  isExecutableInsideResources,
  isProcessAlive,
  readDaemonPidFromPidfile,
} from './intentd-orphan';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intentd-orphan-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Env pointing the data-dir resolver at the temp dir. */
function envFor(dataDir: string): NodeJS.ProcessEnv {
  return { INTENTD_DATA_DIR: dataDir };
}

describe('readDaemonPidFromPidfile', () => {
  it('reads a valid pid', () => {
    fs.writeFileSync(path.join(tmpDir, 'intentd.pid'), '12345');
    expect(readDaemonPidFromPidfile(envFor(tmpDir), 'linux')).toBe(12345);
  });

  it('returns null when the pidfile is missing', () => {
    expect(readDaemonPidFromPidfile(envFor(tmpDir), 'linux')).toBeNull();
  });

  it.each(['', 'abc', '-5', '0', '12.5', '123abc'])('rejects invalid content %j', (content) => {
    fs.writeFileSync(path.join(tmpDir, 'intentd.pid'), content);
    expect(readDaemonPidFromPidfile(envFor(tmpDir), 'linux')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    fs.writeFileSync(path.join(tmpDir, 'intentd.pid'), '4242\n');
    expect(readDaemonPidFromPidfile(envFor(tmpDir), 'linux')).toBe(4242);
  });
});

describe('isProcessAlive', () => {
  it('reports the current process alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('reports a non-existent pid dead', () => {
    // Max pid on Linux is < 2^22 by default; this pid cannot exist.
    expect(isProcessAlive(2 ** 30)).toBe(false);
  });
});

describe('getProcessExecutablePath', () => {
  it('resolves the current process executable on this platform', () => {
    const platform = process.platform;
    if (platform !== 'linux' && platform !== 'darwin') return;
    const exe = getProcessExecutablePath(process.pid, platform);
    expect(exe).toBeTruthy();
    expect(path.isAbsolute(exe!)).toBe(true);
  });

  it('returns null on unsupported platforms', () => {
    expect(getProcessExecutablePath(process.pid, 'win32')).toBeNull();
  });

  it('returns null for a dead pid', () => {
    expect(getProcessExecutablePath(2 ** 30, process.platform)).toBeNull();
  });
});

describe('isExecutableInsideResources', () => {
  it('accepts an executable inside resources', () => {
    const resources = path.join(tmpDir, 'resources');
    const exe = path.join(resources, 'intentd', 'intentd');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    expect(isExecutableInsideResources(exe, resources)).toBe(true);
  });

  it('rejects an executable outside resources', () => {
    const resources = path.join(tmpDir, 'resources');
    fs.mkdirSync(resources, { recursive: true });
    const exe = path.join(tmpDir, 'elsewhere', 'intentd');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    expect(isExecutableInsideResources(exe, resources)).toBe(false);
  });

  it('rejects the resources path itself', () => {
    const resources = path.join(tmpDir, 'resources');
    fs.mkdirSync(resources, { recursive: true });
    expect(isExecutableInsideResources(resources, resources)).toBe(false);
  });

  it('resolves symlinked executables into resources', () => {
    const resources = path.join(tmpDir, 'resources');
    const real = path.join(resources, 'intentd', 'intentd');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, '');
    const link = path.join(tmpDir, 'link-to-intentd');
    fs.symlinkSync(real, link);
    expect(isExecutableInsideResources(link, resources)).toBe(true);
  });

  it('handles a deleted executable via literal path fallback', () => {
    const resources = path.join(tmpDir, 'resources');
    fs.mkdirSync(resources, { recursive: true });
    const gone = path.join(resources, 'intentd', 'intentd');
    expect(isExecutableInsideResources(gone, resources)).toBe(true);
  });

  it('returns false when resources path does not exist', () => {
    expect(isExecutableInsideResources('/bin/ls', path.join(tmpDir, 'missing'))).toBe(false);
  });
});

describe('detectOrphanedSidecar', () => {
  it('returns null when no pidfile exists', () => {
    expect(detectOrphanedSidecar(envFor(tmpDir), tmpDir, 'linux')).toBeNull();
  });

  it('returns null for a dead pid', () => {
    fs.writeFileSync(path.join(tmpDir, 'intentd.pid'), String(2 ** 30));
    expect(detectOrphanedSidecar(envFor(tmpDir), tmpDir, 'linux')).toBeNull();
  });

  it('returns null when the pidfile names our own process', () => {
    fs.writeFileSync(path.join(tmpDir, 'intentd.pid'), String(process.pid));
    expect(detectOrphanedSidecar(envFor(tmpDir), tmpDir, 'linux')).toBeNull();
  });

  it('classifies a live process running from inside resources as an orphan', () => {
    const platform = process.platform;
    if (platform !== 'linux' && platform !== 'darwin') return;
    // Copy a real binary into the fake bundle and run it, standing in for a
    // leftover intentd running from a previous app install's resources.
    const resources = path.join(tmpDir, 'resources');
    const exe = path.join(resources, 'intentd', 'intentd');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.copyFileSync('/bin/sleep', exe);
    fs.chmodSync(exe, 0o755);
    const child = spawn(exe, ['30'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(tmpDir, 'intentd.pid'), String(child.pid));
      const info = detectOrphanedSidecar(envFor(tmpDir), resources, platform);
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(child.pid);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('does NOT classify a live process running outside resources', () => {
    const platform = process.platform;
    if (platform !== 'linux' && platform !== 'darwin') return;
    const resources = path.join(tmpDir, 'resources');
    fs.mkdirSync(resources, { recursive: true });
    const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(tmpDir, 'intentd.pid'), String(child.pid));
      expect(detectOrphanedSidecar(envFor(tmpDir), resources, platform)).toBeNull();
    } finally {
      child.kill('SIGKILL');
    }
  });
});
