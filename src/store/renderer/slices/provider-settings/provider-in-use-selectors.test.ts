import { afterEach, describe, it, expect } from 'vitest';
import { getLocale, overwriteGetLocale } from '$shared/paraglide/runtime.js';
import type { Specialist } from '$lib/constants/specialists';
import { selectProviderInUseReason, selectProviderInUseReasons } from './provider-in-use-selectors';
import { initialState as specialistsInitialState } from '../specialists/specialists-slice';
import { initialState as modelInitialState } from '../model/model-slice';
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '../provider-catalog/provider-catalog-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { CustomSpecialist, FileSpecialist } from '../specialists/specialists-slice';
import type { StoreState } from '../../types';

const providerCatalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

const originalGetLocale = getLocale;
afterEach(() => overwriteGetLocale(originalGetLocale));

function fileSpecialist(overrides: Partial<FileSpecialist> & { id: string }): FileSpecialist {
  return {
    name: overrides.id,
    description: 'test specialist',
    model: '',
    behaviorPrompt: 'prompt',
    filePath: `/tmp/${overrides.id}.md`,
    source: 'user',
    ...overrides,
  };
}

function mockState({
  activeProviderId = 'auggie',
  providerModels = {},
  fileSpecialists = [],
  bundledSpecialists = [],
  customSpecialists = [],
  isGitHubAuthenticated = false,
}: {
  activeProviderId?: string;
  providerModels?: Record<string, string>;
  fileSpecialists?: FileSpecialist[];
  bundledSpecialists?: Specialist[];
  customSpecialists?: CustomSpecialist[];
  isGitHubAuthenticated?: boolean;
} = {}): StoreState {
  return {
    providerCatalog,
    providerSettings: { enabledProviders: {} },
    model: { ...modelInitialState, defaultProviderId: activeProviderId, providerModels },
    specialists: {
      ...specialistsInitialState,
      fileSpecialists: createCollection('id', fileSpecialists),
      bundledSpecialists,
      customSpecialists: createCollection('id', customSpecialists),
    },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: isGitHubAuthenticated },
  } as unknown as StoreState;
}

