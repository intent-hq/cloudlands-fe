import { baselineRows, type BaselineRow } from './current-main-baseline.matrix';

export const mountedScenes = ['chat', 'sidebar', 'tabs', 'panel'] as const;
export type MountedScene = (typeof mountedScenes)[number];
export type MountedState = {
  name: string;
  width: number;
  zoom: number;
  theme: 'light' | 'dark';
  reduced: boolean;
};

export const mountedStates: readonly MountedState[] = [
  { name: 'wide-light-100', width: 1024, zoom: 1, theme: 'light', reduced: false },
  { name: 'narrow-dark-200-reduced', width: 320, zoom: 2, theme: 'dark', reduced: true },
];

export type MountedEvidenceDefinition = {
  evidenceId: string;
  kind: 'mounted';
  scene: MountedScene;
  state: MountedState;
  rowIds: string[];
  observedStates: string[];
};

export type SemanticEvidence = {
  evidenceId: string;
  kind: 'semantic';
  rowId: string;
  observedStates: string[];
  testFiles: string[];
  stateAssertions: Record<string, string>;
  status: 'passed';
};

export type EvidenceRow = BaselineRow & {
  verdict: 'PRESERVED' | 'UNVERIFIED';
  implementationOwner: null;
  evidenceIds: string[];
  stateEvidence: Record<string, string[]>;
};

type SemanticSelector = { states: string[]; assertionIncludes: string };
const selector = (states: string[], assertionIncludes: string): SemanticSelector => ({
  states,
  assertionIncludes,
});

