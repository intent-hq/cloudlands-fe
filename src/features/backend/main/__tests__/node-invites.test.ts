import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_INVITE_CLAIM_METHOD } from '$shared/types/node-invite';
import { createNodeInvites } from '../node-invites';

const SECRET = 'invite-secret-value';
const LINK = `intent://node?v=1&host=192.0.2.20,10.0.0.4&port=7443&fp=AA%3ABB&tc=tc-node.example&invite=inv_1&secret=${SECRET}`;

const MACHINE = {
  id: 'd-gpu',
  name: 'GPU rig',
  hosts: ['192.0.2.20'],
  port: 7443,
  fingerprint: 'AA:BB',
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-11-10T00:00:00Z',
};

function rpcError(rpcCode: number, data?: Record<string, unknown>) {
  return Object.assign(new Error(`rpc ${rpcCode}`), { rpcCode, data });
}

let time = 1_000;
let request: ReturnType<typeof vi.fn>;
const client = () => ({ request });
const invites = () => createNodeInvites({ now: () => time });

beforeEach(() => {
  time = 1_000;
  request = vi.fn(async () => ({ machine: MACHINE }));
});

describe('inspecting a node link', () => {
  it('holds a complete link, named after its first host', () => {
    const result = invites().inspect(LINK);
    expect(result).toEqual({ ok: true, pendingId: expect.any(String), label: '192.0.2.20' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('a tunnel-only link has no name for the renderer to show', () => {
    const tunnelOnly = LINK.replace('host=192.0.2.20,10.0.0.4', 'host=');
    expect(invites().inspect(tunnelOnly)).toMatchObject({ ok: true, label: null });
  });

  it('rejects text that is not a node link', () => {
    expect(invites().inspect('intent://pair?v=1&token=t')).toEqual({
      ok: false,
      code: 'not-a-link',
    });
    expect(invites().inspect(42 as unknown as string)).toEqual({ ok: false, code: 'not-a-link' });
  });

  it.each([
    ['route', LINK.replace('host=192.0.2.20,10.0.0.4', 'host=').replace('&tc=tc-node.example', '')],
    ['port', LINK.replace('port=7443', 'port=0')],
    ['fingerprint', LINK.replace('&fp=AA%3ABB', '')],
    ['invite id', LINK.replace('&invite=inv_1', '')],
    ['secret', LINK.replace(`&secret=${SECRET}`, '')],
    ['version', LINK.replace('v=1&', '')],
  ])('rejects a link without its %s', (_part, link) => {
    expect(invites().inspect(link)).toEqual({ ok: false, code: 'incomplete' });
  });

  it.each(['v=2', 'v=0', 'v=one'])('refuses another link version (%s)', (version) => {
    expect(invites().inspect(LINK.replace('v=1', version))).toEqual({
      ok: false,
      code: 'link-version',
    });
  });
});

describe('claiming a node invite', () => {
  it('hands the link to the current backend and returns the saved machine', async () => {
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    await expect(links.claim(held.pendingId, client())).resolves.toEqual({
      ok: true,
      machine: expect.objectContaining({ id: 'd-gpu', name: 'GPU rig' }),
    });
    expect(request).toHaveBeenCalledWith(
      NODE_INVITE_CLAIM_METHOD,
      { uri: LINK },
      { timeoutMs: expect.any(Number) },
    );
  });

  it('claims each held link once', async () => {
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    await links.claim(held.pendingId, client());
    await expect(links.claim(held.pendingId, client())).resolves.toEqual({
      ok: false,
      code: 'expired',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('expires a held link after a few minutes', async () => {
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    time += 11 * 60_000;
    await expect(links.claim(held.pendingId, client())).resolves.toEqual({
      ok: false,
      code: 'expired',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('drops a discarded link', async () => {
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    links.discard(held.pendingId);
    await expect(links.claim(held.pendingId, client())).resolves.toMatchObject({
      code: 'expired',
    });
  });

  it.each([
    ['invalid-node-link', rpcError(-32602, { code: 'invalid-node-link' })],
    ['node-invite-invalid', rpcError(-32602, { code: 'node-invite-invalid' })],
    ['node-invite-expired', rpcError(-32602, { code: 'node-invite-expired', expiresAt: 'x' })],
    ['node-invite-used', rpcError(-32602, { code: 'node-invite-used' })],
    ['node-invite-revoked', rpcError(-32602, { code: 'node-invite-revoked' })],
    ['node-invite-self', rpcError(-32602, { code: 'node-invite-self' })],
    ['backend-unsupported', rpcError(-32601)],
    ['not-owner', rpcError(-32003)],
    ['failed', rpcError(-32603, { code: 'something-new' })],
    ['failed', new Error('socket closed')],
  ])('maps a %s failure', async (code, error) => {
    request.mockRejectedValueOnce(error);
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    await expect(links.claim(held.pendingId, client())).resolves.toEqual({ ok: false, code });
  });

  async function failWith(data: Record<string, unknown>, rpcCode = -32603) {
    request.mockRejectedValueOnce(rpcError(rpcCode, data));
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    return links.claim(held.pendingId, client());
  }

  it('lists the routes the backend tried, and whether the invite was spent', async () => {
    await expect(
      failWith({
        code: 'machine-unreachable',
        inviteSpent: false,
        attempts: [
          { route: '192.0.2.20:7443', error: 'node-link-connect-timeout' },
          { route: 'tailcat', error: 'node-link-certificate-mismatch' },
          { bogus: true },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'machine-unreachable',
      inviteSpent: false,
      routes: ['192.0.2.20:7443', 'tailcat'],
    });
  });

  it('reports a certificate mismatch when every route failed the pin', async () => {
    await expect(
      failWith({
        code: 'machine-unreachable',
        inviteSpent: false,
        attempts: [
          { route: '192.0.2.20:7443', error: 'node-link-certificate-mismatch' },
          { route: 'tailcat', error: 'node-link-certificate-mismatch' },
        ],
      }),
    ).resolves.toEqual({ ok: false, code: 'certificate-mismatch', inviteSpent: false });
  });

  it.each([
    ['machine-unreachable', true],
    ['machine-update-required', true],
    ['machine-update-required', false],
  ] as const)('keeps inviteSpent on %s (spent: %s)', async (code, inviteSpent) => {
    await expect(failWith({ code, inviteSpent })).resolves.toEqual({
      ok: false,
      code,
      inviteSpent,
    });
  });

  it('treats a reply without a machine as a failure', async () => {
    request.mockResolvedValueOnce({ ok: true });
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    await expect(links.claim(held.pendingId, client())).resolves.toEqual({
      ok: false,
      code: 'failed',
    });
  });
});