describe('provider in-use selectors', () => {
  describe('specialist pin provenance', () => {
    it('retains every specialist pin alongside the global model reason', () => {
      const reason = selectProviderInUseReason.select(
        mockState({
          activeProviderId: 'codex',
          providerModels: { codex: 'global-model' },
          fileSpecialists: [
            fileSpecialist({
              id: 'user-pin',
              name: 'User pin',
              source: 'user',
              filePath: '/home/test user/.intent/specialists/user-pin.md',
              codingAgent: 'codex',
            }),
            fileSpecialist({
              id: 'project-pin',
              name: 'Project pin',
              source: 'project',
              filePath: '/repo/.intent/specialists/project-pin.md',
              model: 'codex:project-model',
            }),
          ],
        }),
        'codex',
      );
      expect(reason).toContain('global-model');
      expect(reason).toContain('User pin');
      expect(reason).toContain('User');
      expect(reason).toContain('/home/test user/.intent/specialists/user-pin.md');
      expect(reason).toContain('Project pin');
      expect(reason).toContain('Project');
      expect(reason).toContain('/repo/.intent/specialists/project-pin.md');
      expect(reason).toContain('codex:project-model');
    });

    it('retains both explicit pin kinds and their original provider resolution', () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: 'split', codingAgent: 'codex', model: 'claude-code:sonnet' }),
          fileSpecialist({ id: 'both', codingAgent: 'codex', model: 'codex:second-model' }),
        ],
      });
      const codexReason = selectProviderInUseReason.select(state, 'codex');
      expect(codexReason).toContain('split');
      expect(codexReason).toContain('both');
      expect(codexReason).toContain('coding agent');
      expect(codexReason).toContain('codex:second-model');
      expect(selectProviderInUseReason.select(state, 'claude-code')).toContain('/tmp/split.md');
      expect(selectProviderInUseReason.select(state, 'auggie')).toBeNull();
    });

    it('distinguishes same-name pins by their exact source paths', () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: 'first', name: 'Same name', codingAgent: 'codex' }),
          fileSpecialist({ id: 'second', name: 'Same name', codingAgent: 'codex' }),
        ],
      });
      const reason = selectProviderInUseReason.select(state, 'codex');
      expect(reason).toContain('/tmp/first.md');
      expect(reason).toContain('/tmp/second.md');
      expect(reason?.match(/coding agent/g)).toHaveLength(2);
    });

    it('explains a bundled pin without inventing a file path', () => {
      const bundled: Specialist = {
        id: 'bundled-pin',
        name: 'Shipped specialist',
        description: '',
        defaultBehaviorPrompt: '',
        source: 'bundled',
        codingAgent: 'codex',
      };
      const reason = selectProviderInUseReason.select(
        mockState({
          bundledSpecialists: [bundled, bundled],
        }),
        'codex',
      );
      expect(reason).toContain('Bundled');
      expect(reason?.match(/Shipped specialist/g)).toHaveLength(1);
      expect(reason).not.toContain('undefined');
      expect(reason).not.toContain('/');
    });

    it('includes a retained bundled path when the catalog has one', () => {
      const bundled: Specialist & { filePath: string } = {
        id: 'bundled-path',
        name: 'Shipped specialist',
        description: '',
        defaultBehaviorPrompt: '',
        source: 'bundled',
        codingAgent: 'codex',
        filePath: '/resources/specialists/shipped.md',
      };
      const reason = selectProviderInUseReason.select(
        mockState({
          bundledSpecialists: [bundled],
        }),
        'codex',
      );
      expect(reason).toContain('Bundled');
      expect(reason).toContain('/resources/specialists/shipped.md');
    });

    it('preserves a user pin with missing path without fabricating a location', () => {
      const reason = selectProviderInUseReason.select(
        mockState({
          fileSpecialists: [
            fileSpecialist({
              id: 'pathless',
              name: 'Pathless',
              codingAgent: 'codex',
              filePath: '',
            }),
          ],
        }),
        'codex',
      );
      expect(reason).toContain('Pathless');
      expect(reason).toContain('User');
      expect(reason).not.toContain('undefined');
      expect(reason).not.toContain('/');
    });

    it('keeps file precedence and does not expose a shadowed bundled pin', () => {
      const state = mockState({
        bundledSpecialists: [
          {
            id: 'overridden',
            name: 'Old bundle',
            description: '',
            defaultBehaviorPrompt: '',
            source: 'bundled',
            codingAgent: 'claude-code',
          },
        ],
        fileSpecialists: [
          fileSpecialist({
            id: 'overridden',
            name: 'Winning file',
            source: 'project',
            codingAgent: 'codex',
          }),
        ],
      });
      expect(selectProviderInUseReason.select(state, 'codex')).toContain('/tmp/overridden.md');
      expect(selectProviderInUseReason.select(state, 'codex')).not.toContain('Old bundle');
      expect(selectProviderInUseReason.select(state, 'claude-code')).toBeNull();
    });

    it('does not resurrect a bundled pin behind an unpinned same-ID file', () => {
      const bundled: Specialist & { filePath: string } = {
        id: 'overridden',
        name: 'Shadowed',
        description: '',
        defaultBehaviorPrompt: '',
        source: 'bundled',
        codingAgent: 'codex',
        filePath: '/resources/old.md',
      };
      const state = mockState({
        bundledSpecialists: [bundled],
        fileSpecialists: [fileSpecialist({ id: 'overridden', filePath: '/user/current.md' })],
      });
      expect(selectProviderInUseReasons.select(state)).toEqual({});
    });

    it('binds provenance to the winning file and changes it with the active catalog', () => {
      const bundled: Specialist & { filePath: string } = {
        id: 'same-id',
        name: 'Original',
        description: '',
        defaultBehaviorPrompt: '',
        source: 'bundled',
        codingAgent: 'codex',
        filePath: '/resources/original.md',
      };
      const staleCustom: CustomSpecialist = {
        id: 'same-id',
        name: 'Legacy custom',
        description: '',
        behaviorPrompt: '',
        model: 'claude-code:old-model',
        codingAgent: 'claude-code',
      };
      const state = mockState({
        bundledSpecialists: [bundled],
        customSpecialists: [staleCustom],
        fileSpecialists: [
          fileSpecialist({
            id: 'same-id',
            name: 'Override',
            source: 'project',
            codingAgent: 'codex',
            filePath: '/project/current.md',
          }),
        ],
      });
      const overridden = selectProviderInUseReason.select(state, 'codex');
      expect(overridden).toContain('/project/current.md');
      expect(overridden).not.toContain('/resources/original.md');
      expect(overridden).not.toContain('Original');
      expect(overridden).not.toContain('Legacy custom');
      expect(selectProviderInUseReason.select(state, 'claude-code')).toBeNull();
      const restored = selectProviderInUseReason.select(
        mockState({
          bundledSpecialists: [bundled],
          customSpecialists: [staleCustom],
        }),
        'codex',
      );
      expect(restored).toContain('/resources/original.md');
      expect(restored).not.toContain('/project/current.md');
      expect(restored).not.toContain('Override');
      expect(restored).not.toContain('Legacy custom');
    });

    it('orders reasons consistently when the incoming file order changes', () => {
      const files = [
        fileSpecialist({ id: 'z', name: 'Zeta', codingAgent: 'codex' }),
        fileSpecialist({ id: 'a', name: 'Alpha', codingAgent: 'codex' }),
      ];
      const first = selectProviderInUseReason.select(
        mockState({ fileSpecialists: files }),
        'codex',
      );
      const reversed = selectProviderInUseReason.select(
        mockState({
          fileSpecialists: [...files].reverse(),
        }),
        'codex',
      );
      expect(first).toBe(reversed);
      expect(first).toContain('/tmp/a.md');
      expect(first).toContain('/tmp/z.md');
      expect(first!.indexOf('Alpha')).toBeLessThan(first!.indexOf('Zeta'));
    });

    it('does not repeat indistinguishable localized reasons', () => {
      const bundled = {
        name: 'Same description',
        description: '',
        defaultBehaviorPrompt: '',
        source: 'bundled' as const,
        codingAgent: 'codex',
      };
      const reason = selectProviderInUseReason.select(
        mockState({
          bundledSpecialists: [
            { ...bundled, id: 'one' },
            { ...bundled, id: 'two' },
          ],
        }),
        'codex',
      );
      expect(reason?.match(/Same description/g)).toHaveLength(1);
    });

    it('does not invent a source label or path when neither was retained', () => {
      const reason = selectProviderInUseReason.select(
        mockState({
          bundledSpecialists: [
            {
              id: 'unknown-origin',
              name: 'Origin unavailable',
              description: '',
              defaultBehaviorPrompt: '',
              codingAgent: 'codex',
            },
          ],
        }),
        'codex',
      );
      expect(reason).toBe('In use by specialist "Origin unavailable" (coding agent)');
    });

    it('keeps the default-model-only reason unchanged', () => {
      expect(
        selectProviderInUseReason.select(
          mockState({
            activeProviderId: 'codex',
            providerModels: { codex: 'gpt-5' },
          }),
          'codex',
        ),
      ).toBe('In use by the default model (gpt-5)');
    });

    it('keeps the existing GitHub visibility boundary while including hidden explicit pins', () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: 'pr-reviewer', codingAgent: 'codex' }),
          fileSpecialist({ id: 'hidden-pin', hidden: true, codingAgent: 'claude-code' }),
        ],
      });
      expect(selectProviderInUseReason.select(state, 'codex')).toBeNull();
      expect(selectProviderInUseReason.select(state, 'claude-code')).toContain(
        '/tmp/hidden-pin.md',
      );
      expect(
        selectProviderInUseReason.select(
          mockState({
            isGitHubAuthenticated: true,
            fileSpecialists: [fileSpecialist({ id: 'pr-reviewer', codingAgent: 'codex' })],
          }),
          'codex',
        ),
      ).toContain('/tmp/pr-reviewer.md');
    });

    it('does not invent pins from implicit previews or model options', () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({
            id: 'inherited',
            resolvedProvider: 'codex',
            resolvedModel: 'gpt-5',
            modelOptions: [{ provider: 'claude-code', model: 'sonnet', hint: '' }],
          }),
        ],
      });
      expect(selectProviderInUseReasons.select(state)).toEqual({});
      expect(selectProviderInUseReason.select(mockState(), 'auggie')).toBeNull();
    });

    it.each([
      ['en', 'User', 'Project'],
      ['de', 'Benutzer', 'Projekt'],
      ['fr', 'Utilisateur', 'Projet'],
      ['es', 'Usuario', 'Proyecto'],
      ['ja', 'ユーザー', 'プロジェクト'],
      ['ko', '사용자', '프로젝트'],
      ['zh-CN', '用户', '项目'],
      ['zh-TW', '使用者', '專案'],
    ] as const)(
      'localizes %s source labels while preserving literal paths',
      (locale, user, project) => {
        overwriteGetLocale(() => locale);
        const reason = selectProviderInUseReason.select(
          mockState({
            fileSpecialists: [
              fileSpecialist({
                id: 'first',
                name: 'Alpha',
                codingAgent: 'codex',
                source: 'user',
                filePath: '/home/fixture/My specialists/{literal} & <draft>.md',
              }),
              fileSpecialist({
                id: 'second',
                name: 'Beta',
                codingAgent: 'codex',
                source: 'project',
                filePath: '/repo/.intent/specialists/第二.md',
              }),
            ],
          }),
          'codex',
        );
        expect(reason).toContain(user);
        expect(reason).toContain(project);
        expect(reason).toContain('/home/fixture/My specialists/{literal} & <draft>.md');
        expect(reason).toContain('/repo/.intent/specialists/第二.md');
        expect(reason).not.toContain('undefined');
      },
    );
  });

  describe('global default model', () => {
    it('marks the provider of a compound global model as in use', () => {
      const state = mockState({
        activeProviderId: 'opencode',
        providerModels: { opencode: 'opencode:claude-sonnet-4' },
      });
      expect(selectProviderInUseReason.select(state, 'opencode')).toContain(
        'opencode:claude-sonnet-4',
      );
    });

    it('marks the default provider as in use for a bare global model', () => {
      const state = mockState({ providerModels: { auggie: 'sonnet4.5' } });
      expect(selectProviderInUseReason.select(state, 'auggie')).toContain('sonnet4.5');
      expect(selectProviderInUseReason.select(state, 'codex')).toBeNull();
    });
  });

  describe('specialist explicit codingAgent', () => {
    it("marks a specialist's pinned coding agent as in use", () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: 'my-spec', name: 'My Spec', codingAgent: 'claude-code' }),
        ],
      });
      const reason = selectProviderInUseReason.select(state, 'claude-code');
      expect(reason).toContain('My Spec');
      expect(reason).toContain('coding agent');
    });
  });

  describe('specialist explicit model', () => {
    it('marks the provider of a specialist compound model as in use', () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({ id: 'my-spec', name: 'My Spec', model: 'codex:gpt-5.3-codex/high' }),
        ],
      });
      const reason = selectProviderInUseReason.select(state, 'codex');
      expect(reason).toContain('My Spec');
      expect(reason).toContain('codex:gpt-5.3-codex/high');
    });

    it('marks the default provider as in use for a bare specialist model', () => {
      const state = mockState({
        fileSpecialists: [fileSpecialist({ id: 'my-spec', name: 'My Spec', model: 'opus4.7' })],
      });
      expect(selectProviderInUseReason.select(state, 'auggie')).toContain('My Spec');
    });

    it('does not pin the default provider for a bare model when a coding agent is set', () => {
      const state = mockState({
        fileSpecialists: [
          fileSpecialist({
            id: 'my-spec',
            name: 'My Spec',
            model: 'sonnet',
            codingAgent: 'claude-code',
          }),
        ],
      });
      expect(selectProviderInUseReasons.select(state)['auggie']).toBeUndefined();
      expect(selectProviderInUseReason.select(state, 'claude-code')).toContain('My Spec');
    });
  });

  describe('active-provider fallback does not count as in use', () => {
    it('does not mark other providers as in use via unpinned specialists', () => {
      // Bundled/hardcoded specialists carry no explicit model or codingAgent
      // pin — they follow the active provider and must not block others.
      const state = mockState({
        activeProviderId: 'claude-code',
        providerModels: { 'claude-code': 'claude-code:sonnet' },
      });
      expect(selectProviderInUseReasons.select(state)['auggie']).toBeUndefined();
      expect(selectProviderInUseReason.select(state, 'codex')).toBeNull();
    });

    it('ignores file specialists without an explicit model or coding agent', () => {
      const state = mockState({
        activeProviderId: 'codex',
        providerModels: { codex: 'codex:gpt-5.3-codex/high' },
        fileSpecialists: [fileSpecialist({ id: 'unpinned', name: 'Unpinned' })],
      });
      expect(selectProviderInUseReasons.select(state)['auggie']).toBeUndefined();
    });
  });

  describe('not in use', () => {
    it('returns null for providers not referenced anywhere', () => {
      const state = mockState({ providerModels: { auggie: 'auggie:sonnet4.5' } });
      expect(selectProviderInUseReason.select(state, 'opencode')).toBeNull();
      expect(selectProviderInUseReason.select(state, 'droid')).toBeNull();
      expect(selectProviderInUseReason.select(state, 'grok')).toBeNull();
    });
  });
});
