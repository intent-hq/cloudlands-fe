/**
 * Tool Result Parser Tests
 *
 * Tests that tool results are correctly parsed for display.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { parseToolResult } from '../tool-result-parser';

describe('tool-result-parser', () => {
  describe('terminal result parsing', () => {
    it('should parse terminal result with output', () => {
      const result = parseToolResult('bash', { command: 'npm test' }, 'Test passed\n✓ All tests pass');

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

    it('should handle launch-process tool', () => {
      const result = parseToolResult('launch-process', { command: 'npm run build' }, 'Build complete');

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
      const result = parseToolResult('Run', { command: 'echo hello world', wait: true, max_wait_seconds: 5, cwd: '/tmp' }, xmlResult);

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
        'Here\'s the files and directories up to 2 levels deep in src/:\n- index.ts\n- utils/\n  - helpers.ts',
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
      const result = parseToolResult('codebase-retrieval', { information_request: 'Find all API endpoints' }, '');

      expect(result.type).toBe('code-search');
      expect(result.content).toBe('Search: Find all API endpoints');
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
      const result = parseToolResult(
        'some_mcp_tool',
        {},
        { output: 'line1\nline2' },
      );

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
      const result = parseToolResult(
        'some_mcp_tool',
        {},
        [{ type: 'text', text: '{"output": "plain text payload"}' }],
      );

      expect(result.type).toBe('confirmation');
      expect(result.content).toBe('plain text payload');
    });

    it('does not unwrap multi-field JSON objects', () => {
      const result = parseToolResult(
        'some_mcp_tool',
        {},
        '{"output": "text", "exitCode": 0}',
      );

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
    });

    it('parses a JSON delegate result without the optional provider field', () => {
      const json = JSON.stringify({ ok: true, agentId: AGENT_ID, name: 'X' });
      const result = parseToolResult('workspace_api_workspace-mcp', delegateInput, json);

      expect(result.type).toBe('delegate-task');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.delegatedAgentName).toBe('X');
      expect(result.delegatedAgentProvider).toBeUndefined();
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
  });
});
