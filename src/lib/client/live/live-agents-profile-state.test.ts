import { describe, expect, it } from 'vitest';
import { normalizeAgent } from './live-agents-client';

// §5.54 additive AgentLite fields: presence-detected on the wire.
const row = (extra: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  workspaceId: 'ws-1',
  name: 'Agent',
  status: 'idle',
  provider: 'codex@pwork00000001',
  ...extra,
});

describe('normalizeAgent profile state (§5.54)', () => {
  it('keeps the profile reference as the agent provider', () => {
    expect(normalizeAgent(row()).provider).toBe('codex@pwork00000001');
  });

  it('reads Using earlier settings and the replacement requirement when present', () => {
    const agent = normalizeAgent(
      row({
        usingEarlierProfileSettings: true,
        providerReplacementRequired: {
          providerRef: 'codex@pwork00000001',
          reason: 'profile-missing',
        },
      }),
    );
    expect(agent.usingEarlierProfileSettings).toBe(true);
    expect(agent.providerReplacementRequired).toEqual({
      providerRef: 'codex@pwork00000001',
      reason: 'profile-missing',
    });
  });

  it('clears both states when a later row omits them', () => {
    const stale = normalizeAgent(
      row({
        usingEarlierProfileSettings: true,
        providerReplacementRequired: {
          providerRef: 'codex@pwork00000001',
          reason: 'provider-disabled',
        },
      }),
    );
    // A merge of the newer row over the stored session must drop the flags.
    const merged = { ...stale, ...normalizeAgent(row()) };
    expect(merged.usingEarlierProfileSettings).toBeUndefined();
    expect(merged.providerReplacementRequired).toBeUndefined();
  });

  it('reads an undocumented replacement shape as absent', () => {
    for (const value of [
      { providerRef: 'codex@pwork00000001', reason: 'something-else' },
      { reason: 'profile-missing' },
      'profile-missing',
    ]) {
      expect(
        normalizeAgent(row({ providerReplacementRequired: value })).providerReplacementRequired,
      ).toBeUndefined();
    }
  });
});
