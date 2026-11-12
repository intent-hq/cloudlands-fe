/**
 * Read the local daemon discovery folder (protocol §5.58 Discovery record) so
 * Settings → Machines → Add machine → Intent on this computer can list the
 * other Intents this OS user is running.
 *
 * Reader rules: skip, without error, anything that is not a regular file (a
 * symlink included), is larger than 16 KiB, is not owned by the current user
 * or does not parse; records whose version is not 1 or that do not advertise
 * `localCodePairing: 1`; records whose process is gone; and this app's own
 * daemon (same fingerprint, instance id or data folder).
 */

import { constants as fsConstants, promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeFingerprint } from '../../backend/main/backend-connection';

/** @internal Exported for tests. */
export const MAX_RECORD_BYTES = 16 * 1024;

/** A parsed, supported discovery record. Holds no secret. */
export interface LocalDaemonRecord {
  instanceId: string;
  pid: number;
  displayName: string;
  dataDir: string;
  daemonVersion: string;
  protocolVersion: string;
  port: number | null;
  /** Normalized (colon-separated uppercase hex). */
  fingerprint: string;
}

/** The discovery folder for this platform; `INTENT_LOCAL_DAEMONS_DIR` overrides it. */
export function localDaemonsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const override = env.INTENT_LOCAL_DAEMONS_DIR?.trim();
  if (override) return override;
  if (platform === 'darwin') {
    // i18n-ignore (filesystem path)
    return path.join(home, 'Library', 'Application Support', 'Intent', 'local-daemons');
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(localAppData, 'Intent', 'local-daemons');
  }
  const runtime = env.XDG_RUNTIME_DIR?.trim();
  if (runtime) return path.join(runtime, 'intent', 'local-daemons');
  return path.join(home, '.local', 'state', 'intent', 'local-daemons');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const INSTANCE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * @internal Exported for tests.
 *
 * Parse one record, or null when it breaks a reader rule or is unsupported.
 */
export function parseLocalDaemonRecord(raw: string): LocalDaemonRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1) return null;
  const capabilities = value.capabilities;
  if (!isRecord(capabilities) || capabilities.localCodePairing !== 1) return null;
  const { instanceId, pid, displayName, dataDir, daemonVersion, protocolVersion, port } = value;
  if (typeof instanceId !== 'string' || !INSTANCE_ID.test(instanceId)) return null;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if (!text(displayName, 200) || !text(dataDir, 4096)) return null;
  if (
    port !== null &&
    (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
  )
    return null;
  if (typeof value.fingerprint !== 'string') return null;
  const fingerprint = normalizeFingerprint(value.fingerprint);
  if (fingerprint.length !== 95) return null; // 32 bytes as colon-separated hex
  return {
    instanceId,
    pid,
    displayName: displayName.replace(CONTROL_CHARACTERS, '').trim(),
    dataDir,
    daemonVersion: typeof daemonVersion === 'string' ? daemonVersion : '',
    protocolVersion: typeof protocolVersion === 'string' ? protocolVersion : '',
    port,
    fingerprint,
  };
}

/** Whether a process id is running. EPERM means it exists under another user. */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** This app's own daemon, hidden from the list. Any known field is enough. */
export interface OwnDaemon {
  fingerprint: string | null;
  instanceId?: string | null;
  dataDir: string | null;
}

export interface DiscoveryReaderDeps {
  dir: string;
  /** Current OS user id; null where file ownership is not POSIX (Windows). */
  uid: number | null;
  isRunning?: (pid: number) => boolean;
  fs?: Pick<typeof fsPromises, 'readdir' | 'lstat' | 'open'>;
  /** O_NOFOLLOW where the platform has it. */
  noFollowFlag?: number;
}

const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b);

function isOwn(record: LocalDaemonRecord, own: OwnDaemon): boolean {
  if (own.fingerprint && normalizeFingerprint(own.fingerprint) === record.fingerprint) return true;
  if (own.instanceId && own.instanceId === record.instanceId) return true;
  return !!own.dataDir && samePath(own.dataDir, record.dataDir);
}

/** Read one file under the reader rules, or null. */
async function readRecordFile(
  file: string,
  deps: Required<Pick<DiscoveryReaderDeps, 'fs' | 'noFollowFlag'>> & { uid: number | null },
): Promise<LocalDaemonRecord | null> {
  const { fs, uid } = deps;
  let handle: Awaited<ReturnType<typeof fsPromises.open>> | null = null;
  try {
    const link = await fs.lstat(file);
    if (!link.isFile() || link.isSymbolicLink()) return null;
    if (link.size > MAX_RECORD_BYTES) return null;
    if (uid !== null && link.uid !== uid) return null;
    handle = await fs.open(file, fsConstants.O_RDONLY | deps.noFollowFlag);
    // The file may have been swapped since lstat: check what was opened.
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== link.ino || stat.dev !== link.dev) return null;
    if (stat.size > MAX_RECORD_BYTES) return null;
    if (uid !== null && stat.uid !== uid) return null;
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_RECORD_BYTES) return null;
    return parseLocalDaemonRecord(buffer.subarray(0, bytesRead).toString('utf8'));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * List the supported, live records of other daemons, sorted by name then
 * data folder. Returns null when the folder itself is unsafe to read (a
 * symlink, not a folder, or owned by someone else); a missing folder is an
 * empty list.
 */
export async function readLocalDaemons(
  deps: DiscoveryReaderDeps,
  own: OwnDaemon,
): Promise<LocalDaemonRecord[] | null> {
  const fs = deps.fs ?? fsPromises;
  const isRunning = deps.isRunning ?? isProcessRunning;
  const noFollowFlag = deps.noFollowFlag ?? fsConstants.O_NOFOLLOW ?? 0;
  try {
    const folder = await fs.lstat(deps.dir);
    if (!folder.isDirectory() || folder.isSymbolicLink()) return null;
    if (deps.uid !== null && folder.uid !== deps.uid) return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
  }
  let names: string[];
  try {
    names = (await fs.readdir(deps.dir)).filter((name) => name.endsWith('.json'));
  } catch {
    return null;
  }
  const records = await Promise.all(
    names.map((name) =>
      readRecordFile(path.join(deps.dir, name), { fs, uid: deps.uid, noFollowFlag }),
    ),
  );
  const seen = new Set<string>();
  return records
    .filter((record): record is LocalDaemonRecord => {
      if (!record || seen.has(record.instanceId)) return false;
      seen.add(record.instanceId);
      return !isOwn(record, own) && isRunning(record.pid);
    })
    .sort(
      (a, b) => a.displayName.localeCompare(b.displayName) || a.dataDir.localeCompare(b.dataDir),
    );
}

/**
 * This install's product name for the sidecar's `INTENTD_PRODUCT_NAME`
 * and the `appName` sent when pairing: the packaged app's name, or that
 * name marked as a dev build.
 */
export function desktopProductName(appName: string, isPackaged: boolean): string {
  const name = appName.trim() || 'Intent'; // i18n-ignore (product name)
  return isPackaged ? name : `${name} (dev build)`; // i18n-ignore (product name, matches intentd)
}
