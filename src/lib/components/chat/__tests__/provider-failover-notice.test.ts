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
  getProviderReturnedNotice,
  getProviderSwitchNotice,
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
      kind: 'failover',
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
    ).toEqual({
      kind: 'failover',
      fromProvider: undefined,
      toProvider: undefined,
      model: null,
      reason: undefined,
    });
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

describe('getProviderReturnedNotice', () => {
  it('parses a complete provider_returned row', () => {
    expect(
      getProviderReturnedNotice({
        role: 'system',
        metadata: {
          type: 'provider_returned',
          fromProvider: 'claude-code@pwork',
          toProvider: 'claude-code@ppersonal',
          model: 'opus',
          reason: 'quota-reset',
        },
      }),
    ).toEqual({
      kind: 'returned',
      fromProvider: 'claude-code@pwork',
      toProvider: 'claude-code@ppersonal',
      model: 'opus',
      reason: 'quota-reset',
    });
  });

  it('keeps a row with missing or invalid fields as a notice with those fields undefined', () => {
    expect(
      getProviderReturnedNotice({
        metadata: { type: 'provider_returned', fromProvider: 7, toProvider: '', model: [] },
      }),
    ).toEqual({
      kind: 'returned',
      fromProvider: undefined,
      toProvider: undefined,
      model: null,
      reason: undefined,
    });
  });

  it.each([
    ['no message', undefined],
    ['no metadata', { role: 'system' }],
    ['a failover row', { metadata: { type: 'provider_failover', toProvider: 'a' } }],
  ])('returns null for %s', (_label, message) => {
    expect(getProviderReturnedNotice(message as never)).toBeNull();
  });

  it('is not a failover row', () => {
    expect(getProviderFailoverNotice({ metadata: { type: 'provider_returned' } })).toBeNull();
  });
});

describe('getProviderSwitchNotice', () => {
  it('recognizes both failover and returned rows and nothing else', () => {
    expect(getProviderSwitchNotice({ metadata: { type: 'provider_failover' } })?.kind).toBe(
      'failover',
    );
    expect(getProviderSwitchNotice({ metadata: { type: 'provider_returned' } })?.kind).toBe(
      'returned',
    );
    expect(getProviderSwitchNotice({ metadata: { type: 'model_changed' } })).toBeNull();
  });
});

describe('formatProviderFailoverLabel — returned home', () => {
  const returned = (
    overrides: Partial<ProviderFailoverNoticeInfo> = {},
  ): ProviderFailoverNoticeInfo => ({
    kind: 'returned',
    fromProvider: 'claude-code@pwork',
    toProvider: 'claude-code@ppersonal',
    model: 'opus',
    reason: 'quota-reset',
    ...overrides,
  });

  it('names the home profile from the catalog', () => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(returned(), FALLBACK)).toBe(
      'Personal quota reset — back on Personal',
    );
  });

  it('labels a bare home reference as the provider Default configuration', () => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(returned({ toProvider: 'claude-code' }), FALLBACK)).toBe(
      'Claude Code · Default quota reset — back on Claude Code · Default',
    );
  });

  it('labels a deleted home profile as removed once the catalog has loaded', () => {
    mockStoreState = catalogState([PROFILES[1]]);
    expect(formatProviderFailoverLabel(returned(), FALLBACK)).toBe(
      'Removed profile quota reset — back on Removed profile',
    );
  });

  it('shows the provider name, not "Removed profile", before the catalog has loaded', () => {
    mockStoreState = catalogState([], false);
    expect(formatProviderFailoverLabel(returned(), FALLBACK)).toBe(
      'Claude Code quota reset — back on Claude Code',
    );
  });

  it('reads the owning workspace catalog', () => {
    mockStoreState = {
      providerCatalog: {
        ...(catalogState([]).providerCatalog as object),
        byWorkspaceId: {
          'ws-1': {
            catalog: {
              providers: [{ id: 'claude-code', displayName: 'Claude Code' }],
              profiles: [PROFILES[0]],
            },
          },
        },
      },
    };
    expect(formatProviderFailoverLabel(returned(), FALLBACK, 'ws-1')).toBe(
      'Personal quota reset — back on Personal',
    );
  });

  it.each([
    ['an unknown reason', { reason: 'other' }],
    ['the failover reason', { reason: 'quota-exceeded' }],
    ['a missing reason', { reason: undefined }],
    ['a missing toProvider', { toProvider: undefined }],
  ])('falls back to the daemon text for %s', (_label, overrides) => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(returned(overrides), FALLBACK)).toBe(FALLBACK);
  });

  it('does not treat a failover notice with the reset reason as a return', () => {
    mockStoreState = catalogState();
    expect(formatProviderFailoverLabel(notice({ reason: 'quota-reset' }), FALLBACK)).toBe(FALLBACK);
  });
});
