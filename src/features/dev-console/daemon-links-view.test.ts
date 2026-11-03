import { describe, expect, it } from 'vitest';
import type { LinkTrafficRow } from '$shared/types/daemon-links';
import { linkAgents, linkPayloadText, linkPeers, orderLinks, peerKey } from './daemon-links-view';

const mac = { kind: 'machine' as const, id: 'm-1', name: 'Mac Studio' };
const box = { kind: 'machine' as const, id: 'm-2', name: 'Build box' };
const nameless = { kind: 'backend' as const, id: 'daemon-z' };
function row(seq: number, extra: Partial<LinkTrafficRow> = {}): LinkTrafficRow {
  return {
    id: `link-${seq}`,
    seq,
    at: '',
    timestamp: seq,
    direction: 'out',
    peer: mac,
    frameType: 'journal',
    bytes: seq * 10,
    summary: `frame ${seq}`,
    hasPayload: true,
    captureStartedAt: '2026-11-03T08:00:00.000Z',
    ...extra,
  };
}
const rows = [
  row(1, { frameType: 'launch', agentId: 'agent-b', summary: 'launch agent-b' }),
  row(2, { peer: box, direction: 'in', agentId: 'agent-a', bytes: 5 }),
  row(3, { agentId: 'agent-b', requestId: 'req-42', frameType: 'request' }),
  row(4, { peer: nameless, frameType: 'hello', summary: 'handshake' }),
];
const all = { peer: '', agent: '', text: '' };

describe('daemon links view model', () => {
  it('lists each peer once by display name, falling back to its id', () => {
    expect(linkPeers(rows).map(peerKey)).toEqual([
      'machine:m-2',
      'backend:daemon-z',
      'machine:m-1',
    ]);
  });

  it('lists remote agents, optionally of one peer', () => {
    expect(linkAgents(rows)).toEqual(['agent-a', 'agent-b']);
    expect(linkAgents(rows, peerKey(mac))).toEqual(['agent-b']);
    expect(linkAgents(rows, peerKey(nameless))).toEqual([]);
  });

  it('filters by peer, remote agent and text together', () => {
    const seqs = (filters: typeof all) =>
      orderLinks(rows, filters, 'timestamp', false).map((r) => r.seq);
    expect(seqs(all)).toEqual([1, 2, 3, 4]);
    expect(seqs({ ...all, peer: peerKey(mac) })).toEqual([1, 3]);
    expect(seqs({ ...all, agent: 'agent-b' })).toEqual([1, 3]);
    expect(seqs({ ...all, peer: peerKey(box), agent: 'agent-b' })).toEqual([]);
    expect(seqs({ ...all, text: 'HANDSHAKE' })).toEqual([4]);
    expect(seqs({ ...all, text: 'req-42' })).toEqual([3]);
    expect(seqs({ ...all, text: ' launch ' })).toEqual([1]);
  });

  it('sorts by arrival, size or peer name in either direction', () => {
    expect(orderLinks(rows, all, 'timestamp', true).map((r) => r.seq)).toEqual([4, 3, 2, 1]);
    expect(orderLinks(rows, all, 'bytes', false).map((r) => r.seq)).toEqual([2, 1, 3, 4]);
    expect(orderLinks(rows, all, 'peer', false).map((r) => r.seq)).toEqual([2, 4, 1, 3]);
  });

  it('serializes the masked payload and reports an absent one', () => {
    const base = { ...row(1), payload: { env: [{ key: 'K', value: '***' }] } };
    expect(JSON.parse(linkPayloadText(base)!)).toEqual({ env: [{ key: 'K', value: '***' }] });
    expect(linkPayloadText({ ...row(2), truncated: true })).toBeNull();
  });
});
