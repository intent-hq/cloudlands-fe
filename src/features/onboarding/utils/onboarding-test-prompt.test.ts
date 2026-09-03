import { describe, expect, it } from 'vitest';
import type { ProviderCatalogEntry } from '$shared/provider-catalog';
import { mapTestPromptFailure, providerSupportsTestPrompt } from './onboarding-test-prompt';

function entry(overrides: Partial<ProviderCatalogEntry> = {}): ProviderCatalogEntry {
  return {
    id: 'claude-code',
    displayName: 'Claude Code',
    shortName: 'Claude',
    command: 'claude',
    canBeDisabled: true,
    visible: true,
    ...overrides,
  };
}

describe('providerSupportsTestPrompt', () => {
  it('is true only for an explicit supportsTestPrompt: true', () => {
    expect(providerSupportsTestPrompt(entry({ supportsTestPrompt: true }))).toBe(true);
    expect(providerSupportsTestPrompt(entry({ supportsTestPrompt: false }))).toBe(false);
  });

  it('treats an absent flag (pre-v9.3 daemon) and a missing entry as unsupported', () => {
    expect(providerSupportsTestPrompt(entry())).toBe(false);
    expect(providerSupportsTestPrompt(undefined)).toBe(false);
  });
});

describe('mapTestPromptFailure', () => {
  it('auth-required surfaces the catalog loginCommandHint + docs url and flags the refresh', () => {
    const guidance = mapTestPromptFailure(
      { reason: 'auth-required', message: 'not logged in' },
      entry({ loginCommandHint: 'claude auth login', loginDocsUrl: 'https://docs.example' }),
      'claude-code',
    );
    expect(guidance.isAuthRequired).toBe(true);
    expect(guidance.loginCommandHint).toBe('claude auth login');
    expect(guidance.loginDocsUrl).toBe('https://docs.example');
    expect(guidance.showClaudeDesktopNote).toBe(true);
    expect(guidance.message).toContain('Claude Code');
  });

  it('auth-required falls back to "<command> login" when the catalog has no hint', () => {
    const guidance = mapTestPromptFailure(
      { reason: 'auth-required', message: 'x' },
      entry({ id: 'codex', displayName: 'Codex', command: 'codex' }),
      'codex',
    );
    expect(guidance.loginCommandHint).toBe('codex login');
    expect(guidance.loginDocsUrl).toBeUndefined();
    expect(guidance.showClaudeDesktopNote).toBe(false);
  });

  it('auth-required with no catalog entry falls back to "<providerId> login"', () => {
    const guidance = mapTestPromptFailure(
      { reason: 'auth-required', message: 'x' },
      undefined,
      'codex',
    );
    expect(guidance.loginCommandHint).toBe('codex login');
    expect(guidance.message).toContain('codex');
  });

  it('the claude desktop note is claude-code-only', () => {
    const other = mapTestPromptFailure(
      { reason: 'auth-required', message: 'x' },
      entry({ id: 'codex', displayName: 'Codex', command: 'codex' }),
      'codex',
    );
    expect(other.showClaudeDesktopNote).toBe(false);
  });

  it('non-auth reasons carry no login affordances and no refresh flag', () => {
    for (const reason of ['busy', 'timeout', 'not-installed', 'unsupported', 'spawn-failed']) {
      const guidance = mapTestPromptFailure(
        { reason, message: 'detail' },
        entry({ loginCommandHint: 'claude auth login' }),
        'claude-code',
      );
      expect(guidance.isAuthRequired).toBe(false);
      expect(guidance.loginCommandHint).toBeUndefined();
      expect(guidance.showClaudeDesktopNote).toBe(false);
      expect(guidance.message).not.toEqual('');
    }
  });

  it('not-installed and generic messages embed the daemon-reported detail', () => {
    const notInstalled = mapTestPromptFailure(
      { reason: 'not-installed', message: 'binary missing from PATH' },
      entry(),
      'claude-code',
    );
    expect(notInstalled.message).toContain('binary missing from PATH');

    const generic = mapTestPromptFailure(
      { reason: 'error', message: 'exit code 1' },
      entry(),
      'claude-code',
    );
    expect(generic.message).toContain('exit code 1');
  });

  it('an unknown future reason falls through to the generic branch instead of throwing', () => {
    const guidance = mapTestPromptFailure(
      { reason: 'rate-limited', message: 'too many requests' },
      entry(),
      'claude-code',
    );
    expect(guidance.isAuthRequired).toBe(false);
    expect(guidance.message).toContain('too many requests');
  });
});
