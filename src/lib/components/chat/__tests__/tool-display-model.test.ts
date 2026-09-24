import { faWrench } from '@fortawesome/free-solid-svg-icons';
import { describe, expect, it } from 'vitest';
import type { ToolCategory, ToolDisplay } from '$lib/utils/tool-classifier';
import {
  buildToolDisplayModel,
  isOkOnlyResult,
  sanitizeMultilineToolText,
  sanitizeToolPayload,
} from '../tool-display-model';

const display = (category: ToolCategory, verb = 'Inspect', subject = 'target'): ToolDisplay => ({
  category,
  icon: faWrench,
  verb,
  subject,
  path: null,
});

const model = (
  toolDisplay: ToolDisplay,
  input: Record<string, any> = {},
  result: unknown = 'meaningful output',
  toolName = 'known-tool',
) =>
  buildToolDisplayModel({
    toolName,
    display: toolDisplay,
    input,
    result,
    toolState: 'completed',
  });

describe('compact tool display model', () => {
  it.each<ToolCategory>([
    'file-read',
    'file-write',
    'file-delete',
    'terminal',
    'search',
    'context-engine',
    'api',
    'workspace',
    'note',
    'meta',
    'agent',
    'task',
    'browser',
    'generic',
  ])('builds one natural sentence for known %s tools and the generic fallback', (category) => {
    const result = model(display(category));
    expect(result.sentence).toBeTruthy();
    expect(result.sentence).not.toMatch(/[·|]/);
    expect(result.accessibleSentence).toBeTruthy();
  });

  it('uses filename-first visible text while preserving the complete path accessibly', () => {
    const result = model(
      {
        ...display('file-read', 'Read', 'tool-classifier.ts:1-120'),
        filePath: '/Users/example/repository/src/lib/components/chat/tool-classifier.ts',
        path: '/Users/example/repository/src/lib/components/chat',
      },
      { view_range: [1, 120] },
    );
    expect(result.sentence).toBe('Read tool-classifier.ts lines 1–120');
    expect(result.sentenceSegments).toEqual([
      { kind: 'primary', text: 'Read' },
      { kind: 'secondary', text: ' ' },
      { kind: 'file', text: 'tool-classifier.ts' },
      { kind: 'secondary', text: ' lines 1–120' },
    ]);
    expect(result.accessibleSentence).toContain(
      '/Users/example/repository/src/lib/components/chat/tool-classifier.ts',
    );
  });

  it('uses natural search and context-engine grammar', () => {
    const fileSearch = model(
      { ...display('file-read', 'Search', 'en.json'), path: 'packages/cloudlands-fe/messages' },
      { search_query_regex: 'chat_toolCall' },
    );
    expect(fileSearch.sentence).toBe('Search en.json in cloudlands-fe/messages');

    const context = model(display('context-engine', '', 'codebase'), {
      information_request: 'compact tool-call rendering',
    });
    expect(context.sentence).toBe('Search codebase for compact tool-call rendering');
  });

  it('renders task updates as a human result sentence', () => {
    const result = buildToolDisplayModel({
      toolName: 'update_tasks_workspace-mcp',
      display: {
        ...display('task', 'Mark', 'Editable focus guard complete'),
        mcpSource: 'workspace-mcp',
      },
      input: { tasks: [{ name: 'Editable focus guard', state: 'COMPLETE' }] },
      result: { ok: true },
      parsedResult: {
        type: 'task-update',
        taskTitle: 'Editable focus guard',
        taskStatus: 'complete',
      },
      toolState: 'completed',
    });
    expect(result.sentence).toBe('Task update: Editable focus guard marked complete');
    expect(result.status).toBe('success');
    expect(result.hasDetails).toBe(false);
  });

  it('suppresses only successful ok-only workspace mutation bodies', () => {
    expect(isOkOnlyResult({ ok: true })).toBe(true);
    expect(isOkOnlyResult({ output: 'ok: true' })).toBe(true);
    expect(isOkOnlyResult({ ok: true, value: 1 })).toBe(false);

    const workspace = model(
      display('workspace', 'Update', 'workspace status'),
      { code: 'return await ws.workspace.setStatusMessage("Ready")', summary: 'Update status' },
      { ok: true },
      'workspace_api',
    );
    expect(workspace.status).toBe('success');
    expect(workspace.hasDetails).toBe(false);

    expect(model(display('generic'), {}, { ok: true }).hasDetails).toBe(true);
  });

  it('exposes details for running tools with input so the pending call is inspectable', () => {
    const running = buildToolDisplayModel({
      toolName: 'launch-process',
      display: display('terminal', 'Run', 'pnpm test'),
      input: { command: 'pnpm test' },
      result: null,
      toolState: 'running',
    });
    expect(running.hasDetails).toBe(true);

    const runningNoInput = buildToolDisplayModel({
      toolName: 'launch-process',
      display: display('terminal', 'Run', 'command'),
      input: {},
      result: null,
      toolState: 'running',
    });
    expect(runningNoInput.hasDetails).toBe(false);
  });

  it('preserves newlines when sanitizing multiline tool text', () => {
    const command = 'cd repo && \\\n  API_KEY=abc123 pnpm test\n';
    expect(sanitizeMultilineToolText(command)).toBe(
      'cd repo && \\\n  API_KEY=[redacted] pnpm test',
    );
  });

  it('redacts secrets while preserving non-secret provenance', () => {
    expect(
      sanitizeToolPayload({
        command: 'curl -H "Authorization: Bearer abc123" https://example.test',
        apiKey: 'secret-value',
        path: '/repo/src/file.ts',
      }),
    ).toEqual({
      command: 'curl -H "Authorization: Bearer [redacted]" https://example.test',
      apiKey: '[redacted]',
      path: '/repo/src/file.ts',
    });
  });
});
