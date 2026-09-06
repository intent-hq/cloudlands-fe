import { describe, it, expect } from 'vitest';

import {
  filterSpecialistsByGitHubAuth,
  filterPickableSpecialists,
  filterModalPickableSpecialists,
  selectProviderModelOverrides,
  selectOrchestratorSpecialist,
  selectSpecialists,
  selectUserOverrides,
  selectBundledSpecialists,
  selectOverridesLoaded,
  selectCustomSpecialistsLoaded,
  selectFileSpecialistsLoaded,
  selectBundledSpecialistsLoaded,
  selectSpecialistsFolderPath,
  selectHasOverrides,
  selectIsBuiltIn,
  selectEffectiveCodingAgent,
  selectEffectiveModel,
  selectExplicitModel,
  selectSpecialistName,
  selectSpecialistSourceLabel,
} from './specialists-selectors';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { initialState } from './specialists-slice';
import type { StoreState } from '../../types';
import { SPECIALISTS } from '$lib/constants/specialists';

/**
 * Create a minimal mock StoreState with specialists slice populated.
 */
function mockState(overrides: Partial<typeof initialState> = {}): StoreState {
  return {
    specialists: { ...initialState, ...overrides },
    featureCodes: { activeFeatures: [], initialized: true },
    providerSettings: { enabledProviders: {} },
    model: { defaultProviderId: 'auggie' },
    agentAvailability: {
      providerStatusMap: { auggie: { available: true } },
      providerLoadingMap: {},
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: true,
      watchedTerminalIds: [],
      npxStatus: null,
    },
    githubAuth: { isAuthenticated: false },
  } as unknown as StoreState;
}

