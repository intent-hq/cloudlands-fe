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
});
