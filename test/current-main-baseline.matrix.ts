export const target = {
  commit: '5b79db2104f129e5c246770bfb5ffa329dd6f00e',
  tree: '73d6787675869cd6b95f0329dfbf4b3281781056',
} as const;

export type Probe = 'chat' | 'sidebar' | 'tabs' | 'panel' | 'chooser' | 'terminal' | 'interaction';
export type BaselineRow = {
  row: string;
  capability: string;
  probe: Probe;
  states: readonly string[];
  tests: readonly string[];
};

export const approvedRowIds = [
  'CHAT-01',
  'CHAT-02',
  'CHAT-03',
  'CHAT-04',
  'CHAT-05',
  'CHAT-06',
  'CHAT-07',
  'CHAT-08',
  'CHAT-09',
  'CHAT-10',
  'CHAT-11',
  'CHAT-36',
  'CHAT-40',
  'WORKSPACE-01',
  'WORKSPACE-02',
  'WORKSPACE-03',
  'WORKSPACE-08',
  'WORKSPACE-09',
  'WORKSPACE-10',
  'WORKSPACE-11',
  'WORKSPACE-14',
  'WORKSPACE-15',
  'WORKSPACE-16',
  'WORKSPACE-17',
  'WORKSPACE-18',
  'WORKSPACE-19',
  'WORKSPACE-20',
  'WORKSPACE-21',
  'WORKSPACE-22',
  'WORKSPACE-26',
  'WORKSPACE-27',
  'WORKSPACE-28',
  'WORKSPACE-29',
  'WORKSPACE-30',
  'WORKSPACE-31',
  'WORKSPACE-36',
  'WORKSPACE-37',
  'WORKSPACE-42',
  'WORKSPACE-43',
  'WORKSPACE-44',
  'WORKSPACE-45',
  'WORKSPACE-46',
  'WORKSPACE-47',
  'WORKSPACE-48',
  'WORKSPACE-50',
  'WORKSPACE-56',
  'REMAINING-03',
  'REMAINING-04',
  'REMAINING-08',
  'REMAINING-12',
  'REMAINING-13',
  'REMAINING-14',
  'REMAINING-21',
] as const;

const visual = [
  'light',
  'dark',
  'wide',
  'narrow',
  'zoom-100',
  'zoom-200',
  'hover',
  'focus',
  'keyboard',
  'reduced-motion',
] as const;
const runtime = ['mounted', 'runtime-success', 'runtime-error', 'keyboard', 'cleanup'] as const;
const sidebar = [
  'test/sidebar-launcher-tab-geometry.spec.ts',
  'src/lib/components/workspace/__tests__/MultiSelectTabbedSidebar.open-in.test.ts',
] as const;
const tabs = [
  'test/workspace-tab-strip-status-geometry.spec.ts',
  'src/lib/components/layout/WorkspaceTabStrip.test.ts',
  'src/lib/components/layout/sidebar-nav/SidebarNav.test.ts',
] as const;
const panel = [
  'src/features/layout/panel-cycle-navigation.test.ts',
  'src/lib/components/layout/panel-system/__tests__/panel-canvas-geometry.test.ts',
  'src/store/renderer/slices/panel-layout/panel-layout-slice.test.ts',
] as const;

const row = (
  row: string,
  capability: string,
  probe: Probe,
  states: readonly string[],
  tests: readonly string[],
): BaselineRow => ({
  row,
  capability,
  probe,
  states: [...new Set(states)],
  tests,
});

