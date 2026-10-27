/**
 * Trace records → one timeline of nested spans (pure).
 *
 * Every agent turn is an interval; intervals closer than `BURST_GAP_MS` join a
 * burst, and the view squeezes the idle time between bursts. Agents nest under
 * their parent agent; an agent with several turns lists them as turn rows
 * (with their tool calls), an agent with one turn lists its tool calls directly.
 */
import type {
  TraceAgentInfo,
  TraceFailureRecord,
  TraceMessageOrigin,
  TraceMessageRecord,
  Trace,
  TraceRecord,
  TraceSegment,
  TraceSpan,
  TraceSpanStatus,
  TraceToolRecord,
  TraceUsage,
  TraceUsageRecord,
  TraceUsageTotals,
} from '../trace-types';

/** Turns closer than this join one burst; longer idle time is squeezed on the axis. */
const BURST_GAP_MS = 60_000;
/** Messages an agent posts on its own this close together are one stretch of work. */
const AUTO_TURN_JOIN_MS = 5 * 60_000;
/** A tool may start slightly before its turn's user row is stamped. */
const TOOL_TURN_TOLERANCE_MS = 2_000;
/** A failure may be stamped slightly after the turn's assistant row. */
const FAILURE_TURN_TOLERANCE_MS = 5_000;
/** Collapsed bars draw at most about this many pieces. */
const MAX_SEGMENTS = 240;

interface BuildTraceInput {
  records: readonly TraceRecord[];
  agents: readonly TraceAgentInfo[];
  /** Display names for agents without a loaded session. */
  names?: Record<string, string>;
  now: number;
}

interface WorkingTool {
  toolCallId: string;
  agentId: string;
  messageId?: string;
  start: number;
  end: number | null;
  failed: boolean;
  title: string;
  toolName: string;
  toolKind?: string;
  input?: Record<string, unknown>;
  output?: string;
}

interface WorkingTurn {
  key: string;
  agentId: string;
  start: number;
  end: number | null;
  origin: TraceMessageOrigin;
  title?: string;
  output?: string;
  error?: string;
  failed: boolean;
  userMessageId?: string;
  assistantMessageId?: string;
  /** The daemon's turn correlation id from the prompt row, when it has one. */
  turnId?: string;
  tools: WorkingTool[];
  usage?: TraceUsage;
  /** Built from tool calls alone (no turn rows loaded yet, or a wake turn). */
  synthetic?: boolean;
  /** A reply whose prompt row was not recorded, so when it started is unknown. */
  startUnknown?: boolean;
  /** Further messages folded into an unprompted turn, for matching their tool calls. */
  extraMessageIds?: string[];
}

/** Turns with no idle gap longer than `BURST_GAP_MS` between them. */
interface Burst {
  start: number;
  end: number;
  turns: WorkingTurn[];
}

