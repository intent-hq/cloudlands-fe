#!/usr/bin/env node
/**
 * Dev Launcher - Automatically finds available ports for running multiple dev instances
 *
 * Usage:
 *   node scripts/dev-launcher.mjs                     # Regular dev mode
 *   node scripts/dev-launcher.mjs --cdp               # CDP debug mode
 *   node scripts/dev-launcher.mjs --name "Frontend"   # Named instance (shows in title bar)
 */

import { createServer } from 'net';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Port configuration with defaults
const PORT_CONFIG = {
  // Start at 5190 so successive instances stay above the MCP bridge scan
  // range (5179–5188) and the reference Intent app's WSS port (5180).
  devPort: { start: 5190, name: 'Vite Dev Server' },
  inspectPort: { start: 9229, name: 'Node Inspector' },
  cdpPort: { start: 9223, name: 'CDP Debug' },
};

function checkHostPort(port, host, options = {}) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();

    const handleError = (error) => {
      if (error?.code === 'EADDRINUSE') return resolve(false);
      // Some environments (or IPv6-disabled setups) may not support the host we're trying
      if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPERM'].includes(error?.code)) return resolve(true);
      return resolve(false);
    };

    server.once('error', handleError);
    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    try {
      server.listen({ port, host, ...options });
    } catch (error) {
      handleError(error);
    }
  });
}

/**
 * Check if a port is available on both IPv4 and IPv6 localhost.
 * This avoids false positives on macOS where ::1 bindings don't block 127.0.0.1.
 */
async function isPortAvailable(port) {
  const ipv4Available = await checkHostPort(port, '127.0.0.1');
  if (!ipv4Available) return false;

  return checkHostPort(port, '::1', { ipv6Only: false });
}

/**
 * Find next available port starting from a given port
 */
