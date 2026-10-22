'use strict';

const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createReadStream } = require('node:fs');
const { lstat, readFile, readdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { isDeepStrictEqual, parseArgs } = require('node:util');
const { gunzipSync } = require('node:zlib');
const { load } = require('js-yaml');
const { resolveWindowsSigning } = require('./windows-signing.cjs');

// Resolve through the declared electron-builder dependency, never a hoisted
// transitive package. These internal APIs are covered by the locked-install tests.
const builderRequire = createRequire(require.resolve('electron-builder'));
const { AppInfo } = builderRequire('app-builder-lib/out/appInfo');
const { expandMacro } = builderRequire('app-builder-lib/out/util/macroExpander');
const { buildBlockMap } = builderRequire('app-builder-lib/out/targets/blockmap/blockmap');

function safeName(name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/:%?#<>|"*]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
  ) {
    throw new Error('Unsafe Windows artifact path');
  }
  return name;
}

function expectedWindowsArtifacts(config, metadata) {
  const info = new AppInfo({ config, metadata }, undefined, config.win);
  const artifact = (target) =>
    safeName(expandMacro(config[target].artifactName, 'x64', info, { ext: 'exe' }));
  const installer = artifact('nsis');
  const portable = artifact('portable');
  if (installer === portable) throw new Error('Installer and portable paths must differ');
  const channel =
    config.publish.channel ||
    (config.detectUpdateChannel === false ? null : info.channel) ||
    'latest';
  return {
    installer,
    portable,
    blockmap: `${installer}.blockmap`,
    feed: safeName(`${channel}.yml`),
    app: safeName(`${info.productFilename}.exe`),
    uninstaller: safeName(`Uninstall ${info.productFilename}.exe`),
  };
}

async function regularFile(root, name) {
  // Check every component: realpath containment alone would still accept a
  // symlink within the output tree, masking unexpected artifact selection.
  let file = root;
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) {
    file = join(file, safeName(parts[i]));
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error('Artifact path is not a regular file/directory');
    }
  }
  return file;
}

async function digest(file) {
  const hash = createHash('sha512');
  let size = 0;
  for await (const bytes of createReadStream(file)) {
    hash.update(bytes);
    size += bytes.length;
  }
  return { sha512: hash.digest('base64'), size };
}

function nativeCommand(command, args, run) {
  const result = run(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Do not forward process errors, stdout, or stderr: callers may have signing
    // credentials in their environment. SignTool status 2 is a warning/failure.
    throw new Error(`Windows signature command failed: ${command}`);
  }
  return result.stdout;
}

async function verifyNativeSignature(
  file,
  identity,
  { run = spawnSync, platform = process.platform } = {},
) {
  if (platform !== 'win32') throw new Error('Native signature verification requires Windows');
  const text = nativeCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-File', join(__dirname, 'windows-authenticode.ps1'), file],
    run,
  );
  let signature;
  try {
    signature = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Invalid native signature JSON');
  }
  if (!signature || Array.isArray(signature)) throw new Error('Missing native signature result');
  // Third-party unsigned binaries are inventoried, not silently certified. A
  // present but invalid signature is always a failure, including for vendors.
  if (!identity && signature.status === 'NotSigned') return signature;
  if (
    signature.status !== 'Valid' ||
    !signature.signerThumbprint ||
    !signature.subject ||
    !signature.timestampSubject ||
    !signature.timestampThumbprint
  ) {
    throw new Error('Signature trust or timestamp verification failed');
  }
  if (
    identity &&
    (signature.subject !== identity.subject || signature.publisherName !== identity.publisherName)
  ) {
    throw new Error('Signature publisher identity does not match the approved certificate');
  }
  nativeCommand('signtool.exe', ['verify', '/pa', '/all', '/v', '/tw', file], run);
  return signature;
}

