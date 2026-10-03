import { expect, test, type Page } from '@playwright/test';
import {
  DIAGRAM_WORKBENCH_CASE_GROUPS,
  DIAGRAM_WORKBENCH_CASES,
} from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';
import { useDiagramPreviewServer } from './diagram-preview-server';

const preview = useDiagramPreviewServer('diagram-workbench-visual-lab');

// Authored fixture contracts, independent of the renderer's discovered DOM.
const flowInventories: Record<string, { nodes: string[]; routes: number; labels: number }> =
  Object.fromEntries(
    [
      ['edge-eight-way-fanout', 'A B C D E F G H I', 8, 8],
      ['edge-eight-way-fanin', 'A B C D E F G H Z R', 9, 0],
      ['edge-braided-diamonds', 'A B C D E F', 9, 5],
      ['edge-three-parallel-labels', 'A B', 4, 4],
      ['edge-four-self-loops', 'A B C D', 7, 4],
      ['edge-two-feedback-loops', 'A B C D E', 7, 3],
      ['edge-shortcut-ladder', 'A B C D E', 7, 6],
      ['edge-unequal-merge', 'A B C D E F G H I J K Z', 14, 0],
      ['edge-reversed-declarations', 'A B X Y Z', 5, 2],
      ['edge-disconnected-cycles', 'A B C D E F', 5, 0],
      ['edge-compact-diamond-grid', 'A B C D E F G H I', 11, 2],
      ['edge-many-roots-late-join', 'A B C D E F G H I', 8, 0],
      ['edge-subgraph-siblings', 'A B C D E F G', 7, 0],
      ['edge-four-nested-groups', 'A B C D E F', 5, 0],
      ['edge-long-group-titles', 'X Y Z', 2, 1],
      ['edge-group-local-directions', 'A1 A2 A3 B1 B2 B3', 5, 0],
      ['edge-group-return-trip', 'A B C D', 4, 4],
      ['edge-one-node-groups', 'A1 B1 C1 D1', 3, 0],
      ['edge-mixed-node-shapes', 'A B C D E F G H', 7, 0],
      ['edge-long-identifiers', 'A B C', 2, 0],
      ['edge-mixed-label-lengths', 'A B C D E', 4, 2],
      ['edge-multilingual-decisions', 'A B C D E', 5, 2],
      ['edge-punctuation-labels', 'A B C D', 3, 3],
      ['edge-styled-branches', 'A B C D E', 4, 2],
      ['edge-explicit-breaks', 'A B C D', 4, 2],
      ['mermaid-invitation', 'A B C D E F G H I J K L M N R X', 16, 6],
      ['mermaid-invitation-horizontal', 'A B C D E F G H I J K L M N R X', 16, 6],
      ['mermaid-invitation-reversed', 'A B C D E F G H I J K L M N R X', 16, 6],
      ['mermaid-unequal-branches', 'A B C D E F G H', 8, 2],
      ['mermaid-late-entry', 'A B C D E F R S', 7, 0],
      ['mermaid-decision-ladder', 'A B C D E X', 8, 8],
      ['mermaid-long-decision', 'A B C D E', 5, 2],
      ['mermaid-many-roles', 'A B C D E F G', 10, 5],
      ['mermaid-retry-and-exit', 'A B C D E', 5, 3],
      ['mermaid-parallel-checks', 'A B C D E F G H I', 11, 1],
      ['mermaid-right-to-left', 'A B C D E F', 6, 2],
      ['mermaid-grouped-invitation', 'A B C D E F J K X', 9, 4],
      ['mermaid-single-node', 'Only', 0, 0],
      ['mermaid-two-node', 'Source Target', 1, 1],
      ['mermaid-disconnected', 'A B C D E', 2, 0],
      ['mermaid-topology-stress', 'A B C D E', 9, 8],
      ['mermaid-nested-routing', 'Intake Validate Enrich Merge Registry', 9, 8],
      ['mermaid-nested-groups', 'Client Gateway Queue Worker Store', 5, 5],
      ['mermaid-flow', 'Start Check Work Fix Done', 5, 2],
      ['mermaid-groups', 'Catalog Scene Mermaid Custom', 3, 0],
      ['mermaid-dense-graph', 'A B C D E F G H', 11, 11],
      ['mermaid-long-labels', 'A B C', 2, 2],
      ['mermaid-multiline-labels', 'A B C', 2, 1],
      ['mermaid-cycle-fanout', 'Hub Flow Sequence State ER Review', 9, 0],
    ].map(([id, nodes, routes, labels]) => [
      id,
      { nodes: String(nodes).split(' '), routes: Number(routes), labels: Number(labels) },
    ]),
  );

const otherMermaidInventories: Record<string, { labels: string[]; routes: number }> = {
  'edge-sequence-six-actors': {
    labels: [
      'User',
      'UI',
      'API',
      'Queue',
      'Worker',
      'Store',
      'Submit',
      'Request',
      'Enqueue',
      'Deliver',
      'Write',
      'Saved',
      'Complete',
      'Result',
      'Ready',
    ],
    routes: 9,
  },
  'edge-sequence-nested-alt': {
    labels: [
      'Client',
      'Host',
      'Connect',
      'Welcome',
      'Publish identity proof',
      'New session',
      'Explain rejection',
    ],
    routes: 5,
  },
  'edge-sequence-parallel': {
    labels: [
      'UI',
      'API',
      'Cache',
      'DB',
      'Load workspace',
      'Read cache',
      'Cached values',
      'Query records',
      'Records',
      'Merged state',
    ],
    routes: 6,
  },
  'edge-sequence-activation': {
    labels: ['Client', 'Service', 'Start', 'Validate recursively', 'Valid', 'Complete'],
    routes: 4,
  },
  'edge-sequence-long-notes': {
    labels: [
      'Device',
      'Host',
      'Request a new session for the currently selected account identity',
      'Return the verified session and current workspace role',
    ],
    routes: 2,
  },
  'edge-sequence-loop-break': {
    labels: ['Client', 'Server', 'Retry request', 'Stop retrying', 'Try later'],
    routes: 3,
  },
  'mermaid-sequence': {
    labels: [
      'User',
      'Workbench',
      'Lazy preview',
      'Select named state',
      'Import fixture',
      'Stable diagram',
      'Error with source',
    ],
    routes: 4,
  },
  'mermaid-minimal-sequence': { labels: ['Worker'], routes: 0 },
  'mermaid-sequence-simple': {
    labels: ['Client', 'API', 'Submit account recovery request', 'Recovery request accepted'],
    routes: 2,
  },
  'mermaid-sequence-alt': {
    labels: [
      'Client',
      'Service',
      'Validate request',
      'Accepted response',
      'Explain required changes',
    ],
    routes: 3,
  },
  'mermaid-sequence-loop': {
    labels: ['User', 'Workbench', 'Review rendered result', 'Show next diagram'],
    routes: 2,
  },
  'mermaid-sequence-note': {
    labels: ['Editor', 'Renderer', 'Shared browser rendering boundary', 'Render source'],
    routes: 1,
  },
  'mermaid-state': {
    labels: ['Idle', 'Starting', 'Streaming', 'RunningTool', 'NeedsInput', 'Complete', 'Failed'],
    routes: 11,
  },
  'mermaid-state-recovery': {
    labels: ['Running', 'Complete', 'Failed', 'success', 'fail', 'retry', 'stop'],
    routes: 6,
  },
  'mermaid-minimal-state': { labels: ['Ready'], routes: 1 },
  'edge-state-compound': {
    labels: ['Idle', 'Active', 'Loading', 'Ready', 'Refreshing', 'Failed'],
    routes: 9,
  },
  'edge-state-fork-join': { labels: ['FetchProfile', 'FetchPermissions', 'Ready'], routes: 7 },
  'edge-state-choice': {
    labels: [
      'Checking',
      'Connected',
      'Denied',
      'Waiting',
      'allowed',
      'forbidden',
      'unavailable',
      'retry',
    ],
    routes: 8,
  },
  'mermaid-class': { labels: ['PreviewDefinition', 'DiagramPreview', 'DiagramFixture'], routes: 2 },
  'mermaid-minimal-class': { labels: ['Workspace'], routes: 0 },
  'edge-class-inheritance': {
    labels: ['Entity', 'User', 'Team', 'Member', 'Permission'],
    routes: 5,
  },
  'edge-class-long-signatures': { labels: ['InvitationService', 'PermissionSet'], routes: 1 },
  'mermaid-entity-relationship': {
    labels: ['PREVIEW', 'STATE', 'FIXTURE', 'exposes', 'renders'],
    routes: 2,
  },
  'mermaid-minimal-entity-relationship': { labels: ['WORKSPACE'], routes: 0 },
  'edge-er-hub': {
    labels: [
      'ACCOUNT',
      'SESSION',
      'INVITATION',
      'MEMBERSHIP',
      'TEAM',
      'WORKSPACE',
      'owns',
      'receives',
      'holds',
      'includes',
      'contains',
      'grants',
    ],
    routes: 6,
  },
  'edge-er-recursive': {
    labels: [
      'FOLDER',
      'DOCUMENT',
      'USER',
      'REVISION',
      'contains',
      'stores',
      'collaborates',
      'tracks',
      'authored_by',
    ],
    routes: 5,
  },
};

const mermaidExceptions: Record<string, string> = {
  'mermaid-invalid-source': '.mermaid-error [role="alert"]',
  'mermaid-empty-content': '.mermaid-empty',
};

