// @vitest-environment node
// @verify-changed-triggers: scripts/isolated-package-protocol.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { selectedProtocol, resolveSelectedProtocol } from './isolated-package-protocol.mjs';

it.each(['14.0', '14.1', '15.1'])('reads the supported source protocol %s', (version) => {
  expect(selectedProtocol(`pub const PROTOCOL_VERSION: &str = "${version}";`)).toBe(version);
});

it.each(['13.3', '14.2', '15.0', '15.2', '16.0', ''])(
  'rejects unsupported source protocol %s',
  (version) => {
    expect(() => selectedProtocol(`pub const PROTOCOL_VERSION: &str = "${version}";`)).toThrow();
  },
);

it.each([
  '',
  '// pub const PROTOCOL_VERSION: &str = "14.1";',
  'pub const PROTOCOL_VERSION: &str = "14.0";\npub const PROTOCOL_VERSION: &str = "14.1";',
])('rejects missing or ambiguous source declaration', (source) => {
  expect(() => selectedProtocol(source)).toThrow();
});

const repositories: string[] = [];
afterEach(() => {
  for (const directory of repositories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function repository(version: string, sourcePresent = true) {
  const directory = mkdtempSync(join(tmpdir(), 'isolated-protocol-'));
  repositories.push(directory);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Protocol test');
  git('config', 'user.email', 'protocol-test@example.invalid');
  const source = join(directory, 'crates/intent-transport/src/protocol.rs');
  if (sourcePresent) {
    mkdirSync(join(directory, 'crates/intent-transport/src'), { recursive: true });
    writeFileSync(source, `pub const PROTOCOL_VERSION: &str = "${version}";\n`);
    git('add', '.');
  }
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'test: selected protocol',
  );
  return { directory, source, sha: git('rev-parse', 'HEAD') };
}
it.each(['14.0', '14.1', '15.1'])('binds %s to the selected clean commit', (version) => {
  const r = repository(version);
  expect(resolveSelectedProtocol(r.directory, r.sha)).toBe(version);
});
it('rejects a different immutable commit', () => {
  const r = repository('14.1');
  expect(() => resolveSelectedProtocol(r.directory, 'a'.repeat(40))).toThrow('identity mismatch');
});
it('rejects a modified tracked source rather than accepting its pinned declaration', () => {
  const r = repository('14.0');
  writeFileSync(r.source, 'pub const PROTOCOL_VERSION: &str = "14.1";\n');
  expect(() => resolveSelectedProtocol(r.directory, r.sha)).toThrow('source changed');
});
it('rejects missing source in the selected commit', () => {
  const r = repository('14.1', false);
  expect(() => resolveSelectedProtocol(r.directory, r.sha)).toThrow();
});
it.each(['main', '', 'a'.repeat(39)])('rejects mutable or malformed identity %s', (identity) => {
  const r = repository('14.1');
  expect(() => resolveSelectedProtocol(r.directory, identity)).toThrow();
});
