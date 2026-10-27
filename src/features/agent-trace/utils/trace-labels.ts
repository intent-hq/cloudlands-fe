/**
 * Row labels and icons for trace spans. Tool rows reuse the chat's tool
 * classifier so a tool reads the same in the trace and in the transcript.
 */
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBolt, faComment, faRobot, faWrench } from '@fortawesome/free-solid-svg-icons';
import { formatInteger } from '$lib/i18n/format';
import { classifyTool, cleanToolName, isRawMcpName } from '$lib/utils/tool-classifier';
import { stripMarkdownFormatting } from '$shared/utils-client';
import { m } from '$shared/paraglide/messages.js';
import type { TraceSpan } from '../trace-types';

interface TraceSpanLabel {
  name: string;
  detail?: string;
  icon?: IconDefinition;
}

/** MCP server ids read as names: `stripe` → `Stripe`. */
function sourceLabel(source: string | undefined): string | undefined {
  if (!source) return undefined;
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Prompts and replies are markdown; a row shows them as plain text. */
function plainLine(text: string | undefined): string {
  return oneLine(stripMarkdownFormatting(text ?? ''));
}

function turnFallback(span: TraceSpan): string {
  if (span.origin === 'human') return m.agentTrace_turn_human_label();
  if (span.origin === 'agent') return m.agentTrace_turn_agent_label();
  return m.agentTrace_turn_system_label();
}

function turnIcon(span: TraceSpan): IconDefinition {
  if (span.origin === 'human') return faComment;
  if (span.origin === 'agent') return faRobot;
  return faBolt;
}

function toolLabel(span: TraceSpan): TraceSpanLabel {
  const input = { ...(span.toolInput ?? {}) };
  if (span.name && input._acpTitle === undefined) input._acpTitle = span.name;
  const display = classifyTool(span.toolName || span.name, input);
  if (!display.hidden) {
    const name = oneLine(display.subject ? `${display.verb} ${display.subject}` : display.verb);
    if (name) return { name, detail: sourceLabel(display.mcpSource), icon: display.icon };
  }
  const cleaned = oneLine(span.name || cleanToolName(span.toolName));
  return {
    name: cleaned && !isRawMcpName(cleaned) ? cleaned : m.agentTrace_tool_fallback_label(),
    icon: display.icon ?? faWrench,
  };
}

export function spanLabel(span: TraceSpan): TraceSpanLabel {
  if (span.kind === 'tool') return toolLabel(span);
  if (span.kind === 'turn') {
    // An unprompted turn has no prompt to show; its last message says what it did.
    const name = plainLine(span.name) || plainLine(span.output) || turnFallback(span);
    return { name, icon: turnIcon(span) };
  }
  return { name: oneLine(span.name) || m.agentTrace_agent_fallback_label(), detail: span.detail };
}

/** Kind line of the details card: `Sub-agent · Opus 5.5`, `Tool call · Figma`. */
export function spanKindLabel(span: TraceSpan, label: TraceSpanLabel): string {
  const kind =
    span.kind === 'agent'
      ? span.isSubAgent
        ? m.agentTrace_kind_subAgent_label()
        : m.agentTrace_kind_agent_label()
      : span.kind === 'turn'
        ? m.agentTrace_kind_turn_label()
        : m.agentTrace_kind_tool_label();
  const detail = label.detail ?? (span.kind === 'turn' ? span.detail : undefined);
  return detail ? m.agentTrace_kind_withDetail_label({ kind, detail }) : kind;
}

const INPUT_PREVIEW_KEYS = [
  'command',
  'cmd',
  'summary',
  'description',
  'prompt',
  'query',
  'pattern',
  'url',
  'path',
  'file_path',
  'filePath',
  'target',
] as const;

/** A readable one-field preview of a tool input. */
export function toolInputPreview(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of INPUT_PREVIEW_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  const rest = Object.fromEntries(Object.entries(input).filter(([key]) => !key.startsWith('_')));
  return Object.keys(rest).length > 0 ? JSON.stringify(rest) : undefined;
}

/** `4 agents`, `1 tool call`, `2 errors` for the run summary line. */
export function pluralLabel(count: number, noun: 'agents' | 'toolCalls' | 'errors'): string {
  const params = { count: formatInteger(count) };
  const one = count === 1;
  if (noun === 'agents') {
    return one ? m.agentTrace_summary_agents_one(params) : m.agentTrace_summary_agents_many(params);
  }
  if (noun === 'toolCalls') {
    return one
      ? m.agentTrace_summary_toolCalls_one(params)
      : m.agentTrace_summary_toolCalls_many(params);
  }
  return one ? m.agentTrace_summary_errors_one(params) : m.agentTrace_summary_errors_many(params);
}
