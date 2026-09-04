/**
 * @vitest-environment jsdom
 *
 * MonitoredPrsRow rendering (PROTOCOL §6.9): inline disclosure rows for the
 * active agent's ACTIVE monitors, summary labels (repo shown as `repo #N`
 * same-owner, `owner/repo #N` cross-owner or unknown workspace repo),
 * expandable last-refresh details, and the kebab action menu (check and
 * flush / open in app / open in external browser / cancel) dispatch wiring.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';

const { dispatchMock, monitorsState, workspaceState, handleLinkMock, openInBrowserPanelMock } =
  vi.hoisted(() => ({
    dispatchMock: vi.fn(),
    monitorsState: { monitors: [] as unknown[] },
    workspaceState: {
      workspace: {
        id: 'ws-1',
        repositoryOwner: 'acme',
        repositoryName: 'widgets',
      } as unknown,
    },
    handleLinkMock: vi.fn(),
    openInBrowserPanelMock: vi.fn(),
  }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' } }),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectAgentPrMonitors: () => ({
    subscribe: (run: (value: unknown[]) => void) => {
      run(monitorsState.monitors);
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => ({
    subscribe: (run: (value: unknown) => void) => {
      run(workspaceState.workspace);
      return () => {};
    },
  }),
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: handleLinkMock,
  openInBrowserPanel: openInBrowserPanelMock,
}));

import MonitoredPrsRow from '../MonitoredPrsRow.svelte';
import monitoredPrsRowSource from '../MonitoredPrsRow.svelte?raw';
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
} from '$store/renderer/slices/pr-monitor/pr-monitor-slice';

const originalInnerWidth = window.innerWidth;
const originalDevicePixelRatio = window.devicePixelRatio;

function setViewport(width: number, devicePixelRatio = 1) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: devicePixelRatio,
  });
  window.dispatchEvent(new Event('resize'));
}

async function openMenu() {
  await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
  const menu = await waitFor(() => screen.getByTestId('monitored-pr-menu'));
  const content = menu.closest<HTMLElement>('[data-slot="menu-content"]');
  if (!content) throw new Error('Expected the monitored PR menu to render inside menu content');
  return { menu, content };
}

// JSDOM does not apply component stylesheets, so the production
// .monitored-pr-menu-content sizing is read from the component source and
// modeled against the test viewport. Removing or altering the rule (the
// menu's only width constraint) fails here instead of staying green.
function readMenuContentRule() {
  const rule = /\.monitored-pr-menu-content\)?\s*\{([^}]*)\}/.exec(monitoredPrsRowSource)?.[1];
  if (!rule) {
    throw new Error('Expected a .monitored-pr-menu-content rule in MonitoredPrsRow.svelte');
  }
  const width = /(?:^|;)\s*width:\s*([0-9]+)px/.exec(rule)?.[1];
  const viewportInset = /max-width:\s*calc\(100vw\s*-\s*([0-9]+)px\)/.exec(rule)?.[1];
  if (!width || !viewportInset) {
    throw new Error(
      'Expected the .monitored-pr-menu-content rule to set width and a viewport-clamped max-width',
    );
  }
  return { preferredWidth: Number(width), viewportInset: Number(viewportInset) };
}

function measureRenderedMenu(menu: HTMLElement) {
  const viewportPadding = Number(menu.dataset.viewportPadding);
  const { preferredWidth, viewportInset } = readMenuContentRule();
  expect(viewportInset).toBe(viewportPadding * 2);
  const width = Math.min(preferredWidth, window.innerWidth - viewportInset);
  const right = window.innerWidth - viewportPadding;
  const rect = {
    x: right - width,
    y: 0,
    left: right - width,
    right,
    top: 0,
    bottom: 0,
    width,
    height: 0,
    toJSON: () => ({}),
  } as DOMRect;
  menu.getBoundingClientRect = () => rect;
  return menu.getBoundingClientRect();
}

function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
  return {
    monitorId: 'mon-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    repo: 'acme/widgets',
    prNumber: 42,
    state: 'active',
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: '2026-08-07T10:00:00Z',
    updatedAt: '2026-08-07T10:05:00Z',
    title: 'Fix widget rendering',
    url: 'https://github.com/acme/widgets/pull/42',
    lastSnapshot: {
      state: 'open',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      mergeable: true,
      checks: {
        total: 4,
        passed: 3,
        failed: 0,
        pending: 1,
        failingRequired: 0,
        pendingRequired: 1,
        requiredKnown: true,
      },
      approvals: { decision: 'REVIEW_REQUIRED', have: 0, needed: 1, changesRequested: 0 },
      threads: { unresolved: 2, resolutionRequired: true },
      rulesKnown: true,
    },
    ...overrides,
  };
}

async function openDetails() {
  await fireEvent.click(screen.getByTestId('monitored-pr-summary'));
  return screen.getByTestId('monitored-pr-details');
}

describe('MonitoredPrsRow', () => {
  const defaultWorkspace = workspaceState.workspace;

  afterEach(() => {
    cleanup();
    setViewport(originalInnerWidth, originalDevicePixelRatio);
    dispatchMock.mockClear();
    handleLinkMock.mockClear();
    openInBrowserPanelMock.mockClear();
    resetAgentSubscriptionsViewStateForTests();
    workspaceState.workspace = defaultWorkspace;
  });

  it('renders a normalized inline disclosure row per active monitor', () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const summary = screen.getByTestId('monitored-pr-summary');
    const line = summary.closest('[data-monitor-state]')?.firstElementChild;
    expect(summary.textContent).toContain('Fix widget rendering');
    // Same-owner label shows the repo name without the owner
    expect(summary.textContent).toContain('widgets #42');
    expect(summary.textContent).not.toContain('acme/');
    expect(line?.className).toContain('min-h-9');
    expect(line?.className).toContain('gap-2');
    expect(line?.className).toContain('px-3');
  });

  it('renders selector data without dispatching lifecycle actions on mount', () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-pr-summary')).toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('starts collapsed and supports summary and chevron expand/collapse transitions', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    const summary = screen.getByTestId('monitored-pr-summary');
    const disclosure = screen.getByTestId('monitored-pr-disclosure');

    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('monitored-pr-details')).toBeNull();
    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('monitored-pr-details')).toBeTruthy();
    await fireEvent.click(disclosure);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('monitored-pr-details')).toBeNull();
  });

  it('persists expanded PR details across remounts in the session', async () => {
    monitorsState.monitors = [makeMonitor()];
    const first = render(MonitoredPrsRow, {
      props: { workspaceId: 'ws-1', agentId: 'agent-1' },
    });
    await fireEvent.click(screen.getByTestId('monitored-pr-summary'));
    expect(screen.getByTestId('monitored-pr-details')).toBeTruthy();
    first.unmount();

    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    await waitFor(() =>
      expect(screen.getByTestId('monitored-pr-summary').getAttribute('aria-expanded')).toBe('true'),
    );
    expect(screen.getByTestId('monitored-pr-details')).toBeTruthy();
  });

  it('renders nothing when the agent has only completed monitors', () => {
    monitorsState.monitors = [makeMonitor({ state: 'completed' })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    expect(screen.queryByTestId('monitored-prs-row')).toBeNull();
  });

  it('renders 4+ digit PR numbers without digit grouping', () => {
    monitorsState.monitors = [
      makeMonitor({ prNumber: 1182, url: 'https://github.com/acme/widgets/pull/1182' }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const summary = screen.getByTestId('monitored-pr-summary');
    expect(summary.textContent).toContain('widgets #1182');
    expect(summary.textContent).not.toContain('1,182');
  });

  it('labels a same-owner, different-repo monitor with the repo name only', () => {
    monitorsState.monitors = [
      makeMonitor({ repo: 'acme/lib', url: 'https://github.com/acme/lib/pull/42' }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const summary = screen.getByTestId('monitored-pr-summary');
    expect(summary.textContent).toContain('lib #42');
    expect(summary.textContent).not.toContain('acme/');
  });

  it('labels a different-owner monitor with owner/repo', () => {
    monitorsState.monitors = [
      makeMonitor({ repo: 'other/lib', url: 'https://github.com/other/lib/pull/42' }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-pr-summary').textContent).toContain(
      'Monitoring PR other/lib #42: Fix widget rendering',
    );
  });

  it('labels with owner/repo when the workspace owner/repo is unknown', () => {
    workspaceState.workspace = { id: 'ws-1' } as unknown;
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-pr-summary').textContent).toContain('acme/widgets #42');
  });

  it('caps the restored disclosure summary so long labels ellipsize, not overflow', () => {
    monitorsState.monitors = [
      makeMonitor({
        repo: 'intent-hq/cloudlands-releases',
        prNumber: 1248,
        url: 'https://github.com/intent-hq/cloudlands-releases/pull/1248',
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByTestId('monitored-prs-row');
    const summary = screen.getByTestId('monitored-pr-summary');
    const label = summary.querySelector('.truncate') as HTMLElement;
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('max-w-full');
    expect(summary.className).toContain('min-w-0');
    expect(summary.className).toContain('max-w-full');
    expect(summary.className).toContain('overflow-hidden');
    expect(label).toBeTruthy();
    expect(label.className).toContain('min-w-0');
    expect(label.className).toContain('flex-1');
  });

  it('inline details lead with human readiness and useful blocking facts', async () => {
    monitorsState.monitors = [
      makeMonitor({
        hasPendingChanges: true,
        pendingChanges: ['checks regressed', 'new review'],
        lastChangeAt: '2026-08-07T10:04:00Z',
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(screen.getByTestId('monitored-pr-summary').textContent).toContain(
      'Fix widget rendering',
    );
    expect(card.textContent).toContain('Open, but blocked by required checks still running.');
    expect(card.textContent).toContain('1 of 4 checks are still running.');
    expect(card.textContent).toContain('0 of 1 required approvals received.');
    expect(card.textContent).toContain('2 unresolved threads');
    expect(card.textContent).not.toContain('Mergeable');
    expect(card.textContent).not.toContain('REVIEW_REQUIRED');
    expect(screen.getByTestId('monitored-pr-pending').textContent).toContain(
      '2 changes pending emit',
    );
  });

  it('inline details stack one fact per line without dot separators', async () => {
    monitorsState.monitors = [
      makeMonitor({
        hasPendingChanges: true,
        pendingChanges: ['checks regressed'],
        lastChangeAt: '2026-08-07T10:04:00Z',
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    // Facts live in a flex-col block, one <span> per line — no inline
    // "·" separators that wrap mid-phrase.
    expect(card.textContent).not.toContain('·');
    const lines = Array.from(card.querySelectorAll(':scope > span')).map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      '1 of 4 checks are still running.',
      '0 of 1 required approvals received.',
      '2 unresolved threads',
      expect.stringContaining('Last change'),
      '1 change pending emit',
    ]);
  });

  it('inline details render no pending line at all when nothing is pending', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(screen.queryByTestId('monitored-pr-pending')).toBeNull();
    expect(card.textContent).not.toContain('No changes pending');

    expect(document.querySelector('[data-tooltip-trigger]')).toBeNull();
  });

  it('prefers localized blocker fragments over the raw wire merge-blocked reason', async () => {
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...makeMonitor().lastSnapshot!,
          mergeable: false,
          mergeBlockedReason: 'blocked by required checks or reviews',
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open, but blocked by required checks still running.');
    expect(card.textContent).not.toContain('blocked by blocked by');
    expect(card.textContent).not.toContain('Not mergeable');
  });

  it('falls back to unmet merge requirements when only the wire merge-blocked reason is set', async () => {
    const base = makeMonitor().lastSnapshot!;
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...base,
          mergeBlockedReason: 'blocked by required checks or reviews',
          checks: {
            ...base.checks,
            passed: 4,
            failed: 0,
            pending: 0,
            failingRequired: 0,
            pendingRequired: 0,
          },
          approvals: { decision: 'APPROVED', have: 1, needed: 1, changesRequested: 0 },
          threads: { unresolved: 0, resolutionRequired: true },
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open, but blocked by unmet merge requirements.');
    expect(card.textContent).not.toContain('blocked by blocked by');
  });

  it('shows queued to merge when the open snapshot is in the merge queue', async () => {
    // The default fixture carries a pending-required-checks blocker — the
    // queued status takes precedence over the blocker/unknown fallthrough.
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: { ...makeMonitor().lastSnapshot!, isInMergeQueue: true },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open; queued to merge.');
    expect(card.textContent).not.toContain('Open, but blocked by');
    expect(card.textContent).not.toContain('still being checked');
  });

  it('renders the pre-existing readiness statuses when isInMergeQueue is absent', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open, but blocked by required checks still running.');
    expect(card.textContent).not.toContain('queued to merge');
  });

  it('uses the custom kebab before the disclosure and keeps their actions isolated', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const kebab = screen.getByTestId('monitored-pr-chip');
    const disclosure = screen.getByTestId('monitored-pr-disclosure');
    expect(kebab.querySelector('svg')?.getAttribute('data-icon')).toBeNull();
    expect(
      kebab.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await fireEvent.click(kebab);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  });

  it('chip menu shows exactly the four items in order: Check and Flush, Open in App, Open in External Browser, Cancel monitor', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    await waitFor(() => screen.getByTestId('monitored-pr-check-flush-item'));
    const menu = screen.getByTestId('monitored-pr-menu');
    const items = Array.from(menu.querySelectorAll('button'));
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Check and Flush',
      'Open in App',
      'Open in External Browser',
      'Cancel monitor',
    ]);
  });

  it('renders the portaled menu at a 260px preferred width with single-line regular labels', async () => {
    setViewport(1280);
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const { menu, content } = await openMenu();
    expect(content.className).toContain('monitored-pr-menu-content');
    expect(menu.className).toContain('w-full');
    expect(menu.className).toContain('min-w-0');
    expect(menu.getAttribute('style')).toBeNull();
    const bounds = measureRenderedMenu(menu);
    expect(bounds.width).toBe(260);
    expect(bounds.left).toBeGreaterThanOrEqual(12);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - 12);
    for (const item of Array.from(menu.querySelectorAll('button'))) {
      expect(item.className).toContain('min-[284px]:whitespace-nowrap');
      expect(item.className).not.toContain('truncate');
    }
  });

  it.each([
    ['narrow viewport', 240, 1],
    ['representative 200% zoom viewport', 240, 2],
  ])('clamps and cleanly wraps labels at a %s', async (_label, width, devicePixelRatio) => {
    setViewport(width, devicePixelRatio);
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const { menu, content } = await openMenu();
    expect(content.className).toContain('monitored-pr-menu-content');
    expect(window.devicePixelRatio).toBe(devicePixelRatio);
    expect(menu.getAttribute('style')).toBeNull();
    const bounds = measureRenderedMenu(menu);
    expect(bounds.width).toBeLessThanOrEqual(window.innerWidth - 24);
    expect(bounds.left).toBeGreaterThanOrEqual(12);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - 12);
    for (const item of Array.from(menu.querySelectorAll('button'))) {
      expect(item.className).toContain('h-auto');
      expect(item.className).toContain('whitespace-normal');
      expect(item.querySelector('span')?.className).toContain('break-words');
    }
  });

  it('chip menu Check and Flush dispatches the flush trigger with check: true', async () => {
    monitorsState.monitors = [makeMonitor({ hasPendingChanges: true, pendingChanges: ['x'] })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const flushItem = await waitFor(() => screen.getByTestId('monitored-pr-check-flush-item'));
    await fireEvent.click(flushItem);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(flushPrMonitorRequested('ws-1', 'mon-1', true));
  });

  it('chip menu Check and Flush stays enabled when nothing is pending', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const flushItem = await waitFor(() => screen.getByTestId('monitored-pr-check-flush-item'));
    expect((flushItem as HTMLButtonElement).disabled).toBe(false);

    await fireEvent.click(flushItem);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(flushPrMonitorRequested('ws-1', 'mon-1', true));
  });

  it('chip menu Cancel monitor dispatches the cancel trigger', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const cancelItem = await waitFor(() => screen.getByTestId('monitored-pr-cancel-item'));
    await fireEvent.click(cancelItem);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(cancelPrMonitorRequested('ws-1', 'mon-1'));
  });

  it('chip menu Open in App opens the PR URL in the embedded browser panel', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openInAppItem = await waitFor(() => screen.getByTestId('monitored-pr-open-in-app-item'));
    await fireEvent.click(openInAppItem);

    expect(openInBrowserPanelMock).toHaveBeenCalledTimes(1);
    expect(openInBrowserPanelMock).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      'ws-1',
    );
    expect(handleLinkMock).not.toHaveBeenCalled();
  });

  it('chip menu Open in External Browser routes the PR URL through the forceExternal link handler', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openItem = await waitFor(() => screen.getByTestId('monitored-pr-open-external-item'));
    await fireEvent.click(openItem);

    expect(handleLinkMock).toHaveBeenCalledTimes(1);
    expect(handleLinkMock).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      expect.objectContaining({ forceExternal: true }),
    );
    expect(openInBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('open actions fall back to the canonical GitHub URL when the monitor has no url', async () => {
    monitorsState.monitors = [makeMonitor({ url: undefined })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openInAppItem = await waitFor(() => screen.getByTestId('monitored-pr-open-in-app-item'));
    await fireEvent.click(openInAppItem);

    expect(openInBrowserPanelMock).toHaveBeenCalledTimes(1);
    expect(openInBrowserPanelMock).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      'ws-1',
    );
  });
});
