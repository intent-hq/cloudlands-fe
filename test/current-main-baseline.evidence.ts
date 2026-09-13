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
  rowAssertions: Record<string, string[]>;
  observedStates: string[];
};

export type SemanticEvidence = {
  evidenceId: string;
  kind: 'semantic';
  rowId: string;
  observedStates: string[];
  testFiles: string[];
  stateAssertions: Record<string, string>;
  configuredStates: Record<string, string[]>;
  status: 'passed';
};

export type EvidenceRow = BaselineRow & {
  verdict: 'PRESERVED' | 'UNVERIFIED';
  implementationOwner: null;
  evidenceIds: string[];
  stateEvidence: Record<string, string[]>;
};

const visualStates = [
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
const visualStateSet = new Set<string>(visualStates);
type SemanticSelector = {
  states: string[];
  assertionIncludes: string;
  configuredStates: string[];
};
const selector = (
  states: string[],
  assertionIncludes: string,
  configuredStates = states.filter((state) => !visualStateSet.has(state)),
): SemanticSelector => ({ states, assertionIncludes, configuredStates });

const semanticSelectors: Record<string, SemanticSelector[]> = {
  'CHAT-01': [
    selector(
      [...visualStates],
      'affirms attributed message hierarchy and density in every required visual state',
      [...visualStates],
    ),
  ],
  'CHAT-03': [
    selector(
      ['mounted', 'runtime-success', 'keyboard'],
      'renders one active 16px phase mark and the localized Thinking row',
      ['mounted', 'runtime-success', 'keyboard'],
    ),
    selector(['runtime-error'], 'renders explicit failed response copy'),
    selector(['cleanup'], 'clears failed presentation when a new stream starts'),
    selector(['advance'], 'formatElapsed > rounds to the nearest whole second'),
    selector(['reset'], 'full lifecycle: streaming → tool-call → tool-waiting → streaming again'),
  ],
  'CHAT-04': [
    selector(
      ['mounted', 'runtime-success', 'keyboard'],
      'shows the newest daemon message and maps all lifecycle phases to mark variants',
      ['mounted', 'runtime-success', 'keyboard'],
    ),
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
    selector(['keyboard'], 'folds added/updated block deltas into the owning message', [
      'keyboard',
    ]),
    selector(['cleanup'], 'stops emitting and unsubscribes after dispose'),
    selector(['packaged'], 'ignores stale duplicate deltas without resnapshotting'),
    selector(['reconnect'], 're-registers on transport reconnect'),
    selector(
      ['refresh'],
      'dispatches refreshChatTranscriptRequested when the daemon replies resumed: false',
    ),
  ],
  'CHAT-06': [
    selector(
      [...visualStates],
      'affirms the composer-to-bubble transition in every required visual state',
      [...visualStates],
    ),
    selector(
      ['success'],
      'uses one compositor transform and delegates bottom follow to the scroll authority',
    ),
    selector(['failure'], 'settles rejected animations without leaking styles'),
    selector(['cancel'], 'aborts immediately and restores exact styles'),
  ],
  'CHAT-07': [
    selector(
      ['mounted', 'runtime-success', 'success'],
      'uses one compositor transform and delegates bottom follow to the scroll authority',
    ),
    selector(['runtime-error', 'failure'], 'settles rejected animations without leaking styles'),
    selector(['keyboard'], 'settles immediately when the page becomes hidden', ['keyboard']),
    selector(['cleanup', 'cancel'], 'aborts immediately and restores exact styles'),
    selector(
      ['teardown'],
      'settles a never-resolving animation within the independent maximum bound',
    ),
  ],
  'CHAT-08': [
    selector(
      [...visualStates],
      'affirms message actions and timestamps in every required visual state',
      [...visualStates],
    ),
  ],
  'CHAT-09': [
    selector(
      [...visualStates],
      'affirms wake disclosure containment in every required visual state',
      [...visualStates],
    ),
    selector(
      ['collapsed', 'expanded'],
      'renders a collapsed hook wake card and strips the prefix when expanded',
    ),
    selector(['attachments'], 'still renders inline mention chips alongside text segments'),
  ],
  'CHAT-10': [
    selector(
      [...visualStates],
      'affirms attributed message hierarchy and density in every required visual state',
      [...visualStates],
    ),
  ],
  'CHAT-11': [
    selector(
      [...visualStates],
      'affirms wake disclosure containment in every required visual state',
      [...visualStates],
    ),
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
    selector([...visualStates], 'affirms nested composer menus in every required visual state', [
      ...visualStates,
    ]),
    selector(['escape'], 'cancels enhancement with Escape'),
    selector(
      ['focus-restore'],
      'shows Undo enhance after success and restores the original prompt',
    ),
    selector(['pointer'], 'runs enhancement from the menu'),
  ],
  'WORKSPACE-01': [
    selector(
      [...visualStates],
      'affirms the latest activity preview in every required visual state',
      [...visualStates],
    ),
    selector(['empty'], 'strictly caps a non-expandable preview'),
  ],
  'WORKSPACE-02': [
    selector(
      [
        'mounted',
        'runtime-success',
        'runtime-error',
        'cleanup',
        'resolvable',
        'internal',
        'unresolvable',
      ],
      'routes mounted file, note, and agent rows only through their exact callbacks',
    ),
    selector(
      ['keyboard'],
      'renders the agent avatar action as a keyboard-accessible sibling control',
      ['keyboard'],
    ),
  ],
  'WORKSPACE-08': [
    selector(
      [...visualStates],
      'affirms repository branch metadata and alignment in every required visual state',
      [...visualStates],
    ),
  ],
  'WORKSPACE-09': [
    selector(
      [...visualStates],
      'affirms repository branch metadata and alignment in every required visual state',
      [...visualStates],
    ),
  ],
  'WORKSPACE-10': [
    selector(
      [...visualStates],
      'affirms the pinned workspace indicator in every required visual state',
      [...visualStates],
    ),
    selector(['activity-precedence'], 'sorts hydrated pinned workspaces to the top'),
  ],
  'WORKSPACE-11': [
    selector(
      [...visualStates],
      'affirms hover-card placement and dismissal in every required visual state',
      [...visualStates],
    ),
  ],
  'WORKSPACE-14': [
    selector(['mixed-statuses'], 'orders every member for the launcher'),
    selector(['overflow'], 'renders 8 Agents and Context items as six plus semantic overflow'),
  ],
  'WORKSPACE-17': [
    selector(
      [...visualStates],
      'affirms coordinator and Spec ordering in every required visual state',
      [...visualStates],
    ),
    selector(['mixed-agents'], 'keeps the marked initial coordinator first'),
  ],
  'WORKSPACE-18': [
    selector(
      [...visualStates],
      'affirms coordinator and Spec ordering in every required visual state',
      [...visualStates],
    ),
    selector(['open'], 'keeps compact Context-card and Spec-icon actions separate'),
  ],
  'WORKSPACE-21': [
    selector(
      ['reuse', 'new'],
      'opens a running target as new and restores an existing hidden browser tab',
    ),
  ],
  'WORKSPACE-22': [
    selector(
      ['reuse', 'empty'],
      'opens an existing terminal and renders truthful empty shell states',
    ),
    selector(['loading'], 'keeps pending controls disabled, busy, and geometrically stable'),
    selector(['error'], 'keeps pending and failure state isolated by workspace'),
  ],
  'WORKSPACE-27': [
    selector(['focus-restore'], 'contained outline-free keyboard focus states'),
    selector(
      ['outside-dismiss'],
      'dismisses expanded overlay and footer backdrops without navigator propagation',
    ),
    selector(
      ['escape'],
      'dismisses the expanded card with Escape while preserving nested interaction isolation',
    ),
  ],
  'WORKSPACE-28': [
    selector(
      [...visualStates],
      'affirms tab status and full-surface activation in every required visual state',
      [...visualStates],
    ),
    selector(
      ['healthy', 'active', 'failed', 'waiting', 'attention', 'overflow'],
      'right-aligns intrinsic statuses before a stable close reservation',
    ),
    selector(
      ['hidden'],
      'keeps one shared status icon and the trailing close reservation without agent detail',
    ),
    selector(
      ['stale', 'rehydration'],
      'renders persisted inactive tabs while their workspace metadata loads',
    ),
  ],
  'WORKSPACE-29': [
    selector(
      [...visualStates],
      'affirms tab status and full-surface activation in every required visual state',
      [...visualStates],
    ),
    selector(
      ['close'],
      'keeps the close control outside the hover trigger and isolated from navigation',
    ),
    selector(['drag'], 'tracks every horizontal pointer move and keeps activation unchanged'),
    selector(
      ['reorder'],
      'supports keyboard reordering in both directions without moving past endpoints',
    ),
  ],
  'WORKSPACE-30': [
    selector(
      [...visualStates],
      'affirms titlebar border-box geometry in every required visual state',
      [...visualStates],
    ),
  ],
  'WORKSPACE-31': [
    selector(['route'], 'dispatches exactly one sidebar toggle for pointer activation'),
    selector(
      ['state'],
      'renders one 16px dandelion in a 20px optical box and a 32px active target',
    ),
  ],
  'WORKSPACE-36': [
    selector(
      ['mounted', 'cleanup'],
      'fills one-panel viewports and normalizes explicit saved widths',
    ),
    selector(
      ['runtime-success', 'edges'],
      'uses the edge panel when the layout has no valid focus',
    ),
    selector(['runtime-error'], 'skips empty workspaces and wraps in display order'),
    selector(['keyboard'], 'cycles through tabs backward', ['keyboard']),
    selector(['next'], 'returns the next local panel and hands off at the layout boundary'),
    selector(['previous'], 'cycles through tabs backward'),
    selector(['nested'], 'expands horizontal ancestors in a nested layout'),
  ],
  'WORKSPACE-37': [
    selector(
      ['mounted', 'cleanup'],
      'fills one-panel viewports and normalizes explicit saved widths',
    ),
    selector(['runtime-success'], 'uses the edge panel when the layout has no valid focus'),
    selector(['runtime-error'], 'skips empty workspaces and wraps in display order'),
    selector(['keyboard'], 'cycles through tabs forward', ['keyboard']),
    selector(['indexed'], 'initializeLayout > sets root, panels, and focusedPanelId'),
    selector(['identified'], 'retargets only the identified tab'),
    selector(
      ['scroll'],
      'ignores long content, sidebar viewport, zoom, and tab-stack mode changes',
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
    selector(['keyboard'], 'uses the usable viewport when resolving a responsive note column', [
      'keyboard',
    ]),
  ],
  'WORKSPACE-44': [
    selector(['mounted', 'resize'], "settles panels 1/2/3 without replay in 'tab' mode at 1× zoom"),
    selector(['runtime-success'], "settles panels 1/2/3 without replay in 'tab' mode at 2× zoom"),
    selector(['runtime-error'], "settles panels 1/2/3 without replay in 'columns' mode at 1× zoom"),
    selector(['cleanup'], "settles panels 1/2/3 without replay in 'columns' mode at 2× zoom"),
    selector(['settlement'], "settles panels 1/2/3 without replay in 'stacked' mode at 2× zoom"),
    selector(['reload'], 'persists explicit pixels and restores them through production storage'),
    selector(['keyboard'], "settles panels 1/2/3 without replay in 'tab' mode at 1× zoom", [
      'keyboard',
    ]),
  ],
  'WORKSPACE-45': [
    selector(
      ['pointer'],
      'keeps a vertical 16px resize target while reporting horizontal drag deltas',
    ),
    selector(['reset'], 'uses the canonical reset width on handle double-click'),
    selector(['reload'], 'preserves two-axis corner resizing and cleanup'),
  ],
  'WORKSPACE-46': [
    selector(
      [...visualStates],
      'affirms conditional resize-handle visibility in every required visual state',
      [...visualStates],
    ),
  ],
  'WORKSPACE-47': [
    selector(
      [...visualStates],
      'affirms dominant-panel expand and restore in every required visual state',
      [...visualStates],
    ),
    selector(['root'], 'keeps 2–5 siblings mounted and interactive for target +0'),
    selector(['nested'], 'keeps 2–5 siblings mounted and interactive for target 1'),
    selector(['control-click'], 'keeps 2–5 siblings mounted and interactive for target 2'),
  ],
  'WORKSPACE-48': [
    selector(
      [...visualStates, 'first-frame'],
      'affirms adjacent-panel first-frame translation in every required visual state',
      [...visualStates, 'first-frame'],
    ),
    selector(['reorder'], 'captures positions by stable panel id'),
  ],
  'WORKSPACE-50': [
    selector(['mounted', 'cleanup'], 'workspaceUnmounted > does NOT clear panel layout state'),
    selector(['runtime-success'], 'initializeLayout > sets root, panels, and focusedPanelId'),
    selector(['runtime-error'], 'rejects a tab owned by another workspace'),
    selector(['keyboard'], 'cycles through tabs forward', ['keyboard']),
    selector(['reuse'], 'reuses existing singleton tab'),
    selector(
      ['reserved-placeholder'],
      'reveals canonical equivalent content instead of filling an empty panel',
    ),
  ],
  'WORKSPACE-56': [
    selector(
      ['remove-last-tab'],
      'removes foreign workspace tabs and collapses panels they exclusively occupied',
    ),
    selector(['recovery'], 'passes the edge delta through nested rightmost horizontal branches'),
  ],
  'REMAINING-03': [
    selector([...visualStates], 'affirms the linked PR action in every required visual state', [
      ...visualStates,
    ]),
    selector(['route'], 'triggerCreatePR calls backgroundGitActionsService.createPR'),
  ],
  'REMAINING-04': [
    selector(
      [...visualStates],
      'affirms the Files Open in chooser in every required visual state',
      [...visualStates],
    ),
    selector(
      ['editor'],
      'opens the isolated compact Files chooser and routes the installed editor action',
    ),
    selector(['other'], 'keeps plain +N text inside the shared logical-start stack'),
    selector(
      ['focus-restore'],
      'uses contained outline-free keyboard focus states for every preview target',
    ),
    selector(
      ['copy-path'],
      'renders a plain chevron-less button that copies the path when "Copy path" is the only action',
    ),
  ],
  'REMAINING-08': [
    selector(
      ['mounted', 'no-selection'],
      'renders a tab for each previously-running script without auto-selecting it',
    ),
    selector(
      ['runtime-success', 'selected'],
      'dispatches terminals/selectScript when a running script tab is clicked',
    ),
    selector(
      ['runtime-error', 'error'],
      'awaits a script rename and keeps the editor open when the mutation fails in-band',
    ),
    selector(['running'], 'still renders live scripts as tabs, without a dismiss button'),
    selector(
      ['keyboard', 'stopped'],
      'dismissing a previously-running tab calls script.stop and refetches the list',
      ['keyboard', 'stopped'],
    ),
    selector(['cleanup'], 'releases active resize listeners and global body styles when destroyed'),
  ],
  'REMAINING-12': [
    selector([...visualStates], 'affirms repository pill contrast in every required visual state', [
      ...visualStates,
    ]),
  ],
  'REMAINING-13': [
    selector(
      [...visualStates],
      'affirms model picker bounds and options in every required visual state',
      [...visualStates],
    ),
  ],
  'REMAINING-14': [
    selector(
      [...visualStates],
      'affirms model picker bounds and options in every required visual state',
      [...visualStates],
    ),
    selector(
      ['pointer', 'dismiss'],
      'keeps keyboard and dismissal behavior inside the open dialog',
    ),
    selector(['selection'], 'selects models in both modes without bubbling'),
  ],
  'REMAINING-21': [
    selector(['aria'], 'renders accessible tabs with delayed shared workspace hover cards'),
    selector(
      ['focus-order'],
      'uses arrow keys to activate adjacent tabs and Delete to close the focused tab',
    ),
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

const mountedRowsByScene: Record<MountedScene, Record<string, string[]>> = {
  chat: {
    'CHAT-02': [
      'renders real compact ToolCall rows',
      'toggles the real disclosure with keyboard and pointer',
    ],
    'CHAT-36': [
      'keeps details collapsed until disclosure activation',
      'renders explicit error state',
    ],
  },
  sidebar: {
    'WORKSPACE-03': ['does not render an Activity launcher in the compact deck'],
    'WORKSPACE-14': ['renders bounded ordered agent previews with semantic responsive overflow'],
    'WORKSPACE-15': ['contains every visible agent preview inside the launcher paint bounds'],
    'WORKSPACE-16': ['keeps the final compact Agents preview left-oriented'],
    'WORKSPACE-19': ['renders the expanded sidebar as a bounded physical deck'],
    'WORKSPACE-20': ['keeps hover and keyboard focus on real compact launcher targets'],
    'WORKSPACE-21': ['renders the real Browser launcher and its expanded launch actions'],
    'WORKSPACE-22': ['renders the real Shell launcher and its terminal actions'],
    'WORKSPACE-26': ['renders expanded content as an overlay without launcher reflow'],
    'WORKSPACE-27': ['dismisses the overlay and restores focus to its launcher'],
    'REMAINING-21': [
      'meets rendered contrast, accessible-name, focus-order, and keyboard requirements',
    ],
  },
  tabs: {
    'WORKSPACE-31': ['renders and activates the real consolidated Spaces control'],
  },
  panel: {
    'WORKSPACE-42': ['keeps the rightmost nested panel inside the reachable scroll canvas'],
    'WORKSPACE-45': ['renders real keyboard-focusable panel resize handles'],
    'WORKSPACE-56': ['renders the real recoverable zero-tab creation shell'],
  },
};

export const mountedDefinitions: MountedEvidenceDefinition[] = mountedStates.flatMap((state) =>
  mountedScenes.map((scene) => ({
    evidenceId: `mounted:${scene}:${state.name}`,
    kind: 'mounted' as const,
    scene,
    state,
    rowIds: Object.keys(mountedRowsByScene[scene]),
    rowAssertions: mountedRowsByScene[scene],
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
    for (const evidenceSelector of selectors) {
      const unsupported = evidenceSelector.states.filter(
        (state) => !evidenceSelector.configuredStates.includes(state),
      );
      if (unsupported.length > 0) {
        throw new Error(
          `${row.row} selector "${evidenceSelector.assertionIncludes}" does not configure: ${unsupported.join(', ')}`,
        );
      }
    }
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
    const configuredByState = new Map(
      selectors.flatMap(({ states, configuredStates }) =>
        states.map((state) => [state, [...configuredStates]] as const),
      ),
    );
    const stateAssertions = Object.fromEntries(
      observedStates.map((state) => [state, assertionByState.get(state)]),
    );
    const configuredStates = Object.fromEntries(
      observedStates.map((state) => [state, configuredByState.get(state) ?? []]),
    );
    return [
      {
        evidenceId: `semantic:${row.row}`,
        kind: 'semantic' as const,
        rowId: row.row,
        observedStates: [...observedStates],
        testFiles,
        stateAssertions,
        configuredStates,
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