const flowGroups: Record<string, string[]> = {
  'edge-subgraph-siblings': ['Apps', 'Data', 'Ops'],
  'edge-four-nested-groups': ['Org', 'Region', 'Cluster', 'Pod'],
  'edge-long-group-titles': ['A', 'B'],
  'edge-group-local-directions': ['A', 'B'],
  'edge-group-return-trip': ['Device', 'Server'],
  'edge-one-node-groups': ['A', 'B', 'C', 'D'],
  'mermaid-grouped-invitation': ['Device', 'Host'],
  'mermaid-nested-routing': ['Review', 'Rules'],
  'mermaid-nested-groups': ['Outer', 'Inner'],
  'mermaid-groups': ['Browser', 'Renderers'],
};

async function expectFixtureInventory(page: Page, readable = false) {
  const custom = Object.entries(DIAGRAM_WORKBENCH_CASES).flatMap(([id, fixture]) => {
    if (fixture.kind !== 'custom') return [];
    const { model, states, currentStateId } = fixture.diagram;
    const state = states?.find((state) => state.id === currentStateId);
    const nodes = model.nodes.filter(
      (node) => !state?.visibleNodes || state.visibleNodes.includes(node.id),
    );
    return [
      {
        id,
        nodes,
        edges: model.edges.filter(
          (edge) =>
            (!state?.visibleEdges || state.visibleEdges.includes(edge.id)) &&
            nodes.some(({ id }) => id === edge.from) &&
            nodes.some(({ id }) => id === edge.to),
        ),
        groups: (model.groups ?? []).filter(
          (group) =>
            (!state?.visibleGroups || state.visibleGroups.includes(group.id)) &&
            group.nodeIds.some((id) => nodes.some((node) => node.id === id)),
        ),
      },
    ];
  });
  const mermaidIds = Object.entries(DIAGRAM_WORKBENCH_CASES)
    .filter(([, fixture]) => fixture.kind === 'mermaid')
    .map(([id]) => id)
    .sort();
  expect(
    [
      ...Object.keys(flowInventories),
      ...Object.keys(otherMermaidInventories),
      ...Object.keys(mermaidExceptions),
    ].sort(),
  ).toEqual(mermaidIds);
  const failures = await page.evaluate(
    ({ flows, groups, others, exceptions, custom, readable }) => {
      const failures: string[] = [];
      const require = (ok: boolean, context: string) => {
        if (!ok) failures.push(context);
      };
      const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      const measure = (element: Element, context: string, minimum: number) => {
        const rect = element.getBoundingClientRect();
        require([rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
          rect.width > 0 &&
          rect.height > 0, `${context} visible bounds`);
        const owner =
          element instanceof SVGGraphicsElement ? element : element.closest('foreignObject');
        const matrix = owner?.getScreenCTM();
        require(Boolean(matrix), `${context} screen transform`);
        const scale = matrix ? Math.hypot(matrix.c, matrix.d) : NaN;
        const size = Number.parseFloat(getComputedStyle(element).fontSize) * scale;
        require(Number.isFinite(size) &&
          size > 0 &&
          (!readable || size >= minimum), `${context} readable font (${size})`);
        require(text(element).length > 0, `${context} nonempty text`);
        const style = getComputedStyle(element);
        require(style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0, `${context} painted text`);
      };
      for (const [id, expected] of Object.entries({ ...flows, ...others })) {
        const root = document.getElementById(id)!;
        require(root.querySelectorAll('.mermaid-renderer').length === 1, `${id} renderer`);
        const svgs = root.querySelectorAll<SVGSVGElement>('.mermaid-svg > svg');
        require(svgs.length === 1, `${id} SVG`);
        require(root.querySelectorAll('.mermaid-error, .mermaid-empty').length ===
          0, `${id} unexpected fallback`);
        const svg = svgs[0];
        if (!svg) continue;
        const viewport = root.querySelector<HTMLElement>('.mermaid-svg-viewport');
        require(Boolean(viewport) &&
          Number.isFinite(viewport!.clientWidth) &&
          viewport!.clientWidth > 0, `${id} viewport`);
        if (readable && viewport && viewport.scrollWidth > viewport.clientWidth + 1) {
          const initial = viewport.scrollLeft;
          const bounds = viewport.getBoundingClientRect();
          require(['auto', 'scroll'].includes(
            getComputedStyle(viewport).overflowX,
          ), `${id} scroll access`);
          viewport.scrollLeft = 0;
          const left = svg.getBoundingClientRect().left;
          viewport.scrollLeft = viewport.scrollWidth;
          const right = svg.getBoundingClientRect();
          require(viewport.scrollLeft > 0 &&
            right.left < left &&
            left >= bounds.left - 1 &&
            right.right <= bounds.right + 1, `${id} both horizontal ends reachable`);
          viewport.scrollLeft = initial;
        }
        if ('nodes' in expected) {
          const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
          const ids = nodes.map((node) => node.id.match(/flowchart-(.+)-\d+$/)?.[1]).sort();
          require(JSON.stringify(ids) ===
            JSON.stringify([...expected.nodes].sort()), `${id} nodes: ${ids}`);
          for (const node of nodes) {
            const labels = node.querySelectorAll('.nodeLabel');
            require(labels.length === 1, `${id}/${node.id} title`);
            labels.forEach((label) => measure(label, `${id}/${node.id} title`, 11.99));
          }
          const labels = [...svg.querySelectorAll('.edgeLabel .edgeLabel')].filter((label) =>
            text(label),
          );
          require(labels.length ===
            expected.labels, `${id} edge labels: ${labels.length}/${expected.labels}`);
          labels.forEach((label) => measure(label, `${id} edge label`, 11.99));
          require(svg.querySelectorAll('.flowchart-link').length ===
            expected.routes, `${id} routes`);
          const clusters = [...svg.querySelectorAll<SVGGElement>('g.cluster')];
          require(clusters.length === (groups[id]?.length ?? 0), `${id} groups`);
          for (const groupId of groups[id] ?? []) {
            const group = clusters.find(
              (group) => group.id === groupId || group.id.endsWith(`-${groupId}`),
            );
            const label = group?.querySelector('.cluster-label');
            require(Boolean(label?.textContent?.trim()), `${id}/${groupId} group heading`);
          }
        } else {
          const labels = [...svg.querySelectorAll('text, .nodeLabel, .edgeLabel')].filter((label) =>
            text(label),
          );
          const sequence = svg.getAttribute('aria-roledescription') === 'sequence';
          const textGroups: Element[][] = labels.map((label) => [label]);
          if (sequence) {
            let message: Element[] = [];
            for (const child of svg.children) {
              if (child.matches('text.messageText')) message.push(child);
              if (child.matches('.messageLine0, .messageLine1')) {
                if (message.length > 0) textGroups.push(message);
                message = [];
              }
            }
          }
          for (const required of expected.labels) {
            const group = textGroups.find(
              (group) =>
                group.map(text).join('').replace(/\s/g, '') === required.replace(/\s/g, ''),
            );
            require(Boolean(group), `${id} label: ${required}`);
            group?.forEach((label) => measure(label, `${id}/${required}`, 11.99));
          }
          const routes = svg.querySelectorAll(
            sequence
              ? '.messageLine0, .messageLine1'
              : '.edgePaths path, .edges.edgePath path, .relationshipLine',
          );
          require(routes.length ===
            expected.routes, `${id} routes: ${routes.length}/${expected.routes}`);
        }
      }
      for (const [id, selector] of Object.entries(exceptions)) {
        const root = document.getElementById(id)!;
        require(root.querySelectorAll(selector).length === 1 &&
          root.querySelectorAll('.mermaid-svg > svg').length === 0, `${id} expected fallback`);
      }
      for (const { id, nodes, edges, groups } of custom) {
        const root = document.getElementById(id)!;
        require(root.querySelectorAll('.diagram-renderer').length === 1, `${id} renderer`);
        require(root.querySelectorAll('.diagram-svg-layer').length ===
          (id === 'custom-empty-content' ? 0 : 1), `${id} SVG`);
        require(root.querySelectorAll('.diagram-feedback[role="status"]').length ===
          (id === 'custom-empty-content' ? 1 : 0), `${id} empty state`);
        require(root.querySelectorAll('.diagram-feedback[role="alert"]').length ===
          0, `${id} unexpected error`);
        const ids = (selector: string, attribute: string) =>
          [...root.querySelectorAll(selector)]
            .map((element) => element.getAttribute(attribute))
            .sort();
        require(JSON.stringify(ids('foreignObject[data-node-id]', 'data-node-id')) ===
          JSON.stringify(nodes.map(({ id }) => id).sort()), `${id} nodes`);
        require(JSON.stringify(ids('.diagram-edge', 'data-edge-id')) ===
          JSON.stringify(edges.map(({ id }) => id).sort()), `${id} routes`);
        require(JSON.stringify(ids('.edge-label-container', 'data-edge-id')) ===
          JSON.stringify(
            edges
              .filter(({ label }) => label)
              .map(({ id }) => id)
              .sort(),
          ), `${id} edge labels`);
        require(JSON.stringify(ids('.diagram-group', 'data-group-id')) ===
          JSON.stringify(groups.map(({ id }) => id).sort()), `${id} groups`);
        for (const group of groups) {
          const label = root.querySelector(`[data-group-id="${group.id}"] .group-label`);
          require(Boolean(label?.textContent?.trim()), `${id}/${group.id} group heading`);
        }
        for (const node of nodes) {
          for (const [selector, minimum] of [
            ['.node-label', 11.99],
            ...(node.kind ? [['.node-kind-label', 9.99]] : []),
          ] as [string, number][]) {
            const labels = root.querySelectorAll(`[data-node-id="${node.id}"] ${selector}`);
            require(labels.length === 1, `${id}/${node.id} ${selector}`);
            labels.forEach((label) => measure(label, `${id}/${node.id} ${selector}`, minimum));
            const expected = selector === '.node-label' ? node.label : node.kind!;
            require(labels.length === 1 &&
              text(labels[0]).replace(/\s/g, '') ===
                expected.replace(/\s/g, ''), `${id}/${node.id} authored text`);
          }
        }
        for (const edge of edges.filter(({ label }) => label)) {
          const label = root.querySelector(`[data-edge-id="${edge.id}"] .edge-label-html`);
          require(Boolean(label) &&
            text(label!).replace(/\s/g, '') ===
              edge.label!.replace(/\s/g, ''), `${id}/${edge.id} authored text`);
        }
        root
          .querySelectorAll('.edge-label-html')
          .forEach((label) => measure(label, `${id} edge label`, 11.99));
      }
      return failures;
    },
    {
      flows: flowInventories,
      groups: flowGroups,
      others: otherMermaidInventories,
      exceptions: mermaidExceptions,
      custom,
      readable,
    },
  );
  expect(failures, 'Every fixture retains its authored content and finite measurements').toEqual(
    [],
  );
}

function isVisibleScrollTarget(box: { y: number; height: number } | null, viewportHeight: number) {
  return Boolean(
    box &&
    [box.y, box.height, viewportHeight].every(Number.isFinite) &&
    box.height > 0 &&
    box.y >= 0 &&
    box.y < 80 &&
    box.y + box.height <= viewportHeight,
  );
}

interface ReadinessSnapshot {
  sceneReady: string | null;
  sceneStable: string | null;
  sceneStatus: string | null;
  workbenchReady: string | null;
  workbenchGeneration: string | null;
  unsettledRendererCount: number;
}

interface ReadinessObservation {
  history: ReadinessSnapshot[];
  observer: MutationObserver;
}

type ReadinessWindow = Window & { __readinessObservation?: ReadinessObservation };

test.describe.configure({ timeout: 120_000 });

async function openSandbox(page: Page, query: string) {
  await page.goto(`${preview.url}/sandbox/diagram-workbench?${query}`);
  const scene = page.getByTestId('catalog-scene');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 90_000 });
  await expect(scene).toHaveAttribute('data-preview-stable', 'true');
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
    { timeout: 90_000 },
  );
  await expect(page.locator('.mermaid-svg > svg:not([data-layout-settled="true"])')).toHaveCount(0);
}