async function inventory(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${safeName(entry.name)}` : safeName(entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported in Windows payloads');
    if (entry.isDirectory()) result.push(...(await inventory(root, name)));
    else if (!entry.isFile()) throw new Error('Unsupported Windows payload file');
    else if (/\.(exe|dll|node)$/i.test(name)) result.push(name);
  }
  return result.sort();
}

async function verifyWindowsArtifacts({
  dir,
  config,
  metadata,
  signing,
  installedDir,
  native = verifyNativeSignature,
}) {
  if (
    !['unsigned', 'azure'].includes(signing.mode) ||
    (signing.mode === 'azure' && !signing.identity?.subject)
  ) {
    throw new Error('Invalid Windows verification policy');
  }
  const root = resolve(dir);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('Unsafe artifact directory');
  const names = expectedWindowsArtifacts(config, metadata);
  const installers = (await readdir(root)).filter((name) => /\.exe$/i.test(name)).sort();
  if (!isDeepStrictEqual(installers, [names.installer, names.portable].sort())) {
    throw new Error('Expected exactly the current installer and portable executable');
  }
  const artifacts = [];
  for (const name of [names.installer, names.portable]) {
    const file = await regularFile(root, name);
    artifacts.push({ path: name, ...(await digest(file)) });
  }
  const feed = load(await readFile(await regularFile(root, names.feed), 'utf8'));
  if (!feed || !Array.isArray(feed.files) || feed.files.length !== 1)
    throw new Error('Invalid update feed entries');
  safeName(feed.path);
  safeName(feed.files[0]?.url);
  const entry = feed.files[0];
  if (
    feed.version !== metadata.version ||
    feed.path !== names.installer ||
    entry.url !== names.installer ||
    feed.sha512 !== artifacts[0].sha512 ||
    entry.sha512 !== artifacts[0].sha512 ||
    entry.size !== artifacts[0].size
  ) {
    throw new Error('Update feed version/path/hash/size mismatch');
  }
  const publishedMap = await readFile(await regularFile(root, names.blockmap));
  const temporary = await mkdtemp(join(tmpdir(), 'intent-blockmap-'));
  try {
    const rebuilt = join(temporary, 'rebuilt.blockmap');
    await buildBlockMap(join(root, names.installer), 'gzip', rebuilt);
    const decode = (bytes) =>
      JSON.parse(gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
    if (!isDeepStrictEqual(decode(publishedMap), decode(await readFile(rebuilt))))
      throw new Error('Stale installer blockmap');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  const payloads = [];
  const roots = [{ path: root, prefix: 'win-unpacked', installed: false }];
  if (installedDir) {
    const path = resolve(installedDir),
      stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe installed directory');
    roots.push({ path, prefix: '', installed: true });
  }
  for (const payload of roots) {
    const prefix = payload.prefix ? `${payload.prefix}/` : '';
    const required = [names.app, 'resources/intentd/intentd.exe', 'resources/tailcat/tailcat.exe'];
    if (payload.installed) required.push(names.uninstaller);
    for (const name of required) await regularFile(payload.path, `${prefix}${name}`);
    const updater = load(
      await readFile(await regularFile(payload.path, `${prefix}resources/app-update.yml`), 'utf8'),
    );
    const expectedPublisher =
      signing.mode === 'azure'
        ? signing.identity.publisherName
        : config.win.signtoolOptions.publisherName;
    const publishers =
      typeof updater?.publisherName === 'string' ? [updater.publisherName] : updater?.publisherName;
    if (!isDeepStrictEqual(publishers, [expectedPublisher]))
      throw new Error('Packaged updater publisher allowlist mismatch');
    for (const name of await inventory(payload.path, payload.prefix)) {
      const own = [names.app, 'resources/intentd/intentd.exe', names.uninstaller].some(
        (file) => name === `${prefix}${file}`,
      );
      payloads.push({
        path: name,
        scope: payload.installed ? 'installed' : 'staged',
        policy: own ? 'publisher' : 'inventory',
        file: await regularFile(payload.path, name),
      });
    }
  }
  if (signing.mode === 'azure') {
    for (const artifact of artifacts)
      artifact.signature = await native(join(root, artifact.path), signing.identity);
    for (const item of payloads)
      item.signature = await native(
        item.file,
        item.policy === 'publisher' ? signing.identity : null,
      );
  }
  return {
    mode: signing.mode,
    version: metadata.version,
    feed: names.feed,
    artifacts,
    inventory: payloads.map(({ file: _file, ...item }) => item),
    nativeAcceptance: 'pending',
    limitations: [
      'Staged files do not prove installer/portable embedded payloads match.',
      'Unsigned vendor binaries are inventoried; their signing policy requires review.',
      ...(installedDir ? [] : ['Installed payload and generated uninstaller were not verified.']),
      'Clean install/launch/uninstall and unsigned-to-signed full/differential updates require Windows acceptance.',
    ],
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: 'dist-electron' },
      'installed-dir': { type: 'string' },
    },
  });
  const signing = resolveWindowsSigning(process.env.INTENT_WINDOWS_SIGNING_MODE, process.env, {
    credentials: false,
  });
  const report = await verifyWindowsArtifacts({
    dir: values.dir,
    installedDir: values['installed-dir'],
    signing,
    config: load(await readFile('electron-builder.yml', 'utf8')),
    metadata: JSON.parse(await readFile('package.json', 'utf8')),
  });
  await writeFile(
    join(values.dir, 'windows-verification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx' },
  );
  console.log('Windows artifact checks passed; native install/update acceptance remains pending.');
}

if (require.main === module)
  main().catch(() => {
    console.error(
      'Windows artifact verification failed; check configuration, inventory, signature tools and final feed/blockmap bytes.',
    );
    process.exitCode = 1;
  });

module.exports = { expectedWindowsArtifacts, verifyWindowsArtifacts, verifyNativeSignature };
