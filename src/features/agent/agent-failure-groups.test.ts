import { describe, expect, it } from 'vitest';

import type { AgentFailureEntry } from './agent-failure-registry';
import {
  classifyAgentFailure,
  groupAgentFailures,
  switchRowsForMembers,
  type FailureClassifier,
} from './agent-failure-groups';

function entry(overrides: Partial<AgentFailureEntry> & { agentId: string }): AgentFailureEntry {
  return { workspaceId: 'ws-1', error: 'boom', at: 1, ...overrides };
}

const authPattern = (_provider: string, _model: string | null | undefined, error: string) =>
  error.includes('not authenticated');
const classify: FailureClassifier = (e) => classifyAgentFailure(e, authPattern);

describe('classifyAgentFailure', () => {
  it('classifies quota by the event provider, falling back to the session provider', () => {
    expect(
      classify(
        entry({
          agentId: 'a',
          errorCode: 'quota-exceeded',
          eventProviderId: 'claude-code@work',
          provider: 'claude-code',
        }),
      ),
    ).toEqual({ kind: 'quota', providerRef: 'claude-code@work', baseProviderId: 'claude-code' });
    expect(
      classify(entry({ agentId: 'a', errorCode: 'quota-exceeded', provider: 'codex' })),
    ).toEqual({ kind: 'quota', providerRef: 'codex', baseProviderId: 'codex' });
  });

  it('leaves a quota failure with no known provider ungrouped', () => {
    expect(classify(entry({ agentId: 'a', errorCode: 'quota-exceeded' }))).toBeNull();
  });

  it('classifies sign-in errors by the session provider only', () => {
    expect(
      classify(
        entry({ agentId: 'a', provider: 'claude-code', error: 'claude-code is not authenticated' }),
      ),
    ).toEqual({ kind: 'auth', providerRef: 'claude-code', baseProviderId: 'claude-code' });
    expect(classify(entry({ agentId: 'a', error: 'claude-code is not authenticated' }))).toBeNull();
  });

  it('does not group other failures', () => {
    expect(
      classify(entry({ agentId: 'a', provider: 'claude-code', error: 'spawn failed' })),
    ).toBeNull();
  });
});

describe('groupAgentFailures', () => {
  it('groups two or more agents by base provider and kind; others stay single', () => {
    const entries = [
      entry({ agentId: 'q1', errorCode: 'quota-exceeded', eventProviderId: 'claude-code', at: 1 }),
      entry({
        agentId: 'q2',
        errorCode: 'quota-exceeded',
        eventProviderId: 'claude-code@work',
        at: 2,
      }),
      entry({ agentId: 'q3', errorCode: 'quota-exceeded', eventProviderId: 'codex', at: 3 }),
      entry({ agentId: 'a1', provider: 'claude-code', error: 'not authenticated', at: 4 }),
      entry({ agentId: 'o1', provider: 'claude-code', error: 'spawn failed', at: 5 }),
    ];
    const { groups, singles } = groupAgentFailures(entries, classify);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'quota:claude-code',
      kind: 'quota',
      baseProviderId: 'claude-code',
    });
    expect(groups[0].members.map((m) => m.agentId)).toEqual(['q1', 'q2']);
    expect(singles.map((s) => s.agentId)).toEqual(['q3', 'a1', 'o1']);
  });

  it('separates quota and sign-in groups for the same provider', () => {
    const entries = [
      entry({ agentId: 'q1', errorCode: 'quota-exceeded', eventProviderId: 'claude-code' }),
      entry({ agentId: 'q2', errorCode: 'quota-exceeded', eventProviderId: 'claude-code' }),
      entry({ agentId: 'a1', provider: 'claude-code', error: 'not authenticated' }),
      entry({ agentId: 'a2', provider: 'claude-code', error: 'not authenticated' }),
    ];
    const { groups, singles } = groupAgentFailures(entries, classify);
    expect(groups.map((g) => g.key)).toEqual(['quota:claude-code', 'auth:claude-code']);
    expect(singles).toEqual([]);
  });
});

describe('switchRowsForMembers', () => {
  it('makes one row per failed provider reference and model', () => {
    const members = [
      entry({
        agentId: 'a',
        errorCode: 'quota-exceeded',
        eventProviderId: 'claude-code',
        model: 'opus',
      }),
      entry({
        agentId: 'b',
        errorCode: 'quota-exceeded',
        eventProviderId: 'claude-code',
        model: 'opus',
      }),
      entry({
        agentId: 'c',
        errorCode: 'quota-exceeded',
        eventProviderId: 'claude-code',
        model: 'fable',
      }),
      entry({
        agentId: 'd',
        errorCode: 'quota-exceeded',
        eventProviderId: 'claude-code@work',
        model: 'opus',
      }),
    ];
    const rows = switchRowsForMembers(members, classify);
    expect(rows.map((r) => [r.providerRef, r.model, r.agentIds])).toEqual([
      ['claude-code', 'opus', ['a', 'b']],
      ['claude-code', 'fable', ['c']],
      ['claude-code@work', 'opus', ['d']],
    ]);
  });
});
