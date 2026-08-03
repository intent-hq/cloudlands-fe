/**
 * Windows named-pipe name derivation for the intentd local transport.
 *
 * On Windows the daemon cannot bind a Unix Domain Socket, so it serves the
 * UDS-equivalent named pipe instead. The pipe name is derived from the
 * resolved socket path so every data dir (prod vs dev vs tests) gets its own
 * isolated pipe without extra coordination state — the FE and the daemon
 * already agree on `INTENTD_DATA_DIR`.
 *
 * Pipe-name contract (MUST match the Rust implementation in intent-transport
 * exactly): `\\.\pipe\intentd-<hash16>` where `<hash16>` = the first 16 hex
 * chars of SHA-256 over the UTF-8 bytes of the resolved socket path
 * (`<data_dir>\intentd.sock`) normalized as: absolute path, backslash
 * separators, lowercased.
 *
 * Cross-check vector (pinned in `backend-connection.test.ts` and mirrored by
 * the Rust test suite):
 *   socket path: C:\Users\alice\AppData\Roaming\intentd\data\intentd.sock
 *   normalized:  c:\users\alice\appdata\roaming\intentd\data\intentd.sock
 *   sha256:      4f8c75c28cfa6e92da1ca663e86a6f8c68d96047d924499ac04c09f905660611
 *   pipe name:   \\.\pipe\intentd-4f8c75c28cfa6e92
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** Matches the Windows pipe namespace (`\\.\pipe\…` or `\\?\pipe\…`). */
const PIPE_NAMESPACE_RE = /^\\\\[.?]\\pipe\\/i;

/** `true` when the target is already a Windows named-pipe path. */
export function isWindowsPipePath(target: string): boolean {
  return PIPE_NAMESPACE_RE.test(target);
}

/**
 * Derive the intentd named-pipe name for a socket path per the pipe-name
 * contract above. `path.win32.resolve` yields the absolute, backslash-
 * separated form on every host platform (deterministic in tests).
 */
export function windowsPipeName(socketPath: string): string {
  const normalized = path.win32.resolve(socketPath).replace(/\//g, '\\').toLowerCase();
  const hash16 = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\intentd-${hash16}`;
}

/**
 * Map a socket path to the local connect target for `net.connect({ path })`:
 * the named pipe on win32 (already-pipe paths pass through), the socket path
 * itself everywhere else.
 */
export function toLocalEndpoint(
  socketPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32' || isWindowsPipePath(socketPath)) return socketPath;
  return windowsPipeName(socketPath);
}

/**
 * Default Windows socket path when `INTENTD_DATA_DIR` is unset. Mirrors the
 * daemon's `directories::ProjectDirs::from("", "", "intentd").data_dir()`
 * (crates/intent-core/src/config.rs): `%APPDATA%\intentd\data`.
 */
export function defaultWindowsSocketPath(env: NodeJS.ProcessEnv): string {
  const appData = env.APPDATA?.trim() || path.win32.join(os.homedir(), 'AppData', 'Roaming');
  return path.win32.join(appData, 'intentd', 'data', 'intentd.sock');
}
