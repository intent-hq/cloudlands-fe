# Diagram Primitives System

A comprehensive diagram system for the Intent app that enables agents and users to create interactive, semantic diagrams with support for walkthroughs, states, and code bindings.

## Architecture

### Core Components

- **DiagramRenderer.svelte** - Main rendering component with state management and interactivity
- **DiagramEdge.svelte** - Edge/connection rendering with path computation
- **DiagramGroup.svelte** - Group/container rendering for logical grouping
- **DiagramControls.svelte** - State navigation and zoom controls

### Layout & Computation

- **layout-engine.ts** - Layout algorithms (layered, force-directed, circular, tree)
- **types.ts** - Grammar configurations and computed types
- **diagram-validator.ts** - Validation utilities with helpful error messages
- **diagram-templates.ts** - Template generators for each grammar type

### Integration

- **diagram-block-node.ts** - TipTap custom node for diagrams
- **DiagramBlock.svelte** - TipTap node view component
- **notes-primitives.ts** - Type definitions and Zod schemas

## Supported Grammars

1. **Architecture** - System architecture, service diagrams
2. **Sequence** - Message flows, API sequences
3. **State Machine** - State transitions, workflows
4. **Data Flow** - Data pipelines, ETL processes
5. **Flowchart** - Decision trees, algorithms
6. **Network** - Network topology, infrastructure
7. **Timeline** - Temporal sequences, project timelines
8. **Dependency Graph** - Module dependencies, imports

## Features

### States & Walkthroughs

Diagrams support multiple states for creating step-by-step walkthroughs:

- **Visibility Control** - Show/hide specific nodes and edges
- **Camera Control** - Zoom and focus on specific elements
- **Narratives** - Explanatory text for each state
- **Animations** - Smooth transitions between states

### Semantic Styling

Predefined semantic styles for consistent theming:

- `highlighted` - Accent color, draws attention
- `muted` - Reduced opacity, less important
- `danger` - Red, errors or warnings
- `success` - Green, successful states
- `warning` - Yellow/orange, caution
- `inactive` - Grayed out, disabled

### Code Bindings

Link diagram elements to workspace entities. Both nodes and edges can have bindings and are clickable when bindings are present:

- **Files** - Opens file in editor
- **Symbols** - Navigates to function, class, etc.
- **Specs** - Opens specification document
- **Notes** - Opens linked note
- **Timeline events** - Jumps to event in timeline
- **Metrics** - Shows metric details
- **Logs** - Opens log entry
- **Tests** - Navigates to test file

## Usage

### For Agents

See `docs/DIAGRAM_PRIMITIVES.md` for comprehensive agent documentation.

Quick example:

```typescript
import { createArchitectureDiagram } from '$lib/components/diagrams/diagram-templates';

const diagram = createArchitectureDiagram(
  [
    { id: 'client', label: 'Client', kind: 'actor' },
    { id: 'api', label: 'API', kind: 'service' },
  ],
  [
    { from: 'client', to: 'api', label: 'HTTP Request' },
  ]
);
```

### For Users

Diagrams appear as interactive blocks in notes. Use the controls to:

- Navigate between states (if available)
- Zoom in/out
- Reset view
- Click on nodes with bindings to navigate to code

## Testing

Visit `/sandbox` route to test diagrams in the browser without Electron/IPC.

## File Structure

```
src/lib/components/diagrams/
├── DiagramRenderer.svelte      # Main renderer
├── DiagramEdge.svelte          # Edge component
├── DiagramGroup.svelte         # Group component
├── DiagramControls.svelte      # Controls UI
├── layout-engine.ts            # Layout algorithms
├── types.ts                    # Type definitions
├── diagram-validator.ts        # Validation
├── diagram-templates.ts        # Templates
└── README.md                   # This file

src/lib/utils/tiptap-primitives/
└── diagram-block-node.ts       # TipTap integration

src/lib/components/notes/primitives/
└── DiagramBlock.svelte         # TipTap node view

src/shared/types/
└── notes-primitives.ts         # Type definitions & schemas

docs/
└── DIAGRAM_PRIMITIVES.md       # Agent documentation

src/routes/
└── sandbox/+page.svelte        # Browser testing sandbox
```

## Design Philosophy

Diagrams are **cognitive tools** designed to make reasoning easier. Every feature supports agent-human collaboration at higher levels of abstraction:

- **Grammar-based** - Each diagram type has specific structural rules
- **State-based** - Support walkthroughs and progressive disclosure
- **Semantic** - Meaning over aesthetics
- **Interactive** - Clickable, navigable, explorable
- **Bound to code** - Always connected to the actual codebase
- **LLM-friendly** - Easy for agents to generate robustly

## Future Enhancements

- Interactive editing (drag nodes, edit labels)
- Custom grammars
- Animation sequences
- Export to SVG/PNG
- Collaborative editing
- Version history
