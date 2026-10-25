import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Credential-free executables for the disposable hosted package proof only. */
export function createIsolatedCliFixture(home, work, nodeExecutable) {
  const native = path.join(home, '.local', 'bin');
  const version = path.join(home, '.nvm', 'versions', 'node', 'v999.0.0');
  const bin = path.join(version, 'bin');
  const claude = path.join(native, 'claude');
  assert.equal(
    fs.lstatSync(claude, { throwIfNoEntry: false }),
    undefined,
    'existing Claude fixture path',
  );
  assert.equal(
    fs.lstatSync(version, { throwIfNoEntry: false }),
    undefined,
    'existing nvm fixture path',
  );
  fs.mkdirSync(native, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const targets = [];
  for (const [name, entry] of [
    ['claude', claude],
    ['npx', path.join(bin, 'npx')],
  ]) {
    const target = path.join(work, `isolation-${name}.cjs`);
    const source = `#!/usr/bin/env node
if (process.argv[2] === '--version') console.log(${JSON.stringify(name === 'claude' ? '99.0.0 (Claude Code)' : '10.30.3')});
else if (process.argv[2] === '--intent-isolation-probe') console.log(JSON.stringify({fixture:${JSON.stringify(name)},home:process.env.HOME,configAbsent:!process.env.CLAUDE_CONFIG_DIR,credentialAbsent:!process.env.ANTHROPIC_API_KEY}));
else process.exitCode = 1;
`;
    fs.writeFileSync(target, source, { flag: 'wx', mode: 0o700 });
    fs.symlinkSync(target, entry);
    targets.push({ entry, target, source });
  }
  const node = path.join(bin, 'node');
  // The daemon follows node symlinks when selecting its sibling npx. A private
  // copy keeps that selection inside this concrete installation fixture.
  fs.copyFileSync(nodeExecutable, node, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(node, 0o700);
  const nodeStat = fs.lstatSync(node);
  const nodeHash = createHash('sha256').update(fs.readFileSync(node)).digest('hex');
  return {
    claude,
    node,
    npx: path.join(bin, 'npx'),
    cleanup() {
      for (const { entry, target, source } of targets) {
        assert.equal(fs.readlinkSync(entry), target);
        assert.equal(fs.readFileSync(target, 'utf8'), source);
      }
      const currentNode = fs.lstatSync(node);
      assert.equal(currentNode.isFile(), true);
      assert.equal(currentNode.ino, nodeStat.ino);
      assert.equal(currentNode.dev, nodeStat.dev);
      assert.equal(currentNode.uid, nodeStat.uid);
      assert.equal(createHash('sha256').update(fs.readFileSync(node)).digest('hex'), nodeHash);
      for (const { entry, target } of targets) {
        fs.unlinkSync(entry);
        fs.unlinkSync(target);
      }
      fs.unlinkSync(node);
      fs.rmdirSync(bin);
      fs.rmdirSync(version);
    },
  };
}
