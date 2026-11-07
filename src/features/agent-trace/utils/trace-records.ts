/**
 * Daemon event → `TraceRecord`.
 *
 * Keeps only what the trace draws so a long run stays small in the store:
 * previews are capped, tool inputs keep a bounded shallow copy (enough for the
 * chat tool classifier), and usage snapshots keep per-agent totals only.
 */
import type { WorkspaceEvent } from '$features/events/types';
import type { TokenUsageTotals } from '$features/token-usage/token-usage-types';
import type { TraceMessageOrigin, TraceRecord, TraceUsageTotals } from '../trace-types';

/** Event types the trace reads, for `event.query` and `events.subscribe`. */
export const TRACE_EVENT_TYPES = [
  'agent:last-message',
  'agent:tool:call',
  'agent:failed',
  'workspace:tokenUsage-changed',
] as const;

const TEXT_PREVIEW_CHARS = 600;
const INPUT_VALUE_CHARS = 400;
const INPUT_ARRAY_ITEMS = 12;
const INPUT_KEYS = 24;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function previewText(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  return text === undefined ? undefined : cap(text.trim(), TEXT_PREVIEW_CHARS);
}

function boundedValue(value: unknown): unknown {
  if (typeof value === 'string') return cap(value, INPUT_VALUE_CHARS);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, INPUT_ARRAY_ITEMS)
      .map((item) =>
        typeof item === 'object' && item !== null
          ? cap(JSON.stringify(item), INPUT_VALUE_CHARS)
          : boundedValue(item),
      );
  }
  if (typeof value === 'object' && value !== undefined) {
    return cap(JSON.stringify(value), INPUT_VALUE_CHARS);
  }
  return undefined;
}

/**
 * The persisted-row cap marker (§5.10): an over-cap `agent:tool:call` row has
 * its free-form fields replaced by `{ truncated: true, originalBytes, preview }`.
 */
function isCappedField(record: Record<string, unknown>): boolean {
  return record.truncated === true && 'preview' in record;
}

/**
 * Bounded shallow copy: the keys the tool classifier reads survive intact. A
 * capped input carries no keys, so it is dropped and the call keeps the input
 * of its other updates.
 */
function boundToolInput(input: unknown): Record<string, unknown> | undefined {
  const record = asRecord(input);
  if (!record || isCappedField(record)) return undefined;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(record)) {
    if (kept >= INPUT_KEYS) break;
    const bounded = boundedValue(value);
    if (bounded === undefined) continue;
    out[key] = bounded;
    kept += 1;
  }
  return kept > 0 ? out : undefined;
}

/** Text of a tool output: a string, MCP text items, or `{ output }`. */
function toolOutputText(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output === 'string') return previewText(output);
  if (Array.isArray(output)) {
    const parts = output
      .map((item) => {
        const record = asRecord(item);
        return nonEmptyString(record?.text) ?? nonEmptyString(record?.content);
      })
      .filter((part): part is string => part !== undefined);
    return parts.length > 0 ? previewText(parts.join('\n')) : undefined;
  }
  const record = asRecord(output);
  if (record) {
    const nested =
      nonEmptyString(record.output) ??
      nonEmptyString(record.preview) ??
      nonEmptyString(record.error) ??
      nonEmptyString(record.text);
    if (nested) return previewText(nested);
  }
  return previewText(JSON.stringify(output));
}

function originOf(event: WorkspaceEvent): TraceMessageOrigin {
  const actorType = (event.actor as { type?: string } | undefined)?.type;
  if (actorType === 'user') return 'human';
  if (actorType === 'agent') return 'agent';
  return 'system';
}

function usageTotals(totals: TokenUsageTotals | undefined): TraceUsageTotals | undefined {
  if (!totals) return undefined;
  const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    tokensIn: n(totals.inputTokens) + n(totals.cacheReadTokens) + n(totals.cacheCreationTokens),
    tokensOut: n(totals.outputTokens) + n(totals.thoughtTokens),
    ...(totals.cost ? { cost: totals.cost } : {}),
  };
}

