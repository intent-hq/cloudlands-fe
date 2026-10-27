/**
 * Agent trace model.
 *
 * `TraceRecord`s are slim, serializable copies of the daemon events the trace
 * reads (PROTOCOL §5.10 history + §6 live): `agent:last-message` marks turn
 * boundaries, `agent:tool:call` carries tool spans, `agent:failed` ends a
 * failed turn and `workspace:tokenUsage-changed` snapshots carry cumulative
 * per-agent usage. `buildTrace` turns them into one timeline of nested spans.
 */
import type { TokenUsageCost } from '$features/token-usage/token-usage-types';

export type TraceMessageOrigin = 'human' | 'agent' | 'system';

interface TraceRecordBase {
  /** Daemon event id; records are de-duplicated by it. */
  id: string;
  /** Event time in epoch milliseconds. */
  ts: number;
}

/** `agent:last-message` — a persisted user or assistant row. */
export interface TraceMessageRecord extends TraceRecordBase {
  kind: 'message';
  agentId: string;
  role: 'user' | 'assistant';
  messageId: string;
  turnId?: string;
  origin: TraceMessageOrigin;
  /** Capped preview: the prompt on user rows, the reply on assistant rows. */
  text?: string;
}

/** One `agent:tool:call` update. A tool call sends several. */
export interface TraceToolRecord extends TraceRecordBase {
  kind: 'tool';
  agentId: string;
  toolCallId: string;
  /** Assistant message that owns the call. */
  messageId?: string;
  toolName: string;
  title: string;
  toolKind?: string;
  status: string;
  /** Bounded shallow copy of the input (long strings cut). */
  input?: Record<string, unknown>;
  /** Capped output preview (terminal updates only). */
  output?: string;
}

/** `agent:failed` — a turn ended with an error. */
export interface TraceFailureRecord extends TraceRecordBase {
  kind: 'failure';
  agentId: string;
  turnId?: string;
  error: string;
}

/** Cumulative usage of one agent in one snapshot. */
export interface TraceUsageTotals {
  tokensIn: number;
  tokensOut: number;
  cost?: TokenUsageCost;
}

/** `workspace:tokenUsage-changed` — cumulative per-agent usage at `ts`. */
export interface TraceUsageRecord extends TraceRecordBase {
  kind: 'usage';
  byAgent: Record<string, TraceUsageTotals>;
  agentNames?: Record<string, string>;
  /** Each agent's main model, from the snapshot's agent × model rows. */
  agentModels?: Record<string, string>;
}

export type TraceRecord =
  TraceMessageRecord | TraceToolRecord | TraceFailureRecord | TraceUsageRecord;

/** Agent facts the builder needs from the session store. */
export interface TraceAgentInfo {
  id: string;
  name: string;
  parentId?: string | null;
  model?: string;
  provider?: string;
  /** The agent is in a turn right now. */
  active: boolean;
  /** Last reply preview, used when no assistant row is loaded. */
  lastResponse?: string;
}

type TraceSpanKind = 'agent' | 'turn' | 'tool';
export type TraceSpanStatus = 'running' | 'done' | 'failed';

/** Usage of one span (a delta, never cumulative). */
export interface TraceUsage {
  tokensIn: number;
  tokensOut: number;
  cost?: TokenUsageCost;
}

/** One piece of a collapsed bar. Lists paint in order: turns, then tool calls. */
export interface TraceSegment {
  kind: 'turn' | 'tool';
  start: number;
  end: number | null;
  failed: boolean;
}

export interface TraceSpan {
  id: string;
  kind: TraceSpanKind;
  agentId: string;
  name: string;
  /** Secondary text: model for agents and turns, source for tools. */
  detail?: string;
  start: number;
  /** `null` while running; the view uses its clock. */
  end: number | null;
  status: TraceSpanStatus;
  children: TraceSpan[];
  /** All descendant spans, for `+N` and collapsed bars. */
  descendantCount: number;
  /** Turn and tool pieces drawn when the row is collapsed. */
  segments: TraceSegment[];
  usage?: TraceUsage;
  input?: string;
  output?: string;
  error?: string;
  /** Agent rows: the agent has no turn of its own, only sub-agents with turns. */
  contextOnly?: boolean;
  /** Turn rows: the prompt row was not recorded, so the duration is unknown. */
  startUnknown?: boolean;
  /** Agent rows: the agent has a parent agent. */
  isSubAgent?: boolean;
  /** Agent and turn rows: what started the turn. */
  origin?: TraceMessageOrigin;
  toolName?: string;
  toolKind?: string;
  toolInput?: Record<string, unknown>;
  /** Tool rows: the tool belongs to this turn. */
  turnId?: string;
  /**
   * The chat message the span starts at: a turn's prompt (its reply when no
   * prompt was recorded), or the reply that made a tool call.
   */
  messageId?: string;
  /** Tool rows: the call inside `messageId`. */
  toolCallId?: string;
  toolCount?: number;
  turnCount?: number;
}

interface TraceStats {
  agents: number;
  turns: number;
  toolCalls: number;
  errors: number;
  usage?: TraceUsage;
}

/** A burst of activity; `end` is `null` while it is live. */
interface TraceWindow {
  start: number;
  end: number | null;
}

/** All loaded agent activity, as one timeline. */
export interface Trace {
  start: number;
  /** `null` while live. */
  end: number | null;
  /** Bursts in time order; the axis squeezes the idle time between them. */
  windows: TraceWindow[];
  live: boolean;
  roots: TraceSpan[];
  stats: TraceStats;
}
