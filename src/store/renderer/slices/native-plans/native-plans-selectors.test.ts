import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { selectHasNativePlanForAgent, selectNativePlanEntries } from './native-plans-selectors';
import type { NativePlanEntry } from './native-plans-types';

const planEntries: NativePlanEntry[] = [{ id: 'e1', title: 'Entry', status: 'pending' }];
const entries: Collection<NativePlanEntry, 'id'> = createCollection('id', planEntries);

function stateWith(
  bySessionId: Record<string, { entries: Collection<NativePlanEntry, 'id'> }>,
  agentSessions?: Record<string, { acpSessionId?: string }>,
): StoreState {
  return {
    nativePlans: { bySessionId },
    agentSessions: { byAgentId: agentSessions ?? {} },
  } as unknown as StoreState;
}

describe('native-plans selectors', () => {
  it('selectNativePlanEntries returns entries for a session and [] otherwise', () => {
    const state = stateWith({ 'acp-1': { entries } });
    expect(selectNativePlanEntries.select(state, 'acp-1')).toEqual(planEntries);
    expect(selectNativePlanEntries.select(state, 'acp-2')).toEqual([]);
  });

  it('selectHasNativePlanForAgent matches a plan keyed by the agent id', () => {
    const state = stateWith({ 'agent-1': { entries } });
    expect(selectHasNativePlanForAgent.select(state, 'agent-1')).toBe(true);
    expect(selectHasNativePlanForAgent.select(state, 'agent-2')).toBe(false);
  });

  it("selectHasNativePlanForAgent matches a plan keyed by the session's acpSessionId", () => {
    const state = stateWith(
      { 'acp-uuid-1': { entries } },
      { 'agent-1': { acpSessionId: 'acp-uuid-1' }, 'agent-2': {} },
    );
    expect(selectHasNativePlanForAgent.select(state, 'agent-1')).toBe(true);
    expect(selectHasNativePlanForAgent.select(state, 'agent-2')).toBe(false);
  });

  it('returns false for an empty agent id or empty plan store', () => {
    expect(selectHasNativePlanForAgent.select(stateWith({}), '')).toBe(false);
    expect(selectHasNativePlanForAgent.select(stateWith({}), 'agent-1')).toBe(false);
  });
});
