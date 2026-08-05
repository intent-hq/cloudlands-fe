/**
 * Unit coverage for the model-change notice label formatting: pretty-name
 * resolution from the model catalog by (provider, model id) and the
 * fallback branches (catalog miss, provider-default sides, missing
 * metadata).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import {
  formatModelChangeLabel,
  getModelChangeNotice,
} from '../model-change-notice';

let mockStoreState: Record<string, unknown> = {};

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => mockStoreState });
});

const FALLBACK = 'Model changed';

/** Hydrated provider catalog + model catalog: bare values belong to the
 * default provider ('auggie'), non-default values are provider-prefixed. */
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
      availableModels: createCollection('value', [
        { value: 'sonnet4.6', label: 'Claude Sonnet 4.6' },
        { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex' },
      ]),
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
