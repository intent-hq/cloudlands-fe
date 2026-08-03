import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { StoreState } from '$store/renderer/types';
import type { ProviderAvailabilityResult } from '$features/providers/provider-availability.client';

interface MockSpecialist {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  defaultModel?: string;
  defaultModelTier?: 'fast' | 'balanced' | 'smart';
  defaultBehaviorPrompt?: string;
}

const mockState = vi.hoisted(() => ({
  availability: {
    hasAnyProvider: true,
    providers: {
      auggie: { available: true, authenticated: true },
      claudeCode: { available: false, authenticated: undefined as boolean | undefined },
      codex: { available: false, authenticated: undefined as boolean | undefined },
      cortex: { available: false, authenticated: undefined as boolean | undefined },
      opencode: { available: false, authenticated: undefined as boolean | undefined },
      droid: { available: false, authenticated: undefined as boolean | undefined },
      grok: { available: false, authenticated: undefined as boolean | undefined },
      mock: { available: false, authenticated: undefined as boolean | undefined },
      pi: { available: false, authenticated: undefined as boolean | undefined },
    },
    hiddenProviders: [] as string[],
  } as ProviderAvailabilityResult,
  activeProviderId: 'auggie',
  selectedModel: '',
  selectedModelByProvider: {} as Record<string, string>,
  availableModels: [] as Array<{ value: string; label: string; description?: string }>,
  modelsByProvider: {} as Record<string, Array<{ value: string; label: string; description?: string }>>,
  userOverrides: { modelOverrides: {} as Record<string, string> },
  specialists: [
    {
      id: 'spec-writer',
      name: 'Coordinator',
      description: 'Plans work',
      defaultModelTier: 'smart' as const,
      defaultBehaviorPrompt: 'coordinator-prompt',
    },
  ] as MockSpecialist[],
}));

vi.mock('$features/providers/provider-availability.client', () => ({
  getProviderAvailability: vi.fn(() => Promise.resolve(mockState.availability)),
}));

function makeSelector<R, A extends unknown[]>(fn: (...args: A) => R) {
  const s = ((..._args: unknown[]) => undefined) as unknown as {
    (..._args: unknown[]): unknown;
    select: (state: StoreState, ...args: A) => R;
    effect: (...args: A) => unknown;
    withStore: () => unknown;
  };
  s.select = (_state, ...args: A) => fn(...args);
  s.effect = () => undefined;
  s.withStore = () => s;
  return s;
}

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: makeSelector(() => mockState.activeProviderId),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: makeSelector(() => mockState.specialists),
  selectEffectiveBehaviorPrompt: makeSelector((_specialistId: string) =>
    mockState.specialists[0]?.defaultBehaviorPrompt ?? '',
  ),
  selectUserOverrides: makeSelector(() => mockState.userOverrides),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: makeSelector(
    (providerId?: string) =>
      (providerId ? mockState.selectedModelByProvider[providerId] : undefined) ??
      mockState.selectedModel,
  ),
  selectAvailableModels: makeSelector(() => mockState.availableModels),
}));

vi.mock('$store/renderer/slices/model/model-utils', () => ({
  getModelsForProvider: vi.fn((providerId: string) =>
    Promise.resolve(mockState.modelsByProvider[providerId] ?? []),
  ),
}));

vi.mock('$store/renderer/slices/model/model-slice', () => ({
  reloadModelsForProvider: vi.fn(() => ({ type: 'model/reloadModelsForProvider' })),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => {},
    dispatch: vi.fn(),
  });
});

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { resolveOnboardingModel } from './resolve-onboarding-model';
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';

// The resolver reads the default provider + tier tables straight off
// state.providerCatalog (real selectors, not mocked) — hydrate it.
const fakeState = {
  providerCatalog: providerCatalogReducer(
    providerCatalogInitialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  ),
} as StoreState;

function setAvailability(
  overrides: Partial<Record<keyof ProviderAvailabilityResult['providers'], { available: boolean; authenticated?: boolean }>>,
) {
  const base: ProviderAvailabilityResult['providers'] = {
    auggie: { available: false, authenticated: undefined },
    claudeCode: { available: false, authenticated: undefined },
    codex: { available: false, authenticated: undefined },
    cortex: { available: false, authenticated: undefined },
    opencode: { available: false, authenticated: undefined },
    droid: { available: false, authenticated: undefined },
    grok: { available: false, authenticated: undefined },
    unsloth: { available: false, authenticated: undefined },
    mock: { available: false, authenticated: undefined },
    pi: { available: false, authenticated: undefined },
  };
  for (const [key, value] of Object.entries(overrides)) {
    base[key as keyof typeof base] = value;
  }
  mockState.availability = {
    hasAnyProvider: Object.values(base).some((p) => p.available),
    providers: base,
    hiddenProviders: [],
  };
}