function byStart<T extends { start: number }>(a: T, b: T): number {
  return a.start - b.start;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function buildTurns(
  messages: readonly TraceMessageRecord[],
  failures: readonly TraceFailureRecord[],
): Map<string, WorkingTurn[]> {
  const turnsByAgent = new Map<string, WorkingTurn[]>();
  const open = new Map<string, WorkingTurn>();
  const push = (turn: WorkingTurn) => {
    const list = turnsByAgent.get(turn.agentId);
    if (list) list.push(turn);
    else turnsByAgent.set(turn.agentId, [turn]);
  };
  const ordered: (TraceMessageRecord | TraceFailureRecord)[] = [...messages, ...failures].sort(
    (a, b) => a.ts - b.ts,
  );
  for (const record of ordered) {
    const current = open.get(record.agentId);
    if (record.kind === 'failure') {
      if (current) {
        current.end = record.ts;
        current.failed = true;
        current.error = record.error || undefined;
        open.delete(record.agentId);
        push(current);
        continue;
      }
      const list = turnsByAgent.get(record.agentId);
      const last = list?.[list.length - 1];
      if (last && last.end !== null && last.end + FAILURE_TURN_TOLERANCE_MS >= record.ts) {
        last.failed = true;
        last.error = record.error || last.error;
        continue;
      }
      push({
        key: `turn:${record.agentId}:${record.id}`,
        agentId: record.agentId,
        start: record.ts,
        end: record.ts,
        origin: 'system',
        failed: true,
        error: record.error || undefined,
        tools: [],
      });
      continue;
    }
    if (record.role === 'user') {
      if (current) {
        // Queued messages drained into one turn share its turn id.
        if (record.turnId === current.turnId) {
          current.title ??= record.text;
          continue;
        }
        // A row of another turn: the open one never got a reply (an appended
        // row, or an interrupted prompt). It ends here instead of absorbing
        // this prompt; settling fits its end to its own activity.
        open.delete(record.agentId);
        push(current);
      }
      open.set(record.agentId, {
        key: `turn:${record.agentId}:${record.id}`,
        agentId: record.agentId,
        start: record.ts,
        end: null,
        origin: record.origin,
        title: record.text,
        userMessageId: record.messageId,
        turnId: record.turnId,
        failed: false,
        tools: [],
      });
      continue;
    }
    if (current) {
      current.end = record.ts;
      current.output = record.text;
      current.assistantMessageId = record.messageId;
      open.delete(record.agentId);
      push(current);
    } else {
      // Agent-initiated (wake) turn, or its user row is outside the history.
      const list = turnsByAgent.get(record.agentId);
      const last = list?.[list.length - 1];
      if (last?.startUnknown && last.end !== null && record.ts - last.end <= AUTO_TURN_JOIN_MS) {
        last.end = record.ts;
        last.output = record.text ?? last.output;
        (last.extraMessageIds ??= []).push(record.messageId);
        continue;
      }
      push({
        key: `turn:${record.agentId}:${record.id}`,
        agentId: record.agentId,
        start: record.ts,
        end: record.ts,
        origin: 'system',
        output: record.text,
        assistantMessageId: record.messageId,
        failed: false,
        tools: [],
        startUnknown: true,
      });
    }
  }
  for (const turn of open.values()) push(turn);
  for (const list of turnsByAgent.values()) list.sort(byStart);
  return turnsByAgent;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Tool call ids are unique only within one agent's session. */
function toolKey(agentId: string, toolCallId: string): string {
  return `${agentId}:${toolCallId}`;
}

function buildTools(records: readonly TraceToolRecord[]): WorkingTool[] {
  const byCall = new Map<string, WorkingTool>();
  for (const record of records) {
    const terminal = record.status === 'completed' || record.status === 'error';
    const key = toolKey(record.agentId, record.toolCallId);
    let tool = byCall.get(key);
    if (!tool) {
      tool = {
        toolCallId: record.toolCallId,
        agentId: record.agentId,
        messageId: record.messageId,
        start: record.ts,
        end: null,
        failed: false,
        title: record.title,
        toolName: record.toolName,
        toolKind: record.toolKind,
        input: record.input,
      };
      byCall.set(key, tool);
    } else {
      tool.messageId ??= record.messageId;
      if (record.title) tool.title = record.title;
      if (record.toolName) tool.toolName = record.toolName;
      if (record.toolKind && record.toolKind !== 'other') tool.toolKind = record.toolKind;
      else tool.toolKind ??= record.toolKind;
      if (record.input) tool.input = record.input;
    }
    if (terminal) {
      if (tool.end === null || record.ts > tool.end) tool.end = record.ts;
      if (record.status === 'error') tool.failed = true;
      if (record.output) tool.output = record.output;
    }
  }
  return [...byCall.values()].sort(byStart);
}

function attachTools(tools: readonly WorkingTool[], turnsByAgent: Map<string, WorkingTurn[]>) {
  const byMessage = new Map<string, WorkingTurn>();
  for (const list of turnsByAgent.values()) {
    for (const turn of list) {
      if (turn.assistantMessageId) byMessage.set(turn.assistantMessageId, turn);
      for (const messageId of turn.extraMessageIds ?? []) byMessage.set(messageId, turn);
    }
  }
  const orphans = new Map<string, WorkingTool[]>();
  for (const tool of tools) {
    let turn = tool.messageId ? byMessage.get(tool.messageId) : undefined;
    if (!turn) {
      const list = turnsByAgent.get(tool.agentId) ?? [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const candidate = list[i];
        if (candidate.start - TOOL_TURN_TOLERANCE_MS > tool.start) continue;
        if (candidate.end === null || candidate.end + TOOL_TURN_TOLERANCE_MS >= tool.start) {
          turn = candidate;
        }
        break;
      }
    }
    if (turn && turn.agentId === tool.agentId) {
      turn.tools.push(tool);
      continue;
    }
    const list = orphans.get(tool.agentId);
    if (list) list.push(tool);
    else orphans.set(tool.agentId, [tool]);
  }

  // Tool calls without a known turn form synthetic turns, split at gaps.
  for (const [agentId, list] of orphans) {
    let current: WorkingTurn | undefined;
    const turns = turnsByAgent.get(agentId) ?? [];
    for (const tool of list) {
      const toolEnd = tool.end ?? tool.start;
      if (current && tool.start <= (current.end ?? current.start) + BURST_GAP_MS) {
        current.tools.push(tool);
        current.end = Math.max(current.end ?? current.start, toolEnd);
        continue;
      }
      current = {
        key: `turn:${agentId}:${tool.toolCallId}`,
        agentId,
        start: tool.start,
        end: toolEnd,
        origin: 'system',
        failed: false,
        tools: [tool],
        synthetic: true,
      };
      turns.push(current);
    }
    turns.sort(byStart);
    turnsByAgent.set(agentId, turns);
  }
}

/** Fit each turn around its tools and settle open ends. */
function settleTurns(
  turnsByAgent: Map<string, WorkingTurn[]>,
  activeAgents: ReadonlySet<string>,
): void {
  for (const [agentId, turns] of turnsByAgent) {
    const active = activeAgents.has(agentId);
    turns.forEach((turn, index) => {
      turn.tools.sort(byStart);
      for (const tool of turn.tools) {
        if (tool.start < turn.start) turn.start = tool.start;
      }
      const isLatest = index === turns.length - 1;
      // Tool calls of a turn whose rows are not persisted yet (a wake turn).
      if (active && isLatest && turn.synthetic) turn.end = null;
      if (turn.end === null && !(active && isLatest)) {
        // Interrupted, or its end is outside the loaded history.
        let lastActivity = turn.start;
        for (const tool of turn.tools)
          lastActivity = Math.max(lastActivity, tool.end ?? tool.start);
        const next = turns[index + 1];
        turn.end = next ? Math.min(Math.max(lastActivity, turn.start), next.start) : lastActivity;
      }
      for (const tool of turn.tools) {
        if (tool.end === null && turn.end !== null) tool.end = Math.max(tool.start, turn.end);
        if (turn.end !== null && tool.end !== null && tool.end > turn.end) turn.end = tool.end;
      }
    });
    turns.sort(byStart);
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

type UsagePoint = { ts: number; totals: TraceUsageTotals };

function usageSeries(snapshots: readonly TraceUsageRecord[]) {
  const sorted = [...snapshots].sort((a, b) => a.ts - b.ts);
  /** Cumulative totals of `agentId` at `ts`; undefined before any snapshot. */
  return (agentId: string, ts: number): UsagePoint | undefined => {
    let lo = 0;
    let hi = sorted.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].ts <= ts) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return undefined;
    const snapshot = sorted[found];
    return { ts: snapshot.ts, totals: snapshot.byAgent[agentId] ?? { tokensIn: 0, tokensOut: 0 } };
  };
}

function usageDelta(from: TraceUsageTotals, to: TraceUsageTotals): TraceUsage | undefined {
  const tokensIn = Math.max(0, to.tokensIn - from.tokensIn);
  const tokensOut = Math.max(0, to.tokensOut - from.tokensOut);
  let cost: TraceUsage['cost'];
  if (to.cost) {
    if (!from.cost) cost = to.cost;
    else if (from.cost.currency === to.cost.currency) {
      cost = { amount: Math.max(0, to.cost.amount - from.cost.amount), currency: to.cost.currency };
    }
  }
  if (tokensIn === 0 && tokensOut === 0 && !(cost && cost.amount > 0)) return undefined;
  return { tokensIn, tokensOut, ...(cost && cost.amount > 0 ? { cost } : {}) };
}

function applyUsage(
  turnsByAgent: Map<string, WorkingTurn[]>,
  snapshots: readonly TraceUsageRecord[],
): void {
  if (snapshots.length === 0) return;
  const at = usageSeries(snapshots);
  for (const [agentId, turns] of turnsByAgent) {
    turns.forEach((turn, index) => {
      const from = at(agentId, turn.start - 1);
      if (!from) return;
      // Usage snapshots are detached and can land minutes after a turn ends;
      // everything the agent spends before its next turn belongs to this one.
      const next = turns[index + 1];
      const to = at(agentId, next ? next.start - 1 : Infinity);
      if (!to || to.ts < turn.start) return;
      turn.usage = usageDelta(from.totals, to.totals);
    });
  }
}

function addUsage(a: TraceUsage | undefined, b: TraceUsage | undefined): TraceUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  let cost = a.cost ?? b.cost;
  if (a.cost && b.cost) {
    cost =
      a.cost.currency === b.cost.currency
        ? { amount: a.cost.amount + b.cost.amount, currency: a.cost.currency }
        : a.cost.amount >= b.cost.amount
          ? a.cost
          : b.cost;
  }
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    ...(cost ? { cost } : {}),
  };
}

