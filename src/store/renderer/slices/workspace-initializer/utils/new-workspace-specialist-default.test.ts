import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_WORKSPACE_SPECIALIST_ID, SPECIALISTS } from '$lib/constants/specialists';
import type { StoreState } from '../../../types';
import { initialState as specialistsInitialState } from '../../specialists/specialists-slice';
import { initialState as workspaceInitializerInitialState } from '../workspace-initializer-slice';
import { selectNewWorkspaceDefaultSpecialist } from '../workspace-initializer-selectors';
import type { WorkspaceInitializerState } from '../workspace-initializer-types';
import {
  resolveNewWorkspaceSpecialistDefault,
  type ResolveNewWorkspaceSpecialistDefaultInput,
} from './new-workspace-specialist-default';

const ORCHESTRATOR_ID = 'spec-writer';
const specialists = [
  { id: ORCHESTRATOR_ID },
  { id: DEFAULT_NEW_WORKSPACE_SPECIALIST_ID },
  { id: 'implementor' },
];

function resolve(overrides: Partial<ResolveNewWorkspaceSpecialistDefaultInput>): string | null {
  return resolveNewWorkspaceSpecialistDefault({
    compactFormState: null,
    lastSubmittedAgent: null,
    specialists,
    orchestratorId: ORCHESTRATOR_ID,
    ...overrides,
  });
}

describe('resolveNewWorkspaceSpecialistDefault', () => {
  describe('team mode', () => {
    it('resolves to the orchestrator when the in-progress form remembers team mode', () => {
      expect(
        resolve({ compactFormState: { isTeamMode: true, selectedSpecialist: 'implementor' } }),
      ).toBe(ORCHESTRATOR_ID);
    });

    it('resolves to the orchestrator when only the last submission remembers team mode', () => {
      expect(resolve({ lastSubmittedAgent: { isTeamMode: true } })).toBe(ORCHESTRATOR_ID);
    });

    it('lets the in-progress form turn team mode off over the last submission', () => {
      expect(
        resolve({
          compactFormState: { isTeamMode: false, selectedSpecialist: 'implementor' },
          lastSubmittedAgent: { isTeamMode: true },
        }),
      ).toBe('implementor');
    });

    it('resolves to null (General) in team mode when there is no orchestrator', () => {
      expect(resolve({ compactFormState: { isTeamMode: true }, orchestratorId: null })).toBeNull();
    });
  });

  describe('single-agent mode', () => {
    it('uses the last submitted specialist when no form state is in progress', () => {
      expect(resolve({ lastSubmittedAgent: { selectedSpecialist: 'implementor' } })).toBe(
        'implementor',
      );
    });

    it('prefers the in-progress form state over the last submission', () => {
      expect(
        resolve({
          compactFormState: { selectedSpecialist: DEFAULT_NEW_WORKSPACE_SPECIALIST_ID },
          lastSubmittedAgent: { selectedSpecialist: 'implementor' },
        }),
      ).toBe(DEFAULT_NEW_WORKSPACE_SPECIALIST_ID);
    });

    it('keeps an explicit General (null) selection instead of falling through', () => {
      expect(
        resolve({
          compactFormState: { selectedSpecialist: null },
          lastSubmittedAgent: { selectedSpecialist: 'implementor' },
        }),
      ).toBeNull();
      expect(resolve({ lastSubmittedAgent: { selectedSpecialist: null } })).toBeNull();
    });

    it('falls through form state that has no specialist field to the last submission', () => {
      expect(
        resolve({
          compactFormState: { selectedModel: 'gpt' },
          lastSubmittedAgent: { selectedSpecialist: 'implementor' },
        }),
      ).toBe('implementor');
    });

    it('defaults to DEFAULT_NEW_WORKSPACE_SPECIALIST_ID when nothing is remembered and it exists', () => {
      expect(resolve({})).toBe(DEFAULT_NEW_WORKSPACE_SPECIALIST_ID);
    });

    it('defaults to null (General) when nothing is remembered and the default is unavailable', () => {
      expect(resolve({ specialists: [{ id: ORCHESTRATOR_ID }, { id: 'implementor' }] })).toBeNull();
    });

    it('falls back to null for a remembered specialist that is no longer available', () => {
      expect(resolve({ compactFormState: { selectedSpecialist: 'removed-custom' } })).toBeNull();
      expect(resolve({ lastSubmittedAgent: { selectedSpecialist: 'removed-custom' } })).toBeNull();
    });
  });
});

describe('selectNewWorkspaceDefaultSpecialist', () => {
  const catalogOrchestratorId = SPECIALISTS.find((s) => s.role === 'orchestrator')?.id;

  function mockState(workspaceInitializer: Partial<WorkspaceInitializerState>): StoreState {
    return {
      workspaceInitializer: { ...workspaceInitializerInitialState, ...workspaceInitializer },
      specialists: { ...specialistsInitialState, bundledSpecialists: SPECIALISTS },
      githubAuth: { isAuthenticated: false },
    } as unknown as StoreState;
  }

  it('resolves the remembered team mode to the orchestrator from the store', () => {
    expect(catalogOrchestratorId).toBeDefined();
    const state = mockState({ lastSubmittedAgent: { isTeamMode: true } });
    expect(selectNewWorkspaceDefaultSpecialist.select(state)).toBe(catalogOrchestratorId);
  });

  it('resolves the in-progress single-agent selection from the store', () => {
    const state = mockState({
      compactFormState: { repoPath: '/repo', isTeamMode: false, selectedSpecialist: 'implementor' },
      lastSubmittedAgent: { isTeamMode: true, selectedSpecialist: null },
    });
    expect(selectNewWorkspaceDefaultSpecialist.select(state)).toBe('implementor');
  });

  it('resolves the first-launch default from the store when nothing is remembered', () => {
    expect(selectNewWorkspaceDefaultSpecialist.select(mockState({}))).toBe(
      DEFAULT_NEW_WORKSPACE_SPECIALIST_ID,
    );
  });
});
