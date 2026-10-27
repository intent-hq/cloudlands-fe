import {
  getDockCompactNotchSize,
  type DockPlacementSnapshot,
  type DockDisplayGeometry,
  type DockShape,
} from '$shared/dock-placement';
import { latestDockHumanMessage, isRecentDockConversation } from '$features/hud/utils/dock-recency';
import type { UserMessageIndexItem } from '$lib/client';
import { definePreview } from '$lib/component-catalog/preview-definition';
import {
  definePreviewFixture,
  PREVIEW_FIXTURE_TIMESTAMPS,
} from '$lib/component-catalog/preview-fixtures';
import { WorkspaceId } from '$shared/types/branded-ids';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';

export interface DockRailPreviewProps {
  workspaces: DockWorkspaceView[];
  viewportHeight: number;
  viewportWidth?: number;
  theme?: 'light' | 'dark';
  placement?: DockPlacementSnapshot;
  failFeedbackOnce?: boolean;
  focusRequest?: number;
  placementError?: boolean;
  floatingDisplay?: DockDisplayGeometry;
  controlledPlacement?: boolean;
  manualResizeAcknowledgements?: boolean;
  conversationFixture?: boolean;
  machineFixture?: boolean;
  failMachineOnce?: boolean;
  resizeAcknowledgement?: 'accept' | 'reject' | 'defer';
}

const VIEWPORT_HEIGHT = 600;
const workspaceFixture = definePreviewFixture<Workspace>({
  id: WorkspaceId('dock-preview-workspace-01'),
  title: 'Build dock visual fixtures',
  branch: 'feat/intent-workspace-dock',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatus.Active,
  displayStatus: 'in_progress',
  attention: 'none',
  activity: 'agent_running',
  repositoryOwner: 'intent-hq',
  repositoryName: 'cloudlands-fe',
  ...PREVIEW_FIXTURE_TIMESTAMPS,
});

const fixtures: DockWorkspaceView[] = [
  dockItem(
    1,
    'Repair release checks',
    { badgeKind: 'failure', priorityGroup: 'action', isRunning: false },
    { displayStatus: 'failed', activity: 'idle' },
  ),
  dockItem(
    2,
    'Resolve access blocker',
    { badgeKind: 'blocker', priorityGroup: 'action', isRunning: false },
    { displayStatus: 'blocked', activity: 'idle' },
  ),
  dockItem(
    3,
    'Answer design question',
    { badgeKind: 'question', priorityGroup: 'action', isRunning: false },
    { displayStatus: 'needs_attention', activity: 'idle' },
  ),
  dockItem(
    4,
    'Review navigation flow',
    { badgeKind: 'review', priorityGroup: 'action', isRunning: false },
    { displayStatus: 'pr_ready', attention: 'review_required', activity: 'idle' },
  ),
  dockItem(
    5,
    'Read verifier report',
    { priorityGroup: 'unread', isUnread: true, isRunning: false },
    { displayStatus: 'idle', attention: 'unread', activity: 'idle' },
  ),
  dockItem(6, 'Polish workspace dock'),
  dockItem(
    7,
    'Wait for visual review',
    { isRunning: false, isWaiting: true },
    { displayStatus: 'idle', waiting: true, activity: 'idle' },
  ),
  dockItem(
    8,
    'Read verifier report',
    { priorityGroup: 'unread', isUnread: true },
    { attention: 'unread' },
  ),
  dockItem(
    9,
    'Monitor release queue',
    { isRunning: false, isWaiting: true },
    { displayStatus: 'pr_open', waiting: true, activity: 'idle' },
  ),
  dockItem(10, 'Check compact spacing'),
  dockItem(11, 'Validate dark theme'),
  dockItem(12, 'Capture final comparison'),
];

const compactOverflowFixtures = [
  ...fixtures,
  ...Array.from({ length: 36 }, (_, index) =>
    dockItem(index + 13, `Compact fixture ${String(index + 13).padStart(2, '0')}`),
  ),
];

function dockItem(
  index: number,
  title: string,
  overrides: Partial<Omit<DockWorkspaceView, 'workspace'>> = {},
  workspaceOverrides: Partial<Workspace> = {},
): DockWorkspaceView {
  const suffix = String(index).padStart(2, '0');
  return {
    workspace: workspaceFixture({
      id: WorkspaceId(`dock-preview-workspace-${suffix}`),
      title,
      statusMessage: `Ready for the next review in workspace ${suffix}.`,
      ...workspaceOverrides,
    }),
    badgeKind: 'none',
    priorityGroup: 'active',
    isUnread: false,
    isRunning: true,
    isWaiting: false,
    ...overrides,
  };
}

// Fixed clock and real index shapes make recency exclusions repeatable in previews.
const dockRecencyFixtureNow = Date.parse('2026-10-19T12:00:00.000Z');
const hoursAgo = (hours: number) =>
  new Date(dockRecencyFixtureNow - hours * 3_600_000).toISOString();
