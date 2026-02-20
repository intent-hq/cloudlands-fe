/**
 * Notes Primitives Type Definitions
 *
 * Core types for the four note primitive blocks:
 * 1. Reference blocks (semantic code anchors)
 * 2. CLI command blocks
 * 3. Agent action blocks
 * 4. Patch (diff) blocks
 */

import { z } from 'zod';
import type { WorkspaceId, NoteId } from './branded-ids';

// ============================================================================
// Base Types
// ============================================================================

export type NotePrimitiveType = 'reference' | 'cli' | 'agent_action' | 'patch' | 'diagram';

export type CreatedByType = 'user' | 'agent' | 'system';

/**
 * Base interface for all note primitives
 */
export interface BasePrimitive {
  id: string; // UUID
  type: NotePrimitiveType;
  version: 1; // Schema version for forward compatibility
  label?: string; // Short, human-readable label
  description?: string; // Optional longer description
  createdAt: string; // ISO timestamp
  createdBy: CreatedByType;
  createdByAgentId?: string; // ID of the agent that created/ran this primitive (if createdBy === 'agent')
  meta?: Record<string, unknown>; // Extension point for future features
}

// ============================================================================
// Reference Block Types
// ============================================================================

export type ReferenceKind = 'symbol' | 'file_range';

export interface ReferenceTarget {
  /**
   * Type of reference. Defaults to 'file_range' if not specified.
   */
  kind?: ReferenceKind;

  /**
   * Human- and LLM-friendly identifier.
   * Optional - if not provided, will be derived from filePath + range.
   * Examples:
   * - "src/ui/MainView.tsx#symbol:MainView.render"
   * - "src/hooks/useDarkMode.ts#symbol:useDarkMode"
   * - "backend/auth.py#L10-25"
   * - "backend/auth.py" (whole file)
   */
  semanticId?: string;

  // File path (required if semanticId is not provided)
  filePath?: string;
  languageId?: string; // "typescript", "python", etc.
  range?: {
    startLine: number;
    startColumn?: number;
    endLine: number;
    endColumn?: number;
  };
}

export interface ReferenceSnapshot {
  code: string;
  filePath: string;
  languageId?: string;
}

export interface ReferenceDisplay {
  collapsedByDefault?: boolean;
  showFilePath?: boolean;
  showSymbolName?: boolean;
}

export interface ReferencePrimitive extends BasePrimitive {
  type: 'reference';
  target: ReferenceTarget;
  snapshot?: ReferenceSnapshot;
  display?: ReferenceDisplay;
}

// ============================================================================
// CLI Command Block Types
// ============================================================================

