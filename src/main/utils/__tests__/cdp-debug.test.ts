import { describe, expect, it } from 'vitest';
import { isCdpMcpBridgeEnabled } from '../cdp-debug';

describe('isCdpMcpBridgeEnabled', () => {
  it('keeps the self-connecting bridge disabled for normal CDP development', () => {
    expect(isCdpMcpBridgeEnabled({ NODE_ENV: 'development', ENABLE_CDP_DEBUG: 'true' })).toBe(
      false,
    );
  });

  it('requires an explicit bridge opt-in', () => {
    expect(
      isCdpMcpBridgeEnabled({
        NODE_ENV: 'development',
        ENABLE_CDP_DEBUG: 'true',
        ENABLE_CDP_MCP_BRIDGE: 'true',
      }),
    ).toBe(true);
  });

  it('never enables the bridge outside development', () => {
    expect(
      isCdpMcpBridgeEnabled({
        NODE_ENV: 'production',
        ENABLE_CDP_DEBUG: 'true',
        ENABLE_CDP_MCP_BRIDGE: 'true',
      }),
    ).toBe(false);
  });
});