async function findAvailablePort(startPort, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Find all available ports for a dev instance
 */
async function findAvailablePorts(includeCdp = false) {
  console.log('\n🔍 Finding available ports...\n');

  const ports = {};
  const usedPorts = new Set();

  // Find ports in order, avoiding conflicts
  for (const [key, config] of Object.entries(PORT_CONFIG)) {
    if (key === 'cdpPort' && !includeCdp) continue;

    let port = config.start;
    while (usedPorts.has(port) || !(await isPortAvailable(port))) {
      port++;
      if (port > config.start + 100) {
        throw new Error(`Could not find available port for ${config.name}`);
      }
    }
    ports[key] = port;
    usedPorts.add(port);

    const isDefault = port === config.start;
    console.log(`  ${config.name}: ${port}${isDefault ? ' (default)' : ' (next available)'}`);
  }

  // Calculate instance number based on devPort offset (always 1-based)
  const instanceNum = String(ports.devPort - PORT_CONFIG.devPort.start + 1);

  return { ...ports, instanceNum };
}

/**
 * Detect Linux-specific Electron flags (e.g. Wayland support).
 * Returns an array of extra CLI flags to pass to Electron.
 */
function getLinuxElectronFlags() {
  if (process.platform !== 'linux') return [];

  const flags = [];
  const isWayland =
    process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';

  if (isWayland) {
    flags.push('--ozone-platform=wayland');
    console.log('  🐧 Wayland session detected – adding --ozone-platform=wayland');
  }

  return flags;
}

/**
 * Patch the Electron.app Info.plist so macOS shows a custom name in the dock
 * instead of "Electron". Returns a cleanup function that restores the original.
 */
function patchElectronPlist(displayName) {
  const plistPath = join(
    dirname(__dirname),
    'node_modules/electron/dist/Electron.app/Contents/Info.plist',
  );
  if (!existsSync(plistPath)) return null;

  const original = readFileSync(plistPath, 'utf-8');
  const patched = original
    .replace(
      /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleDisplayName</key>\n\t<string>${displayName}</string>`,
    )
    .replace(
      /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleName</key>\n\t<string>${displayName}</string>`,
    );

  if (patched === original) return null;

  writeFileSync(plistPath, patched, 'utf-8');
  return () => {
    try {
      writeFileSync(plistPath, original, 'utf-8');
    } catch {
      // best-effort restore
    }
  };
}

function runDev(ports, cdpMode = false, devName = '') {
  ensureElectronBinary();
  ensureNativeModules();

  // Set DEV_NAME on process.env so it's inherited by the child process.
  // We avoid passing it through shell export strings because user-supplied
  // names can contain quotes/apostrophes that break nested shell quoting.
  process.env.DEV_NAME = devName || '';

  // On macOS, patch the Electron binary's Info.plist so the dock shows our name
  const label = devName || (ports.instanceNum ? `Dev ${ports.instanceNum}` : 'Dev');
  let restorePlist = null;
  if (process.platform === 'darwin') {
    restorePlist = patchElectronPlist(`Intent [${label}]`);
  }


  const script = cdpMode ? 'dev:cdp:base' : 'dev:base';

  console.log(`\n🚀 Starting Intent [${label}]...\n`);

  // Set environment variables directly on process.env for cross-platform compatibility
  process.env.DEV_PORT = String(ports.devPort);
  process.env.DEV_INSPECT_PORT = String(ports.inspectPort);
  process.env.DEV_INSTANCE = ports.instanceNum || '';

  // Linux-specific Electron flags (e.g. Wayland)
  const linuxFlags = getLinuxElectronFlags();
  if (linuxFlags.length > 0) {
    process.env.ELECTRON_EXTRA_ARGS = linuxFlags.join(' ');
  }

  if (cdpMode) {
    process.env.CDP_PORT = String(ports.cdpPort);
    process.env.ENABLE_CDP_DEBUG = 'true';
    console.log(`  🔎 CDP targets: http://127.0.0.1:${ports.cdpPort}/json/list`);
    console.log(`  🧠 Memory smoke: pnpm observe:memory -- --port ${ports.cdpPort} --count 1`);
    console.log(`  🤖 agent-browser: agent-browser connect ${ports.cdpPort}`);
  }

  // Use cross-platform approach: set env vars on process.env and spawn pnpm directly
  // On Windows, we need to use shell to find pnpm in PATH
  const isWindows = process.platform === 'win32';
  const child = spawn('pnpm', ['run', script], {
    cwd: dirname(__dirname),
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
    windowsVerbatimArguments: isWindows,
  });

  // Restore the original Info.plist when the process exits (guard against double-call)
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (restorePlist) restorePlist();
  };

  child.on('error', (err) => {
    cleanup();
    console.error('Failed to start dev server:', err);
    process.exit(1);
  });

  child.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  // Forward signals to child
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      child.kill(signal);
    });
  });

  // Also restore on unexpected exit
  process.on('exit', cleanup);
}

/**
 * Parse --name "value" or --name=value from args
 */
function parseNameArg(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' || args[i] === '-n') {
      return args[i + 1] || '';
    }
    if (args[i].startsWith('--name=')) {
      return args[i].slice('--name='.length);
    }
  }
  return '';
}

/**
 * Get the current git branch name to use as the default dev instance name.
 */
function getCurrentGitBranch() {
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dirname(__dirname),
      encoding: 'utf-8',
      timeout: 3000,
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
  } catch {
    // Not in a git repo or git not available
  }
  return '';
}

/**
 * Get the Electron userData parent directory (where cloudlands-dev-<port> dirs are created).
 * Mirrors Electron's default app.getPath('userData') for an app named "Electron" in dev.
 */
function getElectronUserDataDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Electron');
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Electron');
    default: // linux, etc.
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Electron');
  }
}

// Prefix used for cloudlands-fe's per-port dev userData dirs. Must match the naming
// scheme in src/main/utils/resolve-dev-instance.ts (resolveDevUserDataDirName).
const DEV_USERDATA_PREFIX = 'cloudlands-dev-';

/**
 * Remove stale cloudlands-dev-<port> directories that haven't been accessed recently.
 * Runs at dev startup to prevent unbounded disk growth from Electron userData
 * (caches, databases, GPU cache, etc.) accumulating across dev sessions. Scoped to
 * the cloudlands-dev-* prefix so we never touch other Electron dev apps' userData.
 */