export const dockRecencyScenarios: Array<{
  item: DockWorkspaceView;
  messages: UserMessageIndexItem[];
}> = [
  {
    item: dockItem(
      51,
      'Recent human conversation',
      { isRunning: false },
      { activity: 'idle', displayStatus: 'idle' },
    ),
    messages: [
      { id: 'recent-human', preview: 'Please refine the navigation', createdAt: hoursAgo(2) },
    ],
  },
  {
    item: dockItem(52, 'Recent question answer', { isRunning: false }),
    messages: [
      {
        id: 'wizard-answer',
        preview: 'Use the compact layout',
        createdAt: hoursAgo(1),
        metadata: { type: 'question_answers' },
      },
    ],
  },
  {
    item: dockItem(53, 'Yesterday near cutoff'),
    messages: [
      { id: 'near-cutoff', preview: 'Check the port topology', createdAt: hoursAgo(23.9) },
    ],
  },
  {
    item: dockItem(54, 'Old conversation with running agent'),
    messages: [
      { id: 'old-human', preview: 'Start the build', createdAt: hoursAgo(25) },
      {
        id: 'agent-update',
        preview: 'Build still running',
        createdAt: hoursAgo(0.1),
        metadata: { fromAgentId: 'worker' },
      },
    ],
  },
  {
    item: dockItem(55, 'Unread automated update', { isUnread: true }),
    messages: [
      {
        id: 'system-wake',
        preview: 'Scheduled check',
        createdAt: hoursAgo(0.2),
        metadata: { source: 'system' },
      },
    ],
  },
  {
    item: dockItem(56, 'Legacy automated wake'),
    messages: [
      {
        id: 'legacy-wake',
        preview: '[WORKSPACE EVENTS] Agent completed',
        createdAt: hoursAgo(0.3),
      },
    ],
  },
  {
    item: dockItem(57, 'Expired at 24 hours'),
    messages: [{ id: 'expired-human', preview: 'Finish the review', createdAt: hoursAgo(24) }],
  },
];
const recentConversationFixtures = dockRecencyScenarios
  .map(({ item, messages }) => ({ item, latest: latestDockHumanMessage(messages) }))
  .filter(({ latest }) => isRecentDockConversation(latest, dockRecencyFixtureNow))
  .sort((left, right) => (right.latest ?? 0) - (left.latest ?? 0))
  .map(({ item }) => item);

function state(
  workspaces: DockWorkspaceView[],
  viewportHeight: number = VIEWPORT_HEIGHT,
): { props: DockRailPreviewProps } {
  return { props: { workspaces, viewportHeight } };
}

export function adaptiveDockFixture(
  shape: DockShape,
  side: 'left' | 'right' = 'right',
): DockPlacementSnapshot {
  const edge = shape === 'edge';
  const floating = shape === 'floating';
  const cutout = shape === 'notch' ? { x: 244, y: 0, width: 152, height: 32 } : null;
  const compact = cutout ? getDockCompactNotchSize(cutout) : null;
  const width = edge ? 40 : (compact?.width ?? 360);
  const height = edge ? 260 : floating ? 320 : (compact?.height ?? 40);
  return {
    revision: 1,
    placement: edge
      ? { kind: 'edge', displayId: 1, side, along: 0.5 }
      : floating
        ? { kind: 'floating', displayId: 1, x: 0.5, y: 0.5 }
        : { kind: 'notch', displayId: 1 },
    displayId: 1,
    shape,
    windowBounds: { x: 0, y: 0, width: 640, height: 600 },
    surface: {
      x: edge ? (side === 'left' ? 0 : 640 - width) : (640 - width) / 2,
      y: shape === 'notch' ? 0 : floating || edge ? (600 - height) / 2 : 24,
      width,
      height,
    },
    cutout,
    phase: 'idle',
    dragToken: null,
    snapPreview: null,
    captureHidden: false,
  };
}

function adaptiveState(
  shape: DockShape,
  side: 'left' | 'right' = 'right',
  theme: 'light' | 'dark' = 'dark',
  workspaces = fixtures.slice(0, 4),
) {
  return {
    props: {
      workspaces,
      viewportHeight: 600,
      viewportWidth: 640,
      theme,
      placement: adaptiveDockFixture(shape, side),
    },
  };
}

export const dockRailPreview = definePreview<DockRailPreviewProps>({
  id: 'dock-rail',
  title: 'Workspace dock rail',
  defaultState: 'four-mixed',
  states: {
    notch: adaptiveState('notch'),
    'notch-empty': adaptiveState('notch', 'right', 'dark', []),
    'notch-many-updates': adaptiveState(
      'notch',
      'right',
      'dark',
      compactOverflowFixtures.map((item) => ({ ...item, isUnread: true })),
    ),
    'top-pill': adaptiveState('top-pill'),
    'side-left': adaptiveState('edge', 'left', 'light'),
    'side-right': adaptiveState('edge'),
    floating: adaptiveState('floating'),
    'floating-light': adaptiveState('floating', 'right', 'light'),
    'floating-empty': adaptiveState('floating', 'right', 'light', []),
    'floating-overflow': adaptiveState('floating', 'right', 'dark', compactOverflowFixtures),
    light: { props: { ...state(fixtures.slice(0, 4)).props, theme: 'light' } },
    dark: { props: { ...state(fixtures.slice(0, 4)).props, theme: 'dark' } },
    narrow: { props: { ...state(fixtures.slice(0, 4), 420).props, viewportWidth: 300 } },
    overflow: state(compactOverflowFixtures, 320),
    empty: state([]),
    one: state(fixtures.slice(0, 1)),
    'edge-mapping': state(fixtures.slice(0, 3)),
    'recent-conversations': state(recentConversationFixtures),
    'bottom-anchor': state([...fixtures.slice(0, 8), dockItem(60, 'Port topology')], 600),
    'bottom-overflow': state(compactOverflowFixtures, 320),
    'four-mixed': state(fixtures.slice(0, 4)),
    nine: state(fixtures.slice(0, 9)),
    'twelve-overflow': state(compactOverflowFixtures, 480),
  },
});