// ---------------------------------------------------------------------------
// Spans
// ---------------------------------------------------------------------------

function statusOf(end: number | null, failed: boolean): TraceSpanStatus {
  if (end === null) return 'running';
  return failed ? 'failed' : 'done';
}

function maxEnd(spans: readonly { end: number | null }[], floor: number): number | null {
  let end = floor;
  for (const span of spans) {
    if (span.end === null) return null;
    end = Math.max(end, span.end);
  }
  return end;
}

function compactSegments(segments: TraceSegment[], span: number): TraceSegment[] {
  if (segments.length <= MAX_SEGMENTS) return segments;
  const sorted = [...segments].sort(byStart);
  const join = Math.max(1, span / MAX_SEGMENTS);
  const out: TraceSegment[] = [];
  for (const segment of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.kind === segment.kind &&
      last.failed === segment.failed &&
      last.end !== null &&
      segment.start - last.end <= join
    ) {
      last.end = segment.end === null ? null : Math.max(last.end, segment.end);
      continue;
    }
    out.push({ ...segment });
  }
  return out;
}

/** Where a turn starts in the chat: its prompt, else its first reply or tool call. */
function turnMessageId(turn: WorkingTurn): string | undefined {
  return (
    turn.userMessageId ??
    turn.assistantMessageId ??
    turn.tools.find((tool) => tool.messageId)?.messageId
  );
}

