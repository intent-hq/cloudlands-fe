import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUILD_CONFIG } from './build-config.generated.js';

/** Compiled into a dedicated package; inherited runtime environment cannot opt in or out. */
export function isIsolatedTestBuild(): boolean {
  return Boolean(BUILD_CONFIG.ISOLATED_TEST_BUILD_ID);
}

export interface IsolatedTestProfile {
  readonly root: string;
  readonly userData: string;
  readonly home: string;
  readonly data: string;
  readonly socket: string;
  readonly config: string;
  readonly backendSha: string;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
}

const PRIVATE_CONFIG =
  '[server]\nbindAddress = "127.0.0.1"\n[server.wsApi]\nenabled = false\n' +
  '[server.tunnel]\nenabled = false\n[updates]\ncheckOnIdle = false\n' +
  '[sourceControl.github]\ntokenSource = "explicit"\nexposeGitCredentialToChildren = false\n';

function privateDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  ) {
    throw new Error('Unsafe isolated test directory');
  }
}

function checkPrivateFile(file: string): void {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (
    stat &&
    (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.())
  ) {
    throw new Error('Unsafe isolated test state file');
  }
}

/** Prepare only the dedicated profile. Never migrate, chmod, or repair an existing foreign path. */
export function prepareIsolatedTestProfile(
  originalHome: string,
  buildId: string,
  backendSha: string,
): IsolatedTestProfile {
  if (!/^manual-[1-9][0-9]{0,19}-[1-9][0-9]{0,2}$/.test(buildId)) {
    throw new Error('Invalid isolated test build identity');
  }
  if (!/^[a-f0-9]{40}$/.test(backendSha)) throw new Error('Missing isolated backend identity');
  if (!path.isAbsolute(originalHome) || fs.realpathSync(originalHome) !== originalHome) {
    throw new Error('Isolated test home must be canonical');
  }
  const base = path.join(originalHome, '.intent-tests');
  const root = path.join(base, buildId);
  const home = path.join(root, 'home');
  const userData = path.join(root, 'desktop');
  const data = path.join(root, 'daemon');
  const socket = path.join(data, 'intentd.sock');
  // macOS sockaddr_un includes the trailing NUL.
  if (Buffer.byteLength(socket) > 103) throw new Error('Isolated test socket path is too long');
  for (const directory of [base, root, home, userData, data]) privateDirectory(directory);
  if (fs.lstatSync(socket, { throwIfNoEntry: false })) {
    throw new Error('Isolated test socket already exists; close the previous test instance');
  }
  for (const name of ['config', 'cache', 'tmp', 'workspaces', 'github', 'logs', 'sessions']) {
    privateDirectory(path.join(root, name));
  }
  const config = path.join(data, 'config.toml');
  for (const name of [
    'intentd.db',
    'intentd.db-wal',
    'intentd.db-shm',
    'intentd.lock',
    'intentd.pid',
  ]) {
    checkPrivateFile(path.join(data, name));
  }
  const secrets = path.join(root, 'secrets.json');
  checkPrivateFile(secrets);
  checkPrivateFile(config);
  if (!fs.existsSync(config)) fs.writeFileSync(config, PRIVATE_CONFIG, { flag: 'wx', mode: 0o600 });
  const identity = path.join(root, 'backend-sha');
  checkPrivateFile(identity);
  if (!fs.existsSync(identity)) fs.writeFileSync(identity, backendSha, { flag: 'wx', mode: 0o600 });
  if (fs.readFileSync(identity, 'utf8') !== backendSha) {
    throw new Error('An isolated test database cannot be reused by a different backend');
  }
  const environment = Object.freeze({
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_DATA_HOME: data,
    TMPDIR: path.join(root, 'tmp'),
    TMP: path.join(root, 'tmp'),
    TEMP: path.join(root, 'tmp'),
    GH_CONFIG_DIR: path.join(root, 'github'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    INTENTD_DATA_DIR: data,
    INTENTD_CONFIG: config,
    INTENTD_WORKSPACES_DIR: path.join(root, 'workspaces'),
    INTENTD_SECRETS_FILE: secrets,
    INTENTD_LEGACY_IMPORT_ROOTS: '',
    INTENTD_LEGACY_APP_DIR: '',
    INTENTD_DISABLE_GH_CREDENTIALS: '1',
    INTENTD_PRIVATE_TEST_PROFILE: '1',
    INTENTD_SIDECAR: '1',
  });
  return Object.freeze({ root, home, userData, data, socket, config, backendSha, environment });
}

/** Drop ambient credentials, daemon transport/binary overrides, and injected child runtime hooks. */
export function isolatedTestEnvironment(
  profile: IsolatedTestProfile,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'SHELL']) {
    if (inherited[key] !== undefined) result[key] = inherited[key];
  }
  return { ...result, ...profile.environment, NODE_ENV: 'production' };
}

let activeProfile: IsolatedTestProfile | null = null;

export function activateIsolatedTestProfile(profile: IsolatedTestProfile): void {
  if (activeProfile) throw new Error('Isolated test profile was already initialized');
  activeProfile = profile;
}

export function getIsolatedTestProfile(): IsolatedTestProfile | null {
  if (isIsolatedTestBuild() && !activeProfile) {
    throw new Error('Isolated test profile has not been initialized');
  }
  return activeProfile;
}

/** Re-check the binding at transport/spawn boundaries, including recovery and restart. */
export function assertIsolatedTestEnvironment(env: NodeJS.ProcessEnv): void {
  const profile = getIsolatedTestProfile();
  if (!profile) return;
  for (const [key, value] of Object.entries(profile.environment)) {
    if (env[key] !== value) throw new Error('Isolated test environment binding changed');
  }
  for (const key of [
    'INTENTD_BIN',
    'INTENTD_SOCKET',
    'INTENTD_WS_URL',
    'INTENTD_TCP_PORT',
    'INTENTD_TCP',
    'INTENTD_TCP_INSECURE',
  ]) {
    if (env[key] !== undefined) throw new Error('Isolated test transport override is forbidden');
  }
  // Preferences are mutable. The original daemon startup policy pins safety
  // fields through update/reset/reload; a byte-equality guard would break them.
  checkPrivateFile(profile.config);
  if (!fs.existsSync(profile.config)) throw new Error('Isolated test configuration is missing');
}

export function assertNormalAppOperation(): void {
  if (isIsolatedTestBuild()) throw new Error('This operation is disabled in the isolated test app');
}
