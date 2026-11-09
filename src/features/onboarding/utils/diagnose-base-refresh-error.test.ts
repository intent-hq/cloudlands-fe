import { describe, expect, it } from 'vitest';
import { diagnoseBaseRefreshError } from './diagnose-base-refresh-error';

const failure = (category: string, detail: string) =>
  ({ category, detail, baseRef: 'main', remote: 'origin' }) as const;

describe('diagnoseBaseRefreshError (PROTOCOL §9.2)', () => {
  it('is undefined for any other daemon code, so Continue never shows for them', () => {
    expect(diagnoseBaseRefreshError('Internal error: boom', 'clone-failed')).toBeUndefined();
    expect(diagnoseBaseRefreshError('Internal error: boom', null)).toBeUndefined();
    expect(diagnoseBaseRefreshError('boom', 'network', failure('network', 'boom'))).toBeUndefined();
  });

  it('keeps the daemon category, base and remote', () => {
    const d = diagnoseBaseRefreshError(
      "Couldn't update main from origin: Could not resolve host: github.com",
      'base-refresh-failed',
      failure('network', 'fatal: unable to access: Could not resolve host: github.com'),
    );
    expect(d).toMatchObject({ category: 'network', baseRef: 'main', remote: 'origin' });
    expect(d?.cause).toContain('Could not resolve host');
  });

  it('falls back to the message as the cause when detail is empty', () => {
    const d = diagnoseBaseRefreshError(
      "Couldn't update main from origin: timed out",
      'base-refresh-failed',
      failure('timeout', ''),
    );
    expect(d?.cause).toBe("Couldn't update main from origin: timed out");
  });

  it('reads a code without data as other, with the message as cause', () => {
    const d = diagnoseBaseRefreshError('Couldn’t update main', 'base-refresh-failed');
    expect(d).toMatchObject({ category: 'other', cause: 'Couldn’t update main' });
  });

  it('tells SSH remotes from HTTPS remotes for auth-required', () => {
    expect(
      diagnoseBaseRefreshError(
        'x',
        'base-refresh-failed',
        failure('auth-required', 'git@github.com: Permission denied (publickey).'),
      )?.transport,
    ).toBe('ssh');
    expect(
      diagnoseBaseRefreshError(
        'x',
        'base-refresh-failed',
        failure(
          'auth-required',
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        ),
      )?.transport,
    ).toBe('https');
    expect(
      diagnoseBaseRefreshError('x', 'base-refresh-failed', failure('auth-required', 'nope'))
        ?.transport,
    ).toBe('unknown');
  });

  it('extracts the SSH host for the ssh-host-key command when git names it', () => {
    const d = diagnoseBaseRefreshError(
      'x',
      'base-refresh-failed',
      failure(
        'ssh-host-key',
        'No ED25519 host key is known for github.com and you have requested strict checking.\nHost key verification failed.\nfatal: Could not read from remote repository.',
      ),
    );
    expect(d?.sshHost).toBe('github.com');
  });

  it('extracts user@host from an scp-style remote', () => {
    const d = diagnoseBaseRefreshError(
      'x',
      'base-refresh-failed',
      failure(
        'ssh-host-key',
        "Host key verification failed.\nfatal: 'git@gitlab.example.com:team/app.git'",
      ),
    );
    expect(d?.sshHost).toBe('git@gitlab.example.com');
  });

  it('leaves the host undefined when git names none', () => {
    const d = diagnoseBaseRefreshError(
      'x',
      'base-refresh-failed',
      failure('ssh-host-key', 'Host key verification failed.'),
    );
    expect(d?.sshHost).toBeUndefined();
  });
});