function toolSpan(tool: WorkingTool, turn: WorkingTurn): TraceSpan {
  return {
    id: `tool:${toolKey(tool.agentId, tool.toolCallId)}`,
    kind: 'tool',
    agentId: tool.agentId,
    name: tool.title || tool.toolName,
    detail: tool.toolKind,
    start: tool.start,
    end: tool.end,
    status: statusOf(tool.end, tool.failed),
    children: [],
    descendantCount: 0,
    segments: [],
    ...(tool.failed ? { error: tool.output } : { output: tool.output }),
    toolName: tool.toolName,
    toolKind: tool.toolKind,
    toolInput: tool.input,
    turnId: turn.key,
    messageId: tool.messageId ?? turn.assistantMessageId ?? turnMessageId(turn),
    toolCallId: tool.toolCallId,
  };
}

function turnSegments(turn: WorkingTurn): TraceSegment[] {
  return [
    { kind: 'turn', start: turn.start, end: turn.end, failed: turn.failed },
    ...turn.tools.map((tool) => ({
      kind: 'tool' as const,
      start: tool.start,
      end: tool.end,
      failed: tool.failed,
    })),
  ];
}

function turnSpan(turn: WorkingTurn, model: string | undefined): TraceSpan {
  const tools = turn.tools.map((tool) => toolSpan(tool, turn));
  return {
    id: turn.key,
    kind: 'turn',
    agentId: turn.agentId,
    name: turn.title ?? '',
    detail: model,
    start: turn.start,
    end: turn.end,
    status: statusOf(turn.end, turn.failed),
    children: tools,
    descendantCount: tools.length,
    segments: turn.tools.map((tool) => ({
      kind: 'tool' as const,
      start: tool.start,
      end: tool.end,
      failed: tool.failed,
    })),
    usage: turn.usage,
    input: turn.title,
    output: turn.output,
    // Only the turn's own failure: a failed tool call keeps its error on its
    // own row, and the turn's reply stays readable in its details.
    error: turn.error,
    origin: turn.origin,
    toolCount: tools.length,
    messageId: turnMessageId(turn),
    ...(turn.startUnknown && turn.end === turn.start ? { startUnknown: true } : {}),
  };
}