export type CliRunStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface CliLastRun {
  status: CliRunStatus;
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface CliOutputSnapshot {
  stdout: string;
  stderr: string;
}

export interface CliDisplay {
  collapsedOutputByDefault?: boolean;
  showCommandPrefix?: string; // e.g. "$"
}

export interface CliPrimitive extends BasePrimitive {
  type: 'cli';
  command: string; // e.g. "pnpm test --filter ui"
  cwd?: string; // Relative to workspace repo root
  env?: Record<string, string>;
  timeoutMs?: number;
  lastRun?: CliLastRun;
  outputSnapshot?: CliOutputSnapshot;
  display?: CliDisplay;
  terminalId?: string; // ID of the terminal where this command was last run
}

// ============================================================================
// Agent Action Block Types
// ============================================================================

export type AgentActionStatus = 'pending' | 'running' | 'success' | 'error';

export type AgentActionInputKind =
  | 'reference'
  | 'semantic_ref'
  | 'text'
  | 'file_glob'
  | 'note_section';

export interface AgentActionInput {
  kind: AgentActionInputKind;
  refId?: string; // For 'reference' kind
  semanticId?: string; // For 'semantic_ref' kind
  content?: string; // For 'text' kind
  pattern?: string; // For 'file_glob' kind
  heading?: string; // For 'note_section' kind
}

export interface AgentActionConfig {
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown; // Agent-specific settings
}

export interface AgentActionLastRun {
  status: AgentActionStatus;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface AgentActionResultSummary {
  title?: string;
  description?: string;
  createdPrimitives?: string[]; // IDs of new primitives created by the agent
}

export interface AgentActionPrimitive extends BasePrimitive {
  type: 'agent_action';
  agentId: string; // e.g. "refactor", "explainer", "planner"
  goal: string; // Human-readable, single sentence
  inputs: AgentActionInput[];
  config?: AgentActionConfig;
  lastRun?: AgentActionLastRun;
  resultSummary?: AgentActionResultSummary;
}

// ============================================================================
// Patch Block Types
// ============================================================================

export type PatchApplyStatus = 'success' | 'conflict' | 'error';

export interface PatchLastApply {
  status: PatchApplyStatus;
  appliedAt: string;
  errorMessage?: string;
}

export interface FilePatch {
  filePath: string;
  /**
   * Unified diff text for this file
   * Using standard unified diff format for LLM-friendliness
   */
  diff: string;

  // Optional semantic info
  semanticRefs?: string[]; // semanticIds touched by this patch
}

export interface PatchDisplay {
  collapsedByDefault?: boolean;
  showFileNames?: boolean;
}

export interface PatchPrimitive extends BasePrimitive {
  type: 'patch';
  patches: FilePatch[];
  lastApply?: PatchLastApply;
  display?: PatchDisplay;
}

// ============================================================================
// Diagram Block Types
// ============================================================================

/**
 * Supported diagram grammars
 * Each grammar defines structural rules, default layouts, and validation
 */
export type DiagramGrammar =
  | 'architecture'
  | 'sequence'
  | 'state_machine'
  | 'data_flow'
  | 'network'
  | 'flowchart'
  | 'timeline'
  | 'dependency_graph';

/**
 * Node kind varies by grammar
 * Architecture: service, db, queue, actor, ui_component
 * Sequence: actor
 * Flowchart: process, decision, start, end
 * etc.
 */
export type DiagramNodeKind = string;

/**
 * Semantic style tags for consistent theming
 */
export type DiagramSemanticStyle =
  | 'highlighted'
  | 'muted'
  | 'danger'
  | 'success'
  | 'inactive'
  | 'warning'
  | 'active';

/**
 * Binding types for linking diagram elements to workspace entities
 */
export type DiagramBindingType =
  | 'file'
  | 'symbol'
  | 'spec'
  | 'note'
  | 'timeline_event'
  | 'metric'
  | 'log'
  | 'test';

/**
 * Binding to workspace entities
 */
export interface DiagramBinding {
  type: DiagramBindingType;
  target: string; // File path, symbol ID, spec ID, etc.
  metadata?: Record<string, unknown>;
}

/**
 * Diagram node
 */
export interface DiagramNode {
  id: string;
  label: string;
  kind?: DiagramNodeKind;
  semanticStyle?: DiagramSemanticStyle;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  binding?: DiagramBinding; // Singular binding (alternative to bindings)
  bindings?: DiagramBinding[];
  group?: string; // Group ID this node belongs to
  metadata?: Record<string, unknown>;
}

/**
 * Diagram edge
 */
export interface DiagramEdge {
  id: string;
  from: string; // Node ID
  to: string; // Node ID
  label?: string;
  kind?: string; // Edge type (varies by grammar)
  semanticStyle?: DiagramSemanticStyle;
  animated?: boolean; // Animated flow
  dashed?: boolean; // Dashed line style
  flowDirection?: 'forward' | 'backward' | 'bidirectional'; // Direction of animated flow
  bindings?: DiagramBinding[];
  metadata?: Record<string, unknown>;
}

/**
 * Diagram group (for organizing nodes)
 */
export interface DiagramGroup {
  id: string;
  label: string;
  nodeIds: string[];
  semanticStyle?: DiagramSemanticStyle;
  metadata?: Record<string, unknown>;
}

/**
 * Semantic model - the source of truth
 */
export interface DiagramModel {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: DiagramGroup[];
}

/**
 * Layout configuration
 */
export interface DiagramLayout {
  type: 'layered' | 'force' | 'circular' | 'tree' | 'manual';
  direction?: 'LR' | 'RL' | 'TB' | 'BT';
  spacing?: number;
  edgeRouting?: 'orthogonal' | 'polyline' | 'curved';
}

/**
 * Semantic style definitions
 */
export interface DiagramSemanticStyles {
  [key: string]: {
    class?: string;
    style?: Record<string, string>;
  };
}

/**
 * Base view configuration
 */
export interface DiagramBaseView {
  layout: DiagramLayout;
  semanticStyles?: DiagramSemanticStyles;
  zoom?: number;
  pan?: { x: number; y: number };
  // Allow edgeRouting at baseView level as well as layout level for compatibility
  edgeRouting?: 'orthogonal' | 'polyline' | 'curved';
}

/**
 * Camera configuration for a state
 */
export interface DiagramCamera {
  focus?: string; // Node ID to focus on
  zoom?: number;
  pan?: { x: number; y: number };
}

/**
 * Narrative text for a state
 */
export interface DiagramNarrative {
  title?: string;
  text?: string;
}

/**
 * Overlay for a state (e.g., metrics, annotations)
 */
export interface DiagramOverlay {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Transition animation configuration
 */
export interface DiagramTransition {
  duration?: number; // milliseconds
  animate?: ('camera' | 'visibleEdges' | 'visibleNodes' | 'semanticStyle')[];
}

/**
 * Diagram state - alternate view of the model
 */
export interface DiagramState {
  id: string;
  label?: string;
  visibleNodes?: string[]; // Node IDs (if undefined, all visible)
  visibleEdges?: string[]; // Edge IDs (if undefined, all visible)
  visibleGroups?: string[]; // Group IDs (if undefined, inferred from visibleNodes)
  highlightedNodes?: string[]; // Node IDs to highlight
  highlightedEdges?: string[]; // Edge IDs to highlight
  camera?: DiagramCamera;
  narrative?: DiagramNarrative | string; // Can be object or plain string
  overlays?: DiagramOverlay[];
  transition?: DiagramTransition;
}

/**
 * Diagram primitive
 */
export interface DiagramPrimitive extends BasePrimitive {
  type: 'diagram';
  grammar: DiagramGrammar;
  model: DiagramModel;
  baseView: DiagramBaseView;
  states?: DiagramState[];
  currentStateId?: string; // Currently active state
}

// ============================================================================
// Union Types
// ============================================================================

export type NotePrimitive =
  | ReferencePrimitive
  | CliPrimitive
  | AgentActionPrimitive
  | PatchPrimitive
  | DiagramPrimitive;

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

// Base schema
export const BasePrimitiveSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['reference', 'cli', 'agent_action', 'patch', 'diagram']),
  version: z.literal(1),
  label: z.string().optional(),
  description: z.string().optional(),
  createdAt: z.string().datetime(),
  createdBy: z.enum(['user', 'agent', 'system']),
  createdByAgentId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

// Reference schemas
export const ReferenceTargetSchema = z.object({
  kind: z.enum(['symbol', 'file_range']).optional().default('file_range'),
  semanticId: z.string().optional(),
  filePath: z.string().optional(),
  languageId: z.string().optional(),
  range: z
    .object({
      startLine: z.number().nonnegative(), // Line numbers can be 0-based
      startColumn: z.number().nonnegative().optional(),
      endLine: z.number().nonnegative(),
      endColumn: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const ReferenceSnapshotSchema = z.object({
  code: z.string(),
  filePath: z.string(),
  languageId: z.string().optional(),
});

export const ReferenceDisplaySchema = z.object({
  collapsedByDefault: z.boolean().optional(),
  showFilePath: z.boolean().optional(),
  showSymbolName: z.boolean().optional(),
});

export const ReferencePrimitiveSchema = BasePrimitiveSchema.extend({
  type: z.literal('reference'),
  target: ReferenceTargetSchema,
  snapshot: ReferenceSnapshotSchema.optional(),
  display: ReferenceDisplaySchema.optional(),
});

// CLI schemas
export const CliLastRunSchema = z.object({
  status: z.enum(['running', 'success', 'error', 'cancelled']),
  exitCode: z.number().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});

export const CliOutputSnapshotSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
});

export const CliDisplaySchema = z.object({
  collapsedOutputByDefault: z.boolean().optional(),
  showCommandPrefix: z.string().optional(),
});

export const CliPrimitiveSchema = BasePrimitiveSchema.extend({
  type: z.literal('cli'),
  command: z.string(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().positive().optional(),
  lastRun: CliLastRunSchema.optional(),
  outputSnapshot: CliOutputSnapshotSchema.optional(),
  display: CliDisplaySchema.optional(),
  terminalId: z.string().optional(),
});

// Agent action schemas
export const AgentActionInputSchema = z.object({
  kind: z.enum(['reference', 'semantic_ref', 'text', 'file_glob', 'note_section']),
  refId: z.string().optional(),
  semanticId: z.string().optional(),
  content: z.string().optional(),
  pattern: z.string().optional(),
  heading: z.string().optional(),
});

export const AgentActionConfigSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().positive().optional(),
  })
  .passthrough(); // Allow additional agent-specific fields

export const AgentActionLastRunSchema = z.object({
  status: z.enum(['pending', 'running', 'success', 'error']),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
});

export const AgentActionResultSummarySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  createdPrimitives: z.array(z.string()).optional(),
});

export const AgentActionPrimitiveSchema = BasePrimitiveSchema.extend({
  type: z.literal('agent_action'),
  agentId: z.string(),
  goal: z.string(),
  inputs: z.array(AgentActionInputSchema),
  config: AgentActionConfigSchema.optional(),
  lastRun: AgentActionLastRunSchema.optional(),
  resultSummary: AgentActionResultSummarySchema.optional(),
});

// Patch schemas
export const PatchLastApplySchema = z.object({
  status: z.enum(['success', 'conflict', 'error']),
  appliedAt: z.string().datetime(),
  errorMessage: z.string().optional(),
});

export const FilePatchSchema = z.object({
  filePath: z.string(),
  diff: z.string(),
  semanticRefs: z.array(z.string()).optional(),
});

export const PatchDisplaySchema = z.object({
  collapsedByDefault: z.boolean().optional(),
  showFileNames: z.boolean().optional(),
});

export const PatchPrimitiveSchema = BasePrimitiveSchema.extend({
  type: z.literal('patch'),
  patches: z.array(FilePatchSchema),
  lastApply: PatchLastApplySchema.optional(),
  display: PatchDisplaySchema.optional(),
});

// Diagram schemas
export const DiagramGrammarSchema = z.enum([
  'architecture',
  'sequence',
  'state_machine',
  'data_flow',
  'network',
  'flowchart',
  'timeline',
  'dependency_graph',
]);

export const DiagramSemanticStyleSchema = z.enum([
  'highlighted',
  'muted',
  'danger',
  'success',
  'inactive',
  'warning',
  'active',
]);

export const DiagramBindingSchema = z.object({
  type: z.enum(['file', 'symbol', 'spec', 'note', 'timeline_event', 'metric', 'log', 'test']),
  target: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const DiagramNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string().optional(),
  semanticStyle: DiagramSemanticStyleSchema.optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  size: z.object({ width: z.number(), height: z.number() }).optional(),
  binding: DiagramBindingSchema.optional(), // Singular binding (alternative to bindings)
  bindings: z.array(DiagramBindingSchema).optional(),
  group: z.string().optional(), // Group ID this node belongs to
  metadata: z.record(z.unknown()).optional(),
});

export const DiagramEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  kind: z.string().optional(),
  semanticStyle: DiagramSemanticStyleSchema.optional(),
  animated: z.boolean().optional(),
  dashed: z.boolean().optional(),
  flowDirection: z.enum(['forward', 'backward', 'bidirectional']).optional(),
  bindings: z.array(DiagramBindingSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const DiagramGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  nodeIds: z.array(z.string()),
  semanticStyle: DiagramSemanticStyleSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const DiagramModelSchema = z.object({
  nodes: z.array(DiagramNodeSchema),
  edges: z.array(DiagramEdgeSchema),
  groups: z.array(DiagramGroupSchema).optional(),
});

export const DiagramLayoutSchema = z.object({
  type: z.enum(['layered', 'force', 'circular', 'tree', 'manual']),
  direction: z.enum(['LR', 'RL', 'TB', 'BT']).optional(),
  spacing: z.number().optional(),
  edgeRouting: z.enum(['orthogonal', 'polyline', 'curved']).optional(),
});

export const DiagramSemanticStylesSchema = z.record(
  z.object({
    class: z.string().optional(),
    style: z.record(z.string()).optional(),
  }),
);

export const DiagramBaseViewSchema = z.object({
  layout: DiagramLayoutSchema,
  semanticStyles: DiagramSemanticStylesSchema.optional(),
  zoom: z.number().optional(),
  pan: z.object({ x: z.number(), y: z.number() }).optional(),
  // Allow edgeRouting at baseView level as well as layout level for compatibility
  edgeRouting: z.enum(['orthogonal', 'polyline', 'curved']).optional(),
});

export const DiagramCameraSchema = z.object({
  focus: z.string().optional(),
  zoom: z.number().optional(),
  pan: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const DiagramNarrativeSchema = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
});

export const DiagramOverlaySchema = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

export const DiagramTransitionSchema = z.object({
  duration: z.number().optional(),
  animate: z.array(z.enum(['camera', 'visibleEdges', 'visibleNodes', 'semanticStyle'])).optional(),
});

export const DiagramStateSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  visibleNodes: z.array(z.string()).optional(),
  visibleEdges: z.array(z.string()).optional(),
  visibleGroups: z.array(z.string()).optional(),
  highlightedNodes: z.array(z.string()).optional(),
  highlightedEdges: z.array(z.string()).optional(),
  camera: DiagramCameraSchema.optional(),
  // Narrative can be object or plain string
  narrative: z.union([DiagramNarrativeSchema, z.string()]).optional(),
  overlays: z.array(DiagramOverlaySchema).optional(),
  transition: DiagramTransitionSchema.optional(),
});

