import type { DiagramPrimitive } from '$shared/types/notes-primitives';

export const ASSISTANT_MERMAID_SOURCE = `flowchart TB
  User[User] --> UI[Product UI and desktop app]
  UI <--> Daemon[Intent daemon]
  Daemon --> Records[Notes tasks and conversation records]`;

export const ASSISTANT_NATIVE_DIAGRAM: DiagramPrimitive = {
  id: '10000000-0000-4000-8000-000000000001',
  type: 'diagram',
  version: 1,
  createdAt: '2026-10-06T00:00:00Z',
  createdBy: 'agent',
  grammar: 'architecture',
  model: {
    nodes: [
      { id: 'assistant', label: 'Assistant', kind: 'actor' },
      {
        id: 'notes',
        label: 'Architecture notes α',
        kind: 'db',
        binding: { type: 'note', target: 'second' },
      },
    ],
    edges: [{ id: 'writes', from: 'assistant', to: 'notes', label: 'writes' }],
  },
  baseView: { layout: { type: 'layered', direction: 'TB' } },
};

export const ASSISTANT_DIAGRAM_NOTE = [
  '# Intent architecture',
  'Main code layers, shown beside the Assistant conversation.',
  `\`\`\`mermaid\n${ASSISTANT_MERMAID_SOURCE}\n\`\`\``,
  '## Stored notes',
  `~~~diagram\n${JSON.stringify(ASSISTANT_NATIVE_DIAGRAM)}\n~~~`,
  '| Part | Responsibility |\n| --- | --- |\n| Renderer | Product UI |\n| Daemon | Durable work |',
  'End of the architecture note.',
].join('\n\n');

export const ASSISTANT_DIAGRAM_ERROR_NOTE = [
  '# Diagram errors',
  'Each error keeps its source and the rest of the note.',
  '```mermaid\nflowchart LR\n  A --> ??? (((\n```',
  '```diagram\n{"model":\n```',
  '```ws-block:diagram\n{"model":{"nodes":[],"edges":[{"id":"bad","from":"missing","to":"missing"}]}}\n```',
  'End of the error note.',
].join('\n\n');

export const ASSISTANT_DIAGRAM_EXAMPLE_NOTE = [
  '# Literal examples',
  '````markdown\n```mermaid\nflowchart LR\n  Example --> Code\n```\n````',
  '```javascript\nconst diagram = "mermaid";\n```',
  '```diff\n-old\n+new\n```',
  '@@@task\n# Keep task proposals readable\nTask details stay in the note.\n@@@',
  'End of the example note.',
].join('\n\n');
