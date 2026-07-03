/**
 * AUDIT-P0-2 tests for `resolveProviderCapabilities`.
 *
 * Locks in the contract that a malformed OPENCODE_CONFIG_CONTENT must
 * propagate the JSON.parse error instead of silently falling back to
 * `default`. The previous implementation swallowed parse errors and
 * shipped a misleading capability snapshot to consumers.
 */

import { describe, it, expect } from 'vitest';
import type { AgentConfig } from '../base-provider';
import { resolveProviderCapabilities } from '../provider-capabilities';

describe('resolveProviderCapabilities (AUDIT-P0-2)', () => {
  it('uses default_agent from a well-formed OPENCODE_CONFIG_CONTENT', () => {
    const config = {
      provider: 'opencode',
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ default_agent: 'custom-agent' }),
      },
    } as unknown as AgentConfig;

    const caps = resolveProviderCapabilities(config);
    expect(caps.defaultAgent).toBe('custom-agent');
  });

  it('uses defaultAgent (camelCase) when present', () => {
    const config = {
      provider: 'opencode',
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ defaultAgent: 'camel-agent' }),
      },
    } as unknown as AgentConfig;

    expect(resolveProviderCapabilities(config).defaultAgent).toBe('camel-agent');
  });

  it('falls back to `default` when OPENCODE_CONFIG_CONTENT is absent', () => {
    const config = { provider: 'opencode', env: {} } as unknown as AgentConfig;
    expect(resolveProviderCapabilities(config).defaultAgent).toBe('default');
  });

  it('lets a malformed OPENCODE_CONFIG_CONTENT propagate JSON.parse errors (AUDIT-P0-2)', () => {
    // Previously the try/catch swallowed this and returned 'default',
    // hiding a real provider misconfiguration. Callers must now see the
    // failure so they can surface it.
    const config = {
      provider: 'opencode',
      env: { OPENCODE_CONFIG_CONTENT: '{not valid json' },
    } as unknown as AgentConfig;

    expect(() => resolveProviderCapabilities(config)).toThrow(SyntaxError);
  });
});
