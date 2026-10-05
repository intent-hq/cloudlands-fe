import { describe, expect, it } from 'vitest';
import { mcpOptions, normalizeServerName } from './mcp-options';

describe('Figma MCP presets', () => {
  it('keeps hosted OAuth and desktop loopback as distinct configurations', () => {
    const hosted = mcpOptions.find((option) => option.label === 'Figma');
    const desktop = mcpOptions.find((option) => option.label === 'Figma Desktop');

    expect(hosted).toMatchObject({
      type: 'http',
      url: 'https://mcp.figma.com/mcp',
      authType: 'oauth',
    });
    expect(desktop).toMatchObject({
      type: 'http',
      url: 'http://127.0.0.1:3845/mcp',
      authType: 'none',
    });
    expect(normalizeServerName(hosted!.label)).toBe('figma');
    expect(normalizeServerName(desktop!.label)).toBe('figma-desktop');
  });
});