export const baselineRows = [
  row('CHAT-01', 'Label-free human/assistant hierarchy', 'chat', visual, [
    'src/lib/components/chat/__tests__/ChatMessage-message-actions.test.ts',
    'src/lib/components/chat/__tests__/ChatMessage-agent-attribution.test.ts',
  ]),
  row('CHAT-02', 'Compact operational tool rows', 'chat', visual, [
    'src/lib/components/chat/__tests__/operational-disclosure-row.test.ts',
  ]),
  row(
    'CHAT-03',
    'Thinking elapsed timer',
    'chat',
    [...runtime, 'advance', 'reset'],
    ['src/lib/components/chat/__tests__/StreamingStatus.test.ts'],
  ),
  row(
    'CHAT-04',
    'Live lifecycle text beside Thinking',
    'chat',
    [...runtime, 'reconnect', 'complete', 'cancel'],
    ['src/lib/components/chat/__tests__/StreamingStatus.test.ts'],
  ),
  row(
    'CHAT-05',
    'Dev/prod standing-subscription parity',
    'interaction',
    [...runtime, 'development', 'packaged', 'reconnect', 'refresh'],
    [
      'src/lib/client/live/live-chat-client.test.ts',
      'src/store/renderer/slices/chat-state/sagas/chat-subscribe-saga.test.ts',
    ],
  ),
  row(
    'CHAT-06',
    'Composer-to-chat send animation',
    'chat',
    [...visual, 'success', 'failure', 'cancel'],
    ['src/lib/components/chat/__tests__/message-send-transition.test.ts'],
  ),
  row(
    'CHAT-07',
    'Send transition watchdog/terminal cleanup',
    'interaction',
    [...runtime, 'success', 'failure', 'cancel', 'teardown'],
    ['src/lib/components/chat/__tests__/message-send-transition.test.ts'],
  ),
  row('CHAT-08', 'Unified message actions and timestamps', 'chat', visual, [
    'src/lib/components/chat/__tests__/ChatMessage-message-actions.test.ts',
  ]),
  row(
    'CHAT-09',
    'Agent-message disclosure shell',
    'chat',
    [...visual, 'collapsed', 'expanded', 'attachments'],
    ['src/lib/components/chat/__tests__/ChatMessage-agent-attribution.test.ts'],
  ),
  row('CHAT-10', 'Agent-message whole-card density', 'chat', visual, [
    'src/lib/components/chat/__tests__/ChatMessage-agent-attribution.test.ts',
  ]),
  row(
    'CHAT-11',
    'Wake disclosure shell/non-nesting',
    'chat',
    [...visual, 'collapsed', 'expanded'],
    ['src/lib/components/chat/__tests__/ChatMessage-agent-attribution.test.ts'],
  ),
  row(
    'CHAT-36',
    'Collapsed tool-detail presentation',
    'chat',
    [...visual, 'collapsed', 'expanded', 'error', 'output'],
    [
      'src/lib/components/chat/__tests__/ToolCall-legibility.test.ts',
      'src/lib/components/chat/__tests__/operational-disclosure-row.test.ts',
    ],
  ),
  row(
    'CHAT-40',
    'Nested Browse/context/attachment menus',
    'interaction',
    [...visual, 'pointer', 'escape', 'focus-restore'],
    ['src/lib/components/chat/input/SimpleRichInput.test.ts'],
  ),
  row(
    'WORKSPACE-01',
    'Activity latest-event preview',
    'sidebar',
    [...visual, 'empty'],
    ['src/lib/components/workspace/sidebar/__tests__/ActivityLogPreview.test.ts'],
  ),
  row(
    'WORKSPACE-02',
    'Activity safe full-route navigation',
    'interaction',
    [...runtime, 'resolvable', 'internal', 'unresolvable'],
    ['src/lib/components/workspace/sidebar/__tests__/ActivityLogPreview.test.ts'],
  ),
  row('WORKSPACE-03', 'Activity absent from compact launcher/deck', 'sidebar', visual, sidebar),
  row('WORKSPACE-08', 'Simplified repository/branch metadata', 'sidebar', visual, [
    'src/lib/components/workspace/sidebar/__tests__/BranchDisplay.test.ts',
    'src/lib/components/workspace/sidebar/__tests__/WorkspaceProgressCard.test.ts',
  ]),
  row('WORKSPACE-09', 'Branch Off/Using row alignment', 'sidebar', visual, [
    'src/lib/components/workspace/sidebar/__tests__/BranchDisplay.test.ts',
  ]),
  row(
    'WORKSPACE-10',
    'Persistent pinned-workspace indicator',
    'sidebar',
    [...visual, 'activity-precedence'],
    ['src/lib/components/layout/sidebar-nav/__tests__/all-workspaces-card-pinned-ordering.test.ts'],
  ),
  row('WORKSPACE-11', 'Workspace-hover-card sidebar placement', 'sidebar', visual, [
    'src/lib/components/workspace/__tests__/WorkspaceCard.idle-activity.test.ts',
  ]),
  row(
    'WORKSPACE-14',
    'Compact Agents deterministic order/count/overflow',
    'sidebar',
    [...visual, 'mixed-statuses', 'overflow'],
    sidebar,
  ),
  row('WORKSPACE-15', 'Compact Agents visible-paint containment', 'sidebar', visual, [
    'test/sidebar-launcher-tab-geometry.spec.ts',
  ]),
  row('WORKSPACE-16', 'Final compact Agents left-oriented placement', 'sidebar', visual, [
    'test/sidebar-launcher-tab-geometry.spec.ts',
  ]),
  row(
    'WORKSPACE-17',
    'Initial Coordinator first in Agents preview',
    'sidebar',
    [...visual, 'mixed-agents'],
    [
      'src/lib/components/workspace/utils/sidebar-launcher-preview.test.ts',
      'src/lib/components/workspace/__tests__/MultiSelectTabbedSidebar.open-in.test.ts',
    ],
  ),
  row(
    'WORKSPACE-18',
    'Workspace Spec first in Context preview',
    'sidebar',
    [...visual, 'open'],
    sidebar,
  ),
  row('WORKSPACE-19', 'Expanded sidebar physical deck geometry', 'sidebar', visual, [
    'test/sidebar-launcher-tab-geometry.spec.ts',
  ]),
  row('WORKSPACE-20', 'Expanded-only hover/focus allocation', 'sidebar', visual, [
    'test/sidebar-launcher-tab-geometry.spec.ts',
  ]),
  row(
    'WORKSPACE-21',
    'Browser expanded list reuse/new behavior',
    'sidebar',
    [...visual, 'reuse', 'new'],
    [...sidebar, 'src/lib/components/workspace/__tests__/SidebarBrowserList.test.ts'],
  ),
  row(
    'WORKSPACE-22',
    'Shell expanded list terminal reuse/open',
    'sidebar',
    [...visual, 'reuse', 'loading', 'error', 'empty'],
    [...sidebar, 'src/lib/components/workspace/__tests__/WorkspaceShellList.dev-scripts.test.ts'],
  ),
  row('WORKSPACE-26', 'Expanded-card overlay rather than reflow', 'sidebar', visual, [
    'test/sidebar-launcher-tab-geometry.spec.ts',
  ]),
  row(
    'WORKSPACE-27',
    'Expanded-card dismissal and focus restoration',
    'interaction',
    [...visual, 'outside-dismiss', 'escape', 'focus-restore'],
    sidebar,
  ),
  row(
    'WORKSPACE-28',
    'Truthful no-count workspace-tab status lifecycle',
    'tabs',
    [
      ...visual,
      'healthy',
      'active',
      'waiting',
      'attention',
      'failed',
      'stale',
      'hidden',
      'overflow',
      'rehydration',
    ],
    tabs,
  ),
  row(
    'WORKSPACE-29',
    'Full workspace-tab surface activation',
    'tabs',
    [...visual, 'close', 'drag', 'reorder'],
    tabs,
  ),
  row('WORKSPACE-30', 'Titlebar 33/32px border-box geometry', 'tabs', visual, [
    'src/lib/components/layout/titlebar-geometry.test.ts',
  ]),
  row(
    'WORKSPACE-31',
    'Consolidated Spaces/sidebar controls',
    'tabs',
    [...visual, 'route', 'state'],
    tabs,
  ),
  row(
    'WORKSPACE-36',
    'Relative panel navigation',
    'panel',
    [...runtime, 'next', 'previous', 'edges', 'nested'],
    panel,
  ),
  row(
    'WORKSPACE-37',
    'Absolute panel navigation',
    'panel',
    [...runtime, 'indexed', 'identified', 'scroll'],
    panel,
  ),
  row('WORKSPACE-42', 'Rightmost panel/chrome reachability', 'panel', visual, [
    'src/lib/components/layout/panel-system/__tests__/panel-canvas-width.test.ts',
  ]),
  row(
    'WORKSPACE-43',
    'Per-type default panel width tiers',
    'panel',
    [...runtime, 'narrow-type', 'medium-type', 'wide-type', 'explicit-width'],
    ['src/store/renderer/slices/panel-layout/panel-layout-default-widths.test.ts'],
  ),
  row(
    'WORKSPACE-44',
    'Independent root-panel width provenance',
    'panel',
    [...runtime, 'resize', 'settlement', 'reload'],
    [
      'src/lib/components/layout/panel-system/__tests__/root-horizontal-panel-resize-evidence.test.ts',
      'src/store/renderer/slices/panel-layout/panel-layout-width-provenance.test.ts',
    ],
  ),
  row(
    'WORKSPACE-45',
    'Handle reset-to-default semantics',
    'panel',
    [...visual, 'pointer', 'keyboard', 'reset', 'reload'],
    [
      'src/lib/components/layout/ResizablePanel.test.ts',
      'src/lib/components/layout/panel-system/__tests__/panel-resize-handles.test.ts',
    ],
  ),
  row('WORKSPACE-46', 'Resize-handle conditional visibility', 'panel', visual, [
    'src/lib/components/layout/panel-system/__tests__/panel-resize-handles.test.ts',
    'src/lib/components/layout/panel-system/__tests__/panel-resize-rendering-contract.test.ts',
  ]),
  row(
    'WORKSPACE-47',
    'Dominant-panel double-click expand/restore',
    'panel',
    [...visual, 'root', 'nested', 'control-click'],
    ['src/lib/components/layout/panel-system/__tests__/panel-dominant-expansion.test.ts'],
  ),
  row(
    'WORKSPACE-48',
    'Adjacent panel first-frame paint',
    'panel',
    [...visual, 'first-frame', 'reorder'],
    ['src/lib/components/layout/panel-system/__tests__/panel-reorder-animation.test.ts'],
  ),
  row(
    'WORKSPACE-50',
    'Subscription-origin canonical panel reuse',
    'interaction',
    [...runtime, 'reuse', 'reserved-placeholder'],
    ['src/store/renderer/slices/panel-layout/panel-layout-slice.test.ts'],
  ),
  row(
    'WORKSPACE-56',
    'Recoverable zero-tab workspace shell',
    'interaction',
    [...visual, 'remove-last-tab', 'recovery'],
    [
      'src/lib/components/layout/panel-system/__tests__/PanelEmptyState.test.ts',
      'src/store/renderer/slices/panel-layout/panel-layout-tabless.test.ts',
    ],
  ),
  row(
    'REMAINING-03',
    'Changes linked-PR action',
    'sidebar',
    [...visual, 'route'],
    ['src/lib/components/workspace/sidebar/__tests__/PRSection.test.ts'],
  ),
  row(
    'REMAINING-04',
    'Files Open in chooser',
    'chooser',
    [...visual, 'editor', 'other', 'copy-path', 'focus-restore'],
    [
      'src/lib/components/ui/__tests__/OpenComboButton.locality.test.ts',
      'src/lib/components/workspace/__tests__/MultiSelectTabbedSidebar.open-in.test.ts',
    ],
  ),
  row(
    'REMAINING-08',
    'Terminal script-selection crash prevention',
    'terminal',
    [...runtime, 'no-selection', 'selected', 'running', 'stopped', 'error'],
    [
      'src/lib/components/terminal/__tests__/QuakeTerminalOverlay.delete-script.test.ts',
      'src/lib/components/terminal/__tests__/QuakeTerminalOverlay.previously-running-tabs.test.ts',
      'src/lib/components/terminal/__tests__/QuakeTerminalOverlay.test.ts',
    ],
  ),
  row('REMAINING-12', 'Repo/branch pill contrast', 'chooser', visual, [
    'src/lib/components/workspace/sidebar/__tests__/WorkspaceProgressCard.checkout-pill.test.ts',
  ]),
  row('REMAINING-13', 'Model-picker viewport bounds', 'chooser', visual, [
    'src/lib/components/modals/__tests__/NewSpaceModal-model-picker.test.ts',
  ]),
  row(
    'REMAINING-14',
    'Model options clickable',
    'chooser',
    [...visual, 'pointer', 'selection', 'dismiss'],
    ['src/lib/components/modals/__tests__/NewSpaceModal-model-picker.test.ts'],
  ),
  row(
    'REMAINING-21',
    'Final accessibility correction',
    'interaction',
    [...visual, 'aria', 'focus-order', 'keyboard'],
    [
      'src/lib/components/layout/WorkspaceTabStrip.test.ts',
      'src/lib/components/workspace/__tests__/MultiSelectTabbedSidebar.open-in.test.ts',
      'src/lib/styles/__tests__/theme-contract.test.ts',
      'test/sidebar-launcher-tab-geometry.spec.ts',
    ],
  ),
] as const;
