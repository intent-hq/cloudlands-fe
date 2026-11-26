/**
 * Daemon request budgets for everyday flows (intent-hq/cloudlands-fe#5063).
 *
 * Boots the real renderer — root layout, store, every app saga, IPC seeders and
 * the browser WebSocket transport — against a scripted daemon, then counts the
 * requests each flow puts on the wire with the dev-only request counter. A flow
 * fails when a method goes over its budget, so a change that brings back a
 * redundant read (a second full workspace list at startup, a list read on every
 * page change, a per-workspace permission read, a repeat origin lookup) fails
 * here instead of in a Dev Console after release.
 *
 * The flows share one boot and run in order; each resets the counter first.
 * To see every method's count for a flow, set REQUEST_BUDGETS_REPORT=<file>.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
  beforeNavigate: vi.fn<(callback: (navigation: unknown) => void) => void>(),
  afterNavigate: vi.fn<(callback: (navigation: unknown) => void) => void>(),
}));
vi.mock('$app/navigation', () => ({
  goto: vi.fn(() => Promise.resolve()),
  beforeNavigate: nav.beforeNavigate,
  afterNavigate: nav.afterNavigate,
  onNavigate: () => {},
}));
vi.mock('$app/stores', async () => ({
  page: (await import('../../test/fake-sveltekit-page')).page,
}));
// Browser-only workers and the boot splash have no jsdom equivalent and send no requests.
vi.mock('$lib/utils/monaco-workers', () => ({ configureMonacoWorkers: async () => {} }));
vi.mock('$lib/utils/diff-highlighter-preloader', () => ({ preloadDiffHighlighter: () => {} }));
vi.mock('$features/backend/splash-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/backend/splash-gate')>()),
  dismissSplashElement: () => {},
  wireSplashGate: () => () => {},
}));

import { writeFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, type Component } from 'svelte';
import { installBrowserMock } from '$lib/browser-mock';
import {
  disableDaemonRequestCounter,
  enableDaemonRequestCounter,
  type DaemonRequestBudgets,
  type DaemonRequestCounter,
} from '$lib/client/live/daemon-request-counter';
import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { createFakeDaemon } from '../../test/fake-daemon-socket';
import { setPage } from '../../test/fake-sveltekit-page';
import { warmImport } from '../../test/warm-import';
import { isCiEnv } from '../../../scripts/vitest-timeouts.mjs';

/** Pages in one full `workspace.list` read; one admission reads the list once. */
const LIST_PAGES = 5;
const ONE_FULL_LIST = { 'workspace.list': LIST_PAGES };

const daemon = createFakeDaemon();
/** Workspaces whose management the caller has been granted since boot. */
const granted = new Set<string>();
const workspaceId = (n: number) => `amber-forest-${n}`;
const workspaceRow = (n: number) => ({
  id: workspaceId(n),
  title: `Workspace ${n}`,
  myRole: 'collaborator',
  canManage: granted.has(workspaceId(n)),
  status: 'active',
  repositoryPath: `/repos/project-${n}`,
  updatedAt: `2026-11-0${n}T00:00:00Z`,
});
daemon.handle('workspace.list', (params) => {
  const page = Number(params?.nextToken ?? 0);
  return {
    workspaces: [workspaceRow(page + 1)],
    nextToken: page + 1 < LIST_PAGES ? String(page + 1) : null,
  };
});
daemon.handle('workspace.get', (params) => ({
  workspace: workspaceRow(Number(String(params?.workspaceId).split('-').pop())),
}));
/** While set, pending-permission reads stay in flight until it resolves. */
let permissionsHeld: Promise<void> | null = null;
daemon.handle('agent.pendingPermissions', async () => {
  await permissionsHeld;
  return { requests: [] };
});
// A null reply fails the schema and retries every 5 s, which would leak into every flow.
daemon.handle('host.executionContext', () => ({
  defaultProviderId: null,
  defaultModelId: null,
  repositoryConnections: [],
  gitCredentialPolicy: {
    provider: 'github',
    protocol: 'https',
    host: 'github.com',
    managedHelperEnabled: false,
    setting: 'sourceControl.github.exposeGitCredentialToChildren',
  },
}));
daemon.handle('git.getRemoteUrl', (params) => ({
  url: `https://github.com/owner/${String(params?.path ?? params?.repoPath ?? 'repo')
    .split('/')
    .pop()}.git`,
}));

