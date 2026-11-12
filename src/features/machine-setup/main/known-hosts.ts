/**
 * Read-only `~/.ssh/known_hosts` check for the SSH setup runner (main).
 *
 * Decides whether a host key the server presented is known (`match`), new
 * (`unknown`) or different from the recorded key of the same type
 * (`mismatch`). The file is never written: trusting a new key holds for one
 * run only.
 */

import { createHash, createHmac } from 'crypto';

export type KnownHostsVerdict = 'match' | 'unknown' | 'mismatch';

export interface HostKey {
  /** Key type as the wire blob names it, e.g. `ssh-ed25519`. */
  type: string;
  /** The SSH wire-format public key blob. */
  blob: Buffer;
}

/** `SHA256:<base64 without padding>`, as `ssh-keygen -l` prints it. */
export function sha256Fingerprint(blob: Buffer): string {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/** The key type is the first length-prefixed string of the wire blob. */
export function hostKeyType(blob: Buffer): string | null {
  if (blob.length < 4) return null;
  const length = blob.readUInt32BE(0);
  if (length === 0 || length > 64 || blob.length < 4 + length) return null;
  const type = blob.subarray(4, 4 + length).toString('latin1');
  return /^[\x21-\x7e]+$/.test(type) ? type : null;
}

/** The name OpenSSH looks up: `host`, or `[host]:port` off port 22. */
export function knownHostsName(host: string, port: number): string {
  const name = host.trim().toLowerCase();
  return port === 22 ? name : `[${name}]:${port}`;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

function hashedMatches(entry: string, name: string): boolean {
  // |1|<base64 salt>|<base64 HMAC-SHA1(salt, name)>
  const parts = entry.split('|');
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== '1') return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = createHmac('sha1', salt).update(name).digest();
  return actual.length === expected.length && actual.equals(expected);
}

/** Whether a host field (comma list, wildcards, `!` negation, or hashed) names `name`. */
export function hostFieldMatches(field: string, name: string): boolean {
  if (field.startsWith('|')) return hashedMatches(field, name);
  let matched = false;
  for (const raw of field.split(',')) {
    const pattern = raw.trim().toLowerCase();
    if (!pattern) continue;
    const negated = pattern.startsWith('!');
    const body = negated ? pattern.slice(1) : pattern;
    const hit = /[*?]/.test(body) ? globToRegExp(body).test(name) : body === name;
    if (hit && negated) return false;
    if (hit) matched = true;
  }
  return matched;
}

/**
 * Check `key` for `host:port` against the text of a known_hosts file.
 * `@cert-authority` and `@revoked` lines and comments are skipped. A recorded
 * key of another type is not a mismatch: only the same type with a different
 * blob is.
 */
export function checkKnownHosts(
  text: string,
  host: string,
  port: number,
  key: HostKey,
): KnownHostsVerdict {
  const name = knownHostsName(host, port);
  let sameTypeDiffers = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('@')) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    const [hosts, type, base64] = fields;
    if (type !== key.type || !hostFieldMatches(hosts, name)) continue;
    if (Buffer.from(base64, 'base64').equals(key.blob)) return 'match';
    sameTypeDiffers = true;
  }
  return sameTypeDiffers ? 'mismatch' : 'unknown';
}
