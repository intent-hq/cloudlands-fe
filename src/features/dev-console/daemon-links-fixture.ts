/** Synthetic daemon-link traffic for the development-only preview and browser tests. */
import type { LinkCaptureStatus, LinkPeer, LinkTrafficRecord } from '$shared/types/daemon-links';
import type { DaemonLinksApi } from './daemon-links-feed';

/**
 * `backend`: this daemon dials two machines; `machine`: two backends hold links
 * to it; `off`: supported, capture off; `unsupported`: an older daemon.
 */
export type LinksScenario = 'backend' | 'machine' | 'off' | 'unsupported';

const PEERS: Record<'backend' | 'machine', LinkPeer[]> = {
  backend: [
    { kind: 'machine', id: 'node-mac-studio', name: 'Mac Studio' },
    { kind: 'machine', id: 'node-build-box', name: 'build-box' },
  ],
  machine: [
    { kind: 'backend', id: 'daemon-intent1', name: 'intent1' },
    { kind: 'backend', id: 'daemon-lab' },
  ],
};
const FRAMES = ['launch', 'journal', 'request', 'response', 'heartbeat', 'stop'];
const MAX_RECORDS = 2000;
const MAX_PAYLOAD = 65536;

function frame(seq: number, peers: LinkPeer[]): LinkTrafficRecord {
  const peer = peers[seq % peers.length];
  const frameType = FRAMES[seq % FRAMES.length];
  const agentId = frameType === 'heartbeat' ? undefined : `agent-${(seq % 3) + 1}`;
  const requestId = frameType === 'request' || frameType === 'response' ? `r-${seq}` : undefined;
  const out = peer.kind === 'machine' ? frameType !== 'journal' : frameType === 'journal';
  const payload =
    frameType === 'launch'
      ? {
          type: 'launch',
          agentId,
          model: 'opus',
          profileEnv: {
            env: [
              { key: 'ANTHROPIC_API_KEY', value: '***' },
              { key: 'HTTPS_PROXY', value: null },
            ],
            fingerprint: 'sha256:9f2c',
          },
          prompt: 'Summarize the open review threads.',
        }
      : frameType === 'request'
        ? { type: 'request', requestId, method: 'note.read', params: { noteId: 'spec' } }
        : { type: frameType, agentId, seq };
  const oversized = seq % 17 === 0;
  return {
    seq,
    at: new Date(Date.UTC(2026, 10, 3, 8, 0, 0) + seq * 137).toISOString(),
    direction: out ? 'out' : 'in',
    peer,
    frameType,
    ...(agentId ? { agentId } : {}),
    ...(requestId ? { requestId } : {}),
    bytes: oversized ? 91_204 : 180 + ((seq * 37) % 900),
    summary:
      frameType === 'request'
        ? `note.read ${requestId}`
        : `${frameType}${agentId ? ` ${agentId}` : ''}`,
    ...(oversized ? { truncated: true } : { payload }),
  };
}

export function createLinksFixture(scenario: LinksScenario, initial = 120) {
  const peers = PEERS[scenario === 'machine' ? 'machine' : 'backend'];
  let active = scenario === 'backend' || scenario === 'machine';
  let startedAt = '2026-11-03T08:00:00.000Z';
  let records: LinkTrafficRecord[] = [];
  let nextSeq = 1;
  let evicted = 0;
  const status = (): LinkCaptureStatus => ({
    active,
    ...(active ? { startedAt } : {}),
    payloads: true,
    maxRecords: MAX_RECORDS,
    maxPayloadBytes: MAX_PAYLOAD,
    retained: records.length,
    evicted,
    dropped: active ? 3 : 0,
    oversized: records.filter((r) => r.truncated).length,
    nextSeq,
  });
  function append(count: number) {
    if (!active) return;
    for (let i = 0; i < count; i++) records.push(frame(nextSeq++, peers));
    while (records.length > MAX_RECORDS) {
      records.shift();
      evicted++;
    }
  }
  append(initial);
  const row = (record: LinkTrafficRecord) => {
    const { payload, ...rest } = record;
    return {
      ...rest,
      id: `link-${record.seq}`,
      timestamp: Date.parse(record.at),
      hasPayload: payload !== undefined,
    };
  };
  const api: DaemonLinksApi = {
    status: async () => ({ supported: scenario !== 'unsupported' }),
    start: async () => {
      if (!active) {
        active = true;
        startedAt = new Date().toISOString();
        records = [];
        nextSeq = 1;
        evicted = 0;
        append(12);
      }
      return status();
    },
    stop: async () => {
      active = false;
      records = [];
      return status();
    },
    read: async (afterSeq) => ({
      capture: status(),
      records: records.filter((r) => r.seq > afterSeq).map(row),
    }),
    record: async (seq) => records.find((r) => r.seq === seq) ?? null,
  };
  return { api, append };
}
