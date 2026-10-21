/**
 * Unit coverage for the quota failover notice (§5.54 backup profiles):
 * metadata parsing of the daemon's `provider_failover` row and label
 * formatting (profile names, the bare Default configuration, removed
 * profiles, and the pre-load / fallback branches).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import {
  formatProviderFailoverLabel,
  getProviderFailoverNotice,
  type ProviderFailoverNoticeInfo,
} from '../provider-failover-notice';

let mockStoreState: Record<string, unknown> = {};

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockStoreState });
});

const FALLBACK = 'Daemon failover text';

const PROFILES = [
  {
    id: 'ppersonal',
    providerRef: 'claude-code@ppersonal',
    baseProviderId: 'claude-code',
    name: 'Personal',
  },
  { id: 'pwork', providerRef: 'claude-code@pwork', baseProviderId: 'claude-code', name: 'Work' },
];

function catalogState(profiles = PROFILES, loaded = true): Record<string, unknown> {
  return {
    providerCatalog: {
      loaded,
      providers: createCollection('id', [
        { id: 'claude-code', displayName: 'Claude Code' },
        { id: 'codex', displayName: 'OpenAI Codex' },
      ]),
      profiles: createCollection('id', profiles),
    },
  };
}

const notice = (
  overrides: Partial<ProviderFailoverNoticeInfo> = {},
): ProviderFailoverNoticeInfo => ({
  fromProvider: 'claude-code@ppersonal',
  toProvider: 'claude-code@pwork',
  model: 'opus',
  reason: 'quota-exceeded',
  ...overrides,
});

beforeEach(() => {
  mockStoreState = {};
});

describe('getProviderFailoverNotice', () => {
  it('parses a complete provider_failover row', () => {
    expect(
      getProviderFailoverNotice({
        role: 'system',
        metadata: {
          type: 'provider_failover',
          fromProvider: 'claude-code',
          toProvider: 'claude-code@pwork',
          model: 'opus',
          reason: 'quota-exceeded',
        },
      }),
    ).toEqual({
      fromProvider: 'claude-code',
      toProvider: 'claude-code@pwork',
      model: 'opus',
      reason: 'quota-exceeded',
    });
  });

  it('reads a null model as the provider default', () => {
    expect(
      getProviderFailoverNotice({
        metadata: {
          type: 'provider_failover',
          fromProvider: 'codex',
          toProvider: 'codex@pbackup',
          model: null,
          reason: 'quota-exceeded',
        },
      })?.model,
    ).toBeNull();
  });

  it('keeps a row with missing or invalid fields as a notice with those fields undefined', () => {
    expect(
      getProviderFailoverNotice({
        metadata: { type: 'provider_failover', fromProvider: 42, toProvider: '', model: {} },
      }),
    ).toEqual({ fromProvider: undefined, toProvider: undefined, model: null, reason: undefined });
  });

  it.each([
    ['no message', undefined],
    ['no metadata', { role: 'system' }],
    ['null metadata', { role: 'system', metadata: null }],
    ['another notice type', { metadata: { type: 'model_changed', fromProvider: 'a' } }],
    ['no type', { metadata: { fromProvider: 'a', toProvider: 'b' } }],
  ])('returns null for %s', (_label, message) => {
    expect(getProviderFailoverNotice(message as never)).toBeNull();
  });
});

describe('formatProviderFailoverLabel', () => {
  it('names both profiles from the catalog', () => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(notice(), FALLBACK)).toBe(
      'Personal ran out of quota — continuing on Work (backup)',
    );
  });

  it('labels the bare reference as the provider Default configuration', () => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(notice({ fromProvider: 'claude-code' }), FALLBACK)).toBe(
      'Claude Code · Default ran out of quota — continuing on Work (backup)',
    );
  });

  it('labels a deleted profile as removed once the catalog has loaded, and follows renames', () => {
    mockStoreState = catalogState([{ ...PROFILES[1], name: 'Job' }]);
    expect(formatProviderFailoverLabel(notice(), FALLBACK)).toBe(
      'Removed profile ran out of quota — continuing on Job (backup)',
    );
  });

  it('shows the provider name, not "Removed profile", before the catalog has loaded', () => {
    mockStoreState = catalogState([], false);
    const label = formatProviderFailoverLabel(notice(), FALLBACK);
    expect(label).toBe('Claude Code ran out of quota — continuing on Claude Code (backup)');
    expect(label).not.toContain('Removed profile');
  });

  it('waits for the workspace catalog before calling a profile removed', () => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(notice(), FALLBACK, 'ws-1')).toBe(
      'Claude Code ran out of quota — continuing on Claude Code (backup)',
    );
    mockStoreState = {
      providerCatalog: {
        ...(catalogState().providerCatalog as object),
        byWorkspaceId: {
          'ws-1': {
            catalog: {
              providers: [{ id: 'claude-code', displayName: 'Claude Code' }],
              profiles: [PROFILES[1]],
            },
          },
        },
      },
    };
    expect(formatProviderFailoverLabel(notice(), FALLBACK, 'ws-1')).toBe(
      'Removed profile ran out of quota — continuing on Work (backup)',
    );
  });

  it('never shows an internal profile reference', () => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(notice(), FALLBACK)).not.toMatch(/@p/);
  });

  it.each([
    ['an unknown reason', { reason: 'other' }],
    ['a missing reason', { reason: undefined }],
    ['a missing fromProvider', { fromProvider: undefined }],
    ['a missing toProvider', { toProvider: undefined }],
  ])('falls back to the daemon text for %s', (_label, overrides) => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(notice(overrides), FALLBACK)).toBe(FALLBACK);
  });
});
