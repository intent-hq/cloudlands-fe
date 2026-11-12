import type { SshAuthMethod, SshLoginPrefill } from '$shared/types/machine-setup';

/** The key file the login screen suggests (expanded in main). */
export const DEFAULT_SSH_KEY_PATH = '~/.ssh/id_ed25519';
export const DEFAULT_SSH_PORT = 22;

const METHODS: ReadonlySet<string> = new Set<SshAuthMethod>(['agent', 'key', 'password']);

/** A stored login, or null when it is missing or malformed. */
export function parseSshLoginPrefill(value: unknown): SshLoginPrefill | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.host !== 'string' || typeof v.username !== 'string') return null;
  if (typeof v.method !== 'string' || !METHODS.has(v.method)) return null;
  const port = typeof v.port === 'number' && validSshPort(v.port) ? v.port : DEFAULT_SSH_PORT;
  return {
    host: v.host,
    port,
    username: v.username,
    method: v.method as SshAuthMethod,
    keyPath: typeof v.keyPath === 'string' && v.keyPath ? v.keyPath : DEFAULT_SSH_KEY_PATH,
  };
}

export function validSshPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}
