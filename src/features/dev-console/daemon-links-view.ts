import type { LinkPeer, LinkTrafficRecord, LinkTrafficRow } from '$shared/types/daemon-links';

export type LinkColumn =
  'timestamp' | 'direction' | 'peer' | 'frameType' | 'agentId' | 'bytes' | 'summary';

export interface LinkFilters {
  /** `peerKey` of one peer, or '' for all. */
  peer: string;
  /** One remote agent id, or '' for all. */
  agent: string;
  /** Case-insensitive match on frame type, summary or request id. */
  text: string;
}

export const peerKey = (peer: LinkPeer) => `${peer.kind}:${peer.id}`;
export const peerName = (peer: LinkPeer) => peer.name || peer.id;

/** Peers seen in the retained rows, by name. */
export function linkPeers(rows: LinkTrafficRow[]): LinkPeer[] {
  const peers = new Map<string, LinkPeer>();
  for (const row of rows) peers.set(peerKey(row.peer), row.peer);
  return [...peers.values()].sort(
    (a, b) => peerName(a).localeCompare(peerName(b)) || a.id.localeCompare(b.id),
  );
}

/** Remote agents named by the retained rows (optionally of one peer). */
export function linkAgents(rows: LinkTrafficRow[], peer = ''): string[] {
  const agents = new Set<string>();
  for (const row of rows)
    if (row.agentId && (!peer || peerKey(row.peer) === peer)) agents.add(row.agentId);
  return [...agents].sort((a, b) => a.localeCompare(b));
}

/** Table tint stream, matching the app traffic table's outbound / inbound colours. */
export const linkStream = (row: LinkTrafficRow) =>
  row.direction === 'out' ? 'outbound' : 'inbound';

export function orderLinks(
  rows: LinkTrafficRow[],
  filters: LinkFilters,
  column: LinkColumn,
  descending: boolean,
) {
  const needle = filters.text.trim().toLocaleLowerCase();
  const value = (row: LinkTrafficRow): string | number => {
    switch (column) {
      case 'timestamp':
        return row.seq;
      case 'bytes':
        return row.bytes;
      case 'peer':
        return peerName(row.peer);
      case 'agentId':
        return row.agentId ?? '';
      default:
        return row[column];
    }
  };
  return rows
    .filter(
      (row) =>
        (!filters.peer || peerKey(row.peer) === filters.peer) &&
        (!filters.agent || row.agentId === filters.agent) &&
        (!needle ||
          [row.frameType, row.summary, row.requestId ?? ''].some((field) =>
            field.toLocaleLowerCase().includes(needle),
          )),
    )
    .sort((a, b) => {
      const av = value(a),
        bv = value(b);
      const comparison =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true }) || a.seq - b.seq;
      return descending ? -comparison : comparison;
    });
}

/** The masked frame as captured: compact JSON, pretty-printed by the payload viewer. */
export function linkPayloadText(record: LinkTrafficRecord): string | null {
  if (record.payload === undefined) return null;
  try {
    return JSON.stringify(record.payload) ?? null;
  } catch {
    return null;
  }
}