async function beginReadinessObservation(page: Page) {
  await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>('[data-testid="catalog-scene"]');
    const workbench = document.querySelector<HTMLElement>('[data-diagram-workbench]');
    if (!scene || !workbench) throw new Error('Readiness observation targets are unavailable.');
    const readinessWindow = window as ReadinessWindow;
    readinessWindow.__readinessObservation?.observer.disconnect();
    const history: ReadinessSnapshot[] = [];
    const record = () => {
      const currentWorkbench = scene.querySelector<HTMLElement>('[data-diagram-workbench]');
      const snapshot: ReadinessSnapshot = {
        sceneReady: scene.dataset.previewReady ?? null,
        sceneStable: scene.dataset.previewStable ?? null,
        sceneStatus: scene.dataset.previewStatus ?? null,
        workbenchReady: currentWorkbench?.dataset.diagramWorkbenchReady ?? null,
        workbenchGeneration: currentWorkbench?.dataset.diagramWorkbenchGeneration ?? null,
        unsettledRendererCount: [
          ...(currentWorkbench?.querySelectorAll<HTMLElement>(
            '.diagram-renderer, .mermaid-renderer',
          ) ?? []),
        ].filter(
          (renderer) =>
            renderer.dataset.diagramSettled === 'false' ||
            renderer.dataset.renderSettled === 'false',
        ).length,
      };
      if (JSON.stringify(history.at(-1)) !== JSON.stringify(snapshot)) history.push(snapshot);
    };
    const observer = new MutationObserver(record);
    observer.observe(scene, {
      attributes: true,
      attributeFilter: [
        'data-preview-ready',
        'data-preview-stable',
        'data-preview-status',
        'data-diagram-settled',
        'data-diagram-workbench-ready',
        'data-diagram-workbench-generation',
      ],
      childList: true,
      subtree: true,
    });
    readinessWindow.__readinessObservation = { history, observer };
    record();
  });
}

async function readReadinessHistory(page: Page): Promise<ReadinessSnapshot[]> {
  return page.evaluate(() => (window as ReadinessWindow).__readinessObservation?.history ?? []);
}

async function endReadinessObservation(page: Page): Promise<ReadinessSnapshot[]> {
  return page.evaluate(() => {
    const readinessWindow = window as ReadinessWindow;
    const observation = readinessWindow.__readinessObservation;
    observation?.observer.disconnect();
    delete readinessWindow.__readinessObservation;
    return observation?.history ?? [];
  });
}

function hasCompleteReadinessCycle(history: ReadinessSnapshot[]): boolean {
  const rendererWaiting = history.findIndex(({ unsettledRendererCount }) =>
    Boolean(unsettledRendererCount),
  );
  if (rendererWaiting < 0) return false;
  const workbenchWaiting = history.findIndex(
    ({ workbenchReady }, index) => index >= rendererWaiting && workbenchReady === 'false',
  );
  if (workbenchWaiting < 0) return false;
  const sceneWaiting = history.findIndex(
    ({ sceneReady, sceneStable, sceneStatus }, index) =>
      index >= workbenchWaiting &&
      sceneReady === 'false' &&
      sceneStable === 'false' &&
      sceneStatus === 'loading',
  );
  if (sceneWaiting < 0) return false;
  return history.some(
    ({ sceneReady, sceneStable, sceneStatus, workbenchReady, unsettledRendererCount }, index) =>
      index > sceneWaiting &&
      sceneReady === 'true' &&
      sceneStable === 'true' &&
      sceneStatus === 'ready' &&
      workbenchReady === 'true' &&
      unsettledRendererCount === 0,
  );
}

test('renders every registered diagram case together without the dense review shell', async ({
  page,
}) => {
  await openSandbox(page, 'state=mermaid-flow&theme=light&width=960&motion=reduced');

  const orderedCaseIds = DIAGRAM_WORKBENCH_CASE_GROUPS.flatMap(({ caseIds }) => caseIds);
  const registeredCases = Object.values(DIAGRAM_WORKBENCH_CASES);
  expect(
    await page.locator('[data-diagram-case]').evaluateAll((cases) => cases.map(({ id }) => id)),
  ).toEqual(orderedCaseIds);
  await expect(page.locator('[data-diagram-case]')).toHaveCount(registeredCases.length);
  await expect(page.locator('[data-diagram-case] .mermaid-renderer')).toHaveCount(
    registeredCases.filter(({ kind }) => kind === 'mermaid').length,
  );
  await expect(page.locator('[data-diagram-case] .diagram-renderer')).toHaveCount(
    registeredCases.filter(({ kind }) => kind === 'custom').length,
  );
  await expect(page.locator('[data-diagram-case] .loading-state')).toHaveCount(
    registeredCases.filter(({ kind }) => kind === 'loading').length,
  );

  const loading = page.locator('#mermaid-loading .loading-state');
  await expect(loading).toHaveAttribute('role', 'status');
  await expect(loading).toHaveAttribute('aria-label', 'Diagram is loading');
  await expect(loading).toHaveText('Rendering diagram…');
  await expect(loading.locator('svg, img, span, [aria-hidden="true"]')).toHaveCount(0);
  expect(
    await loading.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        childTags: [...element.children].map(({ tagName }) => tagName),
        borderWidths: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
        animationName: style.animationName,
      };
    }),
  ).toEqual({
    childTags: ['P'],
    borderWidths: ['0px', '0px', '0px', '0px'],
    animationName: 'none',
  });

  for (const id of orderedCaseIds) {
    const fixture = DIAGRAM_WORKBENCH_CASES[id];
    const diagramCase = page.locator(`[data-diagram-case="${id}"]`);
    await expect(diagramCase.getByRole('heading', { name: fixture.title })).toBeVisible();
    await expect(diagramCase.getByText(fixture.description, { exact: true })).toBeVisible();
    if (fixture.visualContract) {
      await expect(diagramCase.locator('[data-visual-contract]')).toHaveText(
        fixture.visualContract,
      );
    }
  }

  await expect(page.locator('[data-diagram-review-lab], [data-review-overview]')).toHaveCount(0);
  await expect(page.locator('[data-review-comparison], [data-review-diagnostics]')).toHaveCount(0);
  await expect(page.locator('[data-diagram-workbench]').getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('.view-switcher, .case-groups, .case-groups details')).toHaveCount(0);

  const targetedSurface = await page.locator('#mermaid-flow').evaluate((diagramCase) => ({
    host: getComputedStyle(diagramCase).backgroundColor,
    canvas: getComputedStyle(diagramCase.querySelector('.mermaid-svg > svg')!).backgroundColor,
  }));
  expect(targetedSurface.canvas).toBe(targetedSurface.host);
});