const semanticSelectors: Record<string, SemanticSelector[]> = {
  'CHAT-03': [
    selector(['mounted', 'runtime-success'], 'renders the compact legacy spinner and Thinking row'),
    selector(['runtime-error'], 'renders explicit failed response copy'),
    selector(['cleanup'], 'clears failed presentation when a new stream starts'),
    selector(['advance'], 'formatElapsed > rounds to the nearest whole second'),
    selector(['reset'], 'full lifecycle: streaming → tool-call → tool-waiting → streaming again'),
  ],
  'CHAT-04': [
    selector(['mounted', 'runtime-success'], 'renders the compact legacy spinner and Thinking row'),
    selector(['runtime-error'], 'renders explicit failed response copy'),
    selector(
      ['cleanup', 'cancel'],
      'shows failure copy without retry while active flags are still clearing',
    ),
    selector(['reconnect'], 'clears failed presentation when a new stream starts'),
    selector(
      ['complete'],
      'computeCompletedEvents > computes durations between consecutive events',
    ),
  ],
  'CHAT-05': [
    selector(['mounted', 'development'], 'registers chat.subscribe, emits the seq-0 snapshot'),
    selector(['runtime-success'], 'hydrates the transcript from the seq-0 snapshot emit'),
    selector(['runtime-error'], 'recovers from a rejected chat.subscribe via a delayed retry'),
    selector(['keyboard'], 'folds added/updated block deltas into the owning message'),
    selector(['cleanup'], 'stops emitting and unsubscribes after dispose'),
    selector(['packaged'], 'ignores stale duplicate deltas without resnapshotting'),
    selector(['reconnect'], 're-registers on transport reconnect'),
    selector(
      ['refresh'],
      'dispatches refreshChatTranscriptRequested when the daemon replies resumed: false',
    ),
  ],
  'CHAT-06': [
    selector(['success'], 'uses the emphasized 280ms composer-to-bubble animation'),
    selector(['failure'], 'settles rejected animations without leaking styles'),
    selector(['cancel'], 'aborts immediately and restores exact styles'),
  ],
  'CHAT-07': [
    selector(
      ['mounted', 'runtime-success', 'success'],
      'uses the emphasized 280ms composer-to-bubble animation',
    ),
    selector(['runtime-error', 'failure'], 'settles rejected animations without leaking styles'),
    selector(['keyboard'], 'settles immediately when the page becomes hidden'),
    selector(['cleanup', 'cancel'], 'aborts immediately and restores exact styles'),
    selector(
      ['teardown'],
      'settles a never-resolving animation within the independent maximum bound',
    ),
  ],
  'CHAT-09': [
    selector(
      ['collapsed', 'expanded'],
      'renders a collapsed hook wake card and strips the prefix when expanded',
    ),
    selector(['attachments'], 'still renders inline mention chips alongside text segments'),
  ],
  'CHAT-11': [
    selector(
      ['collapsed', 'expanded'],
      'renders a collapsed hook wake card and strips the prefix when expanded',
    ),
  ],
  'CHAT-36': [
    selector(['collapsed'], 'accessible collapsed details disclosure'),
    selector(['expanded', 'error', 'output'], 'preserves completed and error disclosure semantics'),
  ],
  'CHAT-40': [
    selector(
      ['light', 'dark', 'wide', 'narrow', 'zoom-100', 'zoom-200', 'hover', 'focus'],
      'keeps the model left and places the prompt menu',
    ),
    selector(['keyboard', 'escape'], 'cancels enhancement with Escape'),
    selector(
      ['reduced-motion', 'focus-restore'],
      'shows Undo enhance after success and restores the original prompt',
    ),
    selector(['pointer'], 'runs enhancement from the menu'),
  ],
  'WORKSPACE-01': [selector(['empty'], 'strictly caps a non-expandable preview')],
  'WORKSPACE-02': [
    selector(['mounted', 'keyboard', 'cleanup'], 'provides a semantic keyboard-focus fallback'),
    selector(['runtime-success', 'resolvable'], 'targets its exact chat content'),
    selector(['runtime-error', 'internal'], 'opens compact file activity rows as scoped file tabs'),
    selector(['unresolvable'], 'initially caps the sidebar activity preview at three rows'),
  ],
  'WORKSPACE-10': [
    selector(['activity-precedence'], 'sorts hydrated pinned workspaces to the top'),
  ],
  'WORKSPACE-14': [
    selector(['mixed-statuses'], 'orders every member for the launcher'),
    selector(['overflow'], 'renders 8 agents as six plus semantic overflow'),
  ],
  'WORKSPACE-17': [selector(['mixed-agents'], 'keeps the marked initial coordinator first')],
  'WORKSPACE-18': [selector(['open'], 'opens each compact agent, note, and change exactly once')],
  'WORKSPACE-21': [
    selector(['reuse'], 'opens each compact agent, note, and change exactly once'),
    selector(['new'], 'opens the isolated compact Files chooser'),
  ],
  'WORKSPACE-22': [
    selector(['reuse'], 'opens each compact agent, note, and change exactly once'),
    selector(['loading'], 'keeps the compact Agents launcher stable while sessions are loading'),
    selector(['error', 'empty'], 'renders +0 agents as six plus semantic overflow'),
  ],
  'WORKSPACE-27': [
    selector(
      ['light', 'dark', 'wide', 'hover'],
      'keeps cross-card visible edges and shared geometry aligned at 1-item density',
    ),
    selector(
      ['narrow', 'zoom-100', 'zoom-200', 'reduced-motion'],
      'contained horizontal row with plain overflow text at narrow zoomed sizes',
    ),
    selector(
      ['focus', 'keyboard', 'focus-restore'],
      'contained outline-free keyboard focus states',
    ),
    selector(['outside-dismiss'], 'overlay that dismisses only from its backdrop'),
    selector(['escape'], 'dismisses the expanded card with Escape'),
  ],
  'WORKSPACE-28': [
    selector(['healthy', 'hidden'], 'toggles between single and column workspace views'),
    selector(
      ['active', 'failed'],
      'hides the view-mode toggle and repo launcher while onboarding is active',
    ),
    selector(
      ['waiting', 'stale', 'rehydration'],
      'tracks rapid mode changes without showing a stale destination glyph',
    ),
    selector(['attention'], 'uses a 32px hit box and a 16px destination glyph'),
    selector(
      ['overflow'],
      'restores the destination glyph and keeps the pressed button transparent',
    ),
  ],
  'WORKSPACE-29': [
    selector(['close'], 'toggles between single and column workspace views'),
    selector(['drag'], 'restores the destination glyph and keeps the pressed button transparent'),
    selector(['reorder'], 'tracks rapid mode changes without showing a stale destination glyph'),
  ],
  'WORKSPACE-31': [
    selector(['route'], 'toggles between single and column workspace views'),
    selector(['state'], 'restores the destination glyph and keeps the pressed button transparent'),
  ],
  'WORKSPACE-36': [
    selector(
      ['mounted', 'cleanup'],
      'migrates stale fill while preserving proven explicit and per-type widths',
    ),
    selector(
      ['runtime-success', 'edges'],
      'uses the edge panel when the layout has no valid focus',
    ),
    selector(['runtime-error'], 'skips empty workspaces and wraps in display order'),
    selector(['next'], 'returns the next local panel and hands off at the layout boundary'),
    selector(['previous'], 'cycles through tabs backward'),
    selector(['nested'], 'expands horizontal ancestors in a nested layout'),
  ],
  'WORKSPACE-37': [
    selector(
      ['mounted', 'cleanup'],
      'migrates stale fill while preserving proven explicit and per-type widths',
    ),
    selector(['runtime-success'], 'uses the edge panel when the layout has no valid focus'),
    selector(['runtime-error'], 'skips empty workspaces and wraps in display order'),
    selector(['indexed'], 'initializeLayout > sets root, panels, and focusedPanelId'),
    selector(['identified'], 'retargets only the identified tab'),
    selector(
      ['scroll'],
      'ignores long content, sidebar viewport, zoom, and tab-stack mode changes',
    ),
  ],
  'WORKSPACE-39': [
    selector(
      ['single-to-columns', 'columns-to-single'],
      'animates keyed workspace tabs and content-sized columns',
    ),
  ],
  'WORKSPACE-40': [
    selector(
      ['single-to-columns', 'columns-to-single'],
      'animates keyed workspace tabs and content-sized columns',
    ),
  ],
  'WORKSPACE-43': [
    selector(
      ['mounted', 'runtime-error', 'cleanup', 'narrow-type', 'wide-type', 'explicit-width'],
      'uses the usable viewport when resolving a responsive note column',
    ),
    selector(
      ['runtime-success', 'medium-type'],
      'resolves adjacent browser and note panels to responsive defaults',
    ),
  ],
  'WORKSPACE-44': [
    selector(['mounted', 'resize'], "settles panels 1/2/3 without replay in 'tab' mode at 1× zoom"),
    selector(['runtime-success'], "settles panels 1/2/3 without replay in 'tab' mode at 2× zoom"),
    selector(['runtime-error'], "settles panels 1/2/3 without replay in 'columns' mode at 1× zoom"),
    selector(['cleanup'], "settles panels 1/2/3 without replay in 'columns' mode at 2× zoom"),
    selector(['settlement'], "settles panels 1/2/3 without replay in 'stacked' mode at 2× zoom"),
    selector(['reload'], 'persists explicit pixels and restores them through production storage'),
  ],
  'WORKSPACE-45': [
    selector(
      ['pointer'],
      'keeps a vertical 16px resize target while reporting horizontal drag deltas',
    ),
    selector(['reset'], 'uses one neutral visual contract across resize implementations'),
    selector(['reload'], 'preserves two-axis corner resizing and cleanup'),
  ],
  'WORKSPACE-47': [
    selector(['root'], 'keeps 2–5 siblings mounted and interactive for target +0'),
    selector(['nested'], 'keeps 2–5 siblings mounted and interactive for target 1'),
    selector(['control-click'], 'keeps 2–5 siblings mounted and interactive for target 2'),
  ],
  'WORKSPACE-48': [
    selector(
      ['first-frame'],
      'moves between differently sized slots without scaling panel contents',
    ),
    selector(['reorder'], 'captures positions by stable panel id'),
  ],
  'WORKSPACE-50': [
    selector(['mounted', 'cleanup'], 'workspaceUnmounted > does NOT clear panel layout state'),
    selector(['runtime-success'], 'initializeLayout > sets root, panels, and focusedPanelId'),
    selector(['runtime-error'], 'rejects a tab owned by another workspace'),
    selector(['keyboard'], 'cycles through tabs forward'),
    selector(['reuse'], 'reuses existing singleton tab'),
    selector(
      ['reserved-placeholder'],
      'fills the focused empty panel before reusing equivalent content elsewhere',
    ),
  ],
  'WORKSPACE-56': [
    selector(
      ['light', 'dark', 'remove-last-tab'],
      'removes foreign workspace tabs and collapses panels they exclusively occupied',
    ),
    selector(
      ['wide', 'reduced-motion'],
      'counts horizontal columns without widening for vertical stacks',
    ),
    selector(['narrow'], 'inserts new content directly after its source panel'),
    selector(['zoom-100'], 'adds a horizontal panel without changing existing column pixels'),
    selector(
      ['zoom-200'],
      'uses the resized canvas when preserving pixels during horizontal insertion',
    ),
    selector(['hover'], 'removes a horizontal panel without changing surviving column pixels'),
    selector(['focus'], 'inserts a full-height column after the focused vertical stack'),
    selector(['keyboard'], 'appends a full-height column beside a vertical stack'),
    selector(['recovery'], 'passes the edge delta through nested rightmost horizontal branches'),
  ],
  'REMAINING-03': [
    selector(['route'], 'triggerCreatePR calls backgroundGitActionsService.createPR'),
  ],
  'REMAINING-04': [
    selector(
      ['light', 'dark', 'wide', 'editor'],
      'opens the isolated compact Files chooser and routes the installed editor action',
    ),
    selector(
      ['narrow', 'zoom-100', 'zoom-200', 'reduced-motion'],
      'contained horizontal row with plain overflow text at narrow zoomed sizes',
    ),
    selector(['hover', 'other'], 'keeps plain +N text immediately after the contained icon stack'),
    selector(
      ['focus', 'keyboard', 'focus-restore'],
      'contained outline-free keyboard focus states',
    ),
    selector(['copy-path'], 'opens each compact agent, note, and change exactly once'),
  ],
  'REMAINING-08': [
    selector(
      ['mounted', 'no-selection'],
      'awaits a script rename and keeps the editor open when the mutation fails in-band',
    ),
    selector(
      ['runtime-success', 'selected'],
      'reconciles a deferred rename to its captured workspace',
    ),
    selector(
      ['runtime-error', 'running'],
      'cancels the delayed terminal-tab action when destroyed',
    ),
    selector(['keyboard', 'stopped'], 'expands only the workspace whose terminal overlay is open'),
    selector(
      ['cleanup', 'error'],
      'releases active resize listeners and global body styles when destroyed',
    ),
  ],
  'REMAINING-12': [
    selector(
      ['light', 'wide', 'zoom-100', 'hover'],
      'renders cow mode inside the repository hover card',
    ),
    selector(['dark', 'zoom-200'], 'renders worktree mode inside the repository hover card'),
    selector(['narrow', 'keyboard'], 'omits checkout details when checkoutMode is missing'),
    selector(['focus'], 'renders direct mode inside the repository hover card'),
    selector(['reduced-motion'], 'keeps size out of the second line and mode details'),
  ],
  'REMAINING-13': [
    selector(
      ['light', 'wide', 'narrow', 'zoom-100', 'zoom-200', 'hover'],
      'narrow zoom-like viewport (light theme)',
    ),
    selector(['dark', 'focus'], 'narrow zoom-like viewport (dark theme)'),
    selector(
      ['keyboard', 'reduced-motion'],
      'keeps keyboard and dismissal behavior inside the open dialog',
    ),
  ],
  'REMAINING-14': [
    selector(
      ['light', 'wide', 'narrow', 'zoom-100', 'zoom-200', 'hover', 'pointer'],
      'narrow zoom-like viewport (light theme)',
    ),
    selector(['dark', 'focus'], 'narrow zoom-like viewport (dark theme)'),
    selector(
      ['keyboard', 'reduced-motion', 'dismiss'],
      'keeps keyboard and dismissal behavior inside the open dialog',
    ),
    selector(['selection'], 'selects models in both modes without bubbling'),
  ],
  'REMAINING-21': [
    selector(
      ['light', 'dark', 'wide', 'narrow', 'reduced-motion'],
      'checkColorContrast > should pass AA for sufficient contrast',
    ),
    selector(['zoom-100', 'aria'], 'addAriaLabels > should add aria attributes to element'),
    selector(
      ['zoom-200', 'focus', 'keyboard', 'focus-order'],
      'makeKeyboardNavigable > should add tabindex to element',
    ),
    selector(['hover'], 'makeKeyboardNavigable > should not override existing tabindex'),
  ],
};

