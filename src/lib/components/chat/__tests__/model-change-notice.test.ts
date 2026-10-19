/**
 * Unit coverage for the model-change notice label formatting: pretty-name
 * resolution from the model catalog by (provider, model id) and the
 * fallback branches (catalog miss, provider-default sides, missing
 * metadata).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { formatModelChangeLabel, getModelChangeNotice } from '../model-change-notice';
import { formatProviderRehomedLabel } from '../rehome-notice';

let mockStoreState: Record<string, unknown> = {};

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockStoreState });
});

const FALLBACK = 'Model changed';

/** Hydrated provider catalog + model catalog: rows carry bare ids — the
 * active catalog's provenance lives in `availableModelsProviderId`, other
 * providers resolve through the provider-models cache. */
function hydratedState(): Record<string, unknown> {
  return {
    providerCatalog: {
      loaded: true,
      defaultProviderId: 'auggie',
      providers: createCollection('id', [
        { id: 'auggie', displayName: 'Augment Auggie' },
        { id: 'codex', displayName: 'OpenAI Codex' },
      ]),
    },
    model: {
      defaultProviderId: 'auggie',
      availableModelsProviderId: 'auggie',
      availableModels: createCollection('value', [
        { value: 'sonnet4.6', label: 'Claude Sonnet 4.6' },
      ]),
    },
    providerModels: {
      byProviderId: {
        codex: {
          models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
          fetchedAt: '2026-01-01T00:00:00Z',
        },
      },
      clearEpoch: 0,
    },
  };
}

beforeEach(() => {
  mockStoreState = {};
});