describe('specialists selectors', () => {
  describe('selectProviderModelOverrides', () => {
    it('should return empty object from initial state', () => {
      const state = mockState();
      expect(selectProviderModelOverrides.select(state)).toEqual({});
    });

    it('should return provider model overrides', () => {
      const overrides = {
        'claude-code': { implementor: 'opus', verifier: 'sonnet' },
        auggie: { implementor: 'gpt-4' },
      };
      const state = mockState({ providerModelOverrides: overrides });
      expect(selectProviderModelOverrides.select(state)).toEqual(overrides);
    });

    it('should return the exact reference (no copy)', () => {
      const overrides = { 'claude-code': { implementor: 'opus' } };
      const state = mockState({ providerModelOverrides: overrides });
      expect(selectProviderModelOverrides.select(state)).toBe(overrides);
    });
  });

  describe('selectUserOverrides', () => {
    it('should return initial user overrides', () => {
      const state = mockState();
      expect(selectUserOverrides.select(state)).toEqual({
        codingAgentOverrides: {},
        modelOverrides: {},
        behaviorPromptOverrides: {},
      });
    });

    it('should return modified overrides', () => {
      const userOverrides = {
        modelOverrides: { implementor: 'gpt-4' },
        behaviorPromptOverrides: { 'spec-writer': 'Be concise' },
      };
      const state = mockState({ userOverrides });
      expect(selectUserOverrides.select(state)).toEqual(userOverrides);
    });
  });

  describe('selectBundledSpecialists', () => {
    it('should return empty array from initial state', () => {
      const state = mockState();
      expect(selectBundledSpecialists.select(state)).toEqual([]);
    });
  });

  describe('visibility gating', () => {
    it('should not include ralph in the shipped catalog', () => {
      const state = mockState();
      const ids = selectSpecialists.select(state).map((specialist) => specialist.id);

      expect(ids).not.toContain('ralph');
    });

    it('should hide GitHub-dependent specialists when GitHub is not authenticated', () => {
      const ids = filterSpecialistsByGitHubAuth(SPECIALISTS, false).map(
        (specialist) => specialist.id,
      );

      expect(ids).not.toContain('pr-reviewer');
    });

    it('should keep GitHub-dependent specialists when GitHub is authenticated', () => {
      const ids = filterSpecialistsByGitHubAuth(SPECIALISTS, true).map(
        (specialist) => specialist.id,
      );

      expect(ids).toContain('pr-reviewer');
    });

    it('filterSpecialistsByGitHubAuth should keep hidden specialists (Settings surface)', () => {
      const ids = filterSpecialistsByGitHubAuth(SPECIALISTS, true).map(
        (specialist) => specialist.id,
      );

      expect(ids).toContain('chief-of-staff');
    });

    it('filterPickableSpecialists should drop hidden specialists (chief-of-staff)', () => {
      const ids = filterPickableSpecialists(SPECIALISTS, true).map((specialist) => specialist.id);

      expect(ids).not.toContain('chief-of-staff');
      expect(ids).toContain('spec-writer');
    });

    it('filterPickableSpecialists should also apply GitHub gating when not authenticated', () => {
      const ids = filterPickableSpecialists(SPECIALISTS, false).map((specialist) => specialist.id);

      expect(ids).not.toContain('chief-of-staff');
      expect(ids).not.toContain('pr-reviewer');
    });

    it('filterPickableSpecialists should drop file specialists flagged hidden', () => {
      const specialists = [
        { ...SPECIALISTS[0], id: 'visible-custom', hidden: undefined },
        { ...SPECIALISTS[0], id: 'hidden-custom', hidden: true },
      ];
      const ids = filterPickableSpecialists(specialists, true).map((specialist) => specialist.id);

      expect(ids).toContain('visible-custom');
      expect(ids).not.toContain('hidden-custom');
    });

    it('filterPickableSpecialists should keep internal specialists (in-workspace picker)', () => {
      const ids = filterPickableSpecialists(SPECIALISTS, true).map((specialist) => specialist.id);

      expect(ids).toContain('implementor');
      expect(ids).toContain('verifier');
    });

    it('keeps Vulnerability Scanner pickable as a standard specialist', () => {
      const inWorkspaceIds = filterPickableSpecialists(SPECIALISTS, true).map(({ id }) => id);
      const modalIds = filterModalPickableSpecialists(SPECIALISTS, true).map(({ id }) => id);

      expect(inWorkspaceIds).toContain('vulnerability-scanner');
      expect(modalIds).toContain('vulnerability-scanner');
    });

    it('filterModalPickableSpecialists should drop internal specialists in addition to hidden', () => {
      const ids = filterModalPickableSpecialists(SPECIALISTS, true).map(
        (specialist) => specialist.id,
      );

      expect(ids).not.toContain('implementor');
      expect(ids).not.toContain('verifier');
      expect(ids).not.toContain('chief-of-staff');
      expect(ids).toContain('spec-writer');
      expect(ids).toContain('developer');
    });
  });

  describe('selectOrchestratorSpecialist', () => {
    it('finds the shipped spec-writer orchestrator in the fallback catalog', () => {
      const orchestrator = selectOrchestratorSpecialist.select(mockState());

      expect(orchestrator?.id).toBe('spec-writer');
      expect(orchestrator?.teamAgents).toEqual(['implementor', 'verifier']);
    });

    it('finds a custom orchestrator with a different id', () => {
      const state = mockState({
        fileSpecialists: createCollection('id', [
          {
            id: 'my-lead',
            name: 'My Lead',
            description: 'custom orchestrator',
            model: '',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/my-lead.md',
            source: 'user' as const,
            role: 'orchestrator' as const,
            teamAgents: ['helper'],
          },
        ]),
      });

      expect(selectOrchestratorSpecialist.select(state)?.id).toBe('my-lead');
    });

    it('prefers the bundled orchestrator over an earlier-sorting user orchestrator', () => {
      const specWriter = SPECIALISTS.find(({ id }) => id === 'spec-writer')!;
      const state = mockState({
        bundledSpecialists: [{ ...specWriter, source: 'bundled' as const }],
        fileSpecialists: createCollection('id', [
          {
            id: 'role-round-trip',
            name: 'Role Round Trip',
            description: 'custom orchestrator',
            model: '',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/role-round-trip.md',
            source: 'user' as const,
            role: 'orchestrator' as const,
          },
        ]),
      });

      expect(selectOrchestratorSpecialist.select(state)?.id).toBe('spec-writer');
    });

    it('keeps a winning user-tier spec-writer override at shipped rank', () => {
      const state = mockState({
        fileSpecialists: createCollection('id', [
          {
            id: 'spec-writer',
            name: 'Customized Coordinator',
            description: 'overridden orchestrator',
            model: '',
            behaviorPrompt: 'custom prompt',
            filePath: '/Users/test/.intent/specialists/spec-writer.md',
            source: 'user' as const,
            role: 'orchestrator' as const,
          },
          {
            id: 'role-round-trip',
            name: 'Role Round Trip',
            description: 'custom orchestrator',
            model: '',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/role-round-trip.md',
            source: 'user' as const,
            role: 'orchestrator' as const,
          },
        ]),
      });

      expect(selectOrchestratorSpecialist.select(state)).toMatchObject({
        id: 'spec-writer',
        source: 'user',
      });
    });

    it('ranks a user-tier spec-writer from specialist.list above an earlier novel id', () => {
      const state = mockState({
        bundledSpecialists: [
          {
            id: 'daemon-bundled',
            name: 'Daemon Bundled',
            description: 'another bundled specialist',
            defaultBehaviorPrompt: 'prompt',
            source: 'bundled' as const,
          },
        ],
        fileSpecialists: createCollection('id', [
          {
            id: 'spec-writer',
            name: 'Customized Coordinator',
            description: 'winning user tier from specialist.list',
            model: '',
            behaviorPrompt: 'custom prompt',
            filePath: '/Users/test/.intent/specialists/spec-writer.md',
            source: 'user' as const,
            role: 'orchestrator' as const,
          },
          {
            id: 'aaa-fixture',
            name: 'AAA Fixture',
            description: 'novel user orchestrator',
            model: '',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/aaa-fixture.md',
            source: 'user' as const,
            role: 'orchestrator' as const,
          },
        ]),
      });

      expect(selectOrchestratorSpecialist.select(state)).toMatchObject({
        id: 'spec-writer',
        source: 'user',
      });
    });

    it('returns null when no orchestrator exists (team card hidden)', () => {
      const state = mockState({
        bundledSpecialists: [
          {
            id: 'plain-one',
            name: 'Plain One',
            description: 'no role',
            defaultBehaviorPrompt: 'prompt',
            source: 'bundled' as const,
          },
        ],
      });

      expect(selectOrchestratorSpecialist.select(state)).toBeNull();
    });

    it('breaks ties within the same source rank by id order', () => {
      const orchestrator = (id: string) => ({
        id,
        name: id,
        description: 'orchestrator',
        defaultBehaviorPrompt: 'prompt',
        source: 'bundled' as const,
        role: 'orchestrator' as const,
      });
      const state = mockState({
        bundledSpecialists: [orchestrator('zeta-lead'), orchestrator('alpha-lead')],
      });

      expect(selectOrchestratorSpecialist.select(state)?.id).toBe('alpha-lead');
    });
  });

  describe('replacement mode (daemon set is authoritative)', () => {
    const replacementBundled = [
      {
        id: 'replacement-one',
        name: 'Replacement One',
        description: 'first',
        defaultBehaviorPrompt: 'prompt one',
        source: 'bundled' as const,
      },
      {
        id: 'replacement-two',
        name: 'Replacement Two',
        description: 'second',
        defaultBehaviorPrompt: 'prompt two',
        source: 'bundled' as const,
      },
    ];

    it('does not resurrect hardcoded SPECIALISTS once daemon bundled specialists loaded', () => {
      const state = mockState({ bundledSpecialists: replacementBundled });
      const ids = selectSpecialists.select(state).map((s) => s.id);

      expect(ids).toEqual(['replacement-one', 'replacement-two']);
      expect(ids).not.toContain('implementor');
      expect(ids).not.toContain('verifier');
    });

    it('does not resurrect hardcoded SPECIALISTS once file specialists loaded', () => {
      const state = mockState({
        fileSpecialists: createCollection('id', [
          {
            id: 'file-only',
            name: 'File Only',
            description: 'from file',
            model: '',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/file-only.md',
            source: 'user' as const,
          },
        ]),
      });
      const ids = selectSpecialists.select(state).map((s) => s.id);

      expect(ids).toEqual(['file-only']);
      expect(ids).not.toContain('implementor');
    });

    it('keeps the hardcoded fallback before any source has loaded', () => {
      const ids = selectSpecialists.select(mockState()).map((s) => s.id);
      expect(ids).toContain('implementor');
      expect(ids).toContain('verifier');
    });
  });

  describe('selectSpecialistName startup window (catalog fallback)', () => {
    it('resolves built-in ids from the hardcoded catalog before any source has loaded', () => {
      // Startup window: file + bundled collections are still empty.
      expect(selectSpecialistName.select(mockState(), 'implementor')).toBe(
        SPECIALISTS.find((s) => s.id === 'implementor')!.name,
      );
    });

    it('returns null for unknown ids before any source has loaded', () => {
      expect(selectSpecialistName.select(mockState(), 'my-custom-role')).toBeNull();
    });

    it('does not resurrect catalog names once daemon bundled specialists loaded', () => {
      const state = mockState({
        bundledSpecialists: [
          {
            id: 'replacement-one',
            name: 'Replacement One',
            description: 'first',
            defaultBehaviorPrompt: 'prompt one',
            source: 'bundled' as const,
          },
        ],
      });
      expect(selectSpecialistName.select(state, 'implementor')).toBeNull();
      expect(selectSpecialistName.select(state, 'replacement-one')).toBe('Replacement One');
    });
  });

  describe('collapsed built-in overrides', () => {
    const implementor = SPECIALISTS.find(({ id }) => id === 'implementor')!;

    function userFile(behaviorPrompt = `${implementor.defaultBehaviorPrompt}\nModified`) {
      return {
        id: implementor.id,
        name: implementor.name,
        description: implementor.description,
        model: '',
        behaviorPrompt,
        roleReminder: implementor.roleReminder,
        filePath: '/Users/test/.intent/specialists/implementor.md',
        source: 'user' as const,
      };
    }

    it('recognizes a shipped built-in and its differing user override without a bundled row', () => {
      const state = mockState({
        fileSpecialists: createCollection('id', [userFile()]),
      });

      expect(selectIsBuiltIn.select(state, 'implementor')).toBe(true);
      expect(selectHasOverrides.select(state, 'implementor')).toBe(true);
      expect(selectSpecialists.select(state).map(({ id }) => id)).toEqual(['implementor']);
    });

    it('uses shipped defaults to suppress an identical leftover user file', () => {
      const state = mockState({
        fileSpecialists: createCollection('id', [userFile(implementor.defaultBehaviorPrompt)]),
      });

      expect(selectIsBuiltIn.select(state, 'implementor')).toBe(true);
      expect(selectHasOverrides.select(state, 'implementor')).toBe(false);
    });

    it('does not label project-scope or custom specialists as modified built-ins', () => {
      const projectImplementor = { ...userFile(), source: 'project' as const };
      const custom = {
        id: 'custom-specialist',
        name: 'Custom Specialist',
        description: 'Custom description',
        model: '',
        behaviorPrompt: 'Custom prompt',
        filePath: '/Users/test/.intent/specialists/custom-specialist.md',
        source: 'user' as const,
      };
      const state = mockState({
        fileSpecialists: createCollection('id', [projectImplementor, custom]),
      });

      expect(selectIsBuiltIn.select(state, 'implementor')).toBe(true);
      expect(selectHasOverrides.select(state, 'implementor')).toBe(false);
      expect(selectIsBuiltIn.select(state, custom.id)).toBe(false);
      expect(selectHasOverrides.select(state, custom.id)).toBe(false);
    });
  });

  describe('hidden flag propagation through selectSpecialists', () => {
    it('should carry hidden from a file specialist into the merged list', () => {
      const state = mockState({
        bundledSpecialists: SPECIALISTS,
        fileSpecialists: createCollection('id', [
          {
            id: 'chief-of-staff',
            name: 'Chief of Staff',
            description: 'overridden',
            model: 'gpt-4',
            behaviorPrompt: 'custom prompt',
            filePath: '/Users/test/.intent/specialists/chief-of-staff.md',
            source: 'user' as const,
            hidden: true,
          },
        ]),
      });

      const merged = selectSpecialists.select(state);
      const chief = merged.find((s) => s.id === 'chief-of-staff');
      expect(chief?.hidden).toBe(true);
      // And the pickable filter drops it from the merged list too.
      const pickableIds = filterPickableSpecialists(merged, true).map((s) => s.id);
      expect(pickableIds).not.toContain('chief-of-staff');
    });
  });

  describe('source labels', () => {
    it('should label project and user file specialists distinctly', () => {
      const state = mockState({
        fileSpecialists: createCollection('id', [
          {
            id: 'repo-spec',
            name: 'Repo Specialist',
            description: 'project-level',
            model: '',
            behaviorPrompt: 'prompt',
            filePath: '/repo/.intent/specialists/repo-spec.md',
            source: 'project',
          },
          {
            id: 'user-spec',
            name: 'User Specialist',
            description: 'user-level',
            model: '',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/user-spec.md',
            source: 'user',
          },
        ]),
      });

      expect(selectSpecialistSourceLabel.select(state, 'repo-spec')).toBe('Project');
      expect(selectSpecialistSourceLabel.select(state, 'user-spec')).toBe('User');
    });

    it('should fall back to built-in label (legacy custom no longer tracked)', () => {
      const state = mockState({
        bundledSpecialists: [SPECIALISTS[0]],
        customSpecialists: createCollection('id', [
          {
            id: 'legacy-custom',
            name: 'Legacy Custom',
            description: 'legacy',
            model: 'gpt-4',
            behaviorPrompt: 'prompt',
          },
        ]),
      });

      expect(selectSpecialistSourceLabel.select(state, SPECIALISTS[0].id)).toBe('Built-in');
      // Wave 2: legacy custom specialists are no longer given a source label
      // They should have been migrated to files on startup
      expect(selectSpecialistSourceLabel.select(state, 'legacy-custom')).toBe(null);
    });
  });

  describe('loaded flag selectors', () => {
    it('selectOverridesLoaded should return false initially', () => {
      expect(selectOverridesLoaded.select(mockState())).toBe(false);
    });

    it('selectOverridesLoaded should return true when set', () => {
      expect(selectOverridesLoaded.select(mockState({ overridesLoaded: true }))).toBe(true);
    });

    it('selectCustomSpecialistsLoaded should return false initially', () => {
      expect(selectCustomSpecialistsLoaded.select(mockState())).toBe(false);
    });

    it('selectFileSpecialistsLoaded should return false initially', () => {
      expect(selectFileSpecialistsLoaded.select(mockState())).toBe(false);
    });

    it('selectBundledSpecialistsLoaded should return false initially', () => {
      expect(selectBundledSpecialistsLoaded.select(mockState())).toBe(false);
    });
  });

  describe('selectSpecialistsFolderPath', () => {
    it('should return null from initial state', () => {
      expect(selectSpecialistsFolderPath.select(mockState())).toBeNull();
    });

    it('should return path when set', () => {
      const state = mockState({ specialistsFolderPath: '/path/to/specialists' });
      expect(selectSpecialistsFolderPath.select(state)).toBe('/path/to/specialists');
    });
  });

  describe('selectSpecialists sort order', () => {
    it('should place bundled specialists first in their original order, then custom alphabetically', () => {
      // Use ALL bundled specialists so the SPECIALISTS fallback doesn't add extras
      const bundled = SPECIALISTS;
      const state = mockState({
        bundledSpecialists: bundled,
        fileSpecialists: createCollection('id', [
          {
            id: 'zebra-custom',
            name: 'Zebra Custom',
            description: 'Z specialist',
            model: 'gpt-4',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/zebra-custom.md',
            source: 'user' as const,
          },
          {
            id: 'alpha-custom',
            name: 'Alpha Custom',
            description: 'A specialist',
            model: 'gpt-4',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/alpha-custom.md',
            source: 'user' as const,
          },
        ]),
      });

      const ids = selectSpecialists.select(state).map((s) => s.id);
      // Bundled first in original order (spec-writer, implementor, verifier, ...)
      expect(ids[0]).toBe('spec-writer');
      expect(ids[1]).toBe('implementor');
      expect(ids[2]).toBe('verifier');
      // Custom at the end, sorted alphabetically by name
      const customIds = ids.filter((id) => id === 'alpha-custom' || id === 'zebra-custom');
      expect(customIds).toEqual(['alpha-custom', 'zebra-custom']);
    });

    it('keeps a collapsed built-in override in catalog order without resurrecting omitted ids', () => {
      const bundled = [
        SPECIALISTS.find((specialist) => specialist.id === 'spec-writer')!,
        SPECIALISTS.find((specialist) => specialist.id === 'verifier')!,
        {
          ...SPECIALISTS[0],
          id: 'daemon-extra',
          name: 'Daemon Extra',
        },
      ];
      const state = mockState({
        bundledSpecialists: bundled,
        fileSpecialists: createCollection('id', [
          {
            id: 'implementor',
            name: 'Implementor',
            description: 'overridden',
            model: 'gpt-4',
            behaviorPrompt: 'custom prompt',
            filePath: '/Users/test/.intent/specialists/implementor.md',
            source: 'user' as const,
          },
          {
            id: 'zebra-custom',
            name: 'Zebra Custom',
            description: 'custom',
            model: 'gpt-4',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/zebra-custom.md',
            source: 'user' as const,
          },
          {
            id: 'alpha-custom',
            name: 'Alpha Custom',
            description: 'custom',
            model: 'gpt-4',
            behaviorPrompt: 'prompt',
            filePath: '/Users/test/.intent/specialists/alpha-custom.md',
            source: 'user' as const,
          },
        ]),
      });

      const ids = selectSpecialists.select(state).map((s) => s.id);
      expect(ids).toEqual([
        'spec-writer',
        'implementor',
        'verifier',
        'daemon-extra',
        'alpha-custom',
        'zebra-custom',
      ]);
      expect(ids).not.toContain('ui-designer');
    });
  });

  describe('selectors with missing codingAgentOverrides (legacy electron-store data)', () => {
    /** Simulate old persisted data where codingAgentOverrides didn't exist yet */
    function legacyState() {
      return mockState({
        userOverrides: {
          modelOverrides: {},
          behaviorPromptOverrides: {},
        } as any,
      });
    }

    it('selectHasOverrides should return false without throwing', () => {
      const state = legacyState();
      expect(() => selectHasOverrides.select(state, 'ui-designer')).not.toThrow();
      expect(selectHasOverrides.select(state, 'ui-designer')).toBe(false);
    });

    it('selectEffectiveCodingAgent should return a fallback without throwing', () => {
      const state = {
        ...legacyState(),
        providerSettings: { enabledProviders: {} },
        model: { defaultProviderId: 'auggie' },
      } as unknown as StoreState;
      expect(() =>
        selectEffectiveCodingAgent.select(state, 'nonexistent-specialist'),
      ).not.toThrow();
      const result = selectEffectiveCodingAgent.select(state, 'nonexistent-specialist');
      expect(result).toBe('auggie');
    });
  });

  describe('selectEffectiveModel precedence (explicit model before daemon preview)', () => {
    it('returns the explicit model when a user def carries a model pin', () => {
      const userDef = {
        id: 'implementor',
        name: 'Implementor',
        description: 'Executes implementation tasks, writes code',
        model: 'claude-code:opus-custom',
        behaviorPrompt: 'You implement.',
        source: 'user',
        filePath: '/Users/test/.intent/specialists/implementor.md',
        resolvedModel: 'opus4.7',
        resolvedProvider: 'auggie',
      };
      const state = mockState({
        bundledSpecialists: SPECIALISTS,
        fileSpecialists: createCollection('id', [userDef]),
      });

      expect(selectEffectiveModel.select(state, 'implementor')).toBe('claude-code:opus-custom');
    });

    it('surfaces the daemon resolvedModel preview for inheriting specialists', () => {
      const inheritingDef = {
        id: 'inheriting-custom',
        name: 'Inheriting',
        description: 'custom inheriting specialist',
        behaviorPrompt: 'prompt',
        source: 'user',
        filePath: '/Users/test/.intent/specialists/inheriting-custom.md',
        resolvedModel: 'opus4.7',
        resolvedProvider: 'auggie',
      };
      const state = mockState({
        bundledSpecialists: SPECIALISTS,
        fileSpecialists: createCollection('id', [inheritingDef]),
      });

      expect(selectEffectiveModel.select(state, 'inheriting-custom')).toBe('opus4.7');
    });

    it('returns empty string when resolvedModel is omitted from the wire', () => {
      const cliDefaultDef = {
        id: 'cli-default-custom',
        name: 'CLI Default',
        description: 'custom provider-default specialist',
        behaviorPrompt: 'prompt',
        source: 'user',
        filePath: '/Users/test/.intent/specialists/cli-default-custom.md',
      };
      const state = mockState({
        bundledSpecialists: SPECIALISTS,
        fileSpecialists: createCollection('id', [cliDefaultDef]),
      });

      expect(selectEffectiveModel.select(state, 'cli-default-custom')).toBe('');
    });
  });

  describe('selectExplicitModel', () => {
    it('returns only the explicit frontmatter model', () => {
      const pinnedDef = {
        id: 'implementor',
        name: 'Implementor',
        description: 'Executes implementation tasks, writes code',
        model: 'claude-code:opus-custom',
        behaviorPrompt: 'You implement.',
        source: 'user',
        filePath: '/Users/test/.intent/specialists/implementor.md',
      };
      const state = mockState({
        bundledSpecialists: SPECIALISTS,
        fileSpecialists: createCollection('id', [pinnedDef]),
      });

      expect(selectExplicitModel.select(state, 'implementor')).toBe('claude-code:opus-custom');
    });

    it('returns undefined when only the daemon preview is present', () => {
      const inheritingDef = {
        id: 'implementor',
        name: 'Implementor',
        description: 'Executes implementation tasks, writes code',
        behaviorPrompt: 'You implement.',
        source: 'user',
        filePath: '/Users/test/.intent/specialists/implementor.md',
        resolvedModel: 'opus4.7',
        resolvedProvider: 'auggie',
      };
      const state = mockState({
        bundledSpecialists: SPECIALISTS,
        fileSpecialists: createCollection('id', [inheritingDef]),
      });

      expect(selectExplicitModel.select(state, 'implementor')).toBeUndefined();
      expect(selectEffectiveModel.select(state, 'implementor')).toBe('opus4.7');
    });
  });
});
