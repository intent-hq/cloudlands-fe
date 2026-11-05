import { describe, expect, it, vi } from 'vitest';
import type { StoreState } from '../../types';
import {
  selectAgentSkillsMachine,
  selectSkills,
  selectSkillsError,
  selectSkillsLoading,
} from './skills-selectors';

const capabilities = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../principal/principal-selectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../principal/principal-selectors')>();
  return {
    ...actual,
    selectPrincipalSnapshot: {
      ...actual.selectPrincipalSnapshot,
      select: () => ({ capabilities: capabilities.value }),
    },
  };
});

describe('skills selectors', () => {
  it('selects loading and failure state for only the requested workspace', () => {
    const state = {
      skills: {
        byWorkspaceId: {
          loading: { skills: [], loading: true, error: null },
          failed: { skills: [], loading: false, error: 'skill load failed' },
        },
      },
    } as unknown as StoreState;

    expect(selectSkillsLoading.select(state, 'loading')).toBe(true);
    expect(selectSkillsError.select(state, 'loading')).toBeNull();
    expect(selectSkillsLoading.select(state, 'failed')).toBe(false);
    expect(selectSkillsError.select(state, 'failed')).toBe('skill load failed');
  });

  it('keeps an actual empty roster distinct from loading or failure', () => {
    const state = { skills: { byWorkspaceId: {} } } as unknown as StoreState;

    expect(selectSkills.select(state, 'empty')).toEqual([]);
    expect(selectSkillsLoading.select(state, 'empty')).toBe(false);
    expect(selectSkillsError.select(state, 'empty')).toBeNull();
  });

  it('names the machine of a remote agent only when the daemon supports it', () => {
    const state = {
      skills: { byWorkspaceId: {}, byAgentId: {} },
      agentSessions: {
        byAgentId: {
          remote: { nodeId: 'node-1', nodeName: 'Mac Studio' },
          unnamed: { nodeId: 'node-2' },
          local: {},
        },
      },
    } as unknown as StoreState;

    capabilities.value = { remoteAgentSkills: 1 };
    expect(selectAgentSkillsMachine.select(state, 'remote')).toBe('Mac Studio');
    expect(selectAgentSkillsMachine.select(state, 'unnamed')).toBe("this agent's machine");
    expect(selectAgentSkillsMachine.select(state, 'local')).toBeUndefined();
    expect(selectAgentSkillsMachine.select(state, '')).toBeUndefined();

    capabilities.value = {};
    expect(selectAgentSkillsMachine.select(state, 'remote')).toBeUndefined();
  });
});