/**
 * Normalize one daemon event. Returns `null` for other types and malformed
 * payloads. A row the §5.10 response budget trimmed keeps its short fields,
 * except usage snapshots: trimmed totals would be wrong, so they are dropped.
 */
export function toTraceRecord(event: WorkspaceEvent): TraceRecord | null {
  if (!event || typeof event.id !== 'string') return null;
  const trimmed = (event as { truncated?: boolean }).truncated === true;
  const ts = Date.parse(event.timestamp);
  if (!Number.isFinite(ts)) return null;
  const data = asRecord(event.data);
  if (!data) return null;
  const type = event.type as string;

  if (type === 'agent:last-message') {
    const agentId = nonEmptyString(data.agentId);
    const messageId = nonEmptyString(data.messageId);
    const role = data.role;
    if (!agentId || !messageId || (role !== 'user' && role !== 'assistant')) return null;
    return {
      id: event.id,
      ts,
      kind: 'message',
      agentId,
      role,
      messageId,
      turnId: nonEmptyString(data.turnId),
      origin: originOf(event),
      text: previewText(role === 'user' ? data.lastUserMessage : data.lastAgentResponse),
    };
  }

  if (type === 'agent:tool:call') {
    const agentId = nonEmptyString(data.agentId);
    const toolCallId = nonEmptyString(data.toolCallId);
    if (!agentId || !toolCallId) return null;
    const status = nonEmptyString(data.status) ?? 'started';
    const terminal = status === 'completed' || status === 'error';
    return {
      id: event.id,
      ts,
      kind: 'tool',
      agentId,
      toolCallId,
      messageId: nonEmptyString(data.messageId),
      toolName: nonEmptyString(data.toolName) ?? '',
      title: nonEmptyString(data.title) ?? '',
      toolKind: nonEmptyString(data.toolKind),
      status,
      input: boundToolInput(data.input),
      output: terminal ? toolOutputText(data.output) : undefined,
    };
  }

  if (type === 'agent:failed') {
    const agentId = nonEmptyString(data.agentId);
    if (!agentId) return null;
    return {
      id: event.id,
      ts,
      kind: 'failure',
      agentId,
      turnId: nonEmptyString(data.turnId),
      error: previewText(data.error) ?? '',
    };
  }

  if (type === 'workspace:tokenUsage-changed') {
    if (trimmed) return null;
    const usage = asRecord(data.tokenUsage);
    const byAgentId = asRecord(usage?.byAgentId);
    if (!byAgentId) return null;
    const byAgent: Record<string, TraceUsageTotals> = {};
    for (const [agentId, totals] of Object.entries(byAgentId)) {
      const converted = usageTotals(asRecord(totals) as TokenUsageTotals | undefined);
      if (converted) byAgent[agentId] = converted;
    }
    const names = asRecord(usage?.agentNames);
    const agentNames: Record<string, string> = {};
    for (const [agentId, name] of Object.entries(names ?? {})) {
      if (typeof name === 'string' && name.trim().length > 0) agentNames[agentId] = name;
    }
    const agentModels: Record<string, string> = {};
    const modelTokens: Record<string, number> = {};
    for (const row of Array.isArray(usage?.byAgentModel) ? usage.byAgentModel : []) {
      const cell = asRecord(row);
      const agentId = nonEmptyString(cell?.agentId);
      const model = nonEmptyString(cell?.model);
      if (!agentId || !model) continue;
      const totals = usageTotals(asRecord(cell?.totals) as TokenUsageTotals | undefined);
      const tokens = totals ? totals.tokensIn + totals.tokensOut : 0;
      if (agentModels[agentId] === undefined || tokens > (modelTokens[agentId] ?? 0)) {
        agentModels[agentId] = model;
        modelTokens[agentId] = tokens;
      }
    }
    return {
      id: event.id,
      ts,
      kind: 'usage',
      byAgent,
      ...(Object.keys(agentNames).length > 0 ? { agentNames } : {}),
      ...(Object.keys(agentModels).length > 0 ? { agentModels } : {}),
    };
  }

  return null;
}
