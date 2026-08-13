/**
 * Initial-step decision matrix for `/workspace/new` (monorepo task: gate the
 * onboarding initial step by setup state): provider ready → 'project';
 * pending check + persisted flag → 'project' via provisional local fast-path;
 * pending + no flag → 'welcome'; fast-path corrected when the check settles
 * with no ready provider and no workspaces.
 */
import { describe, expect, it } from 'vitest';

import {
  determineOnboardingInitialStep,
  resolveFastPathSettlement,
} from './determine-onboarding-initial-step';

const base = {
  fullFlowRequested: false,
  hasReadyProvider: false,
  hasCompletedProviderSetup: false,
  hasWorkspaces: false,
};

describe('determineOnboardingInitialStep', () => {
  it('ready provider → project (not a fast-path)', () => {
    expect(determineOnboardingInitialStep({ ...base, hasReadyProvider: true })).toEqual({
      step: 'project',
      viaLocalFastPath: false,
    });
  });

  it('existing workspaces → project even without a ready provider or flag', () => {
    expect(determineOnboardingInitialStep({ ...base, hasWorkspaces: true })).toEqual({
      step: 'project',
      viaLocalFastPath: false,
    });
  });

  it('pending check + persisted flag → project via provisional fast-path', () => {
    expect(
      determineOnboardingInitialStep({ ...base, hasCompletedProviderSetup: true }),
    ).toEqual({ step: 'project', viaLocalFastPath: true });
  });

  it('flag + ready provider → confirmed project, not a fast-path', () => {
    expect(
      determineOnboardingInitialStep({
        ...base,
        hasReadyProvider: true,
        hasCompletedProviderSetup: true,
      }),
    ).toEqual({ step: 'project', viaLocalFastPath: false });
  });

  it('pending check + no flag → welcome (full flow)', () => {
    expect(determineOnboardingInitialStep(base)).toEqual({
      step: 'welcome',
      viaLocalFastPath: false,
    });
  });

  it('explicit full-flow request → welcome regardless of setup state', () => {
    expect(
      determineOnboardingInitialStep({
        fullFlowRequested: true,
        hasReadyProvider: true,
        hasCompletedProviderSetup: true,
        hasWorkspaces: true,
      }),
    ).toEqual({ step: 'welcome', viaLocalFastPath: false });
  });
});

describe('resolveFastPathSettlement', () => {
  it('pending while the bulk check has not landed statuses', () => {
    expect(
      resolveFastPathSettlement({
        hasReadyProvider: false,
        providersCheckedOnce: false,
        hasWorkspaces: false,
      }),
    ).toBe('pending');
  });

  it('keep once a ready provider confirms the fast-path', () => {
    expect(
      resolveFastPathSettlement({
        hasReadyProvider: true,
        providersCheckedOnce: false,
        hasWorkspaces: false,
      }),
    ).toBe('keep');
  });

  it('keep when workspaces exist even with no ready provider found', () => {
    expect(
      resolveFastPathSettlement({
        hasReadyProvider: false,
        providersCheckedOnce: true,
        hasWorkspaces: true,
      }),
    ).toBe('keep');
  });

  it('correct when the check settled with no ready provider and no workspaces', () => {
    expect(
      resolveFastPathSettlement({
        hasReadyProvider: false,
        providersCheckedOnce: true,
        hasWorkspaces: false,
      }),
    ).toBe('correct');
  });
});
