import { describe, expect, it } from 'vitest';
import type { ConnectionRecord } from '$shared/types/connections';
import { resolveTransferDestination } from './proposal-destination';
const connection = (id: string, label: string, hostname?: string): ConnectionRecord => ({
  id,
  label,
  hostname,
  host: null,
  port: null,
  fingerprint: null,
  isLocal: false,
});
const connections = [
  connection('source', 'Server'),
  connection('a', 'Laptop', 'macbook'),
  connection('b', 'Office'),
];
describe('transfer destination hints', () => {
  it('matches IDs and exact device names without case sensitivity', () => {
    expect(resolveTransferDestination(connections, 'source', 'a')).toBe('a');
    expect(resolveTransferDestination(connections, 'source', 'MACBOOK')).toBe('a');
  });
  it('never chooses an arbitrary target for absent, unknown, ambiguous or source hints', () => {
    for (const hint of [undefined, '', 'lap', 'missing', 'source', 'Server']) {
      expect(resolveTransferDestination(connections, 'source', hint)).toBe('');
    }
    expect(
      resolveTransferDestination([...connections, connection('c', 'Laptop')], 'source', 'Laptop'),
    ).toBe('');
  });
  it('uses the window backend, including when the source is remote', () => {
    expect(resolveTransferDestination(connections, 'a', 'Laptop')).toBe('');
    expect(resolveTransferDestination(connections, 'a', 'source')).toBe('source');
  });
});
