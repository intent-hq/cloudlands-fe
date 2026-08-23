/**
 * Tool Result Parser Tests
 *
 * Tests that tool results are correctly parsed for display.
 */

import { describe, it, expect } from 'vitest';
import { parseToolResult } from '../tool-result-parser';

describe('tool-result-parser', () => {
  describe('terminal result parsing', () => {
    it('should parse terminal result with output', () => {
      const result = parseToolResult(
        'bash',
        { command: 'npm test' },
        'Test passed\n✓ All tests pass',
      );

      expect(result.type).toBe('terminal');
      expect(result.command).toBe('npm test');
      expect(result.content).toBe('Test passed\n✓ All tests pass');
    });

    it('should include command in content when result is empty', () => {
      const result = parseToolResult('bash', { command: 'npm test' }, '');

      expect(result.type).toBe('terminal');
      expect(result.command).toBe('npm test');
      expect(result.content).toBe('$ npm test');
    });

    it('should handle null result by including command', () => {
      const result = parseToolResult('bash', { command: 'npm test' }, null);

      expect(result.type).toBe('terminal');
      expect(result.command).toBe('npm test');
      expect(result.content).toBe('$ npm test');
    });

    it('should handle undefined result by including command', () => {
      const result = parseToolResult('bash', { command: 'npm test' }, undefined);

      expect(result.type).toBe('terminal');
      expect(result.command).toBe('npm test');
      expect(result.content).toBe('$ npm test');
    });

    it('should handle empty input gracefully', () => {
      const result = parseToolResult('bash', {}, '');

      expect(result.type).toBe('terminal');
      expect(result.command).toBeUndefined();
      expect(result.content).toBeUndefined();
    });

    it('should handle undefined input without crashing', () => {
      expect(() =>
        parseToolResult('workspace_api', undefined as unknown as Record<string, any>, 'ok'),
      ).not.toThrow();
    });

    it('should handle launch-process tool', () => {
      const result = parseToolResult(
        'launch-process',
        { command: 'npm run build' },
        'Build complete',
      );

      expect(result.type).toBe('terminal');
      expect(result.command).toBe('npm run build');
      expect(result.content).toBe('Build complete');
    });

    it('should parse XML-wrapped terminal result with return-code and output', () => {
      const xmlResult = `Here are the results from executing the command.\n<return-code>\n0\n</return-code>\n<output>\n# create-svelte! 🐕\n\n</output>`;
      const result = parseToolResult('launch-process', { command: 'head -1 README.md' }, xmlResult);

      expect(result.type).toBe('terminal');
      expect(result.command).toBe('head -1 README.md');
      expect(result.content).toBe('# create-svelte! 🐕');
      expect(result.exitCode).toBe(0);
    });

    it('should parse XML-wrapped terminal result with non-zero exit code', () => {
      const xmlResult = `Here are the results from executing the command.\n<return-code>\n1\n</return-code>\n<output>\ncommand not found: foo\n</output>`;
      const result = parseToolResult('bash', { command: 'foo' }, xmlResult);

      expect(result.type).toBe('terminal');
      expect(result.exitCode).toBe(1);
      expect(result.content).toBe('command not found: foo');
    });

    it('should parse XML-wrapped terminal result with empty output', () => {
      const xmlResult = `Here are the results from executing the command.\n<return-code>\n0\n</return-code>\n<output>\n\n</output>`;
      const result = parseToolResult('launch-process', { command: 'mkdir test' }, xmlResult);

      expect(result.type).toBe('terminal');
      expect(result.exitCode).toBe(0);
      // Empty output should fall back to showing the command
      expect(result.content).toBe('$ mkdir test');
    });

    it('should route ACP "Run" tool with command input to terminal parser', () => {
      const xmlResult = `Here are the results from executing the command.\n<return-code>\n0\n</return-code>\n<output>\nhello world\n</output>`;
      const result = parseToolResult(
        'Run',
        { command: 'echo hello world', wait: true, max_wait_seconds: 5, cwd: '/tmp' },
        xmlResult,
      );

      expect(result.type).toBe('terminal');
      expect(result.command).toBe('echo hello world');
      expect(result.content).toBe('hello world');
      expect(result.exitCode).toBe(0);
    });

    it('should handle non-XML terminal result unchanged', () => {
      const result = parseToolResult('bash', { command: 'ls' }, 'file1.txt\nfile2.txt');

      expect(result.type).toBe('terminal');
      expect(result.content).toBe('file1.txt\nfile2.txt');
      expect(result.exitCode).toBeUndefined();
    });

    describe('command-shaped ACP prose titles (#1992)', () => {
      const xmlResult = (output: string) =>
        `Here are the results from executing the command.\n<return-code>\n0\n</return-code>\n<output>\n${output}\n</output>`;

      it('routes a prose title containing "view" to the terminal parser', () => {
        const command =
          'gh pr view 1091 --repo intent-hq/intentd --json headRefOid ; gh run list --limit 3';
        const result = parseToolResult(
          `Run ${command}`,
          { command, wait: true, max_wait_seconds: 60, cwd: '/tmp/repo' },
          xmlResult('abc123'),
        );

        expect(result.type).toBe('terminal');
        expect(result.command).toBe(command);
        expect(result.content).toBe('abc123');
        expect(result.exitCode).toBe(0);
      });

      it('routes a prose title containing "edit" to the terminal parser', () => {
        const command = 'gh pr edit 42 --add-label bug';
        const result = parseToolResult(
          `Run ${command}`,
          { command, wait: true, max_wait_seconds: 30, cwd: '/tmp/repo' },
          xmlResult('done'),
        );

        expect(result.type).toBe('terminal');
        expect(result.command).toBe(command);
        expect(result.content).toBe('done');
        expect(result.exitCode).toBe(0);
      });

      it('routes a prose title containing "search" to the terminal parser', () => {
        const command = 'gh search issues "panel focus" --repo intent-hq/monorepo';
        const result = parseToolResult(
          `Run ${command}`,
          { command, wait: true, max_wait_seconds: 60, cwd: '/tmp/repo' },
          xmlResult('#123 fix panel focus'),
        );

        expect(result.type).toBe('terminal');
        expect(result.command).toBe(command);
        expect(result.content).toBe('#123 fix panel focus');
        expect(result.exitCode).toBe(0);
      });

      it('routes a prose title containing "save" to the terminal parser', () => {
        const command = 'git stash save wip';
        const result = parseToolResult(
          `Run ${command}`,
          { command, wait: true, cwd: '/tmp/repo' },
          xmlResult('Saved working directory'),
        );

        expect(result.type).toBe('terminal');
        expect(result.command).toBe(command);
        expect(result.content).toBe('Saved working directory');
      });

      it('still routes a genuine view tool to file-view', () => {
        const result = parseToolResult(
          'view',
          { path: 'src/index.ts' },
          "Here's the result of running `cat -n` on src/index.ts:\n     1\tconst a = 1;\nTotal lines in file: 1",
        );

        expect(result.type).toBe('file-view');
      });
    });
  });

  describe('glob/find result parsing', () => {
    it('should parse glob result as directory-listing', () => {
      const result = parseToolResult(
        'glob',
        { pattern: '**/*.ts', path: 'src/' },
        "Here's the files and directories up to 2 levels deep in src/:\n- index.ts\n- utils/\n  - helpers.ts",
      );

      expect(result.type).toBe('directory-listing');
      expect(result.files).toContain('index.ts');
      expect(result.files).toContain('utils/');
      expect(result.files).toContain('helpers.ts');
    });

    it('should handle empty glob result with pattern', () => {
      const result = parseToolResult('glob', { pattern: '**/*.xyz', path: 'src/' }, '');

      expect(result.type).toBe('directory-listing');
      expect(result.content).toBe('Find: **/*.xyz');
    });

    it('should handle empty glob result with glob field', () => {
      const result = parseToolResult('find', { glob: '*.json' }, '');

      expect(result.type).toBe('directory-listing');
      expect(result.content).toBe('Find: *.json');
    });

    it('should handle null result for find tool', () => {
      const result = parseToolResult('find', { pattern: 'src/**/*.test.ts' }, null);

      expect(result.type).toBe('directory-listing');
      expect(result.content).toBe('Find: src/**/*.test.ts');
    });
  });

  describe('search result parsing with fallbacks', () => {
    it('parses paths from an object-wrapped output payload', () => {
      const result = parseToolResult(
        'codebase-retrieval',
        { information_request: 'Find the chat panel' },
        {
          output:
            'The following code sections were retrieved:\nPath: src/lib/components/chat/ChatPanel.svelte\n  10 | assistant response',
        },
      );

      expect(result.type).toBe('code-search');
      expect(result.snippets).toEqual([
        {
          path: 'src/lib/components/chat/ChatPanel.svelte',
          content: '10 | assistant response',
        },
      ]);
      expect(result.content).toBeUndefined();
    });

    it('should add query to content when search has no results', () => {
      const result = parseToolResult('grep', { query: 'error handling' }, '');

      expect(result.type).toBe('code-search');
      expect(result.content).toBe('Search: error handling');
      expect(result.snippets).toHaveLength(0);
    });

    it('should add pattern to content when search has no results', () => {
      const result = parseToolResult('search', { pattern: 'TODO' }, null);

      expect(result.type).toBe('code-search');
      expect(result.content).toBe('Search: TODO');
    });

    it('should add information_request to content when retrieval has no results', () => {
      const result = parseToolResult(
        'codebase-retrieval',
        { information_request: 'Find all API endpoints' },
        '',
      );

      expect(result.type).toBe('code-search');
      expect(result.content).toBe('Search: Find all API endpoints');
    });

    it('flags a genuinely empty search result with noMatches', () => {
      const result = parseToolResult('grep', { pattern: 'TODO' }, '');

      expect(result.type).toBe('code-search');
      expect(result.noMatches).toBe(true);
      expect(result.snippets).toHaveLength(0);
      expect(result.content).toBe('Search: TODO');
    });

    it('parses grep -n file:line: output into per-file snippets', () => {
      const output = [
        'src/lib/a.ts:10:const foo = 1;',
        'src/lib/a.ts:22:const bar = foo;',
        'src/lib/b.svelte:5:<div>{foo}</div>',
      ].join('\n');
      const result = parseToolResult('grep', { pattern: 'foo' }, output);

      expect(result.type).toBe('code-search');
      expect(result.noMatches).toBeUndefined();
      expect(result.content).toBeUndefined();
      expect(result.snippets).toEqual([
        {
          path: 'src/lib/a.ts',
          content: '10: const foo = 1;\n22: const bar = foo;',
          lineStart: 10,
        },
        {
          path: 'src/lib/b.svelte',
          content: '5: <div>{foo}</div>',
          lineStart: 5,
        },
      ]);
    });

    it('includes grep context lines (-A/-B) and skips group separators', () => {
      const output = [
        'src/lib/a.ts:10:match line',
        'src/lib/a.ts-11-context line',
        '--',
        'src/lib/b.ts:20:another match',
      ].join('\n');
      const result = parseToolResult('Grep', { pattern: 'match' }, output);

      expect(result.snippets).toEqual([
        { path: 'src/lib/a.ts', content: '10: match line\n11: context line', lineStart: 10 },
        { path: 'src/lib/b.ts', content: '20: another match', lineStart: 20 },
      ]);
      expect(result.content).toBeUndefined();
    });

    it('parses rtk compact grep output, skipping header and truncation footer', () => {
      // Incident shape from #3284: rtk grep dump rendered under a "No results" label
      const output = [
        '222 matches in 40 files:',
        '',
        "src/lib/components/chat/AgentCard.svelte:29:import { render } from './x';",
        'src/.../chat/AgentPreviewToolLabel.svelte:13:import { render } fro...',
        '  +241 more in src/lib/components/chat/tool-result-parser.ts [see remaining: tail -n +26 ~/.local/share/rtk/tee/x.log]',
      ].join('\n');
      const result = parseToolResult('grep', { pattern: 'render' }, output);

      expect(result.type).toBe('code-search');
      expect(result.content).toBeUndefined();
      expect(result.snippets).toEqual([
        {
          path: 'src/lib/components/chat/AgentCard.svelte',
          content: "29: import { render } from './x';",
          lineStart: 29,
        },
        {
          path: 'src/.../chat/AgentPreviewToolLabel.svelte',
          content: '13: import { render } fro...',
          lineStart: 13,
        },
      ]);
    });

    it('falls back to raw content for prose output without claiming noMatches', () => {
      const output =
        'The search completed but the tool emitted a note: results were streamed elsewhere.';
      const result = parseToolResult('search', { query: 'foo' }, output);

      expect(result.type).toBe('code-search');
      expect(result.snippets).toHaveLength(0);
      expect(result.noMatches).toBeUndefined();
      expect(result.content).toBe(output);
    });

    it('does not misparse colon-heavy log output as grep matches', () => {
      const output = ['12:34:56 starting server', 'listening on http://localhost:3000'].join('\n');
      const result = parseToolResult('grep', { pattern: 'server' }, output);

      expect(result.snippets).toHaveLength(0);
      expect(result.content).toBe(output);
    });

    it('falls back to raw content when grep-shaped lines are exactly half (not a strict majority)', () => {
      const output = ['src/a.ts:1:hit', 'search finished with warnings'].join('\n');
      const result = parseToolResult('grep', { pattern: 'hit' }, output);

      expect(result.snippets).toHaveLength(0);
      expect(result.content).toBe(output);
    });
  });

  describe('workspace_api ws.app.* routing', () => {
    it('routes ws.app.question.ask to confirmation carrying the result text', () => {
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        {
          code: 'return await ws.app.question.ask({ question: "Pick one", header: "Choice", options: [] })',
          summary: 'Ask the user a clarifying question',
        },
        'Question queued; answers arrive in the next user message.',
      );

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('Question queued; answers arrive in the next user message.');
    });

    it('routes ws.app.* to confirmation even when later ws.* namespaces appear in the code', () => {
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        {
          code: 'const r = await ws.app.question.ask({ question: "Q" }); await ws.note.add("spec", { content: "x" }); return r;',
          summary: 'Ask then note',
        },
        'ok',
      );

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('ok');
    });

    it('extracts MCP content-item text for ws.app.question.ask results', () => {
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        { code: 'await ws.app.question.ask({ question: "Q" })', summary: 'Ask' },
        [{ type: 'text', text: '{"ok":true,"attachmentId":"att-1","message":"Question queued"}' }],
      );

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('{"ok":true,"attachmentId":"att-1","message":"Question queued"}');
    });

    it('leaves content undefined when no text is extractable from the result payload', () => {
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        { code: 'await ws.app.question.ask({ question: "Q" })', summary: 'Ask' },
        { ok: true, attachmentId: 'att-1', message: 'Question queued' },
      );

      expect(result.type).toBe('confirmation');
      expect(result.content).toBeUndefined();
    });
  });

  describe('single-field JSON envelope unwrapping (#1758)', () => {
    it('unwraps an object result with a single output field to plain text', () => {
      const result = parseToolResult('some_mcp_tool', {}, { output: 'line1\nline2' });

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('line1\nline2');
    });

    it('unwraps a string result that is a single-field JSON envelope', () => {
      const result = parseToolResult(
        'some_mcp_tool',
        {},
        '{"output": "Here are the results.\\n<return-code>\\n0\\n</return-code>"}',
      );

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('Here are the results.\n<return-code>\n0\n</return-code>');
    });

    it('unwraps a terminal result wrapped in a single-field JSON envelope', () => {
      const result = parseToolResult(
        'launch-process',
        { command: 'echo hi', wait: true, cwd: '/tmp' },
        {
          output:
            'Here are the results from executing the command.\n<return-code>\n0\n</return-code>\n<output>\nhi\n</output>',
        },
      );

      expect(result.type).toBe('terminal');
      expect(result.content).toBe('hi');
      expect(result.exitCode).toBe(0);
    });

    it('unwraps a single MCP text item carrying a single-field JSON envelope', () => {
      const result = parseToolResult('some_mcp_tool', {}, [
        { type: 'text', text: '{"output": "plain text payload"}' },
      ]);

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('plain text payload');
    });

    it('does not unwrap multi-field JSON objects', () => {
      const result = parseToolResult('some_mcp_tool', {}, '{"output": "text", "exitCode": 0}');

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('{"output": "text", "exitCode": 0}');
    });

    it('does not unwrap a single-field object whose value is not a string', () => {
      const result = parseToolResult('some_mcp_tool', {}, '{"output": 42}');

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('{"output": 42}');
    });

    it('does not unwrap a single string field whose key is not output', () => {
      const result = parseToolResult('some_mcp_tool', {}, '{"title": "My task"}');

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('{"title": "My task"}');
    });

    it('keeps single-field JSON task payloads intact for the task parser', () => {
      const result = parseToolResult('get_task', { taskId: 't-1' }, '{"title": "My task"}');

      expect(result.type).toBe('task');
      expect(result.taskTitle).toBe('My task');
    });

    it('does not unwrap JSON arrays', () => {
      const result = parseToolResult('some_mcp_tool', {}, '["a", "b"]');

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('["a", "b"]');
    });

    it('leaves invalid JSON untouched', () => {
      const result = parseToolResult('some_mcp_tool', {}, '{"output": broken');

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('{"output": broken');
    });
  });

  describe('agent delegate/create JSON results', () => {
    const AGENT_ID = 'agent-12345678-1234-1234-1234-123456789abc';
    const delegateInput = {
      code: 'return await ws.agent.delegate({ taskNoteId: "note-1" })',
      summary: 'Delegate task',
    };
    const createInput = {
      code: 'return await ws.agent.create("Helper", "Do the thing")',
      summary: 'Create agent',
    };

    it('parses the daemon pretty-printed JSON delegate result', () => {
      const json = JSON.stringify(
        {
          ok: true,
          agentId: AGENT_ID,
          name: 'Implementor #1',
          taskNoteId: 'note-1',
          provider: 'claude-code',
        },
        null,
        2,
      );
      const result = parseToolResult('workspace_api_workspace-mcp', delegateInput, json);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedAgentName).toBe('Implementor #1');
      expect(result.taskNoteId).toBe('note-1');
      expect(result.delegatedAgentProvider).toBe('claude-code');
      expect(result.delegateBatch).toBeUndefined();
    });

    it('parses a JSON delegate result without the optional provider field', () => {
      const json = JSON.stringify({ ok: true, agentId: AGENT_ID, name: 'X' });
      const result = parseToolResult('workspace_api_workspace-mcp', delegateInput, json);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedAgentName).toBe('X');
      expect(result.delegatedAgentProvider).toBeUndefined();
    });

    it('parses a batch delegate result into a disposition summary', () => {
      const json = JSON.stringify(
        {
          ok: true,
          greedy: false,
          tasks: [
            {
              taskNoteId: 'n-1',
              title: 'Task A',
              disposition: 'started',
              agentId: AGENT_ID,
              agentName: 'Implementor #1',
            },
            {
              taskNoteId: 'n-2',
              title: 'Task B',
              disposition: 'held:blocked-on-deps',
              unmetDependsOn: ['n-1'],
              reason: 'waiting on incomplete dependencies: n-1',
            },
            {
              taskNoteId: 'n-3',
              title: 'Task C',
              disposition: 'held:conflict',
              conflictsWith: ['n-1'],
              reason: 'conflictsWith intersects the running/starting set (n-1)',
            },
            {
              taskNoteId: 'n-4',
              title: 'Task D',
              disposition: 'skipped',
              reason: 'task is complete',
            },
            { taskNoteId: 'n-5', title: 'Task E', disposition: 'error', reason: 'boom' },
          ],
          startedTaskIds: ['n-1'],
          unlockPlan: { unlockedBySettlement: ['n-2'], message: 'msg' },
        },
        null,
        2,
      );
      const batchInput = {
        code: 'return await ws.agent.delegate({ tasks: ["n-1", "n-2", "n-3", "n-4", "n-5"] })',
        summary: 'Delegate batch',
      };
      const result = parseToolResult('workspace_api_workspace-mcp', batchInput, json);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBeUndefined();
      expect(result.delegateBatch).toEqual({
        started: 1,
        held: 2,
        skipped: 1,
        errors: 1,
        startedRows: [
          { agentId: AGENT_ID, agentName: 'Implementor #1', taskNoteId: 'n-1', title: 'Task A' },
        ],
      });
    });

    it('does not surface a skipped already-running agent as a started row', () => {
      const json = JSON.stringify({
        ok: true,
        greedy: false,
        tasks: [
          {
            taskNoteId: 'n-1',
            title: 'Task A',
            disposition: 'skipped',
            agentId: AGENT_ID,
            agentName: 'Implementor #1',
            reason: `already being worked by agent ${AGENT_ID} ("Implementor #1")`,
          },
        ],
        startedTaskIds: [],
        unlockPlan: { unlockedBySettlement: [], message: 'msg' },
      });
      const batchInput = {
        code: 'return await ws.agent.delegate({ tasks: ["n-1"] })',
        summary: 'Delegate batch',
      };
      const result = parseToolResult('workspace_api_workspace-mcp', batchInput, json);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBeUndefined();
      expect(result.delegateBatch).toEqual({
        started: 0,
        held: 0,
        skipped: 1,
        errors: 0,
        startedRows: [],
      });
    });

    it('still parses the legacy prose delegate result', () => {
      const prose = `Task "Fix the parser" delegated to new agent.\nAgent ID: ${AGENT_ID}\nTask Note ID: note-1`;
      const result = parseToolResult('workspace_api_workspace-mcp', delegateInput, prose);

      expect(result.type).toBe('delegate-task');
      expect(result.delegatedTaskName).toBe('Fix the parser');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.taskNoteId).toBe('note-1');
    });

    it('parses the daemon pretty-printed JSON agent.create result', () => {
      const json = JSON.stringify(
        {
          ok: true,
          id: AGENT_ID,
          agentId: AGENT_ID,
          name: 'Helper',
          provider: 'auggie',
          subscriptionId: 'sub-1',
        },
        null,
        2,
      );
      const result = parseToolResult('workspace_api_workspace-mcp', createInput, json);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedAgentName).toBe('Helper');
      expect(result.delegatedAgentProvider).toBe('auggie');
    });

    it('falls back to input for task name/note id on JSON create results', () => {
      const json = JSON.stringify({ ok: true, agentId: AGENT_ID, name: 'Helper' });
      const result = parseToolResult(
        'create_agent',
        { name: 'Helper', taskNoteId: 'note-2' },
        json,
      );

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedAgentName).toBe('Helper');
      expect(result.delegatedTaskName).toBe('Helper');
      expect(result.taskNoteId).toBe('note-2');
    });

    it('still parses the legacy prose agent creation result', () => {
      const prose = `Created new agent "Helper" for task "TaskTitle".\nAgent ID: ${AGENT_ID}`;
      const result = parseToolResult('create_agent', {}, prose);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedTaskName).toBe('TaskTitle');
    });

    it('captures a full agent id from bare prose instead of truncating it', () => {
      const prose = `Agent started. agentId: ${AGENT_ID}`;
      const result = parseToolResult('create_agent', {}, prose);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
    });

    it('never captures a partial id from truncated pretty-printed JSON', () => {
      // JSON.parse fails on the cut-off object, so the text falls through to
      // the prose path with a partial agent id inside — the strict bare-id
      // regex must not match it (the old regex captured the fragment).
      const truncated = `{\n  "ok": true,\n  "agentId": "${AGENT_ID.slice(0, 20)}`;
      const result = parseToolResult('create_agent', {}, truncated);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBeUndefined();
    });

    it('never captures a quote-wrapped agentId key from undecodable TOON-ish text', () => {
      // Regression: the alternate bare-key fallback consumed the colon AND
      // the opening quote, so a malformed TOON create/wakeOrCreate response
      // rendered an agent card from the embedded `agentId: "agent-…"` key.
      const text = `Creation failed after starting.\nagentId: "${AGENT_ID}"`;
      const result = parseToolResult('create_agent', {}, text);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBeUndefined();
    });
  });

  describe('agent delegate/create TOON results', () => {
    // Fixtures mirror the daemon's toon-format v0.5 `encode_default` output
    // (`render_workspace_api_value` in intentd): hyphenated strings are
    // quoted, arrays use the `tasks[N]:` list / inline syntax.
    const AGENT_ID = 'agent-12345678-1234-1234-1234-123456789abc';
    const delegateInput = {
      code: 'return await ws.agent.delegate({ taskNoteId: "note-1" })',
      summary: 'Delegate task',
    };
    const batchInput = {
      code: 'return await ws.agent.delegate({ tasks: ["n-1", "n-2", "n-3", "n-4"] })',
      summary: 'Delegate batch',
    };

    const TOON_BATCH = [
      'ok: true',
      'greedy: false',
      'tasks[4]:',
      '  - taskNoteId: "n-1"',
      '    title: Task A',
      '    disposition: started',
      `    agentId: "${AGENT_ID}"`,
      '    agentName: Implementor #1',
      '  - taskNoteId: "n-2"',
      '    title: Task B',
      '    disposition: "held:blocked-on-deps"',
      '    reason: "waiting on incomplete dependencies: n-1"',
      '  - taskNoteId: "n-3"',
      '    title: Task C',
      '    disposition: "held:conflict"',
      '    reason: "conflictsWith intersects the running/starting set (n-1)"',
      '  - taskNoteId: "n-4"',
      '    title: Task D',
      '    disposition: skipped',
      '    reason: already complete',
      'startedTaskIds[1]: "n-1"',
      'unlockPlan:',
      '  unlockedBySettlement[1]: "n-2"',
      '  message: msg',
    ].join('\n');

    it('parses a TOON batch delegate result into a disposition summary', () => {
      const result = parseToolResult('workspace_api_workspace-mcp', batchInput, TOON_BATCH);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBeUndefined();
      expect(result.delegateBatch).toEqual({
        started: 1,
        held: 2,
        skipped: 1,
        errors: 0,
        startedRows: [
          { agentId: AGENT_ID, agentName: 'Implementor #1', taskNoteId: 'n-1', title: 'Task A' },
        ],
      });
    });

    it('never captures a quote-wrapped agentId from TOON batch text', () => {
      // Regression: before TOON decoding, the batch text fell through to the
      // legacy prose regex, which matched `agentId: "agent-…"` inside the
      // TOON body and set a bogus quote-wrapped single agentId.
      const result = parseToolResult('workspace_api_workspace-mcp', batchInput, TOON_BATCH);

      expect(result.agentId).toBeUndefined();
      expect(result.delegateBatch?.startedRows[0].agentId).toBe(AGENT_ID);
      expect(result.delegateBatch?.startedRows[0].agentId).not.toContain('"');
    });

    it('parses a TOON single delegate result', () => {
      const toon = [
        'ok: true',
        `agentId: "${AGENT_ID}"`,
        'name: Implementor #1',
        'taskNoteId: "note-1"',
        'provider: claude-code',
      ].join('\n');
      const result = parseToolResult('workspace_api_workspace-mcp', delegateInput, toon);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedAgentName).toBe('Implementor #1');
      expect(result.taskNoteId).toBe('note-1');
      expect(result.delegatedAgentProvider).toBe('claude-code');
      expect(result.delegateBatch).toBeUndefined();
    });

    it('parses a TOON wakeOrCreate result', () => {
      const toon = [
        'ok: true',
        `agentId: "${AGENT_ID}"`,
        'name: Helper',
        'taskNoteId: "note-2"',
        'provider: auggie',
      ].join('\n');
      const wakeInput = {
        code: 'return await ws.agent.wakeOrCreate("note-2", "resume work")',
        summary: 'Wake or create agent',
      };
      const result = parseToolResult('workspace_api_workspace-mcp', wakeInput, toon);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedAgentName).toBe('Helper');
      expect(result.taskNoteId).toBe('note-2');
      expect(result.delegatedAgentProvider).toBe('auggie');
    });

    it('does not capture an agentId from undecodable TOON-ish text', () => {
      // Prose prefix makes the text invalid TOON; the hardened prose regex
      // must not match the `agentId:` key either.
      const text = `Delegation failed after starting.\nagentId: "${AGENT_ID}"`;
      const result = parseToolResult('workspace_api_workspace-mcp', delegateInput, text);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBeUndefined();
      expect(result.content).toBe(text);
    });
  });

  describe('workspace_api TOON results (generalized renderers)', () => {
    // Fixtures mirror the daemon's toon-format v0.5 `encode_default` output
    // (`render_workspace_api_value` in intentd), verified against the npm
    // `@toon-format/toon` decoder.
    const wsInput = (code: string) => ({ code, summary: 'ws call' });

    it('parses a TOON agent list (tabular array) into agent rows', () => {
      const toon = [
        '[2]{id,name,status,isActive}:',
        '  agent-11111111-1111-1111-1111-111111111111,Coordinator,idle,true',
        '  agent-22222222-2222-2222-2222-222222222222,Implementor #1,responding,true',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.agent.list()'),
        toon,
      );

      expect(result.type).toBe('agent-list');
      expect(result.agents).toEqual([
        {
          name: 'Coordinator',
          agentId: 'agent-11111111-1111-1111-1111-111111111111',
          status: 'idle',
        },
        {
          name: 'Implementor #1',
          agentId: 'agent-22222222-2222-2222-2222-222222222222',
          status: 'responding',
        },
      ]);
    });

    it('still parses the legacy prose agent list', () => {
      const prose = '- Coordinator (agent-1)\n  Status: idle\n- Helper (agent-2)\n  Status: responding';
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.agent.list()'),
        prose,
      );

      expect(result.type).toBe('agent-list');
      expect(result.agents).toEqual([
        { name: 'Coordinator', agentId: 'agent-1', status: 'idle' },
        { name: 'Helper', agentId: 'agent-2', status: 'responding' },
      ]);
    });

    it('parses a TOON note list (list array) into note rows', () => {
      const toon = [
        '[2]:',
        '  - id: note-1',
        '    title: Design Doc',
        '    tags[2]: design,v2',
        '    createdAt: "2026-08-17T00:00:00Z"',
        '  - id: spec',
        '    title: Spec',
        '    tags: []',
        '    createdAt: "2026-08-16T00:00:00Z"',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.note.list()'),
        toon,
      );

      expect(result.type).toBe('note-list');
      expect(result.notes).toEqual([
        { id: 'note-1', title: 'Design Doc', tags: ['design', 'v2'] },
        { id: 'spec', title: 'Spec', tags: [] },
      ]);
    });

    it('parses a TOON note read result via rawContent', () => {
      const toon = [
        'id: spec',
        'title: My Spec',
        'tags[1]: spec',
        'content: "   1 | # Heading\\n   2 | body line"',
        'rawContent: "# Heading\\nbody line"',
        'totalLines: 2',
        'imageCount: 0',
        'images: []',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.note.read("spec")'),
        toon,
      );

      expect(result.type).toBe('note-view');
      expect(result.content).toBe('# Heading\nbody line');
      expect(result.lineCount).toBe(2);
    });

    it('still parses the legacy line-numbered note read text', () => {
      const text = 'Note: My Spec\n\n   1 | # Heading\n   2 | body line';
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.note.read("spec")'),
        text,
      );

      expect(result.type).toBe('note-view');
      expect(result.content).toBe('# Heading\nbody line');
    });

    it('parses a TOON note edit result into an old/new diff', () => {
      const toon = [
        'ok: true',
        'noteId: spec',
        'oldTextLength: 5',
        'newTextLength: 9',
        'matchPosition: 10',
        'oldContent: "# Spec\\nold line"',
        'newContent: "# Spec\\nnew line"',
        'convertedCount: 0',
        'createdTaskNoteIds: []',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.note.edit("spec", { old: "old line", new: "new line" })'),
        toon,
      );

      expect(result.type).toBe('note-edit');
      expect(result.oldContent).toBe('# Spec\nold line');
      expect(result.newContent).toBe('# Spec\nnew line');
    });

    it('parses a TOON getMyTask result', () => {
      const toon = [
        'noteId: task-1',
        'title: Fix the bug',
        'content: Repro steps here',
        'status: in_progress',
        'rev: 3',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.task.getMyTask("task-1")'),
        toon,
      );

      expect(result.type).toBe('task');
      expect(result.taskTitle).toBe('Fix the bug');
      expect(result.taskStatus).toBe('in_progress');
      expect(result.taskContent).toBe('Repro steps here');
    });

    it('parses a TOON task updateStatus result', () => {
      const toon = ['ok: true', 'noteId: note-9', 'taskText: Write tests', 'status: done'].join(
        '\n',
      );
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.task.updateStatus("note-9", "Write tests", "done")'),
        toon,
      );

      expect(result.type).toBe('task-update');
      expect(result.taskTitle).toBe('Write tests');
      expect(result.taskStatus).toBe('done');
    });

    it('still parses the legacy prose task update text', () => {
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.task.updateStatus("note-9", "Write tests", "done")'),
        "Task status updated to 'done': Write tests",
      );

      expect(result.type).toBe('task-update');
      expect(result.taskStatus).toBe('done');
    });

    it('parses a TOON comment add result', () => {
      const toon = [
        'success: true',
        'message: "Comment successfully anchored to \\"Section 3\\""',
        'commentId: comment-abc',
        'anchored: true',
        'noteRev: 7',
        'location:',
        '  line: 12',
        '  anchoredText: Section 3',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.comment.add("spec", { comment: "hi" })'),
        toon,
      );

      expect(result.type).toBe('comment-add');
      expect(result.commentMessage).toBe('Comment successfully anchored to "Section 3"');
      expect(result.commentId).toBe('comment-abc');
      expect(result.commentAnchorText).toBe('Section 3');
    });

    it('parses a TOON comment list result', () => {
      const toon = [
        'threads[1]{threadId,noteId,targetedText,status,createdAt,lastActivity,latestCommentAuthor,latestCommentAuthorType,latestCommentAt,commentCount}:',
        '  thread-1,spec,Section 3,open,"2026-08-17T01:00:00Z","2026-08-17T02:00:00Z",Clement,user,"2026-08-17T02:00:00Z",2',
        'totalThreads: 1',
        'totalComments: 2',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.comment.list("spec")'),
        toon,
      );

      expect(result.type).toBe('comment-list');
      expect(result.totalComments).toBe(2);
      expect(result.commentThreads).toEqual([
        {
          threadId: 'thread-1',
          targetedText: 'Section 3',
          status: 'open',
          commentCount: 2,
          latestAuthor: 'Clement',
          lastActivity: '2026-08-17T02:00:00Z',
        },
      ]);
    });

    it('falls back to raw content for non-structured comment list text', () => {
      const text = 'No comment threads found.';
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.comment.list("spec")'),
        text,
      );

      expect(result.type).toBe('comment-list');
      expect(result.commentThreads).toEqual([]);
      expect(result.content).toBe(text);
    });

    it('parses a TOON browser screenshot result', () => {
      const toon = ['assetUrl: "workspace-asset://shot-1.png"', 'width: 1280', 'height: 800'].join(
        '\n',
      );
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput('return await ws.browser.exec([{ action: "screenshot" }])'),
        toon,
      );

      expect(result.type).toBe('browser');
      expect(result.screenshotUrl).toBe('workspace-asset://shot-1.png');
      expect(result.screenshotWidth).toBe(1280);
      expect(result.screenshotHeight).toBe(800);
    });

    it('parses a TOON multi-action browser result', () => {
      const toon = [
        '[2]:',
        '  - action: evaluate',
        '    success: true',
        '    result: ok',
        '  - action: screenshot',
        '    success: true',
        '    result:',
        '      assetUrl: "workspace-asset://shot-2.png"',
        '      width: 640',
        '      height: 480',
      ].join('\n');
      const result = parseToolResult(
        'workspace_api_workspace-mcp',
        wsInput(
          'return await ws.browser.exec([{ action: "evaluate" }, { action: "screenshot" }])',
        ),
        toon,
      );

      expect(result.type).toBe('browser');
      expect(result.evaluateResult).toBe('ok');
      expect(result.screenshotUrl).toBe('workspace-asset://shot-2.png');
    });
  });
});