function pruneStaleDevInstances(currentDevPort, maxAgeDays = 7) {
  const userDataDir = getElectronUserDataDir();
  if (!existsSync(userDataDir)) return;

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const currentName = `${DEV_USERDATA_PREFIX}${currentDevPort}`;
  let pruned = 0;

  try {
    const entries = readdirSync(userDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(DEV_USERDATA_PREFIX)) continue;

      // Never prune the instance we are about to launch
      if (entry.name === currentName) continue;

      const dirPath = join(userDataDir, entry.name);
      try {
        const { atimeMs, mtimeMs } = statSync(dirPath);
        const lastUsed = Math.max(atimeMs, mtimeMs);
        const ageDays = Math.round((now - lastUsed) / 86400000);
        if (now - lastUsed > maxAgeMs) {
          rmSync(dirPath, { recursive: true, force: true });
          pruned++;
          console.log(`  🧹 Pruned stale ${entry.name} (unused for ${ageDays}d)`);
        }
      } catch {
        // Skip entries we can't stat or remove (e.g. permission issues, open files)
      }
    }
  } catch {
    // userData dir not readable — skip silently
  }

  if (pruned > 0) {
    console.log(`  🧹 Cleaned up ${pruned} stale dev instance(s)\n`);
  }
}

// Main
const args = process.argv.slice(2);
const cdpMode = args.includes('--cdp') || args.includes('-c');
const devName = parseNameArg(args) || getCurrentGitBranch();

findAvailablePorts(cdpMode)
  .then((ports) => {
    pruneStaleDevInstances(ports.devPort);
    runDev(ports, cdpMode, devName);
  })
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });

/**
 * Ensure Electron binary is present (path.txt + dist). If missing (common when a
 * worktree was installed with scripts skipped), rerun electron's install script
 * to download/use cached binaries.
 */
function ensureElectronBinary() {
  const electronDir = join(dirname(__dirname), 'node_modules', 'electron');
  const pathFile = join(electronDir, 'path.txt');
  const distDir = join(electronDir, 'dist');

  if (existsSync(pathFile) && existsSync(distDir)) {
    return;
  }

  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    console.warn(
      '⚠️ ELECTRON_SKIP_BINARY_DOWNLOAD is set; clearing it may be required if install fails.',
    );
  }

  console.log('\n🔧 Electron binary missing; running electron install...\n');
  const result = spawnSync('node', [join(electronDir, 'install.js')], {
    cwd: electronDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(
      '❌ Electron install failed. Try `pnpm install` (without --ignore-scripts) or ensure network/cache access.',
    );
    process.exit(result.status ?? 1);
  }

  if (!existsSync(pathFile) || !existsSync(distDir)) {
    console.error(
      '❌ Electron install completed but binary is still missing. Try removing node_modules/electron and reinstalling.',
    );
    process.exit(1);
  }
}

/**
 * Ensure native modules (node-pty) are built for Electron.
 * In fresh worktrees where postinstall was skipped, the Electron ABI binary is missing.
 */
function ensureNativeModules() {
  const rootDir = dirname(__dirname);
  const nativeModules = [
    {
      name: 'node-pty',
      hasBinary: (moduleDir) =>
        existsSync(join(moduleDir, 'build', 'Release', 'pty.node')) ||
        existsSync(join(moduleDir, 'build', 'Debug', 'pty.node')) ||
        directoryHasNodeBinary(join(moduleDir, 'prebuilds')),
    },
  ];

  const missingModules = nativeModules
    .filter(({ name, hasBinary }) => {
      const moduleDir = join(rootDir, 'node_modules', name);
      return existsSync(moduleDir) && !hasBinary(moduleDir);
    })
    .map(({ name }) => name);

  if (missingModules.length === 0) return;

  console.log(
    `\n🔨 Native Electron binaries missing for ${missingModules.join(', ')}; rebuilding...\n`,
  );
  const result = spawnSync('npx', ['@electron/rebuild', '-f', '-o', missingModules.join(',')], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(
      '❌ Native rebuild failed. Try `pnpm run rebuild:native:verbose` or ensure build tools (Xcode CLT) are installed.',
    );
    process.exit(result.status ?? 1);
  }
}

function directoryHasNodeBinary(dirPath) {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries.some((entry) => {
      if (entry.isFile() && entry.name.endsWith('.node')) return true;
      if (entry.isDirectory()) {
        if (directoryHasNodeBinary(join(dirPath, entry.name))) return true;
      }
      return false;
    });
  } catch {
    return false;
  }
}
