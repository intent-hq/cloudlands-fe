import { describe, expect, it } from 'vitest';
import { formatTransportLabel } from './daemon-status-format';

describe('formatTransportLabel', () => {
  it('labels the spawned sidecar without a target', () => {
    expect(formatTransportLabel({ mode: 'sidecar-uds', target: '/tmp/i.sock' })).toBe(
      'sidecar (UDS)',
    );
  });

  it('labels an external target verbatim when the connection is direct', () => {
    expect(formatTransportLabel({ mode: 'external-uds', target: '/tmp/i.sock' })).toBe(
      'external (/tmp/i.sock)',
    );
    expect(formatTransportLabel({ mode: 'external-ws', target: 'wss:h:443' })).toBe(
      'external (wss:h:443)',
    );
    expect(
      formatTransportLabel({ mode: 'external-ws', target: 'wss:h:443', connectedVia: 'direct' }),
    ).toBe('external (wss:h:443)');
  });

  it('appends "via tailcat" when the tunnel won the connection race', () => {
    expect(
      formatTransportLabel({ mode: 'external-ws', target: 'wss:h:443', connectedVia: 'tunnel' }),
    ).toBe('external (wss:h:443 via tailcat)');
  });

  it('falls back to a generic WebSocket label without a target', () => {
    expect(formatTransportLabel({ mode: 'external-ws' })).toBe('external (WebSocket)');
  });
});