interface TreeContext {
  infos: Map<string, TraceAgentInfo>;
  turnsByAgent: Map<string, WorkingTurn[]>;
  childrenOf: Map<string, string[]>;
  fallbackNames: Record<string, string>;
  fallbackModels: Record<string, string>;
  traceStart: number;
  activeMs: number;
}

function agentSpan(agentId: string, ctx: TreeContext, seen: Set<string>): TraceSpan {
  seen.add(agentId);
  const info = ctx.infos.get(agentId);
  const model = info?.model || ctx.fallbackModels[agentId];
  const turns = ctx.turnsByAgent.get(agentId) ?? [];
  const childAgents = (ctx.childrenOf.get(agentId) ?? [])
    .filter((childId) => !seen.has(childId))
    .map((childId) => agentSpan(childId, ctx, seen));

  const ownSpans: TraceSpan[] =
    turns.length === 1
      ? turns[0].tools.map((tool) => toolSpan(tool, turns[0]))
      : turns.map((turn) => turnSpan(turn, model));
  const children = [...ownSpans, ...childAgents].sort(byStart);

  const starts = [...turns.map((turn) => turn.start), ...childAgents.map((child) => child.start)];
  const start = starts.length > 0 ? starts.reduce((a, b) => Math.min(a, b)) : ctx.traceStart;
  const end = maxEnd([...turns, ...childAgents], start);
  const ownFailed = turns.some((turn) => turn.failed);

  let usage: TraceUsage | undefined;
  for (const turn of turns) usage = addUsage(usage, turn.usage);
  for (const child of childAgents) usage = addUsage(usage, child.usage);

  // Turns first, so tool calls paint over the turns that contain them.
  const segments = compactSegments(
    [...turns.flatMap(turnSegments), ...childAgents.flatMap((child) => child.segments)],
    ctx.activeMs,
  ).sort((a, b) => Number(a.kind === 'tool') - Number(b.kind === 'tool'));
  const only = turns.length === 1 ? turns[0] : undefined;
  const lastTurn = turns[turns.length - 1];
  const failedTurn = turns.find((turn) => turn.failed);
  const toolCount = turns.reduce((sum, turn) => sum + turn.tools.length, 0);
  return {
    id: `agent:${agentId}`,
    kind: 'agent',
    agentId,
    name: info?.name || ctx.fallbackNames[agentId] || '',
    detail: model,
    start,
    end,
    status: statusOf(end, ownFailed),
    children,
    descendantCount: children.reduce((sum, child) => sum + 1 + child.descendantCount, 0),
    segments,
    usage,
    input: turns[0]?.title,
    output: lastTurn?.output ?? (turns.length > 0 ? info?.lastResponse : undefined),
    error: failedTurn?.error,
    contextOnly: turns.length === 0,
    isSubAgent: Boolean(info?.parentId),
    origin: only?.origin ?? turns[0]?.origin,
    toolCount,
    turnCount: turns.length,
    // An agent with one turn is that turn; with more, its chat opens at the end.
    messageId: only ? turnMessageId(only) : undefined,
  };
}

