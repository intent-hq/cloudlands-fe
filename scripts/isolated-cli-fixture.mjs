import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Homebrew's shared Node build resolves libnode beside its installation. Copy
// only that runtime dependency; absolute system dependencies stay untouched.
function darwinNodeLibrary(nodeExecutable) {
  if (process.platform !== 'darwin') return null;
  const executable = fs.realpathSync(nodeExecutable);
  const dependencies = execFileSync('/usr/bin/otool', ['-L', executable], { encoding: 'utf8' });
  const names = new Set();
  for (const line of dependencies.split('\n').slice(1)) {
    const match = line.trim().match(/^@rpath\/(libnode(?:\.\d+)*\.dylib)\s/);
    if (match) names.add(match[1]);
  }
  assert.ok(names.size <= 1, 'ambiguous Node runtime library');
  const [name] = names;
  if (!name) return null;
  const source = fs.realpathSync(path.join(path.dirname(executable), '..', 'lib', name));
  assert.equal(fs.statSync(source).isFile(), true, 'Node runtime library must be a regular file');
  return { name, source };
}

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
  const library = darwinNodeLibrary(nodeExecutable);
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
  const runtimeFiles = [];
  function copyRuntime(source, target) {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o700);
    runtimeFiles.push({
      target,
      stat: fs.lstatSync(target),
      hash: createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
    });
  }
  copyRuntime(nodeExecutable, node);
  const lib = path.join(version, 'lib');
  if (library) {
    fs.mkdirSync(lib);
    copyRuntime(library.source, path.join(lib, library.name));
  }
  return {
    claude,
    node,
    npx: path.join(bin, 'npx'),
    cleanup() {
      for (const { entry, target, source } of targets) {
        assert.equal(fs.readlinkSync(entry), target);
        assert.equal(fs.readFileSync(target, 'utf8'), source);
      }
      // Validate every owned runtime file before unlinking any fixture path.
      for (const { target, stat, hash } of runtimeFiles) {
        const current = fs.lstatSync(target);
        assert.equal(current.isFile(), true);
        assert.equal(current.ino, stat.ino);
        assert.equal(current.dev, stat.dev);
        assert.equal(current.uid, stat.uid);
        assert.equal(createHash('sha256').update(fs.readFileSync(target)).digest('hex'), hash);
      }
      for (const { entry, target } of targets) {
        fs.unlinkSync(entry);
        fs.unlinkSync(target);
      }
      for (const { target } of runtimeFiles) fs.unlinkSync(target);
      if (library) fs.rmdirSync(lib);
      fs.rmdirSync(bin);
      fs.rmdirSync(version);
    },
  };
}
