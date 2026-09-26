import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import {
  admitHostExecutionFixture,
  HOST_EXECUTION_FIXTURE,
} from '../../test/fixtures/host-execution-state';
import HostExecutionNotice from './HostExecutionNotice.svelte';

let dispose: () => void;
beforeEach(() => {
  dispose = store.init();
});
afterEach(() => {
  cleanup();
  dispose();
});

describe('member execution recovery', () => {
  it('explains the disabled managed helper without denying SSH or other helpers', () => {
    admitHostExecutionFixture('member', HOST_EXECUTION_FIXTURE);
    render(HostExecutionNotice);
    expect(screen.getByRole('status').textContent).toContain(
      'sourceControl.github.exposeGitCredentialToChildren',
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Other helpers and SSH may still work',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has no policy warning when managed injection is enabled', () => {
    admitHostExecutionFixture('member', {
      ...HOST_EXECUTION_FIXTURE,
      gitCredentialPolicy: {
        ...HOST_EXECUTION_FIXTURE.gitCredentialPolicy,
        managedHelperEnabled: true,
      },
    });
    render(HostExecutionNotice);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('directs missing repository setup to the host owner without a local account action', () => {
    admitHostExecutionFixture('member', HOST_EXECUTION_FIXTURE);
    render(HostExecutionNotice, { kind: 'repository' });
    expect(screen.getByRole('status').textContent).toContain('owner');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('treats configured GitLab access separately from current authorization', () => {
    admitHostExecutionFixture('member', {
      ...HOST_EXECUTION_FIXTURE,
      repositoryConnections: [{ provider: 'gitlab', host: 'gitlab.com', configured: true }],
    });
    render(HostExecutionNotice, { kind: 'repository' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['owner', 'guest'] as const)('preserves ordinary %s presentation', (role) => {
    admitHostExecutionFixture(role, HOST_EXECUTION_FIXTURE);
    render(HostExecutionNotice);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