test('uses open chevrons for directed routes while preserving semantic markers', async ({
  page,
}) => {
  await openSandbox(page, 'state=mermaid-flow&theme=light&width=960&motion=reduced');
  await expectFixtureInventory(page);
  for (const [id, routes] of [
    [
      'mermaid-flow',
      ['L_Start_Check_0', 'L_Check_Work_0', 'L_Check_Fix_0', 'L_Fix_Check_0', 'L_Work_Done_0'],
    ],
    [
      'mermaid-cycle-fanout',
      [
        'L_Hub_Flow_0',
        'L_Hub_Sequence_0',
        'L_Hub_State_0',
        'L_Hub_ER_0',
        'L_Flow_Review_0',
        'L_Sequence_Review_0',
        'L_State_Review_0',
        'L_ER_Review_0',
        'L_Review_Hub_0',
      ],
    ],
  ] as const) {
    expect(
      await page
        .locator(`#${id} .flowchart-link`)
        .evaluateAll((paths) => paths.map((path) => path.getAttribute('data-id')).sort()),
    ).toEqual([...routes].sort());
  }

  const directedCounts = Object.fromEntries(
    Object.entries(DIAGRAM_WORKBENCH_CASES).flatMap(([id, fixture]) => {
      if (fixture.kind !== 'mermaid' || mermaidExceptions[id]) return [];
      if (/^(?:flowchart|sequenceDiagram|stateDiagram-v2)\b/.test(fixture.source)) {
        return [[id, (flowInventories[id] ?? otherMermaidInventories[id]).routes]];
      }
      return [];
    }),
  );

  const markers = await page.evaluate((expectedCounts) => {
    const markerFor = (path: Element, attribute: 'marker-start' | 'marker-end') => {
      const reference = path.getAttribute(attribute) ?? '';
      const markerId = reference.match(/#([^)'"]+)/)?.[1] ?? '';
      return document.querySelector<SVGMarkerElement>(`marker[id="${CSS.escape(markerId)}"]`);
    };
    // Discover routes independently of marker presence and conversion metadata.
    // Class inheritance/composition and ER cardinality retain semantic markers.
    const discoveryFailures: string[] = [];
    const directed = [...document.querySelectorAll<SVGSVGElement>('.mermaid-svg > svg')]
      .flatMap((svg) => {
        const family = svg.getAttribute('aria-roledescription') ?? '';
        const selector =
          family === 'flowchart-v2'
            ? '.flowchart-link'
            : family === 'sequence'
              ? '.messageLine0, .messageLine1'
              : family.startsWith('stateDiagram')
                ? '.edgePaths path, .edges.edgePath path'
                : null;
        const paths = selector ? [...svg.querySelectorAll(selector)] : [];
        const id = svg.closest('[data-diagram-case]')!.id;
        if (id in expectedCounts && paths.length !== expectedCounts[id])
          discoveryFailures.push(`${id}: ${paths.length}/${expectedCounts[id]} directed routes`);
        return paths;
      })
      .concat([...document.querySelectorAll('.diagram-edge .edge-path')])
      .map((path) => ({ path, marker: markerFor(path, 'marker-end') }));
    const hasRightAngleWings = (shape: SVGPathElement) => {
      const values = shape
        .getAttribute('d')
        ?.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)
        ?.map(Number);
      if (!values || values.length !== 6) return false;
      const [x1, y1, tipX, tipY, x2, y2] = values;
      const first = { x: x1 - tipX, y: y1 - tipY };
      const second = { x: x2 - tipX, y: y2 - tipY };
      return (
        values.every(Number.isFinite) &&
        Math.hypot(first.x, first.y) > 0 &&
        Math.abs(first.x * second.x + first.y * second.y) < 0.001 &&
        Math.abs(Math.hypot(first.x, first.y) - Math.hypot(second.x, second.y)) < 0.001
      );
    };
    const failures = directed.flatMap(({ path, marker }) => {
      const identity = `${path.closest('[data-diagram-case]')?.id}/${path.id || path.closest('[data-edge-id]')?.getAttribute('data-edge-id')}`;
      if (!marker) return [`${identity}: missing marker`];
      const shape = marker.querySelector<SVGPathElement>('path');
      const style = shape && getComputedStyle(shape);
      const pathStyle = getComputedStyle(path);
      const markerWidth = Number(marker.getAttribute('markerWidth'));
      const strokeWidth = Number.parseFloat(pathStyle.strokeWidth);
      return (!path.closest('.mermaid-svg') || marker.dataset.diagramChevron === 'true') &&
        shape &&
        shape.getAttribute('fill') === 'none' &&
        style?.fill === 'none' &&
        shape.getAttribute('stroke') === 'context-stroke' &&
        style.strokeLinecap === 'round' &&
        style.strokeLinejoin === 'round' &&
        hasRightAngleWings(shape) &&
        Number.isFinite(markerWidth) &&
        Number.isFinite(strokeWidth) &&
        strokeWidth > 0 &&
        markerWidth / strokeWidth >= 4
        ? []
        : [`${identity}: ${marker.id}`];
    });
    const classMarkers = [...document.querySelectorAll('#mermaid-class [marker-start]')].map(
      (path) => {
        const marker = markerFor(path, 'marker-start');
        const shape = marker?.querySelector<SVGPathElement>('path');
        return { id: marker?.id ?? '', fill: shape ? getComputedStyle(shape).fill : '' };
      },
    );
    const dependencies = [
      ...document.querySelectorAll('#edge-class-long-signatures .edgePaths path'),
    ];
    const dependency = dependencies.length === 1 ? markerFor(dependencies[0], 'marker-end') : null;
    const dependencyShape = dependency?.querySelector<SVGPathElement>('path');
    const dependencyBounds = dependencyShape?.getBBox();
    return {
      count: directed.length,
      failures: [...discoveryFailures, ...failures],
      inheritanceOpen: classMarkers.some(
        ({ id, fill }) => id.includes('extensionStart') && fill === 'rgba(0, 0, 0, 0)',
      ),
      compositionFilled: classMarkers.some(
        ({ id, fill }) => id.includes('compositionStart') && fill !== 'rgba(0, 0, 0, 0)',
      ),
      dependencyNotched: Boolean(
        dependency?.id.endsWith('dependencyEnd') &&
        dependencyShape &&
        dependencyBounds &&
        dependencyBounds.width > 0 &&
        dependencyBounds.height > 0 &&
        dependencyShape.getTotalLength() > 0 &&
        !dependencyShape.isPointInFill(
          new DOMPoint(
            dependencyBounds.x + dependencyBounds.width * 0.5,
            dependencyBounds.y + dependencyBounds.height * 0.5,
          ),
        ) &&
        dependencyShape.isPointInFill(
          new DOMPoint(
            dependencyBounds.x + dependencyBounds.width * 0.9,
            dependencyBounds.y + dependencyBounds.height * 0.5,
          ),
        ),
      ),
    };
  }, directedCounts);

  expect(markers.count).toBeGreaterThan(50);
  expect(markers.failures).toEqual([]);
  expect(markers.inheritanceOpen).toBe(true);
  expect(markers.compositionFilled).toBe(true);
  expect(markers.dependencyNotched).toBe(true);
});