describe('formatModelChangeLabel — pretty-name resolution', () => {
  it('renders both sides as "<PrettyName> (<providerId> / <modelId>)"', () => {
    mockStoreState = hydratedState();
    const label = formatModelChangeLabel(
      { from: 'sonnet4.6', to: 'gpt-5-codex', fromProvider: 'auggie', toProvider: 'codex' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Claude Sonnet 4.6 (auggie / sonnet4.6) to GPT-5 Codex (codex / gpt-5-codex)',
    );
  });

  it('falls back to the raw model id on a catalog miss, keeping the ids', () => {
    mockStoreState = hydratedState();
    const label = formatModelChangeLabel(
      { from: 'sonnet4.6', to: 'unknown-model', fromProvider: 'auggie', toProvider: 'codex' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Claude Sonnet 4.6 (auggie / sonnet4.6) to unknown-model (codex / unknown-model)',
    );
  });

  it('does not resolve a bare catalog entry for a non-default provider', () => {
    // 'sonnet4.6' is stored bare and belongs to the default provider; the
    // same raw id under 'codex' must not inherit its pretty name.
    mockStoreState = hydratedState();
    const label = formatModelChangeLabel(
      { from: 'sonnet4.6', to: 'sonnet4.6', fromProvider: 'auggie', toProvider: 'codex' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Claude Sonnet 4.6 (auggie / sonnet4.6) to sonnet4.6 (codex / sonnet4.6)',
    );
  });

  it('degrades to raw ids when neither catalog is loaded', () => {
    const label = formatModelChangeLabel(
      { from: 'sonnet4.6', to: 'gpt-5-codex', fromProvider: 'auggie', toProvider: 'codex' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from sonnet4.6 (auggie / sonnet4.6) to gpt-5-codex (codex / gpt-5-codex)',
    );
  });
});

describe('formatModelChangeLabel — provider-default and fallback branches', () => {
  it('renders a null side as "<ProviderDisplayName> default model (<providerId>)"', () => {
    mockStoreState = hydratedState();
    const label = formatModelChangeLabel(
      { from: null, to: 'gpt-5-codex', fromProvider: 'auggie', toProvider: 'codex' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Augment Auggie default model (auggie) to GPT-5 Codex (codex / gpt-5-codex)',
    );
  });

  it('uses the raw provider id in the default-model side before hydration', () => {
    const label = formatModelChangeLabel(
      { from: null, to: 'gpt-5-codex', fromProvider: 'auggie', toProvider: 'codex' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from auggie default model (auggie) to gpt-5-codex (codex / gpt-5-codex)',
    );
  });

  it('returns the fallback text when one side has neither provider nor model', () => {
    mockStoreState = hydratedState();
    const label = formatModelChangeLabel(
      { from: null, to: 'gpt-5-codex', toProvider: 'codex' },
      FALLBACK,
    );
    expect(label).toBe(FALLBACK);
  });

  it('returns the fallback text when both sides are undescribable', () => {
    const label = formatModelChangeLabel({ from: null, to: null }, FALLBACK);
    expect(label).toBe(FALLBACK);
  });
});

describe('getModelChangeNotice', () => {
  it('returns null for messages without model_changed metadata', () => {
    expect(getModelChangeNotice(undefined)).toBeNull();
    expect(getModelChangeNotice({ role: 'system' })).toBeNull();
    expect(getModelChangeNotice({ role: 'system', metadata: { type: 'other' } })).toBeNull();
  });

  it('parses a model_changed metadata row', () => {
    const notice = getModelChangeNotice({
      role: 'system',
      metadata: {
        type: 'model_changed',
        from: 'sonnet4.6',
        to: null,
        fromProvider: 'auggie',
        toProvider: 'codex',
      },
    });
    expect(notice).toEqual({
      from: 'sonnet4.6',
      to: null,
      fromProvider: 'auggie',
      toProvider: 'codex',
    });
  });
});

it('uses learned names in both transcript notice formats before workspace catalogs arrive', () => {
  mockStoreState = {
    providerModels: {
      learnedNames: { codex: { 'org/model:v2': 'Remembered model' } },
      byProviderId: {},
    },
  };
  expect(
    formatModelChangeLabel(
      { from: 'org/model:v2', to: 'never-seen', fromProvider: 'codex', toProvider: 'codex' },
      FALLBACK,
      'cold-workspace',
    ),
  ).toContain('Remembered model (codex / org/model:v2)');
  expect(
    formatModelChangeLabel(
      { from: 'org/model:v2', to: 'never-seen', fromProvider: 'codex', toProvider: 'codex' },
      FALLBACK,
      'cold-workspace',
    ),
  ).toContain('never-seen');
  expect(
    formatProviderRehomedLabel(
      {
        reason: 'provider_disabled',
        from: 'org/model:v2',
        to: null,
        fromProvider: 'codex',
        toProvider: 'auggie',
      },
      FALLBACK,
      'cold-workspace',
    ),
  ).toContain('Remembered model');
});

describe('formatModelChangeLabel — named provider profiles', () => {
  function profileState(
    profiles = [
      {
        id: 'ppersonal',
        providerRef: 'claude-code@ppersonal',
        baseProviderId: 'claude-code',
        name: 'Personal',
      },
      {
        id: 'pwork',
        providerRef: 'claude-code@pwork',
        baseProviderId: 'claude-code',
        name: 'Work',
      },
    ],
  ): Record<string, unknown> {
    const base = hydratedState();
    return {
      ...base,
      providerCatalog: {
        loaded: true,
        defaultProviderId: 'auggie',
        providers: createCollection('id', [
          { id: 'auggie', displayName: 'Augment Auggie' },
          { id: 'claude-code', displayName: 'Claude Code' },
        ]),
        profiles: createCollection('id', profiles),
      },
      providerModels: {
        byProviderId: {
          'claude-code': {
            models: [{ value: 'opus', label: 'Opus 5.5' }],
            fetchedAt: '2026-01-01T00:00:00Z',
          },
          'claude-code@pwork': {
            models: [{ value: 'sonnet', label: 'Sonnet 5' }],
            fetchedAt: '2026-01-01T00:00:00Z',
          },
        },
        clearEpoch: 0,
      },
    };
  }

  it('labels both sides "<Model> (<Provider> · <Profile>)" without internal references', () => {
    mockStoreState = profileState();
    const label = formatModelChangeLabel(
      {
        from: 'opus',
        to: 'opus',
        fromProvider: 'claude-code@ppersonal',
        toProvider: 'claude-code@pwork',
      },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Opus 5.5 (Claude Code · Personal) to Opus 5.5 (Claude Code · Work)',
    );
  });

  it("prefers the profile's own model catalog and names the Default profile", () => {
    mockStoreState = profileState();
    const label = formatModelChangeLabel(
      { from: 'opus', to: 'sonnet', fromProvider: 'claude-code', toProvider: 'claude-code@pwork' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Opus 5.5 (Claude Code · Default) to Sonnet 5 (Claude Code · Work)',
    );
  });

  it('reads a removed profile as a removed profile and follows renames', () => {
    mockStoreState = profileState([
      { id: 'pwork', providerRef: 'claude-code@pwork', baseProviderId: 'claude-code', name: 'Job' },
    ]);
    const label = formatModelChangeLabel(
      {
        from: 'opus',
        to: 'opus',
        fromProvider: 'claude-code@ppersonal',
        toProvider: 'claude-code@pwork',
      },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Opus 5.5 (Claude Code · Removed profile) to Opus 5.5 (Claude Code · Job)',
    );
  });

  it('describes a profile default-model side without the reference', () => {
    mockStoreState = profileState();
    const label = formatModelChangeLabel(
      {
        from: null,
        to: 'opus',
        fromProvider: 'claude-code@pwork',
        toProvider: 'claude-code@ppersonal',
      },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Claude Code · Work default model to Opus 5.5 (Claude Code · Personal)',
    );
    expect(label).not.toContain('@');
  });

  it('keeps provider and model ids for switches that involve no profile', () => {
    mockStoreState = profileState([]);
    const label = formatModelChangeLabel(
      { from: 'sonnet4.6', to: 'opus', fromProvider: 'auggie', toProvider: 'claude-code' },
      FALLBACK,
    );
    expect(label).toBe(
      'Switched from Claude Sonnet 4.6 (auggie / sonnet4.6) to Opus 5.5 (claude-code / opus)',
    );
  });
});
