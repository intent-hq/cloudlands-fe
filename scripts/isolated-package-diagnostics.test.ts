// @verify-changed-triggers: scripts/verify-isolated-macos-package.mjs
// @vitest-environment node
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createPackageDiagnostics } from './isolated-package-diagnostics.mjs';
let root: string;
let output: string;
let profile: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-test-')));
  output = path.join(root, 'output');
  profile = path.join(root, 'private');
  fs.mkdirSync(output);
  fs.mkdirSync(path.join(profile, 'desktop', 'logs'), { recursive: true });
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
