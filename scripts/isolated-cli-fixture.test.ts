// @verify-changed-triggers: scripts/verify-isolated-macos-package.mjs
// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createIsolatedCliFixture } from './isolated-cli-fixture.mjs';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function root() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-fixture-'));
  roots.push(directory);
  return directory;
}
it('runs only fixture probes with a private home and never installs an adapter', () => {
  const home = root();
  const work = root();
  const fixture = createIsolatedCliFixture(home, work, process.execPath);
  expect(fs.lstatSync(fixture.node).isSymbolicLink()).toBe(false);
  expect(fs.realpathSync(fixture.node)).toBe(
    path.join(fs.realpathSync(path.dirname(fixture.node)), 'node'),
  );
  const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  expect(digest(fixture.node)).toBe(digest(process.execPath));
  const env = { HOME: work, PATH: `${path.dirname(fixture.claude)}:${path.dirname(fixture.node)}` };
  for (const name of ['claude', 'npx']) {
    const result = spawnSync(name, ['--intent-isolation-probe'], { env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      fixture: name,
      home: work,
      configAbsent: true,
      credentialAbsent: true,
    });
  }
  expect(spawnSync('npx', ['--yes', 'forbidden-network-package'], { env }).status).toBe(1);
  fixture.cleanup();
  expect(fs.existsSync(fixture.claude)).toBe(false);
  expect(fs.existsSync(fixture.node)).toBe(false);
});
it('refuses to replace an existing executable', () => {
  const home = root();
  const claude = path.join(home, '.local', 'bin', 'claude');
  fs.mkdirSync(path.dirname(claude), { recursive: true });
  fs.writeFileSync(claude, 'untouched');
  expect(() => createIsolatedCliFixture(home, root(), process.execPath)).toThrow('existing Claude');
  expect(fs.readFileSync(claude, 'utf8')).toBe('untouched');
});

it('fails cleanup if the owned runtime was modified', () => {
  const fixture = createIsolatedCliFixture(root(), root(), process.execPath);
  fs.writeFileSync(fixture.node, 'changed runtime');
  expect(() => fixture.cleanup()).toThrow();
  expect(fs.existsSync(fixture.claude)).toBe(true);
  expect(fs.readFileSync(fixture.node, 'utf8')).toBe('changed runtime');
});