describe('resolveOnboardingModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAvailability({ auggie: { available: true, authenticated: true } });
    mockState.activeProviderId = 'auggie';
    mockState.selectedModel = '';
    mockState.selectedModelByProvider = {};
    mockState.availableModels = [];
    mockState.modelsByProvider = {};
    mockState.userOverrides = { modelOverrides: {} };
    mockState.specialists = [
      {
        id: 'spec-writer',
        name: 'Coordinator',
        description: 'Plans work',
        defaultModelTier: 'smart',
        defaultBehaviorPrompt: 'coordinator-prompt',
      },
    ];
  });

  it('returns auggie with no model (daemon resolves the default) when only auggie is installed and authenticated', async () => {
    setAvailability({ auggie: { available: true, authenticated: true } });
    mockState.activeProviderId = 'auggie';

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('auggie');
    expect(result.model).toBeUndefined();
    expect(result.specialistId).toBe('spec-writer');
  });

  it('returns opencode with no model when only opencode is installed and active', async () => {
    setAvailability({ opencode: { available: true, authenticated: true } });
    mockState.activeProviderId = 'opencode';

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('opencode');
    expect(result.model).toBeUndefined();
  });

  it('returns claude-code with no model when claude-code is active alongside opencode', async () => {
    setAvailability({
      claudeCode: { available: true, authenticated: true },
      opencode: { available: true, authenticated: true },
    });
    mockState.activeProviderId = 'claude-code';

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('claude-code');
    expect(result.model).toBeUndefined();
  });

  it('throws when user-explicit active provider is stale and not installed', async () => {
    // User previously picked claude-code but it is no longer installed. Per
    // launch-day hardening, we must NOT silently switch them to auggie —
    // surface the error so the onboarding page can show a visible failure.
    setAvailability({ auggie: { available: true, authenticated: true } });
    mockState.activeProviderId = 'claude-code';

    await expect(resolveOnboardingModel(fakeState)).rejects.toThrow(/claude-code/);
  });

  it('falls back gracefully to defaults when nothing is installed + authenticated', async () => {
    setAvailability({});
    mockState.activeProviderId = 'auggie';

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('auggie');
    expect(result.model).toBeUndefined();
  });

  it('throws when user-explicit opencode is installed but explicitly not authenticated', async () => {
    // `authenticated: false` is an explicit negative — reject even for
    // user-explicit selection (distinct from `undefined`, which is merely
    // inconclusive).
    setAvailability({
      auggie: { available: true, authenticated: true },
      opencode: { available: true, authenticated: false },
    });
    mockState.activeProviderId = 'opencode';

    await expect(resolveOnboardingModel(fakeState)).rejects.toThrow(/opencode/);
  });

  it('honors user-explicit opencode when authenticated=undefined (no model — daemon resolves)', async () => {
    // Finding A mitigation: `checkOpenCodeReady` probe was inconclusive
    // (10s timeout on a slow machine), but the CLI is installed and the
    // user explicitly clicked the opencode card — trust their selection.
    setAvailability({
      auggie: { available: true, authenticated: true },
      opencode: { available: true, authenticated: undefined },
    });
    mockState.activeProviderId = 'opencode';

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('opencode');
    expect(result.model).toBeUndefined();
  });

  it('throws when user-explicit opencode is not installed even though auggie is usable', async () => {
    // Change 3: never silently switch to auggie when the user explicitly
    // picked a non-default provider that turns out to be unavailable.
    setAvailability({
      auggie: { available: true, authenticated: true },
    });
    mockState.activeProviderId = 'opencode';

    await expect(resolveOnboardingModel(fakeState)).rejects.toThrow(/opencode/);
  });

  describe('user-selected Pi provider (provider propagation regression)', () => {
    const PI_MODEL = 'pi:anthropic/claude-opus-4.7';

    // Mirrors the real Coordinator file specialist that pins auggie/fable-5.
    const pinnedCoordinator = (): void => {
      mockState.specialists = [
        {
          id: 'spec-writer',
          name: 'Coordinator',
          description: 'Plans work',
          codingAgent: 'auggie',
          defaultModel: 'fable-5',
          defaultBehaviorPrompt: 'coordinator-prompt',
        },
      ];
    };

    it('routes to pi with no model (daemon resolves) when the user explicitly picked pi', async () => {
      pinnedCoordinator();
      setAvailability({
        auggie: { available: true, authenticated: true },
        pi: { available: true, authenticated: true },
      });
      mockState.activeProviderId = 'pi';
      mockState.selectedModelByProvider = { pi: PI_MODEL };

      const result = await resolveOnboardingModel(fakeState);

      expect(result.provider).toBe('pi');
      // The specialist frontmatter pin (auggie/fable-5) must not leak onto
      // pi; the daemon's provider-guarded resolver handles it.
      expect(result.model).toBeUndefined();
    });

    it('honors user-explicit pi under the relaxed auth gate (authenticated=undefined)', async () => {
      pinnedCoordinator();
      setAvailability({
        auggie: { available: true, authenticated: true },
        pi: { available: true, authenticated: undefined },
      });
      mockState.activeProviderId = 'pi';

      const result = await resolveOnboardingModel(fakeState);

      expect(result.provider).toBe('pi');
      expect(result.model).toBeUndefined();
    });

    it('routes to auggie with no model when the user made no explicit provider change', async () => {
      pinnedCoordinator();
      setAvailability({
        auggie: { available: true, authenticated: true },
        pi: { available: true, authenticated: true },
      });
      // activeProviderId stays at the default — the user never picked pi
      // explicitly, even though a pi model is stored in the model slice.
      mockState.activeProviderId = 'auggie';
      mockState.selectedModelByProvider = { pi: PI_MODEL };

      const result = await resolveOnboardingModel(fakeState);

      expect(result.provider).toBe('auggie');
      // The daemon resolves the specialist frontmatter pin (fable-5) itself.
      expect(result.model).toBeUndefined();
    });

    it('throws when user-explicit pi is not installed (no silent auggie fallback)', async () => {
      pinnedCoordinator();
      setAvailability({ auggie: { available: true, authenticated: true } });
      mockState.activeProviderId = 'pi';

      await expect(resolveOnboardingModel(fakeState)).rejects.toThrow(/'pi'/);
    });

    it('throws when user-explicit pi is installed but explicitly not authenticated', async () => {
      pinnedCoordinator();
      setAvailability({
        auggie: { available: true, authenticated: true },
        pi: { available: true, authenticated: false },
      });
      mockState.activeProviderId = 'pi';

      await expect(resolveOnboardingModel(fakeState)).rejects.toThrow(/'pi'/);
    });
  });

  describe('specialist user model override (explicit pick)', () => {
    it('submits the override when it belongs to the resolved provider', async () => {
      setAvailability({ auggie: { available: true, authenticated: true } });
      mockState.activeProviderId = 'auggie';
      mockState.userOverrides = { modelOverrides: { 'spec-writer': 'sonnet4.5' } };

      const result = await resolveOnboardingModel(fakeState);

      expect(result.provider).toBe('auggie');
      expect(result.model).toBe('sonnet4.5');
    });

    it('drops a cross-provider override instead of leaking it', async () => {
      setAvailability({
        auggie: { available: true, authenticated: true },
        claudeCode: { available: true, authenticated: true },
      });
      // User explicitly selected claude-code; the stale override belongs to auggie.
      mockState.activeProviderId = 'claude-code';
      mockState.userOverrides = { modelOverrides: { 'spec-writer': 'fable-5' } };

      const result = await resolveOnboardingModel(fakeState);

      expect(result.provider).toBe('claude-code');
      expect(result.model).toBeUndefined();
    });
  });

  describe('user-selected model override (onboarding prompt-step picker)', () => {
    it('returns the picked compound model with its provider, bypassing all other resolution', async () => {
      setAvailability({
        auggie: { available: true, authenticated: true },
        pi: { available: true, authenticated: true },
      });
      mockState.activeProviderId = 'auggie';

      const result = await resolveOnboardingModel(fakeState, 'pi:anthropic/claude-opus-4.7');

      expect(result.provider).toBe('pi');
      expect(result.model).toBe('pi:anthropic/claude-opus-4.7');
      expect(result.specialistId).toBe('spec-writer');
      expect(result.behaviorPrompt).toBe('coordinator-prompt');
    });

    it('attributes a bare model id to the default provider', async () => {
      setAvailability({ auggie: { available: true, authenticated: true } });
      mockState.activeProviderId = 'auggie';

      const result = await resolveOnboardingModel(fakeState, 'sonnet4.5');

      expect(result.provider).toBe('auggie');
      expect(result.model).toBe('sonnet4.5');
    });

    it('wins over a specialist model override', async () => {
      setAvailability({
        auggie: { available: true, authenticated: true },
        opencode: { available: true, authenticated: true },
      });
      mockState.activeProviderId = 'auggie';
      mockState.userOverrides = { modelOverrides: { 'spec-writer': 'opencode:x' } };

      const result = await resolveOnboardingModel(fakeState, 'opus4.7');

      expect(result.provider).toBe('auggie');
      expect(result.model).toBe('opus4.7');
    });

    it('honors the pick under the relaxed auth gate (authenticated=undefined)', async () => {
      setAvailability({
        auggie: { available: true, authenticated: true },
        opencode: { available: true, authenticated: undefined },
      });
      mockState.activeProviderId = 'auggie';

      const result = await resolveOnboardingModel(fakeState, 'opencode:anthropic/claude-4');

      expect(result.provider).toBe('opencode');
      expect(result.model).toBe('opencode:anthropic/claude-4');
    });

    it("throws when the picked model's provider is not installed (no silent switch)", async () => {
      setAvailability({ auggie: { available: true, authenticated: true } });
      mockState.activeProviderId = 'auggie';

      await expect(
        resolveOnboardingModel(fakeState, 'pi:anthropic/claude-opus-4.7'),
      ).rejects.toThrow(/'pi'/);
    });

    it("throws when the picked model's provider is explicitly not authenticated", async () => {
      setAvailability({
        auggie: { available: true, authenticated: true },
        pi: { available: true, authenticated: false },
      });
      mockState.activeProviderId = 'auggie';

      await expect(
        resolveOnboardingModel(fakeState, 'pi:anthropic/claude-opus-4.7'),
      ).rejects.toThrow(/'pi'/);
    });
  });
});