let counter: DaemonRequestCounter;
let store: typeof import('$store/renderer/store').store;
let stopRoot: () => void = () => {};
let unmountPage: () => void = () => {};
const report: Record<string, Record<string, number>> = {};

/**
 * Resolves once every request is answered and none has gone out for a quiet
 * period (longer on CI, where a slow async step can pause before its next
 * request and leak it into the next flow). Periodic polls are ignored. Throws,
 * naming the methods still being sent, when the flow never goes quiet.
 */
async function settle(timeoutMs = 30_000) {
  const quietMs = isCiEnv() ? 3_000 : 1_500;
  const polls = new Set(['system.status']);
  const busy = () => daemon.frames.filter((f) => !polls.has(f.method)).length;
  const deadline = performance.now() + timeoutMs;
  const start = daemon.frames.length;
  let seen = busy();
  let quietSince = performance.now();
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (busy() !== seen || daemon.pending() > 0) {
      seen = busy();
      quietSince = performance.now();
    } else if (performance.now() - quietSince >= quietMs) return;
  }
  const late = [...new Set(daemon.frames.slice(start).map((f) => f.method))];
  throw new Error(`requests never settled; still sending: ${late.join(', ')}`);
}

function expectWithinBudget(flow: string, budgets: DaemonRequestBudgets) {
  report[flow] = counter.counts();
  expect.soft(counter.overBudget(budgets), `${flow}: ${JSON.stringify(report[flow])}`).toEqual([]);
}

async function showPage(load: () => Promise<{ default: Component }>) {
  unmountPage();
  const { unmount } = render((await load()).default);
  unmountPage = unmount;
}

/** One client-side navigation: route hooks fire, the page store moves, the page swaps. */
async function navigate(pathname: string, load: () => Promise<{ default: Component }>) {
  const from = { url: new URL(window.location.href) };
  const to = { url: new URL(pathname, window.location.origin) };
  for (const [callback] of nav.beforeNavigate.mock.calls)
    callback({ from, to, type: 'goto', cancel: () => {} });
  setPage(pathname);
  await showPage(load);
  for (const [callback] of nav.afterNavigate.mock.calls) callback({ from, to, type: 'goto' });
}

// The app is a dev web build talking to the scripted daemon through the browser
// WebSocket transport, with the browser mock answering Electron-only IPC.
vi.stubEnv('DEV', true);
vi.stubEnv('INTENT_BUILD_TARGET', 'web');
vi.stubEnv('VITE_INTENTD_WS_URL', 'ws://127.0.0.1:7376/intentd/ws?token=request-budgets');
delete (window as Partial<Window>).electronAPI;
vi.stubGlobal('WebSocket', daemon.Socket);
setPage('/');
installBrowserMock();

const layout = () => import('../(app)/+layout.svelte') as Promise<{ default: Component }>;
const home = () => import('../(app)/+page.svelte') as Promise<{ default: Component }>;
const settings = () => import('../(app)/settings/+page.svelte') as Promise<{ default: Component }>;
warmImport(() => import('../(app)/+layout.svelte'));
warmImport(() => import('../(app)/+page.svelte'));
warmImport(() => import('../(app)/settings/+page.svelte'));

beforeAll(async () => {
  counter = enableDaemonRequestCounter()!;
  ({ store } = await import('$store/renderer/store'));
  const { startRootStoreLifecycle } = await import('$store/renderer/root-store-lifecycle');
  stopRoot = startRootStoreLifecycle(store, { startSagas: () => [] });
  const Layout = (await layout()).default;
  render(Layout, {
    props: { children: createRawSnippet(() => ({ render: () => '<div></div>' })) },
  });
  await showPage(home);
}, 120_000);