function assembleTrace(
  bursts: readonly Burst[],
  turnsByAgent: Map<string, WorkingTurn[]>,
  infos: Map<string, TraceAgentInfo>,
  fallbackNames: Record<string, string>,
  fallbackModels: Record<string, string>,
  now: number,
): Trace {
  const turns = bursts.flatMap((burst) => burst.turns);
  const windows = bursts.map((burst) => ({
    start: burst.start,
    end: burst.turns.some((turn) => turn.end === null) ? null : burst.end,
  }));
  const activeMs = windows.reduce((sum, window) => sum + (window.end ?? now) - window.start, 0);

  // Agents with turns, plus their known ancestors as context rows.
  const included = new Set(turnsByAgent.keys());
  for (const agentId of [...included]) {
    const chain = new Set<string>([agentId]);
    let parentId = infos.get(agentId)?.parentId ?? null;
    while (parentId && infos.has(parentId) && !chain.has(parentId)) {
      chain.add(parentId);
      included.add(parentId);
      parentId = infos.get(parentId)?.parentId ?? null;
    }
  }

  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const agentId of included) {
    const parentId = infos.get(agentId)?.parentId ?? null;
    if (parentId && included.has(parentId) && parentId !== agentId) {
      const list = childrenOf.get(parentId);
      if (list) list.push(agentId);
      else childrenOf.set(parentId, [agentId]);
    } else roots.push(agentId);
  }

  const live = turns.some((turn) => turn.end === null);
  const ctx: TreeContext = {
    infos,
    turnsByAgent,
    childrenOf,
    fallbackNames,
    fallbackModels,
    traceStart: bursts[0].start,
    activeMs: Math.max(1, activeMs),
  };
  const seen = new Set<string>();
  const rootSpans = roots.map((agentId) => agentSpan(agentId, ctx, seen));
  // A parent loop leaves agents unreached from any root; show them as roots.
  for (const agentId of included) {
    if (!seen.has(agentId)) rootSpans.push(agentSpan(agentId, ctx, seen));
  }
  rootSpans.sort(byStart);

  let usage: TraceUsage | undefined;
  let toolCalls = 0;
  let errors = 0;
  for (const turn of turns) {
    usage = addUsage(usage, turn.usage);
    toolCalls += turn.tools.length;
    errors += (turn.failed ? 1 : 0) + turn.tools.filter((tool) => tool.failed).length;
  }

  return {
    start: bursts[0].start,
    end: live ? null : bursts[bursts.length - 1].end,
    windows,
    live,
    roots: rootSpans,
    stats: {
      agents: turnsByAgent.size,
      turns: turns.length,
      toolCalls,
      errors,
      usage,
    },
  };
}

/** The timeline of all loaded activity; `null` until there is a turn. */
export function buildTrace(input: BuildTraceInput): Trace | null {
  const { records, agents, names, now } = input;
  const messages: TraceMessageRecord[] = [];
  const tools: TraceToolRecord[] = [];
  const failures: TraceFailureRecord[] = [];
  const snapshots: TraceUsageRecord[] = [];
  for (const record of records) {
    if (record.kind === 'message') messages.push(record);
    else if (record.kind === 'tool') tools.push(record);
    else if (record.kind === 'failure') failures.push(record);
    else snapshots.push(record);
  }
  tools.sort((a, b) => a.ts - b.ts);

  const infos = new Map(agents.map((agent) => [agent.id, agent]));
  const active = new Set(agents.filter((agent) => agent.active).map((agent) => agent.id));
  // Usage snapshots name agents and models even when no session is loaded; newest wins.
  const fallbackNames: Record<string, string> = {};
  const fallbackModels: Record<string, string> = {};
  for (const snapshot of [...snapshots].sort((a, b) => a.ts - b.ts)) {
    Object.assign(fallbackNames, snapshot.agentNames ?? {});
    Object.assign(fallbackModels, snapshot.agentModels ?? {});
  }
  Object.assign(fallbackNames, names ?? {});

  const turnsByAgent = buildTurns(messages, failures);
  attachTools(buildTools(tools), turnsByAgent);
  settleTurns(turnsByAgent, active);
  applyUsage(turnsByAgent, snapshots);

  const allTurns = [...turnsByAgent.values()].flat().sort(byStart);
  const bursts: Burst[] = [];
  let current: Burst | undefined;
  for (const turn of allTurns) {
    const turnEnd = turn.end ?? now;
    if (current && turn.start <= current.end + BURST_GAP_MS) {
      current.end = Math.max(current.end, turnEnd);
      current.turns.push(turn);
      continue;
    }
    current = { start: turn.start, end: turnEnd, turns: [turn] };
    bursts.push(current);
  }

  if (bursts.length === 0) return null;
  return assembleTrace(bursts, turnsByAgent, infos, fallbackNames, fallbackModels, now);
}
