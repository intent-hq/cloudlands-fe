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
import { hasAvailableWorkspace } from '$features/workspace/utils/empty-window-destination';
import { hasReadyProvider } from '$store/renderer/slices/setup-prompt/setup-prompt-utils';

const base = {
  fullFlowRequested: false,
  hasReadyProvider: false,
  hasCompletedProviderSetup: false,
  hasWorkspaces: false,
  providersCheckedOnce: false,
};

describe('determineOnboardingInitialStep', () => {
  it.each([undefined, false, true])(
    'uses Antigravity auth=%s consistently with the setup gate',
    (authenticated) => {
      const ready = hasReadyProvider({ antigravity: { available: true, authenticated } });
      expect(
        determineOnboardingInitialStep({
          ...base,
          providersCheckedOnce: true,
          hasReadyProvider: ready,
        }).step,
      ).toBe(authenticated === true ? 'project' : 'welcome');
    },
  );
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
    expect(determineOnboardingInitialStep({ ...base, hasCompletedProviderSetup: true })).toEqual({
      step: 'project',
      viaLocalFastPath: true,
    });
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
        providersCheckedOnce: true,
      }),
    ).toEqual({ step: 'welcome', viaLocalFastPath: false });
  });

  // The check has SETTLED with no ready provider and no workspaces: the
  // persisted flag is stale for this backend — no provisional 'project' step,
  // land directly on provider setup.
  it('settled check + no ready provider + flag → welcome (flag ignored, no fast-path)', () => {
    expect(
      determineOnboardingInitialStep({
        ...base,
        hasCompletedProviderSetup: true,
        providersCheckedOnce: true,
      }),
    ).toEqual({ step: 'welcome', viaLocalFastPath: false });
  });

  it('settled check + ready provider → project regardless of the flag', () => {
    expect(
      determineOnboardingInitialStep({
        ...base,
        hasReadyProvider: true,
        providersCheckedOnce: true,
      }),
    ).toEqual({ step: 'project', viaLocalFastPath: false });
  });

  it('settled check + workspaces → project even with no ready provider', () => {
    expect(
      determineOnboardingInitialStep({
        ...base,
        hasWorkspaces: true,
        providersCheckedOnce: true,
      }),
    ).toEqual({ step: 'project', viaLocalFastPath: false });
  });

  // `hasWorkspaces` is fed by `hasAvailableWorkspace` (OnboardingPage), so
  // archived/deleted-only workspaces must NOT count as existing workspaces.
  it('archived-only workspaces + no ready provider + no flag → welcome (full flow)', () => {
    const archivedOnly = [{ id: 'ws-1', status: 'Archived' }];
    expect(
      determineOnboardingInitialStep({
        ...base,
        hasWorkspaces: hasAvailableWorkspace(archivedOnly),
      }),
    ).toEqual({ step: 'welcome', viaLocalFastPath: false });
  });

  it('archived-only workspaces + ready provider → project', () => {
    const archivedOnly = [{ id: 'ws-1', status: 'Archived' }];
    expect(
      determineOnboardingInitialStep({
        ...base,
        hasReadyProvider: true,
        hasWorkspaces: hasAvailableWorkspace(archivedOnly),
      }),
    ).toEqual({ step: 'project', viaLocalFastPath: false });
  });
});

describe('resolveFastPathSettlement', () => {
  it('pending while no bulk check has completed', () => {
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