export const DiagramPrimitiveSchema = BasePrimitiveSchema.extend({
  type: z.literal('diagram'),
  grammar: DiagramGrammarSchema,
  model: DiagramModelSchema,
  baseView: DiagramBaseViewSchema,
  states: z.array(DiagramStateSchema).optional(),
  currentStateId: z.string().optional(),
});

// Union schema
export const NotePrimitiveSchema = z.discriminatedUnion('type', [
  ReferencePrimitiveSchema,
  CliPrimitiveSchema,
  AgentActionPrimitiveSchema,
  PatchPrimitiveSchema,
  DiagramPrimitiveSchema,
]);

// ============================================================================
// Type Guards
// ============================================================================

export function isReferencePrimitive(primitive: NotePrimitive): primitive is ReferencePrimitive {
  return primitive.type === 'reference';
}

export function isCliPrimitive(primitive: NotePrimitive): primitive is CliPrimitive {
  return primitive.type === 'cli';
}

export function isAgentActionPrimitive(
  primitive: NotePrimitive,
): primitive is AgentActionPrimitive {
  return primitive.type === 'agent_action';
}

export function isPatchPrimitive(primitive: NotePrimitive): primitive is PatchPrimitive {
  return primitive.type === 'patch';
}

export function isDiagramPrimitive(primitive: NotePrimitive): primitive is DiagramPrimitive {
  return primitive.type === 'diagram';
}

