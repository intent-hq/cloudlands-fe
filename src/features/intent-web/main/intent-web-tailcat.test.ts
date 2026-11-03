// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { findWebTailcat, checkTailcatVersion } from './intent-web-tailcat';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
it('resolves flag then environment then PATH and skips unavailable binaries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tailcat-'));
  dirs.push(dir);
  const binary = path.join(dir, process.platform === 'win32' ? 'tailcat.exe' : 'tailcat');
  fs.writeFileSync(binary, 'test', { mode: 0o700 });
  expect(findWebTailcat(undefined, { PATH: dir })).toBe(binary);
  expect(findWebTailcat(binary, { TAILCAT_BIN: '/missing', PATH: '' })).toBe(binary);
  expect(findWebTailcat(undefined, { TAILCAT_BIN: binary, PATH: '' })).toBe(binary);
  expect(findWebTailcat('/missing', { PATH: dir })).toBeNull();
  expect(findWebTailcat(undefined, { PATH: '' })).toBeNull();
});
it('warns when the installed version differs from the pinned release', async () => {
  const warn = vi.fn();
  await checkTailcatVersion('/bin/tailcat', '0.4.0', warn, async () => 'tailcat 0.5.0');
  expect(warn).toHaveBeenCalledOnce();
  warn.mockClear();
  await checkTailcatVersion('/bin/tailcat', '0.4.0', warn, async () => 'tailcat 0.4.0');
  expect(warn).not.toHaveBeenCalled();
});
