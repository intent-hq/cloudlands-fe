import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function selectedProtocol(source) {
  const declarations = [
    ...source.matchAll(/^pub const PROTOCOL_VERSION: &str = "([^"\r\n]+)";$/gm),
  ];
  assert.equal(declarations.length, 1, 'Expected one protocol declaration');
  const version = declarations[0][1];
  assert.ok(['14.0', '14.1', '15.1'].includes(version), 'Unsupported inspection protocol');
  return version;
}

export function resolveSelectedProtocol(repository, backendSha) {
  assert.match(backendSha, /^[a-f0-9]{40}$/);
  const git = (...args) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
  assert.equal(git('rev-parse', 'HEAD').trim(), backendSha, 'Selected daemon identity mismatch');
  assert.equal(
    git('status', '--porcelain', '--untracked-files=no').trim(),
    '',
    'Selected daemon source changed',
  );
  return selectedProtocol(git('show', `${backendSha}:crates/intent-transport/src/protocol.rs`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [repository, backendSha] = process.argv.slice(2);
  console.log(`version=${resolveSelectedProtocol(repository, backendSha)}`);
}
