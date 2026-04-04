/**
 * Diagram Templates
 *
 * Template generators for each diagram grammar to help agents create diagrams
 */

import type {
  DiagramPrimitive,
  DiagramGrammar,
} from '$shared/types/notes-primitives';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a base diagram with common fields
 */
export function createBaseDiagram(
  grammar: DiagramGrammar,
  createdBy: 'user' | 'agent' = 'agent',
  createdByAgentId?: string,
): DiagramPrimitive {
  return {
    id: uuidv4(),
    type: 'diagram',
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy,
    createdByAgentId,
    grammar,
    model: {
      nodes: [],
      edges: [],
    },
    baseView: {
      layout: getDefaultLayout(grammar),
    },
  };
}

/**
 * Get default layout for a grammar
 */
function getDefaultLayout(grammar: DiagramGrammar) {
  switch (grammar) {
    case 'architecture':
      return {
        type: 'layered' as const,
        direction: 'LR' as const,
        spacing: 80,
        edgeRouting: 'orthogonal' as const,
      };
    case 'sequence':
      return {
        type: 'layered' as const,
        direction: 'TB' as const,
        spacing: 60,
        edgeRouting: 'polyline' as const,
      };
    case 'state_machine':
      return {
        type: 'layered' as const,
        direction: 'LR' as const,
        spacing: 100,
        edgeRouting: 'curved' as const,
      };
    case 'data_flow':
      return {
        type: 'layered' as const,
        direction: 'LR' as const,
        spacing: 80,
        edgeRouting: 'orthogonal' as const,
      };
    case 'flowchart':
      return {
        type: 'layered' as const,
        direction: 'TB' as const,
        spacing: 60,
        edgeRouting: 'orthogonal' as const,
      };
    case 'network':
      return { type: 'force' as const, strength: 0.5, edgeRouting: 'polyline' as const };
    case 'timeline':
      return {
        type: 'layered' as const,
        direction: 'LR' as const,
        spacing: 100,
        edgeRouting: 'polyline' as const,
      };
    case 'dependency_graph':
      return {
        type: 'layered' as const,
        direction: 'TB' as const,
        spacing: 80,
        edgeRouting: 'orthogonal' as const,
      };
  }
}

/**
 * Architecture diagram template
 */
export function createArchitectureDiagram(
  services: Array<{ id: string; label: string; kind?: string }>,
  connections: Array<{ from: string; to: string; label?: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('architecture');

  diagram.model.nodes = services.map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.kind || 'service',
  }));

  diagram.model.edges = connections.map((c, i) => ({
    id: `edge-${i}`,
    from: c.from,
    to: c.to,
    label: c.label,
    kind: 'request',
  }));

  return diagram;
}

/**
 * Sequence diagram template
 */
export function createSequenceDiagram(
  actors: string[],
  messages: Array<{ from: string; to: string; label: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('sequence');

  diagram.model.nodes = actors.map((actor) => ({
    id: actor.toLowerCase().replace(/\s+/g, '-'),
    label: actor,
    kind: 'actor',
  }));

  diagram.model.edges = messages.map((m, i) => ({
    id: `msg-${i}`,
    from: m.from.toLowerCase().replace(/\s+/g, '-'),
    to: m.to.toLowerCase().replace(/\s+/g, '-'),
    label: m.label,
    kind: 'message',
  }));

  return diagram;
}

/**
 * State machine diagram template
 */
export function createStateMachineDiagram(
  states: Array<{ id: string; label: string; isStart?: boolean; isEnd?: boolean }>,
  transitions: Array<{ from: string; to: string; label: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('state_machine');

  diagram.model.nodes = states.map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.isStart ? 'start' : s.isEnd ? 'end' : 'state',
  }));

  diagram.model.edges = transitions.map((t, i) => ({
    id: `transition-${i}`,
    from: t.from,
    to: t.to,
    label: t.label,
    kind: 'transition',
  }));

  return diagram;
}

/**
 * Flowchart diagram template
 */
export function createFlowchartDiagram(
  steps: Array<{
    id: string;
    label: string;
    kind: 'process' | 'decision' | 'start' | 'end' | 'data';
  }>,
  flows: Array<{ from: string; to: string; label?: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('flowchart');

  diagram.model.nodes = steps.map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.kind,
  }));

  diagram.model.edges = flows.map((f, i) => ({
    id: `flow-${i}`,
    from: f.from,
    to: f.to,
    label: f.label,
    kind: 'flow',
  }));

  return diagram;
}

/**
 * Dependency graph template
 */
export function createDependencyGraph(
  modules: Array<{ id: string; label: string; kind?: 'module' | 'package' | 'file' }>,
  dependencies: Array<{ from: string; to: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('dependency_graph');

  diagram.model.nodes = modules.map((m) => ({
    id: m.id,
    label: m.label,
    kind: m.kind || 'module',
  }));

  diagram.model.edges = dependencies.map((d, i) => ({
    id: `dep-${i}`,
    from: d.from,
    to: d.to,
    kind: 'depends_on',
  }));

  return diagram;
}

/**
 * Data flow diagram template
 */
export function createDataFlowDiagram(
  nodes: Array<{ id: string; label: string; kind?: 'process' | 'data_store' | 'external' }>,
  flows: Array<{ from: string; to: string; label?: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('data_flow');

  diagram.model.nodes = nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind || 'process',
  }));

  diagram.model.edges = flows.map((f, i) => ({
    id: `flow-${i}`,
    from: f.from,
    to: f.to,
    label: f.label,
    kind: 'flow',
  }));

  return diagram;
}

/**
 * Network diagram template
 */
export function createNetworkDiagram(
  devices: Array<{ id: string; label: string; kind?: 'node' | 'router' | 'switch' | 'server' }>,
  connections: Array<{ from: string; to: string; label?: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('network');

  diagram.model.nodes = devices.map((d) => ({
    id: d.id,
    label: d.label,
    kind: d.kind || 'node',
  }));

  diagram.model.edges = connections.map((c, i) => ({
    id: `conn-${i}`,
    from: c.from,
    to: c.to,
    label: c.label,
    kind: 'connection',
  }));

  return diagram;
}

/**
 * Timeline diagram template
 */
export function createTimelineDiagram(
  events: Array<{ id: string; label: string; kind?: 'event' | 'milestone' }>,
  sequences: Array<{ from: string; to: string; label?: string }>,
): DiagramPrimitive {
  const diagram = createBaseDiagram('timeline');

  diagram.model.nodes = events.map((e) => ({
    id: e.id,
    label: e.label,
    kind: e.kind || 'event',
  }));

  diagram.model.edges = sequences.map((s, i) => ({
    id: `seq-${i}`,
    from: s.from,
    to: s.to,
    label: s.label,
    kind: 'sequence',
  }));

  return diagram;
}
