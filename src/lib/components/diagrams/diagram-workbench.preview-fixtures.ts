import type {
  DiagramEdge,
  DiagramGrammar,
  DiagramNode,
  DiagramPrimitive,
  DiagramState,
} from '$shared/types/notes-primitives';

export type DiagramWorkbenchCase =
  | { kind: 'mermaid'; title: string; description: string; source: string }
  | { kind: 'custom'; title: string; description: string; diagram: DiagramPrimitive }
  | { kind: 'loading'; title: string; description: string };

const createdAt = '2026-08-23T12:00:00.000Z';

function customDiagram(
  serial: number,
  grammar: DiagramGrammar,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  options: {
    layoutType?: 'manual';
    direction?: 'LR' | 'RL' | 'TB' | 'BT';
    groups?: DiagramPrimitive['model']['groups'];
    states?: DiagramState[];
    currentStateId?: string;
  } = {},
): DiagramPrimitive {
  return {
    id: `10000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    type: 'diagram',
    version: 1,
    createdAt,
    createdBy: 'agent',
    grammar,
    model: { nodes, edges, groups: options.groups },
    baseView: {
      layout: {
        type: options.layoutType ?? (grammar === 'network' ? 'force' : 'layered'),
        ...(options.direction ? { direction: options.direction } : {}),
        spacing: grammar === 'dependency_graph' ? 56 : 72,
        edgeRouting: 'orthogonal',
      },
    },
    states: options.states,
    currentStateId: options.currentStateId,
  };
}

const architecture = customDiagram(
  1,
  'architecture',
  [
    { id: 'user', label: 'Workspace user', kind: 'actor', group: 'client' },
    {
      id: 'renderer',
      label: 'Diagram workbench\nrenderer',
      kind: 'ui_component',
      semanticStyle: 'active',
      group: 'client',
      binding: { type: 'file', target: 'src/lib/components/diagrams/DiagramRenderer.svelte' },
    },
    { id: 'daemon', label: 'Intent daemon', kind: 'service', group: 'runtime' },
    {
      id: 'notes',
      label: 'Persistent notes',
      kind: 'db',
      semanticStyle: 'success',
      group: 'runtime',
      binding: { type: 'note', target: 'spec' },
    },
    { id: 'events', label: 'Workspace events', kind: 'queue', group: 'runtime' },
  ],
  [
    { id: 'a1', from: 'user', to: 'renderer', label: 'explores' },
    { id: 'a2', from: 'renderer', to: 'daemon', label: 'requests state' },
    { id: 'a3', from: 'daemon', to: 'notes', label: 'reads and writes' },
    { id: 'a4', from: 'notes', to: 'events', label: 'publishes change', animated: true },
    { id: 'a5', from: 'events', to: 'renderer', label: 'refreshes view', animated: true },
  ],
  {
    direction: 'TB',
    groups: [
      { id: 'client', label: 'Browser-only preview', nodeIds: ['user', 'renderer'] },
      { id: 'runtime', label: 'Production boundary', nodeIds: ['daemon', 'notes', 'events'] },
    ],
    states: [
      {
        id: 'orient',
        label: 'Orient',
        visibleNodes: ['user', 'renderer'],
        visibleEdges: ['a1'],
        visibleGroups: ['client'],
        highlightedNodes: ['renderer'],
        narrative: {
          title: '1. Start in the workbench',
          text: 'Inspect fixtures without app sagas.',
        },
      },
      {
        id: 'connect',
        label: 'Connect',
        visibleNodes: ['user', 'renderer', 'daemon', 'notes'],
        visibleEdges: ['a1', 'a2', 'a3'],
        highlightedNodes: ['daemon', 'notes'],
        narrative: { title: '2. Follow the data', text: 'Bindings connect nodes to real context.' },
      },
      {
        id: 'observe',
        label: 'Observe',
        highlightedNodes: ['events', 'renderer'],
        highlightedEdges: ['a4', 'a5'],
        narrative: { title: '3. Close the loop', text: 'Events refresh the visible explanation.' },
      },
    ],
    currentStateId: 'orient',
  },
);

const ownershipWalkthrough = customDiagram(
  10,
  'sequence',
  [
    { id: 'user', label: 'User', kind: 'actor', position: { x: 380, y: 0 } },
    { id: 'redux', label: 'Redux', kind: 'store', position: { x: 380, y: 95 } },
    { id: 'chat', label: 'Chat UI', kind: 'ui_component', position: { x: 0, y: 95 } },
    { id: 'daemon', label: 'Daemon', kind: 'service', position: { x: 373.82, y: 265 } },
  ],
  [
    { id: 'w1', from: 'user', to: 'redux', label: 'send message' },
    { id: 'w2', from: 'redux', to: 'chat', label: 'render current state' },
    { id: 'w3', from: 'chat', to: 'redux', label: 'dispatch request' },
    { id: 'w4', from: 'redux', to: 'daemon', label: 'start turn' },
    { id: 'w5', from: 'daemon', to: 'redux', label: 'stream state events' },
  ],
  {
    layoutType: 'manual',
    direction: 'TB',
    states: [
      {
        id: 'request',
        label: '1. Request',
        visibleNodes: ['user', 'redux', 'chat'],
        visibleEdges: ['w1', 'w2', 'w3'],
        highlightedNodes: ['chat'],
        narrative: {
          title: '1. Capture intent',
          text: 'The UI sends one request and Redux records the daemon-owned state.',
        },
      },
      {
        id: 'execute',
        label: '2. Execute',
        visibleNodes: ['chat', 'redux', 'daemon'],
        visibleEdges: ['w3', 'w4', 'w5'],
        highlightedNodes: ['daemon'],
        narrative: {
          title: '2. Follow execution',
          text: 'The daemon runs the turn and streams state events back.',
        },
      },
      {
        id: 'render',
        label: '3. Render',
        visibleNodes: ['chat', 'redux', 'daemon'],
        visibleEdges: ['w2', 'w5'],
        highlightedNodes: ['redux', 'chat'],
        narrative: {
          title: '3. Show the result',
          text: 'Redux supplies the current state and the UI renders it without reconstruction.',
        },
      },
    ],
    currentStateId: 'request',
  },
);

const recoveryBindings = customDiagram(
  11,
  'flowchart',
  [
    { id: 'failure', label: 'Request failed', kind: 'start', semanticStyle: 'danger' },
    {
      id: 'review',
      label: 'Review retry criteria',
      kind: 'action',
      semanticStyle: 'active',
      binding: { type: 'note', target: 'bf4d5bc8-15d8-4fbb-bb82-b6fea9f2d4b2' },
    },
    { id: 'daemon', label: 'Start new daemon request', kind: 'process' },
    { id: 'stream', label: 'Stream one new response', kind: 'end', semanticStyle: 'success' },
  ],
  [
    { id: 'b1', from: 'failure', to: 'review', label: 'inspect' },
    { id: 'b2', from: 'review', to: 'daemon', label: 'retry' },
    { id: 'b3', from: 'daemon', to: 'stream', label: 'resume' },
  ],
  { direction: 'TB' },
);

const multilinePressure = customDiagram(
  12,
  'data_flow',
  [
    { id: 'response', label: 'Live response', kind: 'ui_component' },
    { id: 'tool', label: 'Tool activity\nstays inside\nthe response', kind: 'process' },
    { id: 'composer', label: 'Composer', kind: 'control' },
  ],
  [
    { id: 'm1', from: 'response', to: 'tool', label: 'starts work' },
    { id: 'm2', from: 'tool', to: 'composer', label: 'asks for\ninput' },
  ],
  { direction: 'TB' },
);

const disconnectedExtremes = customDiagram(
  13,
  'data_flow',
  [
    {
      id: 'unbroken',
      label: 'SupercalifragilisticexpialidociousDeterministicSnapshotBoundary',
      kind: 'external',
      position: { x: 0, y: 0 },
    },
    {
      id: 'unicode',
      label: '東京のプレビュー • مرحبًا • résumé',
      kind: 'ui_component',
      position: { x: 640, y: 0 },
    },
    {
      id: 'multiline',
      label: 'Measured route\nwith a quiet\nsecondary kind',
      kind: 'process',
      position: { x: 640, y: 300 },
    },
    {
      id: 'isolated',
      label: 'Disconnected observer',
      kind: 'actor',
      position: { x: 0, y: 300 },
    },
  ],
  [
    {
      id: 'x1',
      from: 'unbroken',
      to: 'unicode',
      label: 'a deliberately long horizontal route label that must remain owned',
    },
    {
      id: 'x2',
      from: 'unicode',
      to: 'multiline',
      label: 'a deliberately long vertical route label that wraps at word boundaries',
    },
  ],
  { layoutType: 'manual', direction: 'TB' },
);

const topologyStress = customDiagram(
  14,
  'flowchart',
  [
    { id: 'input', label: 'Input', kind: 'start', semanticStyle: 'active' },
    { id: 'gate', label: 'Validation gate', kind: 'decision', semanticStyle: 'warning' },
    { id: 'hub', label: 'Routing hub', kind: 'process' },
    { id: 'success', label: 'Accepted', kind: 'end', semanticStyle: 'success' },
    { id: 'failure', label: 'Rejected', kind: 'end', semanticStyle: 'danger' },
    { id: 'audit', label: 'Audit queue', kind: 'queue', semanticStyle: 'inactive' },
  ],
  [
    { id: 'z1', from: 'input', to: 'gate', label: 'primary request' },
    { id: 'z2', from: 'input', to: 'gate', dashed: true },
    { id: 'z3', from: 'gate', to: 'input', label: 'repair input' },
    { id: 'z4', from: 'gate', to: 'hub', label: 'validated' },
    { id: 'z5', from: 'hub', to: 'hub' },
    { id: 'z6', from: 'hub', to: 'success', label: 'commit', semanticStyle: 'success' },
    { id: 'z7', from: 'hub', to: 'failure', label: 'reject', semanticStyle: 'danger' },
    { id: 'z8', from: 'hub', to: 'audit' },
    { id: 'z9', from: 'success', to: 'audit', label: 'publish success' },
    { id: 'z10', from: 'failure', to: 'audit', label: 'publish failure' },
    { id: 'z11', from: 'audit', to: 'gate', label: 'feedback review', dashed: true },
  ],
  { direction: 'TB' },
);

const sequence = customDiagram(
  2,
  'sequence',
  [
    { id: 'author', label: 'Author', kind: 'actor' },
    { id: 'catalog', label: 'Catalog', kind: 'actor' },
    { id: 'preview', label: 'Lazy preview', kind: 'actor' },
    { id: 'capture', label: 'Capture harness', kind: 'actor' },
  ],
  [
    { id: 's1', from: 'author', to: 'catalog', label: 'open named state' },
    { id: 's2', from: 'catalog', to: 'preview', label: 'import module' },
    { id: 's3', from: 'preview', to: 'capture', label: 'signal ready' },
    { id: 's4', from: 'capture', to: 'author', label: 'return stable frame', dashed: true },
  ],
  { direction: 'TB' },
);

const stateMachine = customDiagram(
  3,
  'state_machine',
  [
    { id: 'idle', label: 'Idle', kind: 'start', semanticStyle: 'inactive' },
    { id: 'loading', label: 'Loading', kind: 'state', semanticStyle: 'active' },
    { id: 'ready', label: 'Ready', kind: 'end', semanticStyle: 'success' },
    { id: 'error', label: 'Invalid source', kind: 'end', semanticStyle: 'danger' },
  ],
  [
    { id: 'st1', from: 'idle', to: 'loading', label: 'select state' },
    { id: 'st2', from: 'loading', to: 'ready', label: 'render succeeds', semanticStyle: 'success' },
    { id: 'st3', from: 'loading', to: 'error', label: 'parse fails', semanticStyle: 'danger' },
    { id: 'st4', from: 'error', to: 'idle', label: 'choose another case', dashed: true },
  ],
);

const dataFlow = customDiagram(
  4,
  'data_flow',
  [
    { id: 'source', label: 'Preview source', kind: 'external' },
    { id: 'parse', label: 'Parse deterministic fixture', kind: 'process' },
    { id: 'layout', label: 'Compute stable layout', kind: 'process' },
    { id: 'render', label: 'Render semantic output', kind: 'process' },
    { id: 'store', label: 'Capture evidence', kind: 'data_store' },
  ],
  [
    { id: 'd1', from: 'source', to: 'parse', label: 'source text and metadata' },
    { id: 'd2', from: 'parse', to: 'layout', label: 'validated semantic model' },
    { id: 'd3', from: 'layout', to: 'render', label: 'nodes, ports, and routed edges' },
    { id: 'd4', from: 'render', to: 'store', label: 'stable browser frame' },
    { id: 'd5', from: 'source', to: 'store', label: 'regression feedback', dashed: true },
  ],
);

const flowchart = customDiagram(
  5,
  'flowchart',
  [
    { id: 'start', label: 'Open workbench', kind: 'start' },
    { id: 'select', label: 'Select a named case', kind: 'process' },
    { id: 'valid', label: 'Source valid?', kind: 'decision' },
    { id: 'inspect', label: 'Inspect diagram', kind: 'process', semanticStyle: 'success' },
    { id: 'repair', label: 'Inspect error source', kind: 'process', semanticStyle: 'warning' },
    { id: 'finish', label: 'Capture evidence', kind: 'end' },
  ],
  [
    { id: 'f1', from: 'start', to: 'select' },
    { id: 'f2', from: 'select', to: 'valid' },
    { id: 'f3', from: 'valid', to: 'inspect', label: 'yes' },
    { id: 'f4', from: 'valid', to: 'repair', label: 'no' },
    { id: 'f5', from: 'inspect', to: 'finish' },
    { id: 'f6', from: 'repair', to: 'select', label: 'try another case' },
    { id: 'f7', from: 'select', to: 'finish', label: 'fan out to direct capture' },
  ],
  { direction: 'TB' },
);

const network = customDiagram(
  6,
  'network',
  [
    { id: 'edge', label: 'Local browser', kind: 'node', position: { x: 0, y: 0 } },
    { id: 'router', label: 'Preview router', kind: 'router', position: { x: 260, y: 0 } },
    { id: 'vite', label: 'Vite server', kind: 'server', position: { x: 271, y: 150 } },
    {
      id: 'hmr',
      label: 'HMR channel',
      kind: 'switch',
      semanticStyle: 'active',
      position: { x: 2, y: 150 },
    },
  ],
  [
    { id: 'n1', from: 'edge', to: 'router', label: '127.0.0.1' },
    { id: 'n2', from: 'router', to: 'vite', label: 'preview route' },
    { id: 'n3', from: 'vite', to: 'hmr', label: 'source update', animated: true },
    { id: 'n4', from: 'hmr', to: 'edge', label: 'hot reload', animated: true },
  ],
  { layoutType: 'manual', direction: 'TB' },
);

const timeline = customDiagram(
  7,
  'timeline',
  [
    { id: 'fixtures', label: 'Fixtures ready', kind: 'milestone', semanticStyle: 'success' },
    { id: 'checks', label: 'Focused checks', kind: 'event' },
    { id: 'browser', label: 'Browser review', kind: 'event' },
    { id: 'handoff', label: 'Evidence recorded', kind: 'milestone', semanticStyle: 'highlighted' },
  ],
  [
    { id: 't1', from: 'fixtures', to: 'checks', label: 'then' },
    { id: 't2', from: 'checks', to: 'browser', label: 'then' },
    { id: 't3', from: 'browser', to: 'handoff', label: 'then' },
  ],
);

const dependency = customDiagram(
  8,
  'dependency_graph',
  [
    { id: 'scene', label: 'CatalogScene.svelte', kind: 'file' },
    { id: 'definition', label: 'preview-definition.ts', kind: 'file' },
    { id: 'fixtures', label: 'diagram-workbench.preview-fixtures.ts', kind: 'file' },
    { id: 'mermaid', label: 'MermaidRenderer.svelte', kind: 'file' },
    { id: 'custom', label: 'DiagramRenderer.svelte', kind: 'file' },
  ],
  [
    { id: 'p1', from: 'scene', to: 'definition', label: 'resolves' },
    { id: 'p2', from: 'definition', to: 'fixtures', label: 'selects props' },
    { id: 'p3', from: 'fixtures', to: 'mermaid', label: 'renders source' },
    { id: 'p4', from: 'fixtures', to: 'custom', label: 'renders model' },
  ],
  { direction: 'TB' },
);

const emptyCustom = customDiagram(9, 'architecture', [], []);

export const MERMAID_WORKBENCH_CASES = Object.freeze({
  'mermaid-single-node': {
    kind: 'mermaid',
    title: 'Single Unicode node',
    description: 'One localized node without edges.',
    source: 'flowchart LR\n  Only["唯一のノード • مرحبًا • résumé"]',
  },
  'mermaid-two-node': {
    kind: 'mermaid',
    title: 'Two-node route',
    description: 'A minimal pair with one long connection label.',
    source:
      'flowchart LR\n  Source[Source] -->|a deliberately long horizontal connection label| Target[Target]',
  },
  'mermaid-disconnected': {
    kind: 'mermaid',
    title: 'Disconnected components',
    description: 'Two small components and one isolated node.',
    source:
      'flowchart TB\n  A[Alpha] --> B[Beta]\n  C[Gamma] --> D[Delta]\n  E[Disconnected observer]',
  },
  'mermaid-topology-stress': {
    kind: 'mermaid',
    title: 'Parallel loops and feedback',
    description: 'Parallel, bidirectional, self-loop, fan-out, fan-in, and feedback routes.',
    source:
      'flowchart TB\n  A[Input] -->|primary| B[Router]\n  A -.->|metadata| B\n  B -->|repair| A\n  B --> B\n  B -->|success| C[Accepted]\n  B -->|warning| D[Review]\n  C -->|record| E[Audit]\n  D -->|record warning| E\n  E -->|feedback| B',
  },
  'mermaid-nested-groups': {
    kind: 'mermaid',
    title: 'Nested group boundaries',
    description: 'Supported nested subgraphs with routes that cross both boundaries.',
    source:
      'flowchart TB\n  Client[Client]\n  subgraph Outer[Runtime boundary]\n    Gateway[Gateway]\n    subgraph Inner[Worker boundary]\n      Queue[Queue]\n      Worker[Worker]\n    end\n    Store[(Store)]\n  end\n  Client -->|request| Gateway\n  Gateway -->|enqueue| Queue\n  Queue -->|deliver| Worker\n  Worker -->|write| Store\n  Store -->|result| Client',
  },
  'mermaid-flow': {
    kind: 'mermaid',
    title: 'Flow and decisions',
    description: 'Branches, edge labels, and a return path.',
    source:
      'flowchart LR\n  Start([Request]) --> Check{Valid?}\n  Check -->|Yes| Work[Process request]\n  Check -->|No| Fix[Repair input]\n  Fix --> Check\n  Work --> Done([Ready])',
  },
  'mermaid-sequence': {
    kind: 'mermaid',
    title: 'Sequence with groups',
    description: 'Actors, loop, alternate path, and a note.',
    source:
      'sequenceDiagram\n  actor User\n  participant UI as Workbench\n  participant Preview as Lazy preview\n  User->>UI: Select named state\n  UI->>Preview: Import fixture\n  alt valid source\n    Preview-->>UI: Stable diagram\n  else invalid source\n    Preview-->>UI: Error with source\n  end\n  Note over UI,Preview: Browser-only boundary',
  },
  'mermaid-sequence-simple': {
    kind: 'mermaid',
    title: 'Simple sequence exchange',
    description: 'A focused request and response with a wrapping message label.',
    source:
      'sequenceDiagram\n  participant Client\n  participant API\n  Client->>API: Submit account recovery request\n  API-->>Client: Recovery request accepted',
  },
  'mermaid-sequence-alt': {
    kind: 'mermaid',
    title: 'Sequence alternative branches',
    description: 'Focused success and failure branches with preserved message order.',
    source:
      'sequenceDiagram\n  participant Client\n  participant Service\n  Client->>Service: Validate request\n  alt request valid\n    Service-->>Client: Accepted response\n  else validation failed\n    Service-->>Client: Explain required changes\n  end',
  },
  'mermaid-sequence-loop': {
    kind: 'mermaid',
    title: 'Sequence loop',
    description: 'A focused repeated exchange inside one quiet loop frame.',
    source:
      'sequenceDiagram\n  actor User\n  participant Workbench\n  loop for each selected diagram\n    User->>Workbench: Review rendered result\n    Workbench-->>User: Show next diagram\n  end',
  },
  'mermaid-sequence-note': {
    kind: 'mermaid',
    title: 'Sequence participant note',
    description: 'A focused compact note spanning the participants it describes.',
    source:
      'sequenceDiagram\n  participant Editor\n  participant Renderer\n  Note over Editor,Renderer: Shared browser rendering boundary\n  Editor->>Renderer: Render source',
  },
  'mermaid-state': {
    kind: 'mermaid',
    title: 'Agent chat states',
    description: 'Startup, streaming, tool work, user input, completion, and recovery.',
    source:
      'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Starting: User sends message\n  Starting --> Streaming: Agent responds\n  Streaming --> RunningTool: Tool starts\n  RunningTool --> Streaming: Tool completes\n  Streaming --> NeedsInput: Agent asks user\n  NeedsInput --> Streaming: User replies\n  Streaming --> Complete: Agent finishes\n  Starting --> Failed: Request fails\n  Streaming --> Failed: Stream fails\n  Failed --> Starting: User retries',
  },
  'mermaid-class': {
    kind: 'mermaid',
    title: 'Class relationships',
    description: 'Inheritance, composition, and methods.',
    source:
      'classDiagram\n  PreviewDefinition <|-- DiagramPreview\n  DiagramPreview *-- DiagramFixture\n  class PreviewDefinition {\n    +string id\n    +string defaultState\n    +resolveState()\n  }\n  class DiagramFixture {\n    +string title\n    +render()\n  }',
  },
  'mermaid-entity-relationship': {
    kind: 'mermaid',
    title: 'Entity relationship',
    description: 'Cardinality and descriptive attributes.',
    source:
      'erDiagram\n  PREVIEW ||--o{ STATE : exposes\n  STATE ||--|| FIXTURE : renders\n  PREVIEW {\n    string id PK\n    string title\n  }\n  STATE {\n    string name PK\n    string theme\n  }',
  },
  'mermaid-groups': {
    kind: 'mermaid',
    title: 'Grouped architecture',
    description: 'Nested responsibility boundaries.',
    source:
      'flowchart LR\n  subgraph Browser[Browser-only preview]\n    Catalog[Component catalog]\n    Scene[Named scene]\n  end\n  subgraph Renderers[Diagram renderers]\n    Mermaid[Mermaid]\n    Custom[Interactive custom]\n  end\n  Catalog --> Scene\n  Scene --> Mermaid\n  Scene --> Custom',
  },
  'mermaid-dense-graph': {
    kind: 'mermaid',
    title: 'Dense graph and edge labels',
    description: 'Cross-links, fan-out, and many labels.',
    source:
      'flowchart TB\n  A[Source] -->|parse| B[Model]\n  A -->|lint| C[Diagnostics]\n  A -->|index| D[Catalog]\n  B -->|layout| E[Frame]\n  C -->|annotate| E\n  D -->|select| E\n  E -->|capture| F[Evidence]\n  E -->|inspect| G[Browser]\n  G -->|feedback| A\n  F -->|record| H[Task note]\n  H -->|review| G',
  },
  'mermaid-long-labels': {
    kind: 'mermaid',
    title: 'Long labels',
    description: 'Wrap pressure from precise explanatory text.',
    source:
      'flowchart LR\n  A[The preview source updates without starting the complete desktop application] --> B[The browser-only scene preserves the exact selected theme width and motion preference] --> C[The capture harness waits for a stable deterministic frame]',
  },
  'mermaid-multiline-labels': {
    kind: 'mermaid',
    title: 'Multiline labels',
    description: 'Explicit line breaks inside nodes and edges.',
    source:
      'flowchart LR\n  A["Named preview<br/>direct URL"] -->|"lazy import<br/>no daemon"| B["Diagram renderer<br/>stable fixture"] --> C["Capture-ready<br/>browser frame"]',
  },
  'mermaid-cycle-fanout': {
    kind: 'mermaid',
    title: 'Cycle and fan-out',
    description: 'One hub, four targets, and a feedback cycle.',
    source:
      'flowchart LR\n  Hub[Workbench] --> Flow[Flow]\n  Hub --> Sequence[Sequence]\n  Hub --> State[State]\n  Hub --> ER[Entity relationship]\n  Flow --> Review[Review]\n  Sequence --> Review\n  State --> Review\n  ER --> Review\n  Review --> Hub',
  },
  'mermaid-invalid-source': {
    kind: 'mermaid',
    title: 'Invalid source',
    description: 'A stable parse error with source disclosure.',
    source: 'flowchart LR\n  A[Missing close --> B[Invalid',
  },
  'mermaid-empty-content': {
    kind: 'mermaid',
    title: 'Empty content',
    description: 'The renderer empty state.',
    source: '',
  },
} satisfies Record<string, DiagramWorkbenchCase>);

export const CUSTOM_WORKBENCH_CASES = Object.freeze({
  'custom-architecture': {
    kind: 'custom',
    title: 'Architecture and groups',
    description: 'Grouped services and event flow.',
    diagram: architecture,
  },
  'custom-sequence': {
    kind: 'custom',
    title: 'Interactive sequence',
    description: 'A browser capture handshake.',
    diagram: sequence,
  },
  'custom-state-machine': {
    kind: 'custom',
    title: 'Semantic state machine',
    description: 'Success, danger, active, and inactive states.',
    diagram: stateMachine,
  },
  'custom-data-flow': {
    kind: 'custom',
    title: 'Dense data flow',
    description: 'Long labels on a feedback loop.',
    diagram: dataFlow,
  },
  'custom-flowchart': {
    kind: 'custom',
    title: 'Cycle and fan-out flowchart',
    description: 'Decision paths and a direct capture branch.',
    diagram: flowchart,
  },
  'custom-network': {
    kind: 'custom',
    title: 'Preview network',
    description: 'Local server and hot reload flow.',
    diagram: network,
  },
  'custom-timeline': {
    kind: 'custom',
    title: 'Verification timeline',
    description: 'Milestones from fixtures to evidence.',
    diagram: timeline,
  },
  'custom-dependency-graph': {
    kind: 'custom',
    title: 'Preview dependencies',
    description: 'Lazy definitions and both production renderers.',
    diagram: dependency,
  },
  'custom-walkthrough': {
    kind: 'custom',
    title: 'State ownership walkthrough',
    description: 'Three selectable request, execution, and render steps.',
    diagram: ownershipWalkthrough,
  },
  'custom-bindings': {
    kind: 'custom',
    title: 'Bound recovery action',
    description: 'A note binding connects retry behavior to its source.',
    diagram: recoveryBindings,
  },
  'custom-long-multiline-labels': {
    kind: 'custom',
    title: 'Long and multiline labels',
    description: 'Wrapping and truncation pressure.',
    diagram: multilinePressure,
  },
  'custom-disconnected-extremes': {
    kind: 'custom',
    title: 'Disconnected extreme aspect ratio',
    description:
      'Unicode, an unbroken word, long horizontal and vertical labels, and an isolated node.',
    diagram: disconnectedExtremes,
  },
  'custom-topology-stress': {
    kind: 'custom',
    title: 'Dense topology stress',
    description:
      'Parallel and bidirectional pairs, a self-loop, multiple cycles, fan-out, and fan-in.',
    diagram: topologyStress,
  },
  'custom-empty-content': {
    kind: 'custom',
    title: 'Empty custom diagram',
    description: 'A valid model with no nodes or edges.',
    diagram: emptyCustom,
  },
} satisfies Record<string, DiagramWorkbenchCase>);

export const DIAGRAM_WORKBENCH_CASES = Object.freeze({
  ...MERMAID_WORKBENCH_CASES,
  'mermaid-loading': {
    kind: 'loading',
    title: 'Mermaid loading',
    description: 'A deterministic pending-render frame.',
  },
  ...CUSTOM_WORKBENCH_CASES,
} satisfies Record<string, DiagramWorkbenchCase>);

export type DiagramWorkbenchCaseId = keyof typeof DIAGRAM_WORKBENCH_CASES;

export const DIAGRAM_WORKBENCH_CASE_GROUPS = Object.freeze([
  {
    id: 'mermaid',
    caseIds: [
      'mermaid-flow',
      'mermaid-sequence',
      'mermaid-sequence-simple',
      'mermaid-sequence-alt',
      'mermaid-sequence-loop',
      'mermaid-sequence-note',
      'mermaid-state',
      'mermaid-class',
      'mermaid-entity-relationship',
      'mermaid-groups',
    ],
  },
  {
    id: 'stress',
    caseIds: [
      'mermaid-single-node',
      'mermaid-two-node',
      'mermaid-disconnected',
      'mermaid-topology-stress',
      'mermaid-nested-groups',
      'mermaid-dense-graph',
      'mermaid-long-labels',
      'mermaid-multiline-labels',
      'mermaid-cycle-fanout',
      'custom-long-multiline-labels',
      'custom-disconnected-extremes',
      'custom-topology-stress',
    ],
  },
  {
    id: 'custom',
    caseIds: [
      'custom-architecture',
      'custom-sequence',
      'custom-state-machine',
      'custom-data-flow',
      'custom-flowchart',
      'custom-network',
      'custom-timeline',
      'custom-dependency-graph',
    ],
  },
  { id: 'interaction', caseIds: ['custom-walkthrough', 'custom-bindings'] },
  {
    id: 'status',
    caseIds: [
      'mermaid-invalid-source',
      'mermaid-empty-content',
      'mermaid-loading',
      'custom-empty-content',
    ],
  },
] as const satisfies ReadonlyArray<{
  id: 'mermaid' | 'stress' | 'custom' | 'interaction' | 'status';
  caseIds: readonly DiagramWorkbenchCaseId[];
}>);
