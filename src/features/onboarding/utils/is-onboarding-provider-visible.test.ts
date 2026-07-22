import { describe, expect, it } from 'vitest';
import { isOnboardingProviderVisible } from './is-onboarding-provider-visible';

const featureEnabled = () => true;
const featureDisabled = () => false;

describe('isOnboardingProviderVisible', () => {
  it('shows ungated providers regardless of availability status', () => {
    expect(
      isOnboardingProviderVisible({
        provider: {},
        isFeatureEnabled: featureDisabled,
        status: undefined,
      }),
    ).toBe(true);
    expect(
      isOnboardingProviderVisible({
        provider: {},
        isFeatureEnabled: featureDisabled,
        status: { available: false },
      }),
    ).toBe(true);
  });

  it('hides env-var-gated providers when reported unavailable', () => {
    expect(
      isOnboardingProviderVisible({
        provider: { requiresEnvVar: 'MOCK_AGENT_SCRIPT_PATH' },
        isFeatureEnabled: featureEnabled,
        status: { available: false },
      }),
    ).toBe(false);
  });

  it('hides env-var-gated providers when no availability status exists yet (default-deny)', () => {
    expect(
      isOnboardingProviderVisible({
        provider: { requiresEnvVar: 'MOCK_AGENT_SCRIPT_PATH' },
        isFeatureEnabled: featureEnabled,
        status: undefined,
      }),
    ).toBe(false);
  });

  it('shows env-var-gated providers when reported available', () => {
    expect(
      isOnboardingProviderVisible({
        provider: { requiresEnvVar: 'MOCK_AGENT_SCRIPT_PATH' },
        isFeatureEnabled: featureEnabled,
        status: { available: true },
      }),
    ).toBe(true);
  });

  it('hides feature-code-gated providers when the feature code is not activated', () => {
    expect(
      isOnboardingProviderVisible({
        provider: { requiresFeatureCode: 'cortex' },
        isFeatureEnabled: featureDisabled,
        status: { available: true },
      }),
    ).toBe(false);
  });

  it('shows feature-code-gated providers when the feature code is activated', () => {
    expect(
      isOnboardingProviderVisible({
        provider: { requiresFeatureCode: 'cortex' },
        isFeatureEnabled: (code) => code === 'cortex',
        status: undefined,
      }),
    ).toBe(true);
  });

  it('requires both gates to pass when a provider has both', () => {
    const provider = { requiresEnvVar: 'SOME_VAR', requiresFeatureCode: 'some-code' };
    expect(
      isOnboardingProviderVisible({
        provider,
        isFeatureEnabled: featureEnabled,
        status: { available: false },
      }),
    ).toBe(false);
    expect(
      isOnboardingProviderVisible({
        provider,
        isFeatureEnabled: featureDisabled,
        status: { available: true },
      }),
    ).toBe(false);
    expect(
      isOnboardingProviderVisible({
        provider,
        isFeatureEnabled: featureEnabled,
        status: { available: true },
      }),
    ).toBe(true);
  });
});
