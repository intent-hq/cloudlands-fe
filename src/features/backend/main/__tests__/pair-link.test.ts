import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/paraglide/messages.js', () => ({ m: {} }));

import { AuthRejectedError, PinMismatchError } from '../backend-connection';
import { createPairLinks, type PairLinkDeps } from '../pair-link';

const TOKEN = 'owner-secret-token';
const LINK = `intent://pair?v=1&host=192.0.2.20,10.0.0.4&port=7443&fp=AA%3ABB&token=${TOKEN}&tc=tc-node.example`;
const NODE_LINK = `${LINK}&mode=node`;

const owner = { principal: { id: 'p1', isAdministrator: true } };

function deps(overrides: Partial<PairLinkDeps> = {}): PairLinkDeps & {
  add: ReturnType<typeof vi.fn>;
} {
  return {
    inspect: vi
      .fn()
      .mockResolvedValue({ snapshot: owner, daemonMode: 'regular', name: 'Build box' }),
    findMatching: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockImplementation(async (conn) => ({ id: 'c-new', ...conn, isLocal: false })),
    isInvitation: vi.fn().mockReturnValue(false),
    compatibilityMessage: vi.fn().mockReturnValue(null),
    now: () => 1_000,
    ...overrides,
  } as never;
}

describe('pair links', () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it('rejects text that is not a pair link', async () => {
    await expect(createPairLinks(d).inspect('hello')).resolves.toEqual({
      ok: false,
      code: 'not-a-link',
    });
    expect(d.inspect).not.toHaveBeenCalled();
  });

  it('rejects an incomplete link without connecting', async () => {
    const result = await createPairLinks(d).inspect('intent://pair?v=1&host=h&port=1&fp=AA');
    expect(result).toEqual({ ok: false, code: 'incomplete' });
    expect(d.inspect).not.toHaveBeenCalled();
  });

  it('classifies a full daemon as a machine named from host.status', async () => {
    const result = await createPairLinks(d).inspect(LINK);
    expect(result).toMatchObject({
      ok: true,
      kind: 'machine',
      label: 'Build box',
      existingId: null,
    });
    expect(d.inspect).toHaveBeenCalledWith(
      expect.objectContaining({ host: '192.0.2.20', port: 7443, tcAddress: 'tc-node.example' }),
    );
  });

  it('classifies a reported node as a node', async () => {
    d = deps({
      inspect: vi.fn().mockResolvedValue({ snapshot: owner, daemonMode: 'node', name: null }),
    });
    const result = await createPairLinks(d).inspect(LINK);
    expect(result).toMatchObject({ ok: true, kind: 'node', label: '192.0.2.20' });
  });

  it('trusts the reported mode over the link hint', async () => {
    const result = await createPairLinks(d).inspect(NODE_LINK);
    expect(result).toMatchObject({ ok: true, kind: 'machine' });
  });

  it('falls back to the link hint only when the mode stays unknown', async () => {
    d = deps({
      inspect: vi.fn().mockResolvedValue({ snapshot: owner, daemonMode: null, name: null }),
    });
    await expect(createPairLinks(d).inspect(NODE_LINK)).resolves.toMatchObject({ kind: 'node' });
    await expect(createPairLinks(d).inspect(LINK)).resolves.toMatchObject({ kind: 'machine' });
  });

  it('reports the saved connection a link matches', async () => {
    d = deps({ findMatching: vi.fn().mockResolvedValue({ id: 'c-old', fingerprint: 'aa:bb' }) });
    await expect(createPairLinks(d).inspect(LINK)).resolves.toMatchObject({ existingId: 'c-old' });
  });

  it('maps a refused token, a changed certificate and an invitation', async () => {
    d = deps({ inspect: vi.fn().mockRejectedValue(new AuthRejectedError(401)) });
    await expect(createPairLinks(d).inspect(LINK)).resolves.toEqual({
      ok: false,
      code: 'rejected',
    });
    d = deps({ inspect: vi.fn().mockRejectedValue(new PinMismatchError('AA:BB', 'CC:DD')) });
    await expect(createPairLinks(d).inspect(LINK)).resolves.toEqual({
      ok: false,
      code: 'certificate',
    });
    d = deps({ isInvitation: vi.fn().mockReturnValue(true) });
    await expect(createPairLinks(d).inspect(LINK)).resolves.toEqual({
      ok: false,
      code: 'not-owner',
    });
  });

  it('maps an old daemon to incompatible with its localized message', async () => {
    const error = new Error('too old');
    d = deps({
      inspect: vi.fn().mockRejectedValue(error),
      compatibilityMessage: vi.fn((e) => (e === error ? 'Update Build box' : null)),
    });
    await expect(createPairLinks(d).inspect(LINK)).resolves.toEqual({
      ok: false,
      code: 'incompatible',
      message: 'Update Build box',
    });
  });

  it('lists every route tried when nothing answers, never the token', async () => {
    d = deps({ inspect: vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${TOKEN}`)) });
    const result = await createPairLinks(d).inspect(LINK);
    expect(result).toEqual({
      ok: false,
      code: 'unreachable',
      routes: ['192.0.2.20:7443', '10.0.0.4:7443', 'tc-node.example'],
    });
  });

  it('commits a pending link once, with the detected mode and the token', async () => {
    d = deps({
      inspect: vi.fn().mockResolvedValue({ snapshot: owner, daemonMode: 'node', name: 'GPU rig' }),
    });
    const links = createPairLinks(d);
    const inspected = await links.inspect(LINK);
    expect(JSON.stringify(inspected)).not.toContain(TOKEN);
    if (!inspected.ok) throw new Error('expected ok');
    const committed = await links.commit(inspected.pendingId);
    expect(committed).toMatchObject({ ok: true, connection: { id: 'c-new' } });
    expect(d.add).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'GPU rig',
        host: '192.0.2.20',
        port: 7443,
        fingerprint: 'AA:BB',
        token: TOKEN,
        tcAddress: 'tc-node.example',
        daemonMode: 'node',
      }),
    );
    await expect(links.commit(inspected.pendingId)).resolves.toEqual({
      ok: false,
      code: 'expired',
    });
  });

  it('keeps the saved label when a link re-pairs a known connection', async () => {
    d = deps({
      findMatching: vi
        .fn()
        .mockResolvedValue({ id: 'c-old', label: 'My rig', fingerprint: 'AA:BB' }),
    });
    const links = createPairLinks(d);
    const inspected = await links.inspect(LINK);
    if (!inspected.ok) throw new Error('expected ok');
    expect(inspected.label).toBe('My rig');
    await links.commit(inspected.pendingId);
    expect(d.add).toHaveBeenCalledWith(expect.objectContaining({ label: 'My rig' }));
  });

  it('does not treat a same-address daemon with another certificate as the saved one', async () => {
    d = deps({
      findMatching: vi.fn().mockResolvedValue({ id: 'c-old', label: 'Old', fingerprint: 'CC:DD' }),
    });
    await expect(createPairLinks(d).inspect(LINK)).resolves.toMatchObject({
      existingId: null,
      label: 'Build box',
    });
  });

  it('holds an already tested link: a mode=node hint counts when the mode is unknown', async () => {
    d = deps({
      findMatching: vi
        .fn()
        .mockResolvedValue({ id: 'c-old', label: 'My rig', fingerprint: 'AA:BB' }),
    });
    const links = createPairLinks(d);
    const held = await links.hold({
      hosts: ['192.0.2.20'],
      port: 7443,
      fingerprint: 'AA:BB',
      token: TOKEN,
      tcAddress: null,
      modeHint: 'node',
      daemonMode: null,
      name: 'GPU rig',
    });
    expect(held).toMatchObject({ ok: true, kind: 'node', label: 'My rig', existingId: 'c-old' });
    expect(JSON.stringify(held)).not.toContain(TOKEN);
    expect(d.inspect).not.toHaveBeenCalled();
    await links.commit(held.pendingId);
    expect(d.add).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, daemonMode: 'node' }),
    );
  });

  it('does not save a discarded or expired link', async () => {
    let now = 1_000;
    d = deps({ now: () => now });
    const links = createPairLinks(d);
    const first = await links.inspect(LINK);
    const second = await links.inspect(LINK);
    if (!first.ok || !second.ok) throw new Error('expected ok');
    links.discard(first.pendingId);
    await expect(links.commit(first.pendingId)).resolves.toEqual({ ok: false, code: 'expired' });
    now += 10 * 60_000 + 1;
    await expect(links.commit(second.pendingId)).resolves.toEqual({ ok: false, code: 'expired' });
    expect(d.add).not.toHaveBeenCalled();
  });

  it('reports a failed save', async () => {
    d = deps({ add: vi.fn().mockRejectedValue(new Error('disk full')) });
    const links = createPairLinks(d);
    const inspected = await links.inspect(LINK);
    if (!inspected.ok) throw new Error('expected ok');
    await expect(links.commit(inspected.pendingId)).resolves.toEqual({ ok: false, code: 'failed' });
  });
});
