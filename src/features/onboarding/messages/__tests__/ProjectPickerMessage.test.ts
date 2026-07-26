/**
 * @vitest-environment jsdom
 *
 * Pre-flight validation of the GitHub tab's clone destination.
 *
 * The GitHub tab mirrors the New-project tab's `file:getDirectoryStatus`
 * check for the computed full clone target (`<clonePath>/<repo>`): when the
 * target exists and is non-empty, an inline error is shown and the selection
 * reports `isValid: false` so the flow cannot advance into a doomed clone.
 * A MISSING target (including a missing parent like `~/Developer`) must NOT
 * block — git clone creates the leading directories.
 *
 * Wire shape: the renderer `invoke('file:getDirectoryStatus', { path })`
 * resolves through the mock IPC router to the host-bridge-seeder, which
 * forwards `{ path }` to the daemon's `host.directoryStatus` RPC and wraps
 * the response in `{ success, data }`. The tests assert the exact RPC method
 * + params on `backendRequest` and feed back the daemon response shape from
 * intent-transport host_ops.rs.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (
    await import('../../../../lib/components/modals/__tests__/mocks/MockPortal.svelte')
  ).default;
  return { default: MockPortal };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { setMockIpcInvokeFallback } from '$shared/ipc-mock-router';
// Side-effect import: bridges `file:getDirectoryStatus` → daemon `host.directoryStatus`.
import '$store/renderer/seeders/host-bridge-seeder';

import ProjectPickerMessage, { type ProjectSelection } from '../ProjectPickerMessage.svelte';

const backendRequestMock = vi.mocked(backendRequest);

/** Daemon `host.directoryStatus` response shape (intent-transport host_ops.rs). */
const directoryStatus = (overrides: Record<string, unknown> = {}) => ({
  exists: false,
  isDirectory: false,
  isEmpty: true,
  isGitRepo: false,
  isSubdirectoryOfGitRepo: false,
  path: '/Users/me/Developer/hello',
  ...overrides,
});

/** Route daemon RPCs: capture `host.directoryStatus` params, benign defaults elsewhere. */
function mockDaemon(status: Record<string, unknown>): Array<Record<string, unknown>> {
  const dirStatusCalls: Array<Record<string, unknown>> = [];
  backendRequestMock.mockImplementation(((method: string, params?: unknown) => {
    if (method === 'host.directoryStatus') {
      dirStatusCalls.push(params as Record<string, unknown>);
      return Promise.resolve(status);
    }
    if (method === 'host.checkGit') return Promise.resolve({ available: true });
    return Promise.resolve(undefined);
  }) as never);
  return dirStatusCalls;
}

/** Render the picker, switch to the GitHub tab, and return the URL input. */
async function openGithubTab(
  onProjectChange: (selection: ProjectSelection) => void,
): Promise<HTMLInputElement> {
  render(ProjectPickerMessage, { props: { onProjectChange } });
  const tabButton = Array.from(document.body.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'GitHub repo',
  );
  if (!tabButton) throw new Error('GitHub repo tab button not found');
  await fireEvent.click(tabButton);
  return waitFor(() => {
    const el = document.body.querySelector('input[role="combobox"]');
    if (!el) throw new Error('GitHub URL input not rendered yet');
    return el as HTMLInputElement;
  });
}

describe('ProjectPickerMessage — GitHub tab clone destination pre-flight', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    // Unrelated channels invoked during tab mount (github auth/search) resolve
    // to undefined instead of rejecting as unbridged.
    setMockIpcInvokeFallback(undefined);
  });

  afterEach(() => {
    cleanup();
    backendRequestMock.mockReset();
  });

  it('shows an inline error and reports isValid:false when the clone target exists and is non-empty', async () => {
    const dirStatusCalls = mockDaemon(
      directoryStatus({ exists: true, isDirectory: true, isEmpty: false, isGitRepo: true }),
    );
    const selections: ProjectSelection[] = [];
    const input = await openGithubTab((s) => selections.push(s));

    await fireEvent.input(input, { target: { value: 'octo/hello' } });

    // Exact wire request: the daemon is asked about the FULL clone target
    // (<clonePath>/<repo>), not the bare parent directory.
    await waitFor(() => expect(dirStatusCalls).toContainEqual({ path: '~/Developer/hello' }), {
      timeout: 3000,
    });
    expect(dirStatusCalls).not.toContainEqual({ path: '~/Developer' });

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        'Clone destination already exists and is not empty.',
      );
    });

    const last = selections.at(-1);
    expect(last?.type).toBe('github');
    expect(last?.clonePath).toBe('~/Developer/hello');
    expect(last?.isValid).toBe(false);
  });

  it('does not block when the clone target (and its parent) is missing — git creates it', async () => {
    const dirStatusCalls = mockDaemon(directoryStatus({ exists: false }));
    const selections: ProjectSelection[] = [];
    const input = await openGithubTab((s) => selections.push(s));

    await fireEvent.input(input, { target: { value: 'octo/hello' } });

    await waitFor(() => expect(dirStatusCalls).toContainEqual({ path: '~/Developer/hello' }), {
      timeout: 3000,
    });
    await waitFor(() => {
      const last = selections.at(-1);
      expect(last?.isValid).toBe(true);
    });
    const last = selections.at(-1);
    expect(last?.type).toBe('github');
    expect(last?.clonePath).toBe('~/Developer/hello');
    expect(document.body.textContent).not.toContain(
      'Clone destination already exists and is not empty.',
    );
  });
});
