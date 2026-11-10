import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_INVITE_CLAIM_METHOD } from '$shared/types/node-invite';
import { createNodeInvites } from '../node-invites';

const SECRET = 'invite-secret-value';
const LINK = `intent://node?v=1&host=192.0.2.20,10.0.0.4&port=7443&fp=AA%3ABB&tc=tc-node.example&invite=inv_1&secret=${SECRET}&name=GPU%20rig`;

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
  it('holds a complete link and names it from the link', () => {
    const result = invites().inspect(LINK);
    expect(result).toEqual({ ok: true, pendingId: expect.any(String), label: 'GPU rig' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('names an unnamed link after its first route', () => {
    const unnamed = LINK.replace('&name=GPU%20rig', '');
    expect(invites().inspect(unnamed)).toMatchObject({ ok: true, label: '192.0.2.20' });
    const tunnelOnly = unnamed.replace('host=192.0.2.20,10.0.0.4', 'host=');
    expect(invites().inspect(tunnelOnly)).toMatchObject({ ok: true, label: 'tc-node.example' });
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
  ])('rejects a link without its %s', (_part, link) => {
    expect(invites().inspect(link)).toEqual({ ok: false, code: 'incomplete' });
  });

  it('refuses a newer link format', () => {
    expect(invites().inspect(LINK.replace('v=1', 'v=2'))).toEqual({
      ok: false,
      code: 'link-version',
    });
  });
});

describe('claiming a node invite', () => {
  it('sends the invite to the current backend and returns the saved machine', async () => {
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    await expect(links.claim(held.pendingId, client())).resolves.toEqual({
      ok: true,
      machine: expect.objectContaining({ id: 'd-gpu', name: 'GPU rig' }),
    });
    expect(request).toHaveBeenCalledWith(
      NODE_INVITE_CLAIM_METHOD,
      {
        inviteId: 'inv_1',
        secret: SECRET,
        hosts: ['192.0.2.20', '10.0.0.4'],
        port: 7443,
        tcAddress: 'tc-node.example',
        fingerprint: 'AA:BB',
      },
      { timeoutMs: expect.any(Number) },
    );
  });

  it('omits the tunnel when the link has none', async () => {
    const links = invites();
    const held = links.inspect(LINK.replace('&tc=tc-node.example', ''));
    if (!held.ok) throw new Error('not held');
    await links.claim(held.pendingId, client());
    expect(request.mock.calls[0][1]).not.toHaveProperty('tcAddress');
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
    ['invite-invalid', rpcError(-32602, { code: 'invite-invalid' })],
    ['invite-expired', rpcError(-32602, { code: 'invite-expired' })],
    ['invite-used', rpcError(-32602, { code: 'invite-used' })],
    ['invite-revoked', rpcError(-32602, { code: 'invite-revoked' })],
    ['machine-update-required', rpcError(-32603, { code: 'machine-update-required' })],
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

  it('lists the routes the backend tried when the machine is unreachable', async () => {
    request.mockRejectedValueOnce(
      rpcError(-32603, {
        code: 'machine-unreachable',
        attempts: [
          { route: '192.0.2.20:7443', error: 'node-link-connect-timeout' },
          { route: 'tailcat', error: 'node-link-certificate-mismatch' },
          { bogus: true },
        ],
      }),
    );
    const links = invites();
    const held = links.inspect(LINK);
    if (!held.ok) throw new Error('not held');
    await expect(links.claim(held.pendingId, client())).resolves.toEqual({
      ok: false,
      code: 'machine-unreachable',
      routes: ['192.0.2.20:7443', 'tailcat'],
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