test('uses the direct state as a stable initial scroll target without hiding cases', async ({
  page,
}) => {
  await openSandbox(
    page,
    'state=custom-bindings&review=compare&compare=mermaid-flow&theme=dark&width=960&motion=reduced',
  );

  const target = page.locator('#custom-bindings');
  await expect(target).toHaveAttribute('data-targeted', 'true');
  await expect(page.locator('[data-diagram-case]')).toHaveCount(
    Object.keys(DIAGRAM_WORKBENCH_CASES).length,
  );
  await expect
    .poll(async () =>
      isVisibleScrollTarget(
        await target.locator('.case-header').boundingBox(),
        await page.evaluate(() => window.innerHeight),
      ),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('rejects missing and overscrolled target headers', () => {
  expect(isVisibleScrollTarget({ y: 16, height: 48 }, 720)).toBe(true);
  expect(isVisibleScrollTarget({ y: -400, height: 48 }, 720)).toBe(false);
  expect(isVisibleScrollTarget({ y: 700, height: 48 }, 720)).toBe(false);
  expect(isVisibleScrollTarget(null, 720)).toBe(false);
});

test('keeps each diagram interaction scoped and usable on the long page', async ({ page }) => {
  await openSandbox(page, 'state=custom-bindings&theme=light&width=960&motion=reduced');

  const bindingCase = page.locator('#custom-bindings');
  const binding = bindingCase.getByRole('button', {
    name: /open review retry criteria note binding/i,
  });
  await expect(bindingCase.locator('.diagram-actions')).toHaveCSS('opacity', '0');
  await binding.focus();
  await expect(bindingCase.locator('.diagram-actions')).toHaveCSS('opacity', '1');
  await binding.click();
  await expect(bindingCase.locator('[data-binding-target]')).toContainText('note: bf4d5bc8');

  const walkthroughCase = page.locator('#custom-walkthrough');
  const firstStep = walkthroughCase.locator('[data-diagram-step-index="0"]');
  await firstStep.focus();
  await firstStep.press('ArrowRight');
  await expect(walkthroughCase.getByLabel('Step 2 of 3')).toBeVisible();

  const mermaidCase = page.locator('#mermaid-flow');
  const mermaidActions = mermaidCase.locator('.mermaid-actions');
  const viewSource = mermaidCase.getByRole('button', { name: 'View source' });
  await expect(mermaidActions).toHaveCSS('opacity', '0');
  await mermaidCase.locator('.mermaid-svg-container').hover();
  await expect(mermaidActions).toHaveCSS('opacity', '1');
  await viewSource.click();
  await expect(mermaidCase.getByRole('region', { name: 'View source' })).toBeVisible();
  await viewSource.click();
  await mermaidCase.getByRole('button', { name: 'Expand diagram to fullscreen' }).click();
  await expect(page.getByRole('dialog', { name: 'Fullscreen diagram view' })).toBeVisible();
  await page.keyboard.press('Escape');
});

for (const [theme, width] of [
  ['light', 960],
  ['light', 420],
  ['dark', 320],
] as const) {
  test(`keeps the complete page responsive in ${theme} at ${width}px`, async ({ page }) => {
    await openSandbox(page, `state=mermaid-flow&theme=${theme}&width=${width}&motion=reduced`);

    await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', theme);
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
      'data-catalog-motion',
      'reduced',
    );
    await expect(page.locator('[data-diagram-case]')).toHaveCount(
      Object.keys(DIAGRAM_WORKBENCH_CASES).length,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page
        .getByTestId('catalog-scene-focus')
        .evaluate((focus, maxWidth) => focus.getBoundingClientRect().width <= maxWidth + 1, width),
    ).toBe(true);
    await expectFixtureInventory(page, width <= 420);

    const sourceCase = page.locator('#mermaid-flow');
    await sourceCase.locator('.mermaid-svg-container').hover();
    await sourceCase.getByRole('button', { name: 'View source' }).click();
    const source = sourceCase.locator('.mermaid-source pre');
    await expect(source).toHaveText(DIAGRAM_WORKBENCH_CASES['mermaid-flow'].source!);
    expect(
      await source.evaluate((pre) => ({
        contained: pre.scrollWidth <= pre.clientWidth + 1,
        wrapping: getComputedStyle(pre).whiteSpace,
      })),
    ).toEqual({ contained: true, wrapping: 'pre-wrap' });

    await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
    await page.getByTestId('catalog-color-theme-control').click();
    await page.getByRole('option', { name: 'Nord', exact: true }).click();
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
      'data-catalog-color-theme',
      'nord',
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
      timeout: 90_000,
    });

    const presentation = await page.locator('[data-diagram-workbench]').evaluate((workbench) => {
      const style = (selector: string) => getComputedStyle(workbench.querySelector(selector)!);
      return {
        headingFonts: ['.page-header h1', '.group-header h2', '.case-header h3'].map(
          (selector) => style(selector).fontFamily,
        ),
        headingTransforms: ['.group-header h2', '.case-header h3'].map(
          (selector) => style(selector).textTransform,
        ),
        stageBackground: style('.diagram-stage').backgroundColor,
      };
    });
    expect(presentation.headingFonts.every((font) => font.includes('Source Serif 4'))).toBe(true);
    expect(presentation.headingTransforms).toEqual(['none', 'none']);
    expect(presentation.stageBackground).toBe('rgba(0, 0, 0, 0)');
  });
}

test('keeps custom routes, labels, markers, and group headings precise', async ({ page }) => {
  await openSandbox(page, 'state=custom-bindings&theme=light&width=960&motion=reduced');

  const architecture = page.locator('#custom-bindings');
  const fit = architecture.locator('.diagram-fit-button');
  await expect(fit).toHaveAccessibleName(/fit diagram to width/i);
  await fit.focus();
  await expect(architecture.locator('.diagram-actions')).toHaveCSS('opacity', '1');
  await fit.click();
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  for (const [selector, attribute, expected] of [
    ['foreignObject[data-node-id]', 'data-node-id', ['failure', 'review', 'daemon', 'stream']],
    ['.diagram-edge', 'data-edge-id', ['b1', 'b2', 'b3']],
    ['.edge-label-container', 'data-edge-id', ['b1', 'b2', 'b3']],
  ] as const) {
    expect(
      await architecture
        .locator(selector)
        .evaluateAll(
          (elements, attribute) =>
            elements.map((element) => element.getAttribute(attribute)).sort(),
          attribute,
        ),
    ).toEqual([...expected].sort());
  }
  await expect(architecture.locator('.node-label')).toHaveCount(4);

  const geometry = await architecture.evaluate((root) => {
    const routeDistance = (path: SVGGeometryElement, x: number, y: number) => {
      const total = path.getTotalLength();
      let distance = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= 2000; step += 1) {
        const point = path.getPointAtLength((total * step) / 2000);
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
        distance = Math.min(distance, Math.hypot(x - screenPoint.x, y - screenPoint.y));
      }
      return distance;
    };

    return {
      pathWidths: [...root.querySelectorAll<SVGPathElement>('.edge-path')].map(
        (path) => getComputedStyle(path).strokeWidth,
      ),
      markerWidths: [...root.querySelectorAll('.edge-path')].map((path) => {
        const id = path.getAttribute('marker-end')?.match(/#([^)'"]+)/)?.[1];
        const marker = id ? root.querySelector(`marker[id="${CSS.escape(id)}"] path`) : null;
        return marker?.getAttribute('stroke-width') ?? null;
      }),
      labelConnections: [...root.querySelectorAll('.edge-label-container')].map((label) => {
        const edgeId = label.getAttribute('data-edge-id');
        const path = root.querySelector<SVGGeometryElement>(
          `.diagram-edge[data-edge-id="${edgeId}"] .edge-path`,
        )!;
        const rect = label.getBoundingClientRect();
        return {
          pathDistance: routeDistance(path, rect.left + rect.width / 2, rect.top + rect.height / 2),
          borderWidth: getComputedStyle(label.querySelector('.edge-label-html')!).borderWidth,
        };
      }),
      insideViewport: (() => {
        const viewport = root.querySelector('.diagram-scroll-container')!.getBoundingClientRect();
        return [
          ...root.querySelectorAll('.diagram-group, .diagram-node-html, .edge-label-container'),
        ].every((element) => {
          const rect = element.getBoundingClientRect();
          return (
            [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= viewport.left - 1 &&
            rect.right <= viewport.right + 1
          );
        });
      })(),
    };
  });

  expect(
    geometry.pathWidths.every((width) => {
      const value = Number.parseFloat(width);
      return value >= 1 && value <= 1.25;
    }),
  ).toBe(true);
  expect(geometry.markerWidths.every((width) => width === '1')).toBe(true);
  expect(
    geometry.labelConnections.every(
      ({ pathDistance }) => Number.isFinite(pathDistance) && pathDistance <= 1,
    ),
  ).toBe(true);
  expect(geometry.labelConnections.every(({ borderWidth }) => borderWidth === '0px')).toBe(true);
  expect(geometry.insideViewport).toBe(true);

  const grouped = page.locator('#custom-architecture');
  await grouped.locator('[data-diagram-step-index="2"]').click();
  await expect(grouped.locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-settled',
    'true',
  );
  const groupLabels = await grouped.locator('.diagram-group').evaluateAll((groups) =>
    groups.map((group) => {
      const outline = group.querySelector('.group-bg')!.getBoundingClientRect();
      const label = group.querySelector('.group-label')!.getBoundingClientRect();
      const scale = Math.hypot(
        (group as SVGGElement).getScreenCTM()!.c,
        (group as SVGGElement).getScreenCTM()!.d,
      );
      return {
        id: group.getAttribute('data-group-id'),
        text: group.querySelector('.group-label')!.textContent?.trim(),
        width: label.width,
        height: label.height,
        horizontalOffset: Math.abs((label.left + label.right - outline.left - outline.right) / 2),
        verticalImbalance: Math.abs(
          label.top - outline.top - (outline.top + 34 * scale - label.bottom),
        ),
      };
    }),
  );
  expect(groupLabels.map(({ id }) => id).sort()).toEqual(['client', 'runtime']);
  for (const label of groupLabels) {
    expect(label.text, `${label.id} heading`).toBeTruthy();
    expect(
      [label.width, label.height, label.horizontalOffset, label.verticalImbalance].every(
        Number.isFinite,
      ),
    ).toBe(true);
    expect(label.width).toBeGreaterThan(0);
    expect(label.height).toBeGreaterThan(0);
    expect(label.horizontalOffset).toBeLessThanOrEqual(1);
    expect(label.verticalImbalance).toBeLessThanOrEqual(1);
  }

  await openSandbox(page, 'state=custom-state-machine&theme=dark&width=960&motion=reduced');
  const negativeRoute = await page.locator('#custom-state-machine').evaluate((root) => {
    const label = root.querySelector<SVGForeignObjectElement>(
      '.edge-label-container[data-edge-id="st3"]',
    )!;
    const labelRect = label.getBoundingClientRect();
    const path = root.querySelector<SVGGeometryElement>(
      '.diagram-edge[data-edge-id="st3"] .edge-path',
    )!;
    const total = path.getTotalLength();
    let routeDistance = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 2000; step += 1) {
      const point = path.getPointAtLength((total * step) / 2000);
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      routeDistance = Math.min(
        routeDistance,
        Math.hypot(
          labelRect.left + labelRect.width / 2 - screenPoint.x,
          labelRect.top + labelRect.height / 2 - screenPoint.y,
        ),
      );
    }
    return {
      hasLeader: Boolean(root.querySelector('.edge-label-leader[data-edge-id="st3"]')),
      routeDistance,
      borderWidth: getComputedStyle(label.querySelector('.edge-label-html')!).borderWidth,
    };
  });
  expect(negativeRoute.hasLeader).toBe(false);
  expect(Number.isFinite(negativeRoute.routeDistance)).toBe(true);
  expect(negativeRoute.routeDistance).toBeLessThanOrEqual(1);
  expect(negativeRoute.borderWidth).toBe('0px');
});

