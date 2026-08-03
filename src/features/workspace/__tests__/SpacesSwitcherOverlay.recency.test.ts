/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  render,
  screen,
} from '@testing-library/svelte';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const goto = vi.fn();
  const switcherState = { selectedIndex: 0, selectionHandled: false };
  const workspaceIds: string[] = [];
  const workspaces: Workspace[] = [];
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });

  return { dispatch, goto, switcherState, workspaceIds, workspaces, readable };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    isAgentStreaming: vi.fn(() => false),
    startPolling: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-switcher/workspace-switcher-selectors', () => ({
  selectSwitcherState: () => mocks.readable(() => mocks.switcherState),
  selectSwitcherWorkspaceIds: () => mocks.readable(() => mocks.workspaceIds),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: () => mocks.readable(() => 'ws-current'),
  selectWorkspaceItems: () => mocks.readable(() => mocks.workspaces),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksByWorkspaceId: Object.assign(
    () => mocks.readable(() => ({})),
    { select: vi.fn(() => ({})) },
  ),
  selectWorkspaceTaskProgress: Object.assign(vi.fn(), {
    select: vi.fn(() => ({ total: 0, completed: 0, inProgress: 0 })),
  }),
}));

vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: () => mocks.readable(() => []),
}));

vi.mock('$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('../../../lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));

vi.mock('$lib/components/workspace/WorkspacePhaseIndicator.svelte', async () => ({
  default: (await import('../../../lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));

function workspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: 'ws-1' as Workspace['id'],
    title: 'Workspace',
    branch: 'main',
    baseRef: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function renderOverlay(workspaceItem: Workspace) {
  mocks.workspaceIds.splice(0, mocks.workspaceIds.length, workspaceItem.id);
  mocks.workspaces.splice(0, mocks.workspaces.length, workspaceItem);
  const SpacesSwitcherOverlay = (await import('../SpacesSwitcherOverlay.svelte')).default;
  return render(SpacesSwitcherOverlay);
}

describe('SpacesSwitcherOverlay recency display', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    Element.prototype.scrollIntoView = vi.fn();
    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    mocks.workspaceIds.length = 0;
    mocks.workspaces.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders recency from lastActivity instead of a freshly touched updatedAt', async () => {
    await renderOverlay(
      workspace({
        title: 'Old Activity Workspace',
        lastActivity: '2025-06-01T00:00:00.000Z',
        updatedAt: '2026-05-07T12:00:00.000Z',
      }),
    );

    expect(screen.getByRole('dialog', { name: 'Workspace switcher' })).toBeTruthy();
    expect(screen.getByText('Old Activity Workspace')).toBeTruthy();
    expect(screen.getByTitle(/2025/)).toBeTruthy();
    expect(screen.queryByTitle(/2026/)).toBeNull();
    expect(screen.queryByText('now')).toBeNull();
  });

  it('does not render Unix epoch recency when all workspace timestamps are invalid', async () => {
    await renderOverlay(
      workspace({
        title: 'No Valid Timestamp Workspace',
        lastActivity: 'bad-last-activity',
        createdAt: 'bad-created-at',
        updatedAt: 'bad-updated-at',
      }),
    );

    expect(screen.getByText('No Valid Timestamp Workspace')).toBeTruthy();
    expect(screen.queryByText('1970')).toBeNull();
    expect(screen.queryByText('Invalid')).toBeNull();
  });
});
