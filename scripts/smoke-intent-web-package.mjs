#!/usr/bin/env node
// Packs dist/intent-web-package (scripts/build-intent-web-package.mjs) with
// `npm pack`, checks the tarball's contents and size, installs it into a temp
// dir and smoke-tests the CLI the way users run it:
//   - `npx <tarball> --help` resolves the single bin entry like `npx @intent-hq/web`
//   - `intent-web key` creates the data dir and prints the access key
//   - `intent-web serve --no-local` starts with no daemon; the sign-in page,
//     key login, the web UI, runtime config and the connections API answer.
// Usage: node scripts/smoke-intent-web-package.mjs [--package-dir <dir>] [--pack-destination <dir>]
// With --pack-destination the checked tarball is kept there (the publish
// workflow publishes exactly that file).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The packed web UI is about 20 MB; this cap catches an accidental inclusion
// of sourcemaps, node_modules or a second build.
export const MAX_PACKED_BYTES = 40 * 1024 * 1024;
export const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'bin/intent-web.mjs',
  'web/index.html',
];

// Returns the problems with a packed file list (paths relative to the package root).
export function tarballProblems({ files, size }) {
  const paths = new Set(files.map((file) => file.path));
  const problems = REQUIRED_FILES.filter((file) => !paths.has(file)).map(
    (file) => `missing ${file}`,
  );
  for (const file of paths) {
    if (file.endsWith('.map')) problems.push(`sourcemap shipped: ${file}`);
    if (file.split('/').includes('node_modules')) problems.push(`node_modules shipped: ${file}`);
    if (!/^(bin|web)\//.test(file) && !REQUIRED_FILES.includes(file))
      problems.push(`unexpected file: ${file}`);
  }
  if (size > MAX_PACKED_BYTES)
    problems.push(`packed size ${size} bytes exceeds ${MAX_PACKED_BYTES} bytes`);
  return problems;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`smoke: ${message}`);
}

async function serveSmoke({ bin, dataDir, accessKey }) {
  const port = await freePort();
  // No tailcat: the server must start with tunnel routes off.
  const { TAILCAT_BIN: _tailcat, ...withoutTailcat } = process.env;
  const child = spawn(
    process.execPath,
    [bin, 'serve', '--port', String(port), '--data-dir', dataDir, '--no-local'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: withoutTailcat },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const stop = async () => {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const result = await exited;
    clearTimeout(timer);
    return result;
  };
  try {
    const started = Date.now();
    while (!output.includes('Intent Web listening on')) {
      if (child.exitCode !== null) throw new Error(`serve exited early:\n${output}`);
      if (Date.now() - started > 30_000) throw new Error(`serve did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(output.includes(`http://127.0.0.1:${port}`), `banner names the port:\n${output}`);
    assert(output.includes('Access key unchanged'), `banner keeps the key private:\n${output}`);
    assert(!output.includes(accessKey), 'serve banner must not print an existing key');
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/__browser-access/login`);
    assert(login.status === 200, `login page status ${login.status}`);
    assert((await login.text()).includes('<form'), 'login page renders a form');
    const anonymous = await fetch(`${base}/runtime-config.js`);
    assert(anonymous.status === 401, `unauthenticated runtime config status ${anonymous.status}`);
    const signIn = await fetch(`${base}/?key=${accessKey}`, { redirect: 'manual' });
    assert(signIn.status === 303, `key sign-in status ${signIn.status}`);
    const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
    assert(cookie, 'key sign-in sets a session cookie');
    const headers = { cookie };
    const page = await fetch(`${base}/`, { headers });
    assert(page.status === 200, `web UI status ${page.status}`);
    assert((await page.text()).includes('<html'), 'web UI serves index.html');
    const config = await fetch(`${base}/runtime-config.js`, { headers });
    assert(config.status === 200, `runtime config status ${config.status}`);
    assert(
      (await config.text()).includes('connections.manage'),
      'runtime config has host capabilities',
    );
    const connections = await fetch(`${base}/__intent-web/connections`, { headers });
    assert(connections.status === 200, `connections status ${connections.status}`);
    const listed = await connections.json();
    assert(
      Array.isArray(listed.connections) &&
        listed.connections.length === 0 &&
        listed.activeId === null,
      `a fresh server lists no machines, got ${JSON.stringify(listed)}`,
    );
  } catch (error) {
    await stop();
    throw error;
  }
  const { code, signal } = await stop();
  if (signal === 'SIGKILL') throw new Error(`serve did not stop on SIGTERM:\n${output}`);
  assert(code === 0 || signal === 'SIGTERM', `serve exit code ${code}, signal ${signal}`);
}

export async function smokeIntentWebPackage({
  packageDir = path.join(ROOT, 'dist/intent-web-package'),
  packDestination,
} = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-web-smoke-'));
  try {
    const destination = packDestination ? path.resolve(packDestination) : path.join(work, 'pack');
    fs.mkdirSync(destination, { recursive: true });
    const [packed] = JSON.parse(
      run('npm', ['pack', '--json', '--pack-destination', destination], { cwd: packageDir }),
    );
    const tarball = path.join(destination, packed.filename);
    const problems = tarballProblems(packed);
    if (problems.length) throw new Error(`tarball check failed:\n  ${problems.join('\n  ')}`);
    console.log(
      `${packed.id}: ${packed.entryCount} files, packed ${(packed.size / 1048576).toFixed(1)} MB, unpacked ${(packed.unpackedSize / 1048576).toFixed(1)} MB`,
    );

    const npmEnv = {
      ...process.env,
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
    };
    const npxHelp = run('npx', ['--yes', `file:${tarball}`, '--help'], {
      cwd: work,
      env: { ...npmEnv, npm_config_cache: path.join(work, 'npm-cache') },
    });
    assert(npxHelp.includes('intent-web [serve'), `npx --help prints usage:\n${npxHelp}`);

    const install = path.join(work, 'install');
    fs.mkdirSync(install);
    fs.writeFileSync(path.join(install, 'package.json'), '{"private":true}\n');
    run('npm', ['install', '--no-audit', '--ignore-scripts', tarball], {
      cwd: install,
      env: npmEnv,
    });
    const bin = path.join(install, 'node_modules/@intent-hq/web/bin/intent-web.mjs');
    const deps = fs
      .readdirSync(path.join(install, 'node_modules'))
      .filter((n) => !n.startsWith('.'));
    assert(
      deps.sort().join(',') === '@intent-hq,ws',
      `only ws is installed beside the package, got ${deps.join(', ')}`,
    );

    const dataDir = path.join(work, 'data');
    const accessKey = run(process.execPath, [bin, 'key', '--data-dir', dataDir]).trim();
    assert(/^[A-Za-z0-9_-]{43}$/.test(accessKey), `key prints an access key, got ${accessKey}`);
    if (process.platform !== 'win32')
      assert((fs.statSync(dataDir).mode & 0o777) === 0o700, 'data dir is 0700');
    await serveSmoke({ bin, dataDir, accessKey });
    console.log(packDestination ? `Smoke test passed: ${tarball}` : 'Smoke test passed.');
    return { tarball, packed };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: { 'package-dir': { type: 'string' }, 'pack-destination': { type: 'string' } },
  });
  await smokeIntentWebPackage({
    packageDir: values['package-dir'] && path.resolve(values['package-dir']),
    packDestination: values['pack-destination'],
  });
}