test('keeps the named dashed return routes continuous on cardinal ports', async ({ page }) => {
  await openSandbox(page, 'state=custom-sequence&theme=light&width=320&motion=reduced');
  const routes = await page.evaluate(() => {
    const cases = [
      ['custom-sequence', 's4', 'capture', 'author'],
      ['custom-state-machine', 'st4', 'error', 'idle'],
      ['custom-data-flow', 'd5', 'source', 'store'],
      ['custom-topology-stress', 'z11', 'audit', 'gate'],
    ];
    const cardinalDistance = (point: DOMPoint, bounds: DOMRect) =>
      Math.min(
        Math.hypot(point.x - (bounds.left + bounds.width / 2), point.y - bounds.top),
        Math.hypot(point.x - (bounds.left + bounds.width / 2), point.y - bounds.bottom),
        Math.hypot(point.x - bounds.left, point.y - (bounds.top + bounds.height / 2)),
        Math.hypot(point.x - bounds.right, point.y - (bounds.top + bounds.height / 2)),
      );
    return cases.map(([caseId, edgeId, sourceId, targetId]) => {
      const root = document.getElementById(caseId)!;
      const path = root.querySelector<SVGPathElement>(`[data-edge-id='${edgeId}'] .edge-path`)!;
      const matrix = path.getScreenCTM()!;
      const start = path.getPointAtLength(0).matrixTransform(matrix);
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      const node = (id: string) =>
        root
          .querySelector<HTMLElement>(`[data-node-id='${id}'] .diagram-node-html`)!
          .getBoundingClientRect();
      return {
        edgeId,
        sourceDistance: cardinalDistance(start, node(sourceId)),
        targetDistance: cardinalDistance(end, node(targetId)),
        marker: path.getAttribute('marker-end'),
        dash: getComputedStyle(path).strokeDasharray,
      };
    });
  });
  for (const route of routes) {
    expect(route.sourceDistance, `${route.edgeId} source port`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(route.targetDistance - 0.5 - 5),
      `${route.edgeId} painted target gap`,
    ).toBeLessThanOrEqual(0.35);
    expect(route.marker).toContain('arrowhead');
    expect(route.dash).not.toBe('none');
  }
});

test('publishes catalog readiness after 640px Mermaid settlement', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __diagramWorkbenchReadyAtCatalogReady?: boolean[];
    };
    state.__diagramWorkbenchReadyAtCatalogReady = [];
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        new MutationObserver(() => {
          const scene = document.querySelector('[data-testid="catalog-scene"]');
          if (scene?.getAttribute('data-preview-ready') !== 'true') return;
          const workbench = document.querySelector('[data-diagram-workbench]');
          state.__diagramWorkbenchReadyAtCatalogReady?.push(
            workbench?.getAttribute('data-diagram-workbench-ready') === 'true',
          );
        }).observe(document, {
          attributes: true,
          attributeFilter: ['data-preview-ready'],
          subtree: true,
        });
      },
      { once: true },
    );
  });
  await openSandbox(page, 'state=mermaid-cycle-fanout&theme=light&width=640&motion=reduced');

  const readinessOrder = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __diagramWorkbenchReadyAtCatalogReady?: boolean[];
        }
      ).__diagramWorkbenchReadyAtCatalogReady,
  );
  expect(readinessOrder).toEqual([true]);
});

test('keeps 30 consecutive 640px readiness generations active and stable', async ({ page }) => {
  await openSandbox(page, 'state=mermaid-cycle-fanout&theme=light&width=640&motion=reduced');
  await expectFixtureInventory(page);
  await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
  const scene = page.getByTestId('catalog-scene');
  const workbench = page.locator('[data-diagram-workbench]');
  const initialGeometry = await page
    .locator('#mermaid-cycle-fanout .mermaid-svg > svg')
    .evaluate((svg) => ({
      viewBox: svg.getAttribute('viewBox'),
      width: svg.getAttribute('width'),
      height: svg.getAttribute('height'),
      routes: [...svg.querySelectorAll('.flowchart-link')].map((path) => path.getAttribute('d')),
    }));

  for (let cycle = 1; cycle <= 30; cycle += 1) {
    await beginReadinessObservation(page);
    const priorWorkbenchGeneration = Number(
      await workbench.getAttribute('data-diagram-workbench-generation'),
    );
    if (cycle === 10 || cycle === 20) {
      const state = cycle === 10 ? 'custom-architecture' : 'custom-walkthrough';
      const theme = cycle === 20 ? 'light' : 'dark';
      await page.getByTestId('catalog-theme-control').getByRole('radio', { name: theme }).click();
      await page.evaluate((state) => {
        const url = new URL(window.location.href);
        url.searchParams.set('state', state);
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, state);
      await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', theme);
    } else {
      const steppedCase = cycle % 2 === 0 ? 'custom-walkthrough' : 'custom-architecture';
      await page
        .locator(`#${steppedCase} [data-diagram-step-index]:not([aria-current="step"])`)
        .first()
        .evaluate((button) => (button as HTMLButtonElement).click());
    }
    await expect
      .poll(async () => hasCompleteReadinessCycle(await readReadinessHistory(page)), {
        message: `Readiness cycle ${cycle} did not publish its complete lifecycle`,
      })
      .toBe(true);
    await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 90_000 });
    await expect(scene).toHaveAttribute('data-preview-stable', 'true');
    await expect(scene).toHaveAttribute('data-preview-width', '640');
    await expect(workbench).toHaveAttribute('data-diagram-workbench-ready', 'true');
    if (cycle !== 10 && cycle !== 20) {
      await expect
        .poll(async () => Number(await workbench.getAttribute('data-diagram-workbench-generation')))
        .toBeGreaterThan(priorWorkbenchGeneration);
    }

    const readiness = await page.locator('.mermaid-renderer').evaluateAll((renderers) =>
      renderers.map((renderer) => {
        const active = renderer.getAttribute('data-render-generation');
        const settled = renderer.getAttribute('data-render-settled-generation');
        const svg = renderer.querySelector('.mermaid-svg > svg');
        return {
          id: renderer.closest('[data-diagram-case]')?.id,
          active,
          settled,
          ready: renderer.getAttribute('data-render-settled'),
          layout: svg?.getAttribute('data-layout-generation') ?? null,
          svgCount: renderer.querySelectorAll('.mermaid-svg > svg').length,
          errorCount: renderer.querySelectorAll('.mermaid-error [role="alert"]').length,
          emptyCount: renderer.querySelectorAll('.mermaid-empty').length,
        };
      }),
    );
    expect(readiness.map(({ id }) => id).sort()).toEqual(
      Object.entries(DIAGRAM_WORKBENCH_CASES)
        .filter(([, fixture]) => fixture.kind === 'mermaid')
        .map(([id]) => id)
        .sort(),
    );
    for (const renderer of readiness) {
      const context = `cycle ${cycle}, ${renderer.id}`;
      expect(renderer.active, context).toMatch(/^[1-9]\d*$/);
      expect(Number.isFinite(Number(renderer.active)), context).toBe(true);
      expect(renderer.settled, context).toBe(renderer.active);
      expect(renderer.ready, context).toBe('true');
      const error = renderer.id === 'mermaid-invalid-source';
      const empty = renderer.id === 'mermaid-empty-content';
      expect(renderer.errorCount, context).toBe(error ? 1 : 0);
      expect(renderer.emptyCount, context).toBe(empty ? 1 : 0);
      expect(renderer.svgCount, context).toBe(error || empty ? 0 : 1);
      expect(renderer.layout, context).toBe(error || empty ? null : renderer.active);
    }
    await endReadinessObservation(page);
  }

  await expect
    .poll(async () => Number(await workbench.getAttribute('data-diagram-workbench-generation')))
    .toBeGreaterThan(0);
  await expect(scene).toHaveAttribute('data-preview-width', '640');

  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(scene).toHaveAttribute('data-preview-ready', 'true');
  await expect(page.locator('#mermaid-cycle-fanout .mermaid-svg > svg')).toHaveAttribute(
    'data-layout-settled',
    'true',
  );
  expect(
    await page.locator('#mermaid-cycle-fanout .mermaid-svg > svg').evaluate((svg) => ({
      viewBox: svg.getAttribute('viewBox'),
      width: svg.getAttribute('width'),
      height: svg.getAttribute('height'),
      routes: [...svg.querySelectorAll('.flowchart-link')].map((path) => path.getAttribute('d')),
    })),
  ).toEqual(initialGeometry);
});