afterAll(() => {
  if (process.env.REQUEST_BUDGETS_REPORT)
    writeFileSync(process.env.REQUEST_BUDGETS_REPORT, JSON.stringify(report, null, 2));
  unmountPage();
  cleanup();
  stopRoot();
  // Close the cached transport's socket and polls before the WebSocket stub goes.
  (resolveBackendTransport() as { dispose?: () => void }).dispose?.();
  disableDaemonRequestCounter();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('daemon request budgets', () => {
  // One test, four flows: the shared test setup clears timers and the DOM after
  // every test, which would tear down the booted app between separate tests.
  // Soft assertions report every flow that goes over budget, not just the first.
  it('startup, page changes, New workspace and reconnect stay within budget', async () => {
    // Startup: one full workspace list and one pending-permissions read.
    await settle();
    expect.soft(counter.count('principal.me'), 'startup admits the caller once').toBe(1);
    expectWithinBudget('startup', { ...ONE_FULL_LIST, 'agent.pendingPermissions': 1 });

    // Home -> Settings -> Home: no list or permission reads on page changes.
    counter.reset();
    await navigate('/settings', settings);
    await settle();
    await navigate('/', home);
    await settle();
    // Home keeps the Assistant's hook, PR monitor and script monitor leases
    // through a short page change, and the capability probe is not repeated on
    // the same connection. Settings reads provider paths once when it opens.
    expectWithinBudget('page changes', {
      'workspace.list': 0,
      'agent.pendingPermissions': 0,
      'client.hello': 0,
      'events.subscribe': 0,
      'events.unsubscribe': 0,
      'hook.list': 0,
      'prMonitor.list': 0,
      'host.executionContext': 0,
      'settings.get': 1,
    });

    // New workspace opened twice: the second open within 30 s reuses every origin.
    const { setShowCreateModal } =
      await import('$store/renderer/slices/sidebar-nav/sidebar-nav-slice');
    // The origin cache lasts 30 s; a slower run would turn the second open
    // into a legitimate miss, so report that instead of a budget failure.
    const firstOpenAt = performance.now();
    counter.reset();
    store.dispatch(setShowCreateModal(true));
    await settle();
    expect
      .soft(counter.count('git.getRemoteUrl'), 'the first open looks up repository origins')
      .toBeGreaterThan(0);
    store.dispatch(setShowCreateModal(false));
    await settle();
    counter.reset();
    store.dispatch(setShowCreateModal(true));
    await settle();
    store.dispatch(setShowCreateModal(false));
    await settle();
    expect
      .soft(performance.now() - firstOpenAt, 'both opens fit in the 30 s origin cache window')
      .toBeLessThan(30_000);
    expectWithinBudget('second New workspace open', {
      'git.getRemoteUrl': 0,
      'workspace.list': 0,
      'agent.pendingPermissions': 0,
    });

    // Forced reconnect: the new admission reads the list and permissions once.
    counter.reset();
    const before = daemon.connections();
    daemon.dropConnections();
    await vi.waitFor(() => expect(daemon.connections()).toBeGreaterThan(before), {
      interval: 100,
    });
    await settle();
    expect.soft(counter.count('principal.me'), 'the reconnect re-admits the caller').toBe(1);
    expectWithinBudget('reconnect', { ...ONE_FULL_LIST, 'agent.pendingPermissions': 1 });

    // Management granted on every workspace, one row at a time, while a
    // pending-permission read is in flight (the read is slow on a large host):
    // the grants coalesce into one trailing read, never one read per workspace.
    const { selectWorkspaceById } =
      await import('$store/renderer/slices/workspace/workspace-selectors');
    counter.reset();
    let release: () => void = () => {};
    permissionsHeld = new Promise((resolve) => (release = resolve));
    for (let n = 1; n <= LIST_PAGES; n++) {
      granted.add(workspaceId(n));
      daemon.notify('events.event', {
        event: {
          type: 'workspace:updated',
          workspaceId: workspaceId(n),
          data: { changes: { members: true } },
        },
      });
      await vi.waitFor(
        () => expect(selectWorkspaceById.select(store.state, workspaceId(n))?.canManage).toBe(true),
        { interval: 20 },
      );
    }
    permissionsHeld = null;
    release();
    await settle();
    expect.soft(counter.count('workspace.get'), 'each grant re-reads its row').toBe(LIST_PAGES);
    expectWithinBudget('management grants during recovery', {
      'agent.pendingPermissions': 2,
      'workspace.list': 0,
    });
  }, 180_000);
});
