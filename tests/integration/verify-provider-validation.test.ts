import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../../src/features/agent/testing/agent-test-harness';

describe('Provider Validation Verification', () => {
  let harness: AgentTestHarness;

  beforeEach(async () => {
    harness = new AgentTestHarness({
      verbose: false,
      enableMemoryTracking: false,
      enablePerformanceTracking: false,
    });
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it('should accept valid providers', async () => {
    const validProviders = [
      'anthropic',
      'openai',
      'acp',
      'opencode',
      'claude-code',
      'codex',
      'test-provider',
    ];

    for (const provider of validProviders) {
      const agent = await harness.createAgent({
        name: `Test Agent - ${provider}`,
        provider: provider as any,
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe(`Test Agent - ${provider}`);
    }
  });

  it('should reject invalid providers', async () => {
    const invalidProviders = [
      'unknown-provider',
      'invalid',
      'google',
      'microsoft',
      'aws',
      '',
    ];

    for (const provider of invalidProviders) {
      await expect(
        harness.createAgent({
          name: 'Test Agent',
          provider: provider as any,
        }),
      ).rejects.toThrow(
        'Invalid provider: Must be one of anthropic, openai, acp, opencode, claude-code, codex, test-provider',
      );
    }
  });

  it('should allow undefined provider (uses default)', async () => {
    // When provider is undefined, it should not throw
    const agent = await harness.createAgent({
      name: 'Test Agent - No Provider',
      // provider is intentionally not specified
    });

    expect(agent).toBeDefined();
    expect(agent.name).toBe('Test Agent - No Provider');
  });

  it('should validate provider case-sensitively', async () => {
    // Provider names should be case-sensitive
    await expect(
      harness.createAgent({
        name: 'Test Agent',
        provider: 'Anthropic' as any, // Wrong case
      }),
    ).rejects.toThrow(
      'Invalid provider: Must be one of anthropic, openai, acp, opencode, claude-code, codex, test-provider',
    );

    await expect(
      harness.createAgent({
        name: 'Test Agent',
        provider: 'OPENAI' as any, // Wrong case
      }),
    ).rejects.toThrow(
      'Invalid provider: Must be one of anthropic, openai, acp, opencode, claude-code, codex, test-provider',
    );
  });
});