// ============================================================================
// Semantic ID Parsing
// ============================================================================

/**
 * Parsed semantic ID - can be in one of several formats depending on the input
 */
export interface ParsedSemanticId {
  filePath: string;
  // New format fields
  type?: 'symbol' | 'line' | 'file';
  symbol?: string;
  startLine?: number;
  endLine?: number;
  // Legacy format fields
  refSpec?: {
    type: 'symbol' | 'lines';
    value: string;
  };
}

/**
 * Parse a semantic ID into its components
 * Supports four formats:
 * - File only: "filePath" (no anchor)
 * - Symbol: "filePath#symbol:symbolPath"
 * - Line: "filePath#L10" or "filePath#L10-20"
 * - Legacy lines: "filePath#lines:L10-20"
 */
export function parseSemanticId(semanticId: string): ParsedSemanticId | null {
  // Try symbol format first
  const symbolMatch = semanticId.match(/^(.+)#symbol:(.+)$/);
  if (symbolMatch) {
    const [, filePath, symbol] = symbolMatch;
    return {
      filePath,
      type: 'symbol',
      symbol,
    };
  }

  // Try line format
  const lineMatch = semanticId.match(/^(.+)#L(\d+)(?:-(\d+))?$/);
  if (lineMatch) {
    const [, filePath, startLine, endLine] = lineMatch;
    const result: ParsedSemanticId = {
      filePath,
      type: 'line',
      startLine: parseInt(startLine, 10),
    };
    if (endLine) {
      result.endLine = parseInt(endLine, 10);
    }
    return result;
  }

  // Try the original lines: format for backward compatibility
  const linesMatch = semanticId.match(/^(.+)#lines:(.+)$/);
  if (linesMatch) {
    const [, filePath, value] = linesMatch;
    return {
      filePath,
      refSpec: {
        type: 'lines',
        value,
      },
    };
  }

  // Handle file-only reference (no anchor) - treat as whole file reference
  // This supports bare file paths like "src/routes/+layout.svelte"
  if (semanticId && !semanticId.includes('#')) {
    return {
      filePath: semanticId,
      type: 'file',
    };
  }

  return null;
}

/**
 * Validate a semantic ID
 */
export function isValidSemanticId(semanticId: string): boolean {
  if (!semanticId || typeof semanticId !== 'string') return false;

  // Check for symbol format
  if (semanticId.match(/^.+#symbol:.+$/)) return true;

  // Check for line format
  const lineMatch = semanticId.match(/^.+#L(\d+)(?:-(\d+))?$/);
  if (lineMatch) {
    const [, startLine, endLine] = lineMatch;
    const start = parseInt(startLine, 10);
    if (endLine) {
      const end = parseInt(endLine, 10);
      return start > 0 && end > 0 && end >= start;
    }
    return start > 0;
  }

  // Check for lines: format
  if (semanticId.match(/^.+#lines:.+$/)) return true;

  // Accept bare file paths (no anchor) - file-only reference
  if (!semanticId.includes('#') && semanticId.length > 0) return true;

  return false;
}

/**
 * Build a semantic ID from components
 */
export function buildSemanticId(filePath: string, type: 'symbol' | 'lines', value: string): string {
  return `${filePath}#${type}:${value}`;
}

/**
 * Get the semantic ID from a ReferenceTarget, deriving it from filePath + range if not provided
 */
export function getSemanticId(target: ReferenceTarget): string | null {
  // If semanticId is provided, use it
  if (target.semanticId) {
    return target.semanticId;
  }

  // Derive from filePath + range
  if (target.filePath) {
    if (target.range) {
      if (target.range.startLine === target.range.endLine) {
        return `${target.filePath}#L${target.range.startLine}`;
      }
      return `${target.filePath}#L${target.range.startLine}-${target.range.endLine}`;
    }
    // Just the file path (whole file reference)
    return target.filePath;
  }

  return null;
}
