/**
 * @vitest-environment jsdom
 *
 * WorkspaceCreationError — asserts the daemon-code-driven rendering seam
 * (monorepo#826): the `errorCode` prop wins over contradicting prose, the
 * path-invalid branch renders its guidance, and the raw daemon detail is
 * visible by default for classified kinds but not duplicated for `unknown`.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

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
});
