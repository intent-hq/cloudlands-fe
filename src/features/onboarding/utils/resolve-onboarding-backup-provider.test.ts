import { describe, expect, it } from 'vitest';
import { resolveOnboardingBackupProvider } from './resolve-onboarding-backup-provider';

const runnable = { available: true };

describe('resolveOnboardingBackupProvider', () => {
  it('adds OpenCode as a backup to another chosen provider', () => {
    expect(
      resolveOnboardingBackupProvider({
        selectedProviderId: 'claude-code',
        statusMap: { opencode: runnable },
        enabledProviders: {},
      }),
    ).toBe('opencode');
  });

  it('adds it whether OpenCode runs installed or through npx, signed in or unknown', () => {
    for (const status of [
      { available: true, authenticated: true },
      { available: true, viaNpx: true },
    ]) {
      expect(
        resolveOnboardingBackupProvider({
          selectedProviderId: 'codex',
          statusMap: { opencode: status },
          enabledProviders: {},
        }),
      ).toBe('opencode');
    }
  });

  it('adds nothing when OpenCode is the chosen provider', () => {
    expect(
      resolveOnboardingBackupProvider({
        selectedProviderId: 'opencode',
        statusMap: { opencode: runnable },
        enabledProviders: {},
      }),
    ).toBeUndefined();
  });

  it('adds nothing when OpenCode cannot run or is signed out', () => {
    for (const status of [
      undefined,
      { available: false },
      { available: true, authenticated: false },
    ]) {
      expect(
        resolveOnboardingBackupProvider({
          selectedProviderId: 'claude-code',
          statusMap: { opencode: status },
          enabledProviders: {},
        }),
      ).toBeUndefined();
    }
  });

  it('respects a user who turned OpenCode off', () => {
    expect(
      resolveOnboardingBackupProvider({
        selectedProviderId: 'claude-code',
        statusMap: { opencode: runnable },
        enabledProviders: { opencode: false },
      }),
    ).toBeUndefined();
  });

  it('adds nothing without a chosen provider or on an orchestrator', () => {
    expect(
      resolveOnboardingBackupProvider({
        selectedProviderId: undefined,
        statusMap: { opencode: runnable },
        enabledProviders: {},
      }),
    ).toBeUndefined();
    expect(
      resolveOnboardingBackupProvider({
        selectedProviderId: 'claude-code',
        statusMap: { opencode: runnable },
        enabledProviders: {},
        orchestrator: true,
      }),
    ).toBeUndefined();
  });
});
