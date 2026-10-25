import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
import type { Workspace } from '$shared/types';

afterEach(cleanup);

// A daemon status update must change the accessible meaning, even within one Home group.
describe('Home workspace status updates', () => {
  it('distinguishes open, mergeable and queued PRs as their state changes', async () => {
    const view = render(HomeWorkspaceStatus, { workspace: { displayStatus: 'pr_open' } });
    expect(view.getByRole('img', { name: /PR open/i })).toBeTruthy();
    await view.rerender({ workspace: { displayStatus: 'pr_ready' } });
    expect(view.getByRole('img', { name: /PR Mergeable/i })).toBeTruthy();
    await view.rerender({ workspace: { displayStatus: 'pr_queued' } });
    expect(view.getByRole('img', { name: /PR queued/i })).toBeTruthy();
  });

  it.each(['pr_open', 'pr_ready', 'pr_queued'] as const)(
    'restores %s after a review request clears and keeps running precedence',
    async (displayStatus) => {
      const view = render(HomeWorkspaceStatus, {
        workspace: { displayStatus, attention: 'review_required' },
      });
      expect(view.getByRole('img', { name: /Needs you/i })).toBeTruthy();
      await view.rerender({ workspace: { displayStatus, activity: 'agent_running' } });
      expect(
        view.getByRole('img', {
          name: displayStatus === 'pr_ready' ? /PR Mergeable/i : /Running/i,
        }),
      ).toBeTruthy();
      await view.rerender({ workspace: { displayStatus } });
      expect(view.getByRole('img', { name: /PR /i })).toBeTruthy();
    },
  );
});

describe('Home script-running indicator', () => {
  it('labels a script-only workspace Running and explains the script', async () => {
    const view = render(HomeWorkspaceStatus, { workspace: { displayStatus: 'idle' } });
    expect(view.getByRole('img', { name: /Idle/i })).toBeTruthy();
    await view.rerender({ workspace: { displayStatus: 'idle', scriptsRunning: true } });
    expect(view.getByRole('img', { name: /^Running\. A command script/i })).toBeTruthy();
    await view.rerender({ workspace: { displayStatus: 'idle', scriptsRunning: false } });
    expect(view.getByRole('img', { name: /Idle/i })).toBeTruthy();
  });
});

describe('Home waiting indicator', () => {
  it('updates when idle waiting starts and clears, including absent and false flags', async () => {
    const view = render(HomeWorkspaceStatus, { workspace: { displayStatus: 'idle' } });
    expect(view.queryByRole('img', { name: /Waiting/i })).toBeNull();
    await view.rerender({ workspace: { displayStatus: 'idle', waiting: true } });
    expect(view.getByRole('img', { name: /Waiting/i })).toBeTruthy();
    await view.rerender({ workspace: { displayStatus: 'idle', waiting: false } });
    expect(view.getByRole('img', { name: /Idle/i })).toBeTruthy();
    expect(view.queryByRole('img', { name: /Waiting/i })).toBeNull();
  });

  it.each([
    ['pr_open', /PR open/i],
    ['pr_ready', /PR Mergeable/i],
    ['pr_queued', /PR queued/i],
    ['pr_merged', /Done/i],
    ['complete', /Done/i],
  ] as const)(
    'keeps %s accessible while waiting starts and clears',
    async (displayStatus, name) => {
      const view = render(HomeWorkspaceStatus, { workspace: { displayStatus, waiting: true } });
      expect(view.getByRole('img', { name }).getAttribute('aria-label')).toMatch(/Waiting/i);
      await view.rerender({ workspace: { displayStatus, waiting: false } });
      expect(view.getByRole('img', { name }).getAttribute('aria-label')).not.toMatch(/Waiting/i);
    },
  );

  it.each([
    { displayStatus: 'failed' },
    { displayStatus: 'blocked' },
    { displayStatus: 'needs_attention' },
    { displayStatus: 'pr_ready', attention: 'review_required' },
    { displayStatus: 'pr_open', activity: 'agent_running' },
    { displayStatus: 'pr_queued', activity: 'agent_running' },
    { displayStatus: 'idle', attention: 'unread' },
  ] satisfies Partial<Workspace>[])(
    'keeps priority signals above waiting: %o',
    async (workspace) => {
      const view = render(HomeWorkspaceStatus, { workspace });
      const name = view.getByRole('img').getAttribute('aria-label');
      await view.rerender({ workspace: { ...workspace, waiting: true } });
      expect(view.getByRole('img').getAttribute('aria-label')).toBe(name);
    },
  );
});
