import { describe, it, expect } from 'vitest';
import { isRealBridgeHealth } from '../mcp-bridge-health';

describe('isRealBridgeHealth', () => {
  it('accepts a payload with service === "http-mcp-bridge"', () => {
    expect(isRealBridgeHealth({ status: 'ok', service: 'http-mcp-bridge' })).toBe(true);
  });

  it('accepts a payload with numeric bridgeApiVersion', () => {
    expect(isRealBridgeHealth({ status: 'ok', bridgeApiVersion: 2 })).toBe(true);
    expect(isRealBridgeHealth({ bridgeApiVersion: 0 })).toBe(true);
  });

  it('accepts a payload with both fields', () => {
    expect(
      isRealBridgeHealth({ status: 'ok', service: 'http-mcp-bridge', bridgeApiVersion: 2 }),
    ).toBe(true);
  });

  it('rejects the intentd /health shape ({status, clients})', () => {
    expect(isRealBridgeHealth({ status: 'ok' } as never)).toBe(false);
    expect(isRealBridgeHealth({ status: 'ok', service: 'intentd' })).toBe(false);
  });

  it('rejects payloads with a non-numeric bridgeApiVersion', () => {
    expect(isRealBridgeHealth({ bridgeApiVersion: '2' as unknown as number })).toBe(false);
    expect(isRealBridgeHealth({ bridgeApiVersion: NaN })).toBe(false);
    expect(isRealBridgeHealth({ bridgeApiVersion: Infinity })).toBe(false);
  });

  it('rejects a wrong-service payload even when a version is missing', () => {
    expect(isRealBridgeHealth({ service: 'something-else' })).toBe(false);
  });

  it('rejects empty / nullish payloads', () => {
    expect(isRealBridgeHealth({})).toBe(false);
    expect(isRealBridgeHealth(null)).toBe(false);
    expect(isRealBridgeHealth(undefined)).toBe(false);
  });
});
