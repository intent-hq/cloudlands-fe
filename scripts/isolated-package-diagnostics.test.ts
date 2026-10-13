// @verify-changed-triggers: scripts/verify-isolated-macos-package.mjs
// @vitest-environment node
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createPackageDiagnostics } from './isolated-package-diagnostics.mjs';
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
let root: string;
let output: string;
let profile: string;
beforeEach(() => {
  vi.mocked(execFileSync).mockReset();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-test-')));
  output = path.join(root, 'output');
  profile = path.join(root, 'private');
  fs.mkdirSync(output);
  fs.mkdirSync(path.join(profile, 'desktop', 'logs'), { recursive: true });
});

it('samples only the attached live child with bounded host-side stack diagnostics', () => {
  vi.mocked(execFileSync).mockReturnValue(
    'Process: private launch arguments\nCall graph:\n' +
      '    100 Thread_123 DispatchQueue_1: com.apple.main-thread (serial)\n' +
      '    + 100 semaphore_wait_trap (in libsystem_kernel.dylib)\n' +
      '    + ! 100 open /Users/runner/private\n' +
      '    + ! 100 token=do-not-copy\n' +
      'Total number in stack:\nBinary Images: secret paths\n',
  );
  const diagnostics = createPackageDiagnostics(output, profile);
  diagnostics.attach({ pid: 12345, exitCode: null, signalCode: null });
  diagnostics.captureStacks();
  expect(execFileSync).toHaveBeenCalledWith('/usr/bin/sample', ['12345', '1', '10'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const stacks = fs.readFileSync(path.join(output, 'startup-stacks.log'), 'utf8');
  expect(stacks).toContain('semaphore_wait_trap');
  expect(stacks).toContain('/Users/<private>/private');
  expect(stacks).not.toContain('launch arguments');
  expect(stacks).not.toContain('do-not-copy');
  expect(stacks).not.toContain('Binary Images');
});

it('bounds stack output while preserving initial main-thread frames', () => {
  vi.mocked(execFileSync).mockReturnValue(
    'Call graph:\n    100 Thread_1 main-thread\n' +
      '    + 100 function /Users/private/日本語\n'.repeat(5000),
  );
  const diagnostics = createPackageDiagnostics(output, profile);
  diagnostics.attach({ pid: 12345, exitCode: null, signalCode: null });
  diagnostics.captureStacks();
  const stacks = fs.readFileSync(path.join(output, 'startup-stacks.log'), 'utf8');
  expect(Buffer.byteLength(stacks)).toBeLessThanOrEqual(65536);
  expect(stacks).toContain('Thread_1 main-thread');
});

it('never samples an absent, exited, disposed, or invalid child and contains sample failures', () => {
  const diagnostics = createPackageDiagnostics(output, profile);
  diagnostics.captureStacks();
  for (const child of [
    { pid: 12345, exitCode: 0, signalCode: null },
    { pid: 12345, exitCode: null, signalCode: 'SIGTERM' },
    { pid: -1, exitCode: null, signalCode: null },
  ]) {
    diagnostics.attach(child);
    diagnostics.captureStacks();
  }
  const dispose = diagnostics.attach({ pid: 12345, exitCode: null, signalCode: null });
  dispose();
  diagnostics.captureStacks();
  expect(execFileSync).not.toHaveBeenCalled();
  diagnostics.attach({ pid: 12345, exitCode: null, signalCode: null });
  vi.mocked(execFileSync).mockImplementation(() => {
    throw Object.assign(new Error('sensitive invocation arguments'), { code: 'ETIMEDOUT' });
  });
  expect(() => diagnostics.captureStacks()).not.toThrow();
  expect(read()).toContain('Stack sample unavailable');
  expect(read()).not.toContain('sensitive invocation');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const read = () => fs.readFileSync(path.join(output, 'startup-diagnostics.log'), 'utf8');
it('captures child streams while the main process is unresponsive and removes listeners', () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const diagnostics = createPackageDiagnostics(output, profile);
  const dispose = diagnostics.attach({ stdout, stderr });
  stdout.write('boot started\n');
  stderr.write('GH_TO');
  stderr.write('KEN=do-not-publish\n');
  stderr.write('socket unavailable /Users/runner/private\n');
  expect(read()).toContain('boot started');
  expect(read()).toContain('socket unavailable /Users/<private>/private');
  expect(read()).not.toContain('do-not-publish');
  dispose();
  expect(stdout.listenerCount('data')).toBe(0);
  expect(stderr.listenerCount('data')).toBe(0);
});
it('bounds output and drops incomplete or oversized credential lines', () => {
  const stdout = new PassThrough();
  createPackageDiagnostics(output, profile).attach({ stdout });
  stdout.write('x'.repeat(100000));
  stdout.write('token-not-visible\n');
  for (let i = 0; i < 1000; i++) stdout.write('safe '.repeat(50) + '\n');
  stdout.write('unfinished-secret');
  expect(Buffer.byteLength(read())).toBeLessThanOrEqual(65536);
  expect(read()).not.toContain('token-not-visible');
  expect(read()).not.toContain('unfinished-secret');
});
it('captures only the private console log with redaction, never neighboring secrets', () => {
  fs.writeFileSync(path.join(profile, 'secrets.json'), 'never-read');
  fs.writeFileSync(
    path.join(profile, 'desktop/logs/console-output.log'),
    'startup error\npassword=hidden\n',
  );
  createPackageDiagnostics(output, profile).capture();
  expect(read()).toContain('startup error');
  expect(read()).not.toContain('hidden');
  expect(read()).not.toContain('never-read');
});
it('rejects symlinked private logs without reading their target', () => {
  const other = path.join(root, 'normal.log');
  fs.writeFileSync(other, 'foreign state\n');
  fs.symlinkSync(other, path.join(profile, 'desktop/logs/console-output.log'));
  createPackageDiagnostics(output, profile).capture();
  expect(read()).toContain('Private log unavailable');
  expect(read()).not.toContain('foreign state');
});

it('bounds multibyte diagnostics and tolerates persistence failure without interrupting cleanup', () => {
  const stdout = new PassThrough();
  const dispose = createPackageDiagnostics(output, profile).attach({ stdout });
  for (let i = 0; i < 100; i++) stdout.write('日本語'.repeat(100) + '\n');
  expect(Buffer.byteLength(read())).toBeLessThanOrEqual(65536);
  fs.rmSync(output, { recursive: true });
  expect(() => stdout.write('another diagnostic\n')).not.toThrow();
  dispose();
  expect(stdout.listenerCount('data')).toBe(0);
});
