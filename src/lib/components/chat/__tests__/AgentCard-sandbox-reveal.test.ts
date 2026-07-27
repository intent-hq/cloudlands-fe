/**
 * @vitest-environment jsdom
 *
 * AgentCard — "Reveal in Finder" sandbox context-menu item (Task: agent
 * sandbox UI visibility).
 *
 * Renders the REAL component against the REAL configured store: seeds an
 * agent session (with/without `metadata.sandboxPath`) plus daemon locality
 * (`systemStatusSuccess` → `host.locality`), opens the context menu, and
 * asserts the reveal item's visibility and that clicking it invokes
 * `shell:showItemInFolder` with the sandbox path.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { systemStatusSuccess } from '$store/renderer/slices/daemon-health/daemon-health-slice';
// The global test-setup mocks $lib/electron-bridge, so `invoke` here is the
// vi.fn stub AgentCard actually calls — assert the channel + payload on it.
import { invoke } from '$lib/electron-bridge';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

const mockedInvoke = vi.mocked(invoke);
// Preserve the test-setup default implementation so a full reset (which also
// drops leftover one-off stubs like mockRejectedValueOnce) can restore it.
const defaultInvokeImpl = mockedInvoke.getMockImplementation();

const SANDBOX_PATH = '/Users/dev/.dev/intentd/sandboxes/agent-abc/monorepo';

// Distinct agent id per test: the configured store is a process singleton and
// the upsert no-op guard (`isSessionEquivalent`) does not compare `metadata`,
// so re-upserting the same id with different metadata would be dropped.
let testAgentSeq = 0;
let agentId = '';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'Sandboxed Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

/** Dispatch a system.status poll result with the given daemon locality. */
function seedLocality(locality: 'local' | 'remote') {
  appStore.dispatch(
    systemStatusSuccess({
      running: true,
      listenMode: 'both',
      transports: ['uds'],
      clients: 1,
      agents: 1,
      protocolVersion: '2.4',
      host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality },
    }),
  );
}

async function openContextMenu() {
  const card = await screen.findByTestId('agent-list-item');
  const button = card.querySelector('button');
  expect(button).not.toBeNull();
  await fireEvent.contextMenu(button!);
}

describe('AgentCard sandbox "Reveal in" context-menu item', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-sbx-${++testAgentSeq}`;
  });

  afterEach(() => {
    // Full reset (not just mockClear): drops any unconsumed one-off stubs
    // (e.g. mockRejectedValueOnce from a test that bailed early) so behavior
    // never leaks between tests; then restore the test-setup default impl.
    mockedInvoke.mockReset();
    if (defaultInvokeImpl) mockedInvoke.mockImplementation(defaultInvokeImpl);
    appStore.dispatch(removeSession(agentId));
  });

  it('shows the reveal item when the agent has a sandboxPath and the daemon is local', async () => {
    seedLocality('local');
    appStore.dispatch(bulkUpsertSessions([makeSession({ metadata: { sandboxPath: SANDBOX_PATH } })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    expect(await screen.findByText(/^Reveal in /)).toBeTruthy();
  });

  it('hides the reveal item when the agent has no sandboxPath', async () => {
    seedLocality('local');
    appStore.dispatch(bulkUpsertSessions([makeSession({ metadata: {} })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    // Menu is open (Open/Rename present) but no reveal entry.
    expect(await screen.findByText('Open')).toBeTruthy();
    expect(screen.queryByText(/^Reveal in /)).toBeNull();
  });

  it('hides the reveal item when the daemon is remote', async () => {
    seedLocality('remote');
    appStore.dispatch(bulkUpsertSessions([makeSession({ metadata: { sandboxPath: SANDBOX_PATH } })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    expect(await screen.findByText('Open')).toBeTruthy();
    expect(screen.queryByText(/^Reveal in /)).toBeNull();
  });

  it('invokes shell:showItemInFolder with the sandbox path on click', async () => {
    seedLocality('local');
    appStore.dispatch(bulkUpsertSessions([makeSession({ metadata: { sandboxPath: SANDBOX_PATH } })]));

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText(/^Reveal in /);
    await fireEvent.click(item);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('shell:showItemInFolder', {
        path: SANDBOX_PATH,
      });
    });
  });

  it('surfaces a reveal failure as an error toast (no silent no-op)', async () => {
    seedLocality('local');
    appStore.dispatch(bulkUpsertSessions([makeSession({ metadata: { sandboxPath: SANDBOX_PATH } })]));
    mockedInvoke.mockRejectedValueOnce(new Error('open exited with code 1'));
    const { toast } = await import('svelte-sonner');
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '' as never);

    render(AgentCard, { props: { agentId } });
    await openContextMenu();

    const item = await screen.findByText(/^Reveal in /);
    await fireEvent.click(item);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('open exited with code 1');
    });
    errorSpy.mockRestore();
  });
});
