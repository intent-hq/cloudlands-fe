// @vitest-environment node
// @verify-changed-triggers: src/test-global-setup.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

// Execute the real setup/teardown in a child: its exitCode and TMP* mutations
// must never affect the surrounding Vitest process or its own hygiene guard.
function runGuard(arrange: string) {
  const parent = mkdtempSync(join(tmpdir(), 'hygiene-diagnostic-'));
  paths.push(parent);
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import fs from 'node:fs';
       import { join } from 'node:path';
       import { syncBuiltinESMExports } from 'node:module';
       import { setup, teardown } from ${JSON.stringify(pathToFileURL(resolve('src/test-global-setup.ts')).href)};
       const parent = ${JSON.stringify(parent)};
       process.env.TMPDIR = parent;
       process.env.TMP = 'original-tmp';
       delete process.env.TEMP;
       setup();
       const root = process.env.TMPDIR;
       ${arrange}
       let failed = false;
       try { teardown(); } catch { failed = true; }
       console.log(JSON.stringify({
         failed, removed: !fs.existsSync(root),
         restored: process.env.TMPDIR === parent && process.env.TMP === 'original-tmp' && !('TEMP' in process.env),
         outsideIntact: fs.existsSync(join(parent, 'outside', 'private-target')),
       }));`,
    ],
    { encoding: 'utf8', env: process.env },
  );
  expect(result.error).toBeUndefined();
  return { ...result, state: JSON.parse(result.stdout.trim()) };
}

function expectLeak(result: ReturnType<typeof runGuard>) {
  expect(result.status, result.stderr).toBe(1);
  expect(result.state).toMatchObject({ failed: true, removed: true, restored: true });
}

describe('temp-dir hygiene failure diagnostics', () => {
  it('keeps clean teardown silent and restores all temp environment variables', () => {
    const result = runGuard('');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.state).toMatchObject({ failed: false, removed: true, restored: true });
  });

  it('keeps allowed tool caches silent and removes them', () => {
    const result = runGuard(`fs.mkdirSync(join(root, 'tsx-1000'));`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.state).toMatchObject({ failed: false, removed: true, restored: true });
  });

  it('reports nested metadata before cleanup without exposing file contents or following symlinks', () => {
    const result = runGuard(`
      fs.mkdirSync(join(root, 'fixture', '.git'), { recursive: true });
      fs.writeFileSync(join(root, 'fixture', '.git', 'late.lock'), 'private-file-body');
      fs.utimesSync(join(root, 'fixture', '.git', 'late.lock'), new Date('2026-01-02T03:04:05Z'), new Date('2026-01-02T03:04:05Z'));
      fs.mkdirSync(join(parent, 'outside'));
      fs.writeFileSync(join(parent, 'outside', 'private-target'), 'outside-private-body');
      fs.symlinkSync(join(parent, 'outside'), join(root, 'fixture', 'outside-link'), 'dir');
    `);
    expectLeak(result);
    expect(result.state.outsideIntact).toBe(true);
    expect(result.stderr).toContain('fixture/.git/late.lock');
    expect(result.stderr).toContain('2026-01-02T03:04:05.000Z');
    expect(result.stderr).toContain('"type":"file"');
    expect(result.stderr).toContain('"size":17');
    expect(result.stderr).toContain('"type":"symlink"');
    expect(result.stderr).not.toContain('private-file-body');
    expect(result.stderr).not.toContain('private-target');
    expect(result.stderr).not.toContain('outside-private-body');
  });

  it('bounds depth and reports that deeper entries were omitted', () => {
    const result = runGuard(`
      fs.mkdirSync(join(root, 'fixture', 'one', 'two', 'three', 'four'), { recursive: true });
      fs.writeFileSync(join(root, 'fixture', 'one', 'two', 'three', 'four', 'too-deep'), 'secret');
    `);
    expectLeak(result);
    expect(result.stderr).toContain('fixture/one/two');
    expect(result.stderr).toContain('depth limit');
    expect(result.stderr).not.toContain('too-deep');
  });

  it('bounds entry count even for a wide directory', () => {
    const result = runGuard(`
      fs.mkdirSync(join(root, 'fixture'));
      for (let i = 0; i < 100; i++) fs.writeFileSync(join(root, 'fixture', 'entry-' + i), '');
    `);
    expectLeak(result);
    const listed = result.stderr.match(/"path":/g) ?? [];
    expect(listed.length).toBeGreaterThan(1);
    expect(listed.length).toBeLessThanOrEqual(32);
    expect(result.stderr).toContain('entry limit');
  });

  it('bounds output bytes and escapes control characters in filenames', () => {
    const result = runGuard(`
      for (let i = 0; i < 100; i++) fs.writeFileSync(join(root, 'long-' + i + '-' + '界'.repeat(65) + '\\nforged-output'), '');
    `);
    expectLeak(result);
    const metadata = result.stderr.slice(result.stderr.indexOf('{"path":'));
    expect(Buffer.byteLength(metadata)).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(result.stderr)).toBeLessThan(5000);
    expect(result.stderr).toContain('output limit');
    expect(result.stderr).not.toContain('\nforged-output');
    expect(result.stderr).toContain('\\nforged-output');
  });

  it.each(['EACCES', 'ENOENT'])(
    'retains the leak failure and cleanup when metadata is unavailable: %s',
    (code) => {
      const result = runGuard(`
      fs.mkdirSync(join(root, 'fixture'));
      fs.writeFileSync(join(root, 'fixture', 'unavailable'), 'secret');
      const original = fs.lstatSync;
      fs.lstatSync = function(path, ...args) {
        if (String(path).endsWith('/unavailable')) {
          fs.lstatSync = original;
          syncBuiltinESMExports();
          if ('${code}' === 'ENOENT') {
            fs.unlinkSync(path);
            return original.call(this, path, ...args);
          }
          throw Object.assign(new Error('private error detail'), { code: '${code}' });
        }
        return original.call(this, path, ...args);
      };
      syncBuiltinESMExports();
    `);
      expectLeak(result);
      expect(result.stderr).toContain(code);
      expect(result.stderr).toContain('fixture/unavailable');
      expect(result.stderr).not.toContain('private error detail');
    },
  );

  it('continues cleanup and reports only errno when a directory cannot be read', () => {
    const result = runGuard(`
      fs.mkdirSync(join(root, 'fixture'));
      const original = fs.opendirSync;
      fs.opendirSync = function(path, ...args) {
        if (String(path) === join(root, 'fixture')) {
          throw Object.assign(new Error('private directory detail'), { code: 'EACCES' });
        }
        return original.call(this, path, ...args);
      };
      syncBuiltinESMExports();
    `);
    expectLeak(result);
    expect(result.stderr).toContain('EACCES');
    expect(result.stderr).not.toContain('private directory detail');
  });
});
