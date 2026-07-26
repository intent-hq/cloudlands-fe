import {
  describe,
  expect,
  it,
} from 'vitest';
import { diagnoseCloneError } from './diagnose-clone-error';

describe('diagnoseCloneError', () => {
  it('returns unknown for empty/whitespace input', () => {
    expect(diagnoseCloneError('').kind).toBe('unknown');
    expect(diagnoseCloneError(undefined).kind).toBe('unknown');
    expect(diagnoseCloneError('   \n').kind).toBe('unknown');
  });

  it('classifies the real-world askpass packaging failure', () => {
    const msg =
      "fatal: cannot exec '/Users/x/Downloads/Intent.app/.../app.asar/resources/bin/ssh-askpass-intent.sh': Not a directory\n" +
      'fatal: could not read Username for https://github.com: terminal prompts disabled';
    expect(diagnoseCloneError(msg).kind).toBe('askpass-missing');
  });

  it('prefers askpass-missing over auth-required when both signals are present', () => {
    const msg =
      'fatal: cannot exec ssh-askpass-intent.sh\nfatal: could not read Username for https://github.com: terminal prompts disabled';
    expect(diagnoseCloneError(msg).kind).toBe('askpass-missing');
  });

  it('classifies bare auth-required messages', () => {
    expect(diagnoseCloneError('fatal: Authentication failed').kind).toBe('auth-required');
    expect(
      diagnoseCloneError('This repository requires authentication. Please sign in.').kind,
    ).toBe('auth-required');
    expect(diagnoseCloneError('git@github.com: Permission denied (publickey).').kind).toBe(
      'auth-required',
    );
  });

  it('does NOT classify github-oauth copy as auth-required', () => {
    expect(
      diagnoseCloneError('GitHub authentication is required to list your repositories.').kind,
    ).not.toBe('auth-required');
  });

  it('classifies repository-not-found', () => {
    expect(diagnoseCloneError('ERROR: Repository not found.').kind).toBe('repo-not-found');
    expect(
      diagnoseCloneError('fatal: unable to access ... The requested URL returned error: 404').kind,
    ).toBe('repo-not-found');
  });

  it('classifies access-denied (403)', () => {
    expect(diagnoseCloneError('The requested URL returned error: 403').kind).toBe('access-denied');
  });

  it('classifies network errors', () => {
    expect(diagnoseCloneError('Could not resolve host: github.com').kind).toBe('network');
    expect(diagnoseCloneError('network is unreachable').kind).toBe('network');
    expect(diagnoseCloneError('operation timed out').kind).toBe('network');
  });

  it('classifies destination-exists', () => {
    expect(
      diagnoseCloneError(
        "fatal: destination path '/Users/x/dev/repo' already exists and is not an empty directory.",
      ).kind,
    ).toBe('destination-exists');
  });

  it('classifies git-not-installed', () => {
    expect(diagnoseCloneError('spawn git ENOENT').kind).toBe('git-not-installed');
  });

  it('preserves the raw message regardless of kind', () => {
    const raw = 'ERROR: Repository not found.';
    expect(diagnoseCloneError(raw).rawMessage).toBe(raw);
  });

  describe('daemon-authored error codes (PROTOCOL §9.1, monorepo#826)', () => {
    it('maps each stable daemon code to its kind, ignoring the prose', () => {
      const detail = 'workspace.create clone failed (x): some unrecognizable detail';
      expect(diagnoseCloneError(detail, 'auth-required').kind).toBe('auth-required');
      expect(diagnoseCloneError(detail, 'repo-not-found').kind).toBe('repo-not-found');
      expect(diagnoseCloneError(detail, 'access-denied').kind).toBe('access-denied');
      expect(diagnoseCloneError(detail, 'network').kind).toBe('network');
      expect(diagnoseCloneError(detail, 'destination-exists-non-empty').kind).toBe(
        'destination-exists',
      );
      expect(diagnoseCloneError(detail, 'path-invalid').kind).toBe('path-invalid');
    });

    it('classifies repo-not-found and access-denied by code even with an empty message', () => {
      expect(diagnoseCloneError('', 'repo-not-found').kind).toBe('repo-not-found');
      expect(diagnoseCloneError('', 'access-denied').kind).toBe('access-denied');
    });

    it('daemon code wins over a conflicting prose match', () => {
      const msg = 'fatal: Authentication failed for https://github.com/a/b.git';
      expect(diagnoseCloneError(msg, 'network').kind).toBe('network');
    });

    it('lets askpass-missing prose win over an auth-required code', () => {
      const msg =
        'fatal: cannot exec ssh-askpass-intent.sh\nfatal: could not read Username: terminal prompts disabled';
      expect(diagnoseCloneError(msg, 'auth-required').kind).toBe('askpass-missing');
    });

    it('keeps auth-required when the prose mentions askpass without matching askpass-missing', () => {
      // "askpass" appears, but not in one of the askpass-missing shapes — the
      // authoritative daemon code must not degrade to unknown (monorepo#837).
      expect(
        diagnoseCloneError("error: unable to read askpass response from '/x/y'", 'auth-required')
          .kind,
      ).toBe('auth-required');
    });

    it('falls back to prose matching for the clone-failed catch-all and unknown codes', () => {
      expect(diagnoseCloneError('ERROR: Repository not found.', 'clone-failed').kind).toBe(
        'repo-not-found',
      );
      expect(diagnoseCloneError('something opaque', 'some-future-code').kind).toBe('unknown');
    });

    it('preserves the raw message when classified by code', () => {
      const raw = 'workspace.create clone failed (network): could not resolve host';
      expect(diagnoseCloneError(raw, 'network').rawMessage).toBe(raw);
    });
  });
});
