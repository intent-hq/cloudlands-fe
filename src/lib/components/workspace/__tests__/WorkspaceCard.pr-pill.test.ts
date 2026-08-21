/**
 * @vitest-environment jsdom
 *
 * WorkspaceCard PR pill interactivity tests.
 *
 * The compact-row PR pill routes clicks through the unified link handler
 * (`handleLink` with the original event, so GitHub PR URLs get the configured
 * default action / choices menu) without bubbling to the card row, and its
 * hover tooltip's first line is the PR's `owner/repo #N`. Pills with no
 * resolvable URL stay non-interactive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { PullRequestStatus, WorkspaceStatus } from '$shared/types';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import { createTestWorkspaceId } from '../../../../test/factories/workspace.factory';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const state = {};
  const handleLink = vi.fn().mockResolvedValue(true);
  const monitors: PrMonitorRow[] = [];

  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });

  const selector = <T>(getter: (state: any, ...args: any[]) => T) =>
    Object.assign((...args: any[]) => readable(getter(state, ...args)), {
      select: (s: any, ...a: any[]) => getter(s ?? state, ...a),
    });

  return { dispatch, state, readable, selector, handleLink, monitors };
});
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/') }));

vi.mock('$app/state', () => ({ page: pageState }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksLoading: mocks.selector(() => false),
  selectWorkspaceTaskProgress: mocks.selector(() => ({ total: 0, completed: 0 })),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-slice', () => ({
  ensureWorkspaceTasksLoaded: vi.fn((id) => ({
    type: 'workspace-tasks/ensureLoaded',
    payload: id,
  })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
}));

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectPrMonitors: mocks.selector(() => mocks.monitors),
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: mocks.handleLink,
}));

// Capture tooltip props (content/disabled) via the shared MockTooltip, which
// pushes lazy prop getters onto `globalThis.__mockTooltipProps`.
vi.mock('$lib/components/ui/tooltip', async () => ({
  Tooltip: (await import('../sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));

import WorkspaceCard from '../WorkspaceCard.svelte';

type TooltipProps = { content: unknown; disabled: unknown };
const tooltipProps = (): TooltipProps[] =>
  (globalThis as { __mockTooltipProps?: TooltipProps[] }).__mockTooltipProps ?? [];
const tooltipContents = (): string[] =>
  tooltipProps().map((p) => (typeof p.content === 'string' ? p.content : ''));

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: createTestWorkspaceId(),
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activity: 'idle',
    displayStatus: 'idle',
    agentSummary: { agentIds: [], hasActiveAgents: false },
    ...overrides,
  } as Workspace;
}

function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
  return {
    monitorId: 'mon-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    repo: 'other-org/lib',
    prNumber: 7,
    state: 'active',
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  mocks.handleLink.mockClear();
  mocks.monitors.length = 0;
  (globalThis as { __mockTooltipProps?: TooltipProps[] }).__mockTooltipProps = [];
});

function makeWorkspaceWithPr(overrides: Partial<Workspace> = {}): Workspace {
  return makeWorkspace({
    repositoryOwner: 'acme',
    repositoryName: 'widgets',
    pullRequests: [
      {
        id: 'pr-1',
        number: 42,
        url: 'https://github.com/acme/widgets/pull/42',
        title: 'Add feature',
        status: PullRequestStatus.Open,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  });
}

describe('WorkspaceCard PR pill', () => {
  it('routes pill clicks through handleLink without bubbling to the card', async () => {
    const onClick = vi.fn();
    const workspace = makeWorkspaceWithPr();

    const { container } = render(WorkspaceCard, { props: { workspace, onClick } });

    const pill = container.querySelector('[data-workspace-card-pr-pill]');
    expect(pill).toBeTruthy();
    expect(pill?.tagName).toBe('BUTTON');
    expect(pill?.getAttribute('type')).toBe('button');

    await fireEvent.click(pill!);

    expect(mocks.handleLink).toHaveBeenCalledOnce();
    const [url, options] = mocks.handleLink.mock.calls[0];
    expect(url).toBe('https://github.com/acme/widgets/pull/42');
    expect(options.workspaceId).toBe(workspace.id);
    expect(options.event).toBeInstanceOf(MouseEvent);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses a constructed URL for the legacy workspace.prNumber-only case', async () => {
    const workspace = makeWorkspace({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
      prNumber: 9,
      prStatus: PullRequestStatus.Open,
    });

    const { container } = render(WorkspaceCard, { props: { workspace } });

    const pill = container.querySelector('[data-workspace-card-pr-pill]');
    expect(pill?.tagName).toBe('BUTTON');
    await fireEvent.click(pill!);
    expect(mocks.handleLink).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/9',
      expect.objectContaining({ workspaceId: workspace.id }),
    );
  });

  it('keeps the pill non-interactive when no URL can be resolved', () => {
    const workspace = makeWorkspace({
      prNumber: 9,
      prStatus: PullRequestStatus.Open,
    });

    const { container } = render(WorkspaceCard, { props: { workspace } });

    const pill = container.querySelector('[data-workspace-card-pr-pill]');
    expect(pill).toBeTruthy();
    expect(pill?.tagName).toBe('SPAN');
    expect(mocks.handleLink).not.toHaveBeenCalled();
  });

  it('puts owner/repo #N as the first tooltip line for a same-repo PR', () => {
    render(WorkspaceCard, { props: { workspace: makeWorkspaceWithPr() } });

    const content = tooltipContents().find((c) => c.includes('acme/widgets #42'));
    expect(content).toBeTruthy();
    expect(content!.split('\n')[0]).toBe('acme/widgets #42');
  });

  it('puts owner/repo #N as the first tooltip line for a cross-repo monitored PR', () => {
    const workspace = makeWorkspace({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
    });
    mocks.monitors.push(
      makeMonitor({
        workspaceId: workspace.id,
        repo: 'other-org/lib',
        prNumber: 7,
        url: 'https://github.com/other-org/lib/pull/7',
      }),
    );

    render(WorkspaceCard, { props: { workspace } });

    const content = tooltipContents().find((c) => c.includes('other-org/lib #7'));
    expect(content).toBeTruthy();
    expect(content!.split('\n')[0]).toBe('other-org/lib #7');
  });

  it('degrades to status-only tooltip content when no repo line is resolvable', () => {
    // A workspace PR without a URL on a workspace without repositoryOwner/
    // repositoryName: no repo source resolves, so the tooltip must be the
    // status content alone — no leading blank line.
    const workspace = makeWorkspace({
      pullRequests: [
        {
          id: 'pr-9',
          number: 9,
          url: '',
          title: 'Legacy PR',
          status: PullRequestStatus.Open,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    render(WorkspaceCard, { props: { workspace } });

    const content = tooltipContents().find((c) => c.includes('Open'));
    expect(content).toBeTruthy();
    expect(content!.startsWith('\n')).toBe(false);
    expect(content!.split('\n')[0]).toBe('Open');
    expect(content).not.toContain('#9');
  });
});