function observedMountedStates(state: MountedState): string[] {
  return [
    state.theme,
    state.width < 500 ? 'narrow' : 'wide',
    state.zoom === 2 ? 'zoom-200' : 'zoom-100',
    'hover',
    'focus',
    'keyboard',
    ...(state.reduced ? ['reduced-motion'] : []),
  ];
}

export const mountedDefinitions: MountedEvidenceDefinition[] = mountedStates.flatMap((state) =>
  mountedScenes.map((scene) => ({
    evidenceId: `mounted:${scene}:${state.name}`,
    kind: 'mounted' as const,
    scene,
    state,
    rowIds: baselineRows.filter(({ probe }) => probe === scene).map(({ row }) => row),
    observedStates: observedMountedStates(state),
  })),
);

export const semanticTestFiles = [
  ...new Set(
    baselineRows.flatMap(({ tests }) =>
      tests.filter((file) => file.startsWith('src/') && file.endsWith('.test.ts')),
    ),
  ),
].sort();

export function createSemanticEvidence(
  assertionsByFile: ReadonlyMap<string, readonly string[]>,
): SemanticEvidence[] {
  return baselineRows.flatMap((row) => {
    const mountedStatesForRow = new Set(
      mountedDefinitions
        .filter(({ rowIds }) => rowIds.includes(row.row))
        .flatMap(({ observedStates }) => observedStates),
    );
    const observedStates = row.states.filter((state) => !mountedStatesForRow.has(state));
    if (observedStates.length === 0) return [];
    const testFiles = row.tests.filter((file) => assertionsByFile.has(file));
    const assertionIds = [
      ...new Set(testFiles.flatMap((file) => assertionsByFile.get(file) ?? [])),
    ];
    if (assertionIds.length === 0) {
      throw new Error(`${row.row} has semantic states without a passing semantic assertion`);
    }
    const selectors = semanticSelectors[row.row] ?? [];
    const selectorStates = selectors.flatMap(({ states }) => states);
    if (new Set(selectorStates).size !== selectorStates.length) {
      throw new Error(`${row.row} has duplicate semantic selector states`);
    }
    if (
      selectorStates.length !== observedStates.length ||
      observedStates.some((state) => !selectorStates.includes(state))
    ) {
      throw new Error(
        `${row.row} semantic selectors do not exactly cover: ${observedStates.join(', ')}`,
      );
    }
    const assertionByState = new Map(
      selectors.flatMap(({ states, assertionIncludes }) => {
        const matches = assertionIds.filter((assertionId) =>
          assertionId.includes(assertionIncludes),
        );
        if (matches.length !== 1) {
          throw new Error(
            `${row.row} selector "${assertionIncludes}" matched ${matches.length} assertions`,
          );
        }
        return states.map((state) => [state, matches[0]]);
      }),
    );
    const stateAssertions = Object.fromEntries(
      observedStates.map((state) => [state, assertionByState.get(state)]),
    );
    return [
      {
        evidenceId: `semantic:${row.row}`,
        kind: 'semantic' as const,
        rowId: row.row,
        observedStates: [...observedStates],
        testFiles,
        stateAssertions,
        status: 'passed' as const,
      },
    ];
  });
}

export function createEvidenceRows(semantic: readonly SemanticEvidence[]): EvidenceRow[] {
  return baselineRows.map((row) => {
    const stateEvidence = Object.fromEntries(
      row.states.map((state) => {
        const mountedIds = mountedDefinitions
          .filter(
            ({ rowIds, observedStates }) =>
              rowIds.includes(row.row) && observedStates.includes(state),
          )
          .map(({ evidenceId }) => evidenceId);
        const semanticIds = semantic
          .filter(({ rowId, stateAssertions }) => rowId === row.row && stateAssertions[state])
          .map(({ evidenceId }) => evidenceId);
        return [state, [...mountedIds, ...semanticIds]];
      }),
    );
    const evidenceIds = [...new Set(Object.values(stateEvidence).flat())];
    const verified = Object.values(stateEvidence).every((ids) => ids.length > 0);
    return {
      ...row,
      verdict: verified ? 'PRESERVED' : 'UNVERIFIED',
      implementationOwner: null,
      evidenceIds,
      stateEvidence,
    };
  });
}
