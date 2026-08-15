import { m } from '$shared/paraglide/messages.js';
import type { ParsedToolResult } from './tool-result-parser';
import type { ToolDisplay } from './tool-classifier';

export type ToolState = 'running' | 'completed' | 'error';

export interface CompactToolSentenceSegment {
  kind: 'text' | 'file';
  text: string;
}

export interface CompactToolDisplayModel {
  sentence: string;
  sentenceSegments: CompactToolSentenceSegment[];
  accessibleSentence: string;
  status: 'success' | 'error' | null;
  isOkOnlyWorkspaceResult: boolean;
  hasDetails: boolean;
}

const SECRET_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const WORKSPACE_MUTATION =
  /(?:^|_)(?:add|archive|assign|cancel|create|delete|edit|mark|remove|rename|respond|send|set|unarchive|update|write)(?:_|$)/i;

export function sanitizeToolText(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text
    .replace(/\b(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(
      /\b([A-Za-z0-9_-]*(?:token|secret|password|api[_-]?key)[A-Za-z0-9_-]*\s*[=:]\s*)[^\s"']+/gi,
      '$1[redacted]',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeToolPayload(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return sanitizeToolText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeToolPayload(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeToolPayload(child, childKey),
      ]),
    );
  }
  return value;
}

function resultText(result: unknown): string | null {
  if (typeof result === 'string') return sanitizeToolText(result);
  if (Array.isArray(result)) {
    const text = result
      .filter((item): item is { type: 'text'; text: string } =>
        Boolean(
          item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string',
        ),
      )
      .map((item) => item.text)
      .join('\n');
    return text ? sanitizeToolText(text) : null;
  }
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as { output?: unknown }).output === 'string'
  ) {
    return sanitizeToolText((result as { output: string }).output);
  }
  return null;
}

export function isOkOnlyResult(result: unknown): boolean {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const entries = Object.entries(result);
    if (entries.length === 1 && entries[0][0] === 'ok' && entries[0][1] === true) return true;
  }
  return /^\s*(?:\{\s*"?ok"?\s*:\s*true\s*\}|ok\s*:\s*true)\s*$/i.test(resultText(result) ?? '');
}

function isWorkspaceMutation(toolName: string, input: Record<string, any>, display: ToolDisplay) {
  const code = typeof input.code === 'string' ? input.code : '';
  const codeMutation =
    /ws\.[A-Za-z]+\.(?:add|archive|assign|cancel|create|delete|edit|mark|remove|rename|respond|send|set|unarchive|update|write)[A-Za-z]*\b/.test(
      code,
    );
  return (
    codeMutation ||
    ((display.mcpSource === 'workspace-mcp' || /workspace_api|workspace-mcp/i.test(toolName)) &&
      WORKSPACE_MUTATION.test(toolName.replace(/-/g, '_')))
  );
}

function fullSubject(display: ToolDisplay, input: Record<string, any>): string {
  if (display.category === 'terminal' && input.command) return sanitizeToolText(input.command);
  if (display.category === 'context-engine') {
    return sanitizeToolText(input.information_request || input.query || display.subject || '');
  }
  if (display.category === 'search') {
    return sanitizeToolText(
      input.information_request ||
        input.query ||
        input.pattern ||
        input.glob ||
        display.subject ||
        '',
    );
  }
  if (display.filePath) return sanitizeToolText(display.filePath);
  return sanitizeToolText(display.subject || '');
}

function compactSentence(
  display: ToolDisplay,
  input: Record<string, any>,
  parsed?: ParsedToolResult | null,
) {
  const action = sanitizeToolText(display.verb);
  const subject = sanitizeToolText(display.subject || '');
  const viewRange = input.view_range;
  const range = Array.isArray(viewRange) && viewRange.length >= 2 ? viewRange : null;
  if (display.category === 'file-read' && range) {
    const file = subject.replace(/:\d+-\d+$/, '');
    return m.chat_toolCall_fileLines_label({
      action,
      file,
      start: String(range[0]),
      end: String(range[1]),
    });
  }
  if (display.category === 'file-read' && input.search_query_regex && display.path) {
    const location = sanitizeToolText(display.path.split('/').filter(Boolean).slice(-2).join('/'));
    return m.chat_toolCall_fileIn_label({ action, file: subject, location });
  }
  if (display.category === 'context-engine') {
    const source = sanitizeToolText(display.subject?.split(':')[0] || '');
    const query = sanitizeToolText(input.information_request || input.query || '');
    return query
      ? m.chat_toolCall_contextSentence_label({ source, query })
      : [action, source].filter(Boolean).join(' ');
  }
  if (parsed?.type === 'task-update' && parsed.taskTitle && parsed.taskStatus) {
    return m.chat_toolCall_taskUpdateSentence_label({
      task: sanitizeToolText(parsed.taskTitle),
      status: sanitizeToolText(parsed.taskStatus),
    });
  }
  return [action, subject].filter(Boolean).join(' ');
}

function accessibleSentence(display: ToolDisplay, input: Record<string, any>, compact: string) {
  const full = fullSubject(display, input);
  if (!full || compact.includes(full)) return compact;
  const action = sanitizeToolText(display.verb);
  if (display.category === 'context-engine') {
    const source = sanitizeToolText(display.subject?.split(':')[0] || '');
    return m.chat_toolCall_contextSentence_label({ source, query: full });
  }
  if (display.category === 'file-read' && Array.isArray(input.view_range)) {
    return m.chat_toolCall_fileLines_label({
      action,
      file: full,
      start: String(input.view_range[0]),
      end: String(input.view_range[1]),
    });
  }
  return [action, full].filter(Boolean).join(' ');
}

function sentenceSegments(
  display: ToolDisplay,
  input: Record<string, any>,
  sentence: string,
): CompactToolSentenceSegment[] {
  if (!display.filePath || display.isDirectory) return [{ kind: 'text', text: sentence }];
  const subject = sanitizeToolText(display.subject || '');
  const file =
    display.category === 'file-read' && Array.isArray(input.view_range)
      ? subject.replace(/:\d+-\d+$/, '')
      : subject;
  const index = file ? sentence.indexOf(file) : -1;
  if (index < 0) return [{ kind: 'text', text: sentence }];
  return [
    { kind: 'text', text: sentence.slice(0, index) },
    { kind: 'file', text: file },
    { kind: 'text', text: sentence.slice(index + file.length) },
  ].filter((segment) => segment.text.length > 0) as CompactToolSentenceSegment[];
}

export function buildToolDisplayModel({
  toolName,
  display,
  input,
  result,
  parsedResult,
  toolState,
}: {
  toolName: string;
  display: ToolDisplay;
  input: Record<string, any>;
  result: unknown;
  parsedResult?: ParsedToolResult | null;
  toolState: ToolState;
}): CompactToolDisplayModel {
  const sentence = compactSentence(display, input, parsedResult);
  const okOnly = isOkOnlyResult(result) && isWorkspaceMutation(toolName, input, display);
  const hasPayload = result !== null && result !== undefined;
  const hasInput = Object.keys(input || {}).some((key) => !key.startsWith('_'));
  return {
    sentence,
    sentenceSegments: sentenceSegments(display, input, sentence),
    accessibleSentence: accessibleSentence(display, input, sentence),
    status:
      toolState === 'error' ? 'error' : okOnly && toolState === 'completed' ? 'success' : null,
    isOkOnlyWorkspaceResult: okOnly,
    hasDetails:
      toolState === 'error' || (!okOnly && toolState === 'completed' && (hasPayload || hasInput)),
  };
}
