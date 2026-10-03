/** Disposable hosted macOS only. No existing user profile or installed app is used. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const [dmg, output, backendSha] = process.argv.slice(2);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.match(backendSha, /^[a-f0-9]{40}$/);
assert.ok(dmg && output && process.env.RUNNER_TEMP);
fs.mkdirSync(output, { recursive: false, mode: 0o700 });
const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'intent-package-'));
const mount = path.join(work, 'mount');
fs.mkdirSync(mount);
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 120_000 });
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidence = { dmgSha256: hash(dmg), backendSha, phases: [], passed: false };
let application;
let mounted = false;
let normalServer;
let normalConnections = 0;
const ownedPids = new Set();
const normalData = path.join(os.homedir(), 'Library/Application Support/intentd');
const normalDesktop = path.join(os.homedir(), 'Library/Application Support/intent-cloudlands');
const normalLegacy = path.join(os.homedir(), 'intent');
const markers = [];
const electronExits = [];

async function closePackage(phase) {
  const child = application.process();
  let timer;
  const exited = new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('exit', (code, signal) => resolve({ code, signal }));
    timer = setTimeout(() => reject(new Error('Original Electron child did not exit')), 15_000);
  });
  try {
    const [, result] = await Promise.all([application.close(), exited]);
    electronExits.push({ phase, pid: child.pid, ...result });
    application = undefined;
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
  } finally {
    clearTimeout(timer);
  }
}

async function eventually(read, accept, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not complete: ${JSON.stringify(last)}`);
}

async function inspect(app) {
  return app.evaluate(async ({ app: instance }) => {
    const { pathToFileURL } = await import('node:url');
    const module = (name) => import(pathToFileURL(`${instance.getAppPath()}/dist/${name}.js`).href);
    const policy = await module('main/isolated-test-profile');
    const profile = policy.getIsolatedTestProfile();
    const sidecar = await module('features/backend/main/intentd-sidecar');
    const client = (await module('features/backend/main/backend.ipc')).getBackendClient();
    return {
      name: instance.getName(),
      userData: instance.getPath('userData'),
      home: instance.getPath('home'),
      data: profile.data,
      root: profile.root,
      socket: profile.socket,
      backendSha: profile.backendSha,
      config: client.getConfig(),
      running: sidecar.isSidecarRunning(),
      run: sidecar.getSidecarRunLog(),
      status: await client.request('system.status'),
    };
  });
}

try {
  // Refuse an unexpected non-disposable runner rather than overwrite any existing state.
  for (const directory of [normalData, normalDesktop, normalLegacy]) {
    assert.equal(fs.existsSync(directory), false, `pre-existing normal state: ${directory}`);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, 'isolation-sentinel');
    fs.writeFileSync(file, 'normal state must remain untouched', { mode: 0o600 });
    markers.push([file, hash(file)]);
  }
  const normalDb = path.join(normalData, 'intentd.db');
  command('/usr/bin/sqlite3', [
    normalDb,
    "CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('normal');",
  ]);
  markers.push([normalDb, hash(normalDb)]);
  const normalSecrets = path.join(normalLegacy, '.secrets.json');
  fs.writeFileSync(normalSecrets, '{"isolationSentinel":"not-a-credential"}', { mode: 0o600 });
  markers.push([normalSecrets, hash(normalSecrets)]);
  const normalCli = '/usr/local/bin/intent';
  assert.equal(fs.existsSync(normalCli), false, 'pre-existing CLI on disposable runner');
  const cliTarget = path.join(work, 'normal-cli-sentinel');
  fs.writeFileSync(cliTarget, 'normal CLI must remain untouched', { mode: 0o600 });
  fs.symlinkSync(cliTarget, normalCli);
  markers.push([cliTarget, hash(cliTarget)]);
  // A real normal endpoint would be adopted by a misconfigured package.
  normalServer = net.createServer((socket) => {
    normalConnections++;
    socket.destroy();
  });
  await new Promise((resolve) =>
    normalServer.listen(path.join(normalData, 'intentd.sock'), resolve),
  );
  command('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
  mounted = true;
  const apps = fs.readdirSync(mount).filter((name) => name.endsWith('.app'));
  assert.deepEqual(apps, ['Intent GitLab Test.app']);
  const bundle = path.join(work, apps[0]);
  command('ditto', [path.join(mount, apps[0]), bundle]);
  command('hdiutil', ['detach', mount]);
  mounted = false;
  const info = path.join(bundle, 'Contents/Info.plist');
  const plist = JSON.parse(command('plutil', ['-convert', 'json', '-o', '-', info]));
  assert.equal(plist.CFBundleIdentifier, 'app.cloudlands.intent.gitlab-test');
  assert.equal(plist.IntentIsolatedTestBackend, backendSha);
  assert.match(plist.IntentIsolatedTestBuild, /^manual-[1-9][0-9]*-[1-9][0-9]*$/);
  assert.ok(!plist.CFBundleURLTypes?.length, 'test package must not register intent://');
  assert.equal(fs.existsSync(path.join(bundle, 'Contents/Resources/keychain-helper')), false);
  evidence.signing = command('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  evidence.gatekeeper = command('spctl', ['--assess', '--type', 'execute', '--verbose=4', bundle]);
  evidence.stapling = command('xcrun', ['stapler', 'validate', bundle]);
  const executable = path.join(bundle, 'Contents/MacOS', plist.CFBundleExecutable);
  assert.equal(command('lipo', ['-archs', executable]).trim(), 'arm64');
  const sidecar = path.join(bundle, 'Contents/Resources/intentd/intentd');
  assert.equal(command('lipo', ['-archs', sidecar]).trim(), 'arm64');
  evidence.sidecarSha256 = hash(sidecar);
  evidence.plist = { id: plist.CFBundleIdentifier, build: plist.IntentIsolatedTestBuild };
  const expectedRoot = path.join(os.homedir(), '.intent-tests', plist.IntentIsolatedTestBuild);
  assert.equal(fs.existsSync(expectedRoot), false);
  const launchEnv = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: os.homedir(),
    LANG: 'en_US.UTF-8',
    INTENTD_SOCKET: path.join(normalData, 'intentd.sock'),
    INTENTD_DATA_DIR: normalData,
    INTENTD_CONFIG: path.join(normalData, 'config.toml'),
    INTENTD_BIN: '/normal/forbidden',
    GH_TOKEN: 'disposable-sentinel-not-a-credential',
  };
  const launch = () =>
    electron.launch({ executablePath: executable, env: launchEnv, timeout: 120_000 });
  application = await launch();
  const initial = await eventually(
    () => inspect(application),
    (r) => r.running,
    'private startup',
  );
  assert.equal(initial.root, expectedRoot);
  assert.equal(initial.userData, path.join(expectedRoot, 'desktop'));
  assert.equal(initial.data, path.join(expectedRoot, 'daemon'));
  assert.equal(initial.config.transport, 'uds');
  assert.equal(initial.config.socketPath, initial.socket);
  assert.equal(initial.backendSha, backendSha);
  assert.match(initial.status.buildCommit, /^[a-f0-9]{7,40}$/);
  assert.ok(
    backendSha.startsWith(initial.status.buildCommit),
    'actual source-built daemon identity',
  );
  const daemonPid = () =>
    Number(fs.readFileSync(path.join(initial.data, 'intentd.pid'), 'utf8').trim());
  ownedPids.add(daemonPid());
  evidence.phases.push({ phase: 'startup', ...initial });
  // Execute the original shared-action entry points, all of which must reject or stay inert.
  const policy = await application.evaluate(async ({ app }) => {
    const { pathToFileURL } = await import('node:url');
    const module = (name) => import(pathToFileURL(`${app.getAppPath()}/dist/${name}.js`).href);
    const keys = await module('features/backend/main/keychain-sync-lifecycle');
    const helper = await module('features/backend/main/keychain-sync');
    const system = await module('features/system/main/system.ipc');
    const updater = (await module('features/auto-update/main/auto-update.service'))
      .autoUpdateService;
    const outcomes = [];
    for (const operation of [
      () => system.installIntentCli(),
      () => updater.setChannel('stable'),
      () => updater.checkForUpdatesManual(),
      () => updater.downloadUpdate(),
      () => updater.installUpdate(),
    ]) {
      try {
        await operation();
        outcomes.push('unexpected-success');
      } catch {
        outcomes.push('rejected');
      }
    }
    await system.autoRepairCliSymlink();
    return {
      sync: await keys.isKeychainSyncEnabled('darwin'),
      helper: await helper.createHelperKeychainClient().list(),
      outcomes,
    };
  });
  assert.equal(policy.sync, false);
  assert.equal(policy.helper.ok, false);
  assert.deepEqual(policy.outcomes, Array(5).fill('rejected'));
  evidence.phases.push({ phase: 'shared-actions', ...policy });
  const recovery = await application.evaluate(async ({ app }) => {
    const { pathToFileURL } = await import('node:url');
    const sidecar = await import(
      pathToFileURL(`${app.getAppPath()}/dist/features/backend/main/intentd-sidecar.js`).href
    );
    await sidecar.stopIntentdSidecar();
    const stopped = sidecar.getSidecarRunLog();
    const spawned = await sidecar.spawnSidecarOnDemand(
      process.env,
      app.isPackaged,
      process.resourcesPath,
      process.cwd(),
    );
    return { stopped, spawned };
  });
  assert.equal(recovery.stopped.exitCode, 0);
  assert.equal(recovery.stopped.signal, null);
  assert.equal(recovery.spawned.spawned, true);
  const recovered = await eventually(
    () => inspect(application),
    (r) => r.running,
    'private recovery',
  );
  ownedPids.add(daemonPid());
  assert.equal(recovered.socket, initial.socket);
  evidence.phases.push({ phase: 'recovery', ...recovery, ...recovered });
  await closePackage('recovery-close');
  await eventually(
    () =>
      [...ownedPids].every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (e) {
          return e.code === 'ESRCH';
        }
      }),
    Boolean,
    'owned child exits',
    15_000,
  );
  const db = path.join(initial.data, 'intentd.db');
  assert.ok(fs.statSync(db).size > 0);
  const inode = fs.statSync(db).ino;
  application = await launch();
  const reopened = await eventually(
    () => inspect(application),
    (r) => r.running,
    'private relaunch',
  );
  ownedPids.add(daemonPid());
  assert.equal(reopened.root, initial.root);
  assert.equal(fs.statSync(db).ino, inode);
  evidence.phases.push({ phase: 'relaunch', ...reopened });
  await closePackage('relaunch-close');
  await eventually(
    () =>
      [...ownedPids].every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (e) {
          return e.code === 'ESRCH';
        }
      }),
    Boolean,
    'final owned child exits',
    15_000,
  );
  assert.equal(normalConnections, 0);
  for (const [file, digest] of markers) assert.equal(hash(file), digest);
  assert.deepEqual(fs.readdirSync(normalData).sort(), [
    'intentd.db',
    'intentd.sock',
    'isolation-sentinel',
  ]);
  assert.deepEqual(fs.readdirSync(normalDesktop), ['isolation-sentinel']);
  assert.deepEqual(fs.readdirSync(normalLegacy).sort(), ['.secrets.json', 'isolation-sentinel']);
  assert.equal(fs.readlinkSync(normalCli), cliTarget);
  evidence.normalConnections = normalConnections;
  evidence.ownedPids = [...ownedPids];
  evidence.electronExits = electronExits;
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (application) {
    try {
      await application.close();
    } catch (error) {
      evidence.cleanupError = String(error);
      evidence.passed = false;
      process.exitCode = 1;
    }
  }
  if (normalServer) await new Promise((resolve) => normalServer.close(resolve));
  if (mounted) {
    try {
      command('hdiutil', ['detach', mount]);
    } catch (error) {
      evidence.detachError = String(error);
      evidence.passed = false;
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(output, 'isolation.json'), JSON.stringify(evidence, null, 2), {
    mode: 0o600,
  });
  // Never relabel forced cleanup as a pass. This VM is retired by GitHub after the job.
  console.log(JSON.stringify({ passed: evidence.passed, output, error: evidence.error }));
}
