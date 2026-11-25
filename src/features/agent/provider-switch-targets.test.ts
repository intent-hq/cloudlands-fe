import { describe, expect, it } from 'vitest';

import {
  getRememberedProviderSwitch,
  resolveSwitchPrefill,
  unionTargets,
  withRememberedProviderSwitches,
} from './provider-switch-targets';

const codex = {
  providerId: 'codex',
  models: [{ value: 'sol', isDefault: true }, { value: 'luna' }],
};
const gemini = { providerId: 'gemini', models: [{ value: 'pro' }] };

describe('remembered provider switch', () => {
  it('round-trips per failed provider reference and model, keeping other bag fields', () => {
    const bag = withRememberedProviderSwitches(
      { other: true },
      [
        {
          providerRef: 'claude-code',
          model: 'opus',
          target: { providerId: 'codex', modelId: 'luna' },
        },
      ],
      5,
    );
    expect(bag.other).toBe(true);
    expect(getRememberedProviderSwitch(bag, 'claude-code', 'opus')).toEqual({
      providerId: 'codex',
      modelId: 'luna',
    });
    expect(getRememberedProviderSwitch(bag, 'claude-code', 'fable')).toBeUndefined();
    expect(getRememberedProviderSwitch(bag, 'claude-code@work', 'opus')).toBeUndefined();
  });

  it('ignores malformed bags and entries', () => {
    expect(getRememberedProviderSwitch({ choices: [] }, 'claude-code', 'opus')).toBeUndefined();
    expect(
      getRememberedProviderSwitch(
        { choices: { 'claude-code|opus': { providerId: 3 } } },
        'claude-code',
        'opus',
      ),
    ).toBeUndefined();
  });

  it('keeps only the newest 50 pairs', () => {
    let bag = {};
    for (let i = 0; i < 55; i += 1) {
      bag = withRememberedProviderSwitches(
        bag,
        [{ providerRef: `p${i}`, model: null, target: { providerId: 'codex', modelId: 'sol' } }],
        i,
      );
    }
    expect(getRememberedProviderSwitch(bag, 'p0', null)).toBeUndefined();
    expect(getRememberedProviderSwitch(bag, 'p54', null)).toBeDefined();
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
