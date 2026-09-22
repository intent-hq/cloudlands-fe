import type { AgentSession } from '$shared/types';
import { describe, expect, it } from 'vitest';
import {
  agentDelegationParentOf,
  classifyAgentScope,
  isBackgroundAgentSession,
} from './agent-scope';

// Partition contract (PROTOCOL §5.5 "Row scope", agent.list `scope`):
//   topLevel   = parent_agent_id IS NULL AND is_background = 0
//   delegated  = parent_agent_id IS NOT NULL   (a background CHILD is delegated)
//   background = parent_agent_id IS NULL AND is_background <> 0
// Retired sessions are their own bin and never classify here.
const PARENT = 'agent-11111111-1111-4111-8111-111111111111';
const LEGACY_PARENT = 'agent-22222222-2222-4222-8222-222222222222';

type Row = Pick<
  AgentSession,
  'parentAgentId' | 'isBackground' | 'metadata' | 'agentMetadata' | 'parentSessionId'
>;

const row = (fields: Partial<Row> = {}): Row => ({ ...fields }) as Row;
const meta = (fields: Record<string, unknown>) => fields as AgentSession['metadata'];

describe('classifyAgentScope (§5.5 row-scope partition)', () => {
  it.each<{ name: string; agent: Row; bin: 'topLevel' | 'delegated' | 'background' }>([
    { name: 'no parent, not background', agent: row(), bin: 'topLevel' },
    {
      name: 'no parent, isBackground: false',
      agent: row({ isBackground: false }),
      bin: 'topLevel',
    },
    {
      name: 'no parent, isBackground: true',
      agent: row({ isBackground: true }),
      bin: 'background',
    },
    {
      name: 'no parent, metadata.isBackground: true',
      agent: row({ metadata: meta({ isBackground: true }) }),
      bin: 'background',
    },
    {
      name: 'parentAgentId, not background',
      agent: row({ parentAgentId: PARENT as never }),
      bin: 'delegated',
    },
    {
      name: 'parentAgentId, isBackground: true (a background CHILD is delegated)',
      agent: row({ parentAgentId: PARENT as never, isBackground: true }),
      bin: 'delegated',
    },
    {
      name: 'legacy metadata.createdByAgentId, not background',
      agent: row({ metadata: meta({ createdByAgentId: LEGACY_PARENT }) }),
      bin: 'delegated',
    },
    {
      name: 'legacy metadata.createdByAgentId, metadata.isBackground: true',
      agent: row({ metadata: meta({ createdByAgentId: LEGACY_PARENT, isBackground: true }) }),
      bin: 'delegated',
    },
    {
      name: 'legacy createdByAgentId under the alternative agentMetadata location',
      agent: row({ agentMetadata: meta({ createdByAgentId: LEGACY_PARENT }) }),
      bin: 'delegated',
    },
    {
      name: 'no parent, agentMetadata.isBackground: true',
      agent: row({ agentMetadata: meta({ isBackground: true }) }),
      bin: 'background',
    },
    {
      name: 'fork-only row (parentSessionId, no parent agent), not background',
      agent: row({ parentSessionId: PARENT }),
      bin: 'topLevel',
    },
    {
      name: 'fork-only row (parentSessionId, no parent agent), isBackground: true',
      agent: row({ parentSessionId: PARENT, isBackground: true }),
      bin: 'background',
    },
    {
      name: 'empty-string parentAgentId reads as unparented',
      agent: row({ parentAgentId: '' as never }),
      bin: 'topLevel',
    },
  ])('$name → $bin', ({ agent, bin }) => {
    expect(classifyAgentScope(agent)).toBe(bin);
    // A row is delegated iff it has a `delegatedCounts.byParent` key to count under.
    expect(classifyAgentScope(agent) === 'delegated').toBe(agentDelegationParentOf(agent) !== null);
  });

  it('ignores retiredAt — the bin is the one the row re-enters on restore', () => {
    const retired = { ...row({ isBackground: true }), retiredAt: '2026-01-01T00:00:00.000Z' };
    expect(classifyAgentScope(retired)).toBe('background');
  });
});

describe('agentDelegationParentOf (§5.5 delegatedCounts byParent key)', () => {
  it('prefers the wire parentAgentId over the legacy createdByAgentId fallback', () => {
    expect(
      agentDelegationParentOf(
        row({
          parentAgentId: PARENT as never,
          metadata: meta({ createdByAgentId: LEGACY_PARENT }),
        }),
      ),
    ).toBe(PARENT);
    expect(
      agentDelegationParentOf(row({ metadata: meta({ createdByAgentId: LEGACY_PARENT }) })),
    ).toBe(LEGACY_PARENT);
    expect(
      agentDelegationParentOf(row({ agentMetadata: meta({ createdByAgentId: LEGACY_PARENT }) })),
    ).toBe(LEGACY_PARENT);
  });

  it('is null for an unparented row — the fork marker is not a parent agent id', () => {
    expect(agentDelegationParentOf(row())).toBeNull();
    expect(agentDelegationParentOf(row({ parentSessionId: 'sess' }))).toBeNull();
    expect(agentDelegationParentOf(row({ metadata: meta({ createdByAgentId: '' }) }))).toBeNull();
  });
});

describe('isBackgroundAgentSession', () => {
  it('reads the persisted flag from either location', () => {
    expect(isBackgroundAgentSession(row())).toBe(false);
    expect(isBackgroundAgentSession(row({ isBackground: true }))).toBe(true);
    expect(isBackgroundAgentSession(row({ metadata: meta({ isBackground: true }) }))).toBe(true);
    expect(isBackgroundAgentSession(row({ metadata: meta({ isBackground: 'yes' }) }))).toBe(false);
  });
});
