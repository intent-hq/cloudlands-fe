/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  PROVIDER_SWITCH_MEMORY_STORAGE_KEY,
  getRememberedProviderSwitch,
  rememberProviderSwitch,
  resolveSwitchPrefill,
  unionTargets,
} from './provider-switch-targets';

afterEach(() => window.localStorage.clear());

const codex = {
  providerId: 'codex',
  models: [{ value: 'sol', isDefault: true }, { value: 'luna' }],
};
const gemini = { providerId: 'gemini', models: [{ value: 'pro' }] };

describe('remembered provider switch', () => {
  it('round-trips per failed provider reference and model', () => {
    rememberProviderSwitch('claude-code', 'opus', { providerId: 'codex', modelId: 'luna' });
    expect(getRememberedProviderSwitch('claude-code', 'opus')).toEqual({
      providerId: 'codex',
      modelId: 'luna',
    });
    expect(getRememberedProviderSwitch('claude-code', 'fable')).toBeUndefined();
    expect(getRememberedProviderSwitch('claude-code@work', 'opus')).toBeUndefined();
  });

  it('ignores corrupt storage', () => {
    window.localStorage.setItem(PROVIDER_SWITCH_MEMORY_STORAGE_KEY, '{not json');
    expect(getRememberedProviderSwitch('claude-code', 'opus')).toBeUndefined();
    rememberProviderSwitch('claude-code', 'opus', { providerId: 'codex', modelId: 'sol' });
    expect(getRememberedProviderSwitch('claude-code', 'opus')?.modelId).toBe('sol');
  });
});

describe('resolveSwitchPrefill', () => {
  it('prefills an eligible remembered target', () => {
    expect(
      resolveSwitchPrefill({
        remembered: { providerId: 'gemini', modelId: 'pro' },
        targets: [codex, gemini],
        configuredModels: {},
      }),
    ).toEqual({ providerId: 'gemini', modelId: 'pro' });
  });

  it('ignores a remembered provider that is no longer eligible', () => {
    expect(
      resolveSwitchPrefill({
        remembered: { providerId: 'droid', modelId: 'x' },
        targets: [codex],
        configuredModels: {},
      }),
    ).toEqual({ providerId: 'codex', modelId: 'sol' });
  });

  it('uses the configured default model, then the provider default', () => {
    expect(resolveSwitchPrefill({ targets: [codex], configuredModels: { codex: 'luna' } })).toEqual(
      { providerId: 'codex', modelId: 'luna' },
    );
    expect(
      resolveSwitchPrefill({ targets: [codex], configuredModels: { codex: 'retired' } }),
    ).toEqual({ providerId: 'codex', modelId: 'sol' });
    expect(
      resolveSwitchPrefill({
        remembered: { providerId: 'codex', modelId: 'retired' },
        targets: [codex],
        configuredModels: {},
      }),
    ).toEqual({ providerId: 'codex', modelId: 'sol' });
  });

  it('returns null when nothing is eligible', () => {
    expect(resolveSwitchPrefill({ targets: [], configuredModels: {} })).toBeNull();
    expect(
      resolveSwitchPrefill({
        targets: [{ providerId: 'codex', models: [] }],
        configuredModels: {},
      }),
    ).toBeNull();
  });
});

describe('unionTargets', () => {
  it('unions per-agent eligible providers in first-seen order', () => {
    expect(unionTargets([['codex', 'gemini'], ['gemini', 'droid'], []])).toEqual([
      'codex',
      'gemini',
      'droid',
    ]);
  });
});
