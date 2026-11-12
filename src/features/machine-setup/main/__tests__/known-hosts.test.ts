import { createHash, createHmac, randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  checkKnownHosts,
  hostFieldMatches,
  hostKeyType,
  knownHostsName,
  sha256Fingerprint,
} from '../known-hosts';
import { TEST_HOST_KEYS } from './fixtures';

function hashed(name: string): string {
  const salt = randomBytes(20);
  const hash = createHmac('sha1', salt).update(name).digest();
  return `|1|${salt.toString('base64')}|${hash.toString('base64')}`;
}

const ed = TEST_HOST_KEYS.ed25519;
const otherEd = TEST_HOST_KEYS.otherEd25519;
const ecdsa = TEST_HOST_KEYS.ecdsa;
const edKey = { type: 'ssh-ed25519', blob: ed };
const line = (hosts: string, type: string, blob: Buffer) =>
  `${hosts} ${type} ${blob.toString('base64')}`;

describe('known-hosts', () => {
  it('reads the key type from the wire blob', () => {
    expect(hostKeyType(ed)).toBe('ssh-ed25519');
    expect(hostKeyType(ecdsa)).toBe('ecdsa-sha2-nistp256');
    expect(hostKeyType(Buffer.from([0, 0]))).toBeNull();
  });

  it('formats the SHA256 fingerprint like ssh-keygen -l', () => {
    const expected = createHash('sha256').update(ed).digest('base64').replace(/=+$/, '');
    expect(sha256Fingerprint(ed)).toBe(`SHA256:${expected}`);
    expect(sha256Fingerprint(ed)).not.toContain('=');
  });

  it('matches a plain host name and a comma list', () => {
    expect(checkKnownHosts(line('build-box', 'ssh-ed25519', ed), 'build-box', 22, edKey)).toBe(
      'match',
    );
    const text = `# comment\n${line('other,Build-Box,10.0.0.5', 'ssh-ed25519', ed)}\n`;
    expect(checkKnownHosts(text, '10.0.0.5', 22, edKey)).toBe('match');
    expect(checkKnownHosts(text, 'build-box', 22, edKey)).toBe('match');
    expect(checkKnownHosts(text, 'elsewhere', 22, edKey)).toBe('unknown');
  });

  it('uses [host]:port off port 22', () => {
    expect(knownHostsName('Box', 2222)).toBe('[box]:2222');
    const text = line('[box]:2222', 'ssh-ed25519', ed);
    expect(checkKnownHosts(text, 'box', 2222, edKey)).toBe('match');
    expect(checkKnownHosts(text, 'box', 22, edKey)).toBe('unknown');
    expect(checkKnownHosts(line('box', 'ssh-ed25519', ed), 'box', 2222, edKey)).toBe('unknown');
  });

  it('matches hashed entries for both name forms', () => {
    expect(checkKnownHosts(line(hashed('box'), 'ssh-ed25519', ed), 'box', 22, edKey)).toBe('match');
    expect(checkKnownHosts(line(hashed('[box]:2200'), 'ssh-ed25519', ed), 'box', 2200, edKey)).toBe(
      'match',
    );
    expect(checkKnownHosts(line(hashed('other'), 'ssh-ed25519', ed), 'box', 22, edKey)).toBe(
      'unknown',
    );
  });

  it('reports a same-type, different-blob key as a mismatch', () => {
    const text = line('box', 'ssh-ed25519', otherEd);
    expect(checkKnownHosts(text, 'box', 22, edKey)).toBe('mismatch');
    expect(checkKnownHosts(line(hashed('box'), 'ssh-ed25519', otherEd), 'box', 22, edKey)).toBe(
      'mismatch',
    );
  });

  it('does not treat a key of another type as a mismatch', () => {
    const text = line('box', 'ecdsa-sha2-nistp256', ecdsa);
    expect(checkKnownHosts(text, 'box', 22, edKey)).toBe('unknown');
  });

  it('prefers a match over another stale line of the same type', () => {
    const text = [line('box', 'ssh-ed25519', otherEd), line('box', 'ssh-ed25519', ed)].join('\n');
    expect(checkKnownHosts(text, 'box', 22, edKey)).toBe('match');
  });

  it('skips @revoked and @cert-authority lines', () => {
    const text = [
      `@cert-authority box ${'ssh-ed25519'} ${otherEd.toString('base64')}`,
      `@revoked box ssh-ed25519 ${otherEd.toString('base64')}`,
    ].join('\n');
    expect(checkKnownHosts(text, 'box', 22, edKey)).toBe('unknown');
  });

  it('supports wildcards and negation', () => {
    expect(hostFieldMatches('*.lan', 'box.lan')).toBe(true);
    expect(hostFieldMatches('*.lan,!secret.lan', 'secret.lan')).toBe(false);
    expect(hostFieldMatches('bo?', 'box')).toBe(true);
  });
});
