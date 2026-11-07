/**
 * @vitest-environment jsdom
 *
 * WorkspaceCreationError — asserts the daemon-code-driven rendering seam
 * (monorepo#826): the `errorCode` prop wins over contradicting prose, the
 * path-invalid branch renders its guidance, and the raw daemon detail is
 * visible by default for classified kinds but not duplicated for `unknown`.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

vi.mock('$lib/electron-bridge', () => ({
  shell: { open: vi.fn(() => Promise.resolve()) },
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import WorkspaceCreationError from './WorkspaceCreationError.svelte';

describe('WorkspaceCreationError', () => {
  it('lets the daemon errorCode drive the title even when the prose contradicts it', () => {
    // PROTOCOL §9.1-shaped failure: network code with auth-looking prose.
    const { container } = render(WorkspaceCreationError, {
      props: {
        message:
          'workspace.create clone failed (network): fatal: Authentication service unreachable',
        errorCode: 'network',
      },
    });
    expect(container.textContent).toContain('Network error');
    expect(container.textContent).not.toContain('GitHub authentication required');
  });

  it('renders the path-invalid guidance branch', () => {
    const { container } = render(WorkspaceCreationError, {
      props: {
        message:
          'workspace.create clone failed (path-invalid): clonePath must resolve to a non-empty target',
        errorCode: 'path-invalid',
      },
    });
    expect(container.textContent).toContain('Clone destination is not usable');
    expect(container.textContent).toContain('Pick a different folder');
  });

  it('shows the raw daemon detail expanded by default for classified kinds', () => {
    const detail =
      "workspace.create clone failed (auth-required): fatal: could not read Username for 'https://github.com': terminal prompts disabled";
    const { container } = render(WorkspaceCreationError, {
      props: { message: detail, errorCode: 'auth-required' },
    });
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('terminal prompts disabled');
  });

  it('does not duplicate the raw message for unknown kinds', () => {
    // The unknown branch renders rawMessage as the body — the details <pre>
    // must not repeat it.
    const { container } = render(WorkspaceCreationError, {
      props: { message: 'something entirely opaque' },
    });
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).toContain('something entirely opaque');
  });

  it('renders the retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    const { container } = render(WorkspaceCreationError, {
      props: { message: 'boom', errorCode: 'network', onRetry },
    });
    const retry = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Try again'),
    );
    expect(retry).toBeDefined();
  });

  describe('base-refresh-failed (PROTOCOL §9.2)', () => {
    const baseRefresh = (category: string, detail: string) => ({
      message: `Couldn't update main from origin: ${detail}`,
      errorCode: 'base-refresh-failed',
      baseRefreshFailure: { category, detail, baseRef: 'main', remote: 'origin' } as never,
    });
    const buttons = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());

    it.each([
      [
        'auth-required',
        'git@github.com: Permission denied (publickey).',
        "Couldn't sign in to origin",
        'no SSH key or agent',
      ],
      [
        'ssh-host-key',
        'No ED25519 host key is known for github.com and you have requested strict checking.\nHost key verification failed.',
        "The origin host isn't trusted yet",
        'ssh -T github.com',
      ],
      [
        'network',
        'fatal: unable to access: Could not resolve host: github.com',
        "Couldn't reach origin",
        'network, VPN, or proxy',
      ],
      [
        'timeout',
        'fetch timed out after 100s',
        'Updating main took too long',
        'continue from the last-fetched copy',
      ],
      [
        'repo-not-found',
        "fatal: 'origin' does not appear to be a git repository",
        'Remote repository not found',
        'remote URL may be wrong',
      ],
      [
        'access-denied',
        'The requested URL returned error: 403',
        'Access denied by origin',
        "isn't allowed to fetch it",
      ],
      ['other', 'fatal: something odd', "Couldn't update main", 'Git reported'],
    ])(
      'renders the %s title, the git cause and its guidance',
      (category, detail, title, guidance) => {
        const { container } = render(WorkspaceCreationError, {
          props: { ...baseRefresh(category, detail), onRetry: vi.fn(), onContinue: vi.fn() },
        });
        const text = container.textContent ?? '';
        expect(text).toContain(title);
        expect(text).toContain(guidance);
        expect(text.toLowerCase()).toContain('the machine intent runs on');
        expect(container.querySelector('pre')?.textContent).toContain(detail.split('\n')[0]);
        expect(text).not.toContain('gh auth login');
        expect(buttons(container)).toContain('Try again');
        expect(buttons(container)).toContain('Continue from last-fetched main');
      },
    );

    it('shows only the matching transport guidance when the cause names it', () => {
      const ssh = render(WorkspaceCreationError, {
        props: baseRefresh('auth-required', 'git@github.com: Permission denied (publickey).'),
      });
      expect(ssh.container.textContent).toContain('SSH key');
      expect(ssh.container.textContent).not.toContain('saved credential');
      ssh.unmount();
      const https = render(WorkspaceCreationError, {
        props: baseRefresh(
          'auth-required',
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        ),
      });
      expect(https.container.textContent).toContain('saved credential');
      expect(https.container.textContent).not.toContain('SSH key');
    });

    it('calls onContinue when Continue is clicked', async () => {
      const onContinue = vi.fn();
      const { container } = render(WorkspaceCreationError, {
        props: { ...baseRefresh('network', 'Could not resolve host: github.com'), onContinue },
      });
      const button = Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Continue from last-fetched'),
      );
      await fireEvent.click(button!);
      expect(onContinue).toHaveBeenCalledOnce();
    });

    it('offers no Continue for any other error, even with an onContinue handler', () => {
      for (const errorCode of [null, 'network', 'clone-failed', 'base-ref-unresolvable']) {
        const { container, unmount } = render(WorkspaceCreationError, {
          props: {
            message: 'Internal error: boom',
            errorCode,
            onRetry: vi.fn(),
            onContinue: vi.fn(),
          },
        });
        expect(buttons(container).some((b) => b.includes('Continue'))).toBe(false);
        expect(buttons(container)).toContain('Try again');
        unmount();
      }
    });
  });
});
