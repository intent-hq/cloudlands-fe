import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { StoreState } from '$store/renderer/types';
import type { ProviderAvailabilityResult } from '$features/providers/provider-availability.client';

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
  ],
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
  selectSelectedModel: makeSelector((_providerId?: string) => mockState.selectedModel),
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

const fakeState = {} as StoreState;

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
    mockState.availableModels = [];
    mockState.modelsByProvider = {};
    mockState.userOverrides = { modelOverrides: {} };
  });

  it('returns auggie opus4.7 when only auggie is installed and authenticated', async () => {
    setAvailability({ auggie: { available: true, authenticated: true } });
    mockState.activeProviderId = 'auggie';

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('auggie');
    expect(result.model).toBe('opus4.7');
    expect(result.specialistId).toBe('spec-writer');
  });

  it('returns opencode with dynamic model when only opencode is installed and active', async () => {
    setAvailability({ opencode: { available: true, authenticated: true } });
    mockState.activeProviderId = 'opencode';
    mockState.modelsByProvider = {
      opencode: [
        { value: 'opencode:foo', label: 'Foo' },
        { value: 'opencode:bar', label: 'Bar' },
      ],
    };

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('opencode');
    expect(result.model).toBe('opencode:foo');
    expect(result.model).not.toBe('opus4.7');
    expect(result.model.startsWith('auggie:')).toBe(false);
  });

  it('returns compound claude-code:default when claude-code is active alongside opencode', async () => {
    setAvailability({
      claudeCode: { available: true, authenticated: true },
      opencode: { available: true, authenticated: true },
    });
    mockState.activeProviderId = 'claude-code';

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('claude-code');
    expect(result.model).toBe('claude-code:default');
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
    expect(result.model).toBe('opus4.7');
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

  it('honors user-explicit opencode when authenticated=undefined and resolves a model dynamically', async () => {
    // Finding A mitigation: `checkOpenCodeReady` probe was inconclusive
    // (10s timeout on a slow machine), but the CLI is installed and the
    // user explicitly clicked the opencode card — trust their selection.
    setAvailability({
      auggie: { available: true, authenticated: true },
      opencode: { available: true, authenticated: undefined },
    });
    mockState.activeProviderId = 'opencode';
    mockState.modelsByProvider = {
      opencode: [
        { value: 'opencode:anthropic/claude-4', label: 'Claude 4' },
      ],
    };

    const result = await resolveOnboardingModel(fakeState);

    expect(result.provider).toBe('opencode');
    expect(result.model).toBe('opencode:anthropic/claude-4');
  });

  it('throws when user-explicit opencode is auggie-unavailable and returns no models (empty list)', async () => {
    // Finding B: if the opencode IPC fetch returns an empty list, we must
    // not fall through to an empty model string (main-side would then
    // synthesize an invalid `{ provider: 'opencode', model: 'opus4.7' }`).
    setAvailability({
      opencode: { available: true, authenticated: true },
    });
    mockState.activeProviderId = 'opencode';
    mockState.modelsByProvider = { opencode: [] };

    await expect(resolveOnboardingModel(fakeState)).rejects.toThrow(/opencode/);
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
});