for (const colorTheme of ['default-light', 'default-dark', 'nord'] as const) {
  for (const width of [960, 640, 420] as const) {
    test(`keeps final diagram geometry polished in ${colorTheme} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1400, height: 1000 });
      const theme = colorTheme === 'default-dark' ? 'dark' : 'light';
      if (colorTheme === 'nord') {
        await page.addInitScript(() =>
          localStorage.setItem(
            'component-catalog-preferences',
            JSON.stringify({ colorTheme: 'nord' }),
          ),
        );
      }
      await openSandbox(
        page,
        `state=mermaid-cycle-fanout&theme=${theme}&width=${width}&motion=reduced`,
      );
      if (colorTheme === 'nord') {
        await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
          'data-catalog-color-theme',
          'nord',
        );
      }
      await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
        'data-diagram-workbench-ready',
        'true',
      );
      await expectFixtureInventory(page);

      await expect(page.locator('#mermaid-long-labels .mermaid-svg > svg')).toBeVisible();
      await expect(page.locator('#mermaid-cycle-fanout .mermaid-svg > svg')).toBeVisible();
      const walkthrough = page.locator('#custom-walkthrough');
      await walkthrough.locator('[data-diagram-step-index="1"]').click();
      await expect(walkthrough.locator('.diagram-renderer')).toHaveAttribute(
        'data-diagram-settled',
        'true',
      );
      for (const [selector, attribute, expected] of [
        ['foreignObject[data-node-id]', 'data-node-id', ['chat', 'redux', 'daemon']],
        ['.diagram-edge', 'data-edge-id', ['w3', 'w4', 'w5']],
        ['.edge-label-container', 'data-edge-id', ['w3', 'w4', 'w5']],
      ] as const) {
        expect(
          await walkthrough
            .locator(selector)
            .evaluateAll(
              (elements, attribute) =>
                elements.map((element) => element.getAttribute(attribute)).sort(),
              attribute,
            ),
        ).toEqual([...expected].sort());
      }
      await expect(walkthrough.locator('.node-label')).toHaveCount(3);

      const geometry = await page.evaluate(() => {
        const intersects = (a: DOMRect, b: DOMRect, padding = 0) =>
          a.left < b.right + padding &&
          a.right > b.left - padding &&
          a.top < b.bottom + padding &&
          a.bottom > b.top - padding;
        const routeDistance = (path: SVGGeometryElement, x: number, y: number) => {
          const total = path.getTotalLength();
          const matrix = path.getScreenCTM()!;
          let distance = Number.POSITIVE_INFINITY;
          for (let step = 0; step <= 2000; step += 1) {
            const point = path.getPointAtLength((total * step) / 2000).matrixTransform(matrix);
            distance = Math.min(distance, Math.hypot(x - point.x, y - point.y));
          }
          return distance;
        };
        const paintedPath = (path: SVGPathElement) => {
          const length = path.getTotalLength();
          const matrix = path.getScreenCTM();
          const bounds = path.getBoundingClientRect();
          const svg = path.ownerSVGElement!.getBoundingClientRect();
          const style = getComputedStyle(path);
          const strokeWidth = Number.parseFloat(style.strokeWidth);
          const points = matrix
            ? Array.from({ length: 121 }, (_, index) =>
                path.getPointAtLength((length * index) / 120).matrixTransform(matrix),
              )
            : [];
          const strokeScale =
            style.vectorEffect === 'non-scaling-stroke'
              ? 1
              : matrix
                ? Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d))
                : NaN;
          const halfStroke = (strokeWidth * strokeScale) / 2;
          return {
            id:
              path.getAttribute('data-id') ??
              path.closest('[data-edge-id]')?.getAttribute('data-edge-id'),
            length,
            finite:
              [
                length,
                strokeWidth,
                halfStroke,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                svg.x,
                svg.y,
                svg.width,
                svg.height,
              ].every(Number.isFinite) &&
              points.length === 121 &&
              points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
            painted:
              length > 0 &&
              bounds.width + bounds.height > 0 &&
              strokeWidth > 0 &&
              style.stroke !== 'none' &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) > 0 &&
              Number(style.strokeOpacity) > 0,
            contained:
              svg.width > 0 &&
              svg.height > 0 &&
              points.length === 121 &&
              points.every(
                ({ x, y }) =>
                  x - halfStroke >= svg.left - 1 &&
                  x + halfStroke <= svg.right + 1 &&
                  y - halfStroke >= svg.top - 1 &&
                  y + halfStroke <= svg.bottom + 1,
              ),
          };
        };
        const surfaceFailures = [
          ['#mermaid-state', '.mermaid-svg > svg', 'backgroundColor'],
          ['#mermaid-state', '.edgeLabel rect.background', 'fill'],
          ['#mermaid-nested-groups', '.mermaid-svg > svg', 'backgroundColor'],
          ['#mermaid-nested-groups', '.cluster > rect', 'fill'],
          ['#custom-bindings', '.diagram-svg-layer', 'backgroundColor'],
          ['#custom-walkthrough', '.diagram-svg-layer', 'backgroundColor'],
        ].flatMap(([rootSelector, targetSelector, property]) => {
          const root = document.querySelector<HTMLElement>(rootSelector)!;
          const probe = document.createElement('span');
          probe.style.background = 'var(--diagram-host-surface)';
          root.append(probe);
          const surface = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const targets = [...root.querySelectorAll(targetSelector)];
          return targets.length > 0 &&
            targets.every((target) => getComputedStyle(target)[property as 'fill'] === surface)
            ? []
            : [`${rootSelector} ${targetSelector}`];
        });

        const longRoot = document.querySelector('#mermaid-long-labels')!;
        const longSvg = longRoot.querySelector<SVGSVGElement>('.mermaid-svg > svg')!;
        const longSvgRect = longSvg.getBoundingClientRect();
        const longOutlines = [
          ...longRoot.querySelectorAll<SVGRectElement>('.node > rect:not(.flowchart-node-outline)'),
        ].map((outline) => {
          const rect = outline.getBoundingClientRect();
          const style = getComputedStyle(outline);
          return {
            inset: Math.min(
              rect.left - longSvgRect.left,
              rect.top - longSvgRect.top,
              longSvgRect.right - rect.right,
              longSvgRect.bottom - rect.bottom,
            ),
            radius: Number.parseFloat(style.rx),
            strokeWidth: Number.parseFloat(style.strokeWidth),
          };
        });

        const cyclePaths = [
          ...document.querySelectorAll<SVGPathElement>('#mermaid-cycle-fanout .flowchart-link'),
        ].map(paintedPath);

        const customRoot = document.querySelector('#custom-walkthrough')!;
        const labels = [
          ...customRoot.querySelectorAll<SVGForeignObjectElement>('.edge-label-container'),
        ].map((label) => {
          const edgeId = label.dataset.edgeId!;
          const rect = label.getBoundingClientRect();
          const path = customRoot.querySelector<SVGGeometryElement>(
            `.diagram-edge[data-edge-id="${CSS.escape(edgeId)}"] .edge-path`,
          )!;
          const content = label.querySelector<HTMLElement>('.edge-label-html')!;
          return {
            edgeId,
            rect,
            routeDistance: routeDistance(
              path,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            ),
            borderStyle: getComputedStyle(content).borderStyle,
            borderWidth: getComputedStyle(content).borderWidth,
          };
        });
        const nodes = [...customRoot.querySelectorAll('.diagram-node-html')].map((node) =>
          node.getBoundingClientRect(),
        );
        const customPaths = [...customRoot.querySelectorAll<SVGPathElement>('.edge-path')];
        const compactCustom = Boolean(customRoot.querySelector('.compact-diagram'));
        const pathSamples = customPaths.map((path) => {
          const total = path.getTotalLength();
          const matrix = path.getScreenCTM()!;
          return Array.from({ length: 121 }, (_, index) =>
            path.getPointAtLength((total * index) / 120).matrixTransform(matrix),
          );
        });
        const insideNode = (point: DOMPoint) =>
          nodes.some(
            (node) =>
              point.x >= node.left - 2 &&
              point.x <= node.right + 2 &&
              point.y >= node.top - 2 &&
              point.y <= node.bottom + 2,
          );
        const cross = (a: DOMPoint, b: DOMPoint, c: DOMPoint) =>
          (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        let routeCrossings = 0;
        for (let first = 0; !compactCustom && first < pathSamples.length; first += 1) {
          for (let second = first + 1; second < pathSamples.length; second += 1) {
            for (let a = 1; a < pathSamples[first].length; a += 1) {
              const a1 = pathSamples[first][a - 1];
              const a2 = pathSamples[first][a];
              if (insideNode(a1) || insideNode(a2)) continue;
              for (let b = 1; b < pathSamples[second].length; b += 1) {
                const b1 = pathSamples[second][b - 1];
                const b2 = pathSamples[second][b];
                if (insideNode(b1) || insideNode(b2)) continue;
                if (
                  cross(a1, a2, b1) * cross(a1, a2, b2) < -0.01 &&
                  cross(b1, b2, a1) * cross(b1, b2, a2) < -0.01
                ) {
                  routeCrossings += 1;
                }
              }
            }
          }
        }
        const unrelatedRouteLabelCrossings = compactCustom
          ? []
          : customPaths.flatMap((path) => {
              const edgeId = path.closest('.diagram-edge')?.getAttribute('data-edge-id');
              return labels.filter((label) => {
                if (label.edgeId === edgeId) return false;
                const total = path.getTotalLength();
                const matrix = path.getScreenCTM()!;
                for (let step = 1; step < 300; step += 1) {
                  const point = path.getPointAtLength((total * step) / 300).matrixTransform(matrix);
                  if (
                    point.x > label.rect.left &&
                    point.x < label.rect.right &&
                    point.y > label.rect.top &&
                    point.y < label.rect.bottom
                  ) {
                    return true;
                  }
                }
                return false;
              });
            });
        const content = customRoot.querySelector('.diagram-content')!.getBoundingClientRect();
        const footer = customRoot.querySelector('.diagram-footer')!.getBoundingClientRect();

        return {
          surfaceFailures,
          longOutlines,
          cyclePaths,
          finiteGeometry:
            [...labels.map(({ rect }) => rect), ...nodes, content, footer].every(
              (rect) =>
                [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
                rect.width > 0 &&
                rect.height > 0,
            ) &&
            pathSamples.every((points) =>
              points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
            ),
          labelDistances: labels.map((label) => label.routeDistance),
          labelsUnbordered: labels.every(
            (label) => label.borderStyle === 'none' && label.borderWidth === '0px',
          ),
          labelsClearNodes: labels.every((label) =>
            nodes.every((node) => !intersects(label.rect, node, 1)),
          ),
          labelsClearLabels: labels.every((label, index) =>
            labels.slice(index + 1).every((other) => !intersects(label.rect, other.rect, 1)),
          ),
          unrelatedRouteLabelCrossings: unrelatedRouteLabelCrossings.length,
          routeCrossings,
          customPaths: customPaths.map(paintedPath),
          compactCustom,
          hasLeaders: customRoot.querySelectorAll('.edge-label-leader').length > 0,
          footerClearance: footer.top - content.bottom,
        };
      });
      expect(geometry.surfaceFailures, `${colorTheme}/${width} surfaces`).toEqual([]);
      expect(geometry.longOutlines.length, `${colorTheme}/${width} long boxes`).toBe(3);
      expect(geometry.finiteGeometry).toBe(true);
      expect(
        geometry.longOutlines.every(
          ({ inset, radius, strokeWidth }) =>
            [inset, radius, strokeWidth].every(Number.isFinite) &&
            inset >= strokeWidth - 0.25 &&
            radius >= 14 &&
            radius <= 18 &&
            strokeWidth === 1,
        ),
        `${colorTheme}/${width} long box containment`,
      ).toBe(true);
      expect(
        new Set(geometry.longOutlines.map(({ radius }) => radius)).size,
        `${colorTheme}/${width} long box radii`,
      ).toBe(1);
      expect(geometry.cyclePaths.map(({ id }) => id).sort()).toEqual(
        [
          'L_Hub_Flow_0',
          'L_Hub_Sequence_0',
          'L_Hub_State_0',
          'L_Hub_ER_0',
          'L_Flow_Review_0',
          'L_Sequence_Review_0',
          'L_State_Review_0',
          'L_ER_Review_0',
          'L_Review_Hub_0',
        ].sort(),
      );
      for (const route of geometry.cyclePaths) {
        expect(route.finite, `${route.id} finite painted geometry`).toBe(true);
        expect(route.painted, `${route.id} visible nondegenerate route`).toBe(true);
        expect(route.contained, `${route.id} contained painted route`).toBe(true);
      }
      expect(geometry.labelDistances).toHaveLength(3);
      expect(
        geometry.labelDistances.every((distance) => Number.isFinite(distance) && distance <= 1),
      ).toBe(true);
      expect(geometry.labelsUnbordered).toBe(true);
      expect(geometry.labelsClearNodes).toBe(true);
      expect(geometry.labelsClearLabels).toBe(true);
      // Compact presentation deliberately omits crossing checks; it is not clearance evidence.
      if (!geometry.compactCustom) {
        expect(geometry.unrelatedRouteLabelCrossings).toBe(0);
        expect(geometry.routeCrossings).toBe(0);
      }
      expect(geometry.customPaths.map(({ id }) => id).sort()).toEqual(['w3', 'w4', 'w5']);
      for (const route of geometry.customPaths) {
        expect(route.finite, `${route.id} finite painted geometry`).toBe(true);
        expect(route.painted, `${route.id} visible nondegenerate route`).toBe(true);
        expect(route.contained, `${route.id} contained painted route`).toBe(true);
      }
      expect(geometry.hasLeaders).toBe(false);
      expect(geometry.footerClearance).toBeGreaterThanOrEqual(-1);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`uses the editorial architecture style contract in ${theme}`, async ({ page }) => {
    await openSandbox(page, `state=mermaid-flow&theme=${theme}&width=960&motion=reduced`);
    await expectFixtureInventory(page);
    // Require each renderer/style family before collecting the aggregate style measurements.
    for (const [id, selectors] of [
      [
        'custom-architecture',
        [
          '[data-node-id="user"] .node-label',
          '[data-node-id="renderer"] .node-kind-label',
          '[data-group-id="client"] .group-bg',
          '[data-edge-id="a1"] .edge-path',
          '[data-edge-id="a1"] .edge-label-html',
        ],
      ],
      [
        'mermaid-nested-groups',
        ['g.node .nodeLabel', '.cluster > rect', '.flowchart-link', '.edgeLabel .edgeLabel'],
      ],
    ] as const) {
      for (const selector of selectors) {
        expect(
          await page.locator(`#${id} ${selector}`).count(),
          `${id} ${selector}`,
        ).toBeGreaterThan(0);
      }
    }
    const styles = await page.locator('[data-diagram-workbench-ready="true"]').evaluate((root) => {
      const customNodes = Array.from(root.querySelectorAll<HTMLElement>('.diagram-node-html'));
      const customGroups = Array.from(root.querySelectorAll<SVGRectElement>('.group-bg'));
      const mermaidNodes = Array.from(
        root.querySelectorAll<SVGRectElement>('.mermaid-svg svg .node rect'),
      ).filter((node) => !node.classList.contains('flowchart-node-outline'));
      const mermaidGroups = Array.from(
        root.querySelectorAll<SVGRectElement>('.mermaid-svg svg .cluster rect'),
      );
      const connectors = Array.from(
        root.querySelectorAll<SVGPathElement>('.edge-path, .mermaid-svg .edgePaths path'),
      );
      const nodeStyles = [...customNodes, ...mermaidNodes].map((node) => getComputedStyle(node));
      const groupStyles = [...customGroups, ...mermaidGroups].map((group) =>
        getComputedStyle(group),
      );
      const customTitleFamilies = customNodes.map(
        (node) => getComputedStyle(node.querySelector<HTMLElement>('.node-label')!).fontFamily,
      );
      const mermaidTitleFamilies = Array.from(
        root.querySelectorAll<HTMLElement>('.mermaid-svg .node .nodeLabel'),
      ).map((label) => getComputedStyle(label).fontFamily);
      const metadataFamilies = Array.from(
        root.querySelectorAll<HTMLElement>('.node-kind-label, .edge-label-html, .edgeLabel'),
      ).map((label) => getComputedStyle(label).fontFamily);
      const numeric = (...values: string[]) =>
        values.map(Number.parseFloat).find((value) => Number.isFinite(value) && value > 0) ?? 0;
      return {
        nodeRadii: [
          ...customNodes
            .filter((node) => node.dataset.storeNode !== 'true')
            .map((node) => numeric(getComputedStyle(node).borderRadius)),
          ...mermaidNodes.map((node) => numeric(getComputedStyle(node).getPropertyValue('rx'))),
        ],
        groupRadii: groupStyles.map((style) => Number.parseFloat(style.getPropertyValue('rx'))),
        shadows: nodeStyles.map((style) => style.boxShadow),
        nodeBorders: nodeStyles.map((style) => numeric(style.strokeWidth, style.borderWidth)),
        filledNodeBorders: customNodes
          .filter((node) => node.dataset.semanticStyle !== 'default')
          .map((node) => Number.parseFloat(getComputedStyle(node).borderWidth)),
        connectorWidths: connectors.map((edge) =>
          Number.parseFloat(getComputedStyle(edge).strokeWidth),
        ),
        customTitleFamilies,
        mermaidTitleFamilies,
        metadataFamilies,
        activeCount: Math.max(
          ...Array.from(root.querySelectorAll<HTMLElement>('[data-diagram-case]')).map(
            (diagram) =>
              diagram.querySelectorAll(
                '.node-active, .node-highlighted, .mermaid-svg .node.active, .mermaid-svg .node.current, .mermaid-svg .node.selected',
              ).length,
          ),
        ),
      };
    });

    for (const [family, values] of Object.entries(styles)) {
      if (Array.isArray(values)) {
        expect(values.length, `${theme} ${family}`).toBeGreaterThan(0);
        if (typeof values[0] === 'number')
          expect(
            values.every((value) => Number.isFinite(value)),
            family,
          ).toBe(true);
      }
    }
    expect(styles.nodeRadii.every((radius) => radius >= 14 && radius <= 18)).toBe(true);
    expect(styles.groupRadii.every((radius) => radius >= 28 && radius <= 36)).toBe(true);
    expect(styles.shadows.every((shadow) => shadow === 'none')).toBe(true);
    expect(styles.nodeBorders.every((width) => width <= 1)).toBe(true);
    expect(styles.filledNodeBorders.length).toBeGreaterThan(0);
    expect(styles.filledNodeBorders.every((width) => width === 0)).toBe(true);
    expect(styles.connectorWidths.every((width) => width >= 1 && width <= 1.25)).toBe(true);
    expect(
      styles.customTitleFamilies.every((family) =>
        /Source Serif|Iowan|Palatino|Georgia/.test(family),
      ),
    ).toBe(true);
    expect(styles.mermaidTitleFamilies.every((family) => /Inter|system-ui/.test(family))).toBe(
      true,
    );
    expect(
      styles.metadataFamilies.every(
        (family) => !/Source Serif|Iowan|Palatino|Georgia/.test(family),
      ),
    ).toBe(true);
    expect(styles.activeCount).toBeLessThanOrEqual(1);
  });
}
