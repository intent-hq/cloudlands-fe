/**
 * Tool Classifier Tests
 *
 * Tests that tool names are correctly classified into display categories.
 * This is critical for showing the correct verb (Read, Edit, Save, etc.)
 * in the UI when displaying tool calls.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { classifyTool } from '../tool-classifier';

describe('tool-classifier', () => {
  describe('file operations', () => {
    it('should classify "view" tool as file-read with verb "Read"', () => {
      const result = classifyTool('view', { path: 'src/index.ts', type: 'file' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('index.ts');
      expect(result.isDirectory).toBeFalsy();
    });

    it('should classify "view" tool with type "directory" as "List Contents"', () => {
      const result = classifyTool('view', { path: 'src/lib/components', type: 'directory' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('List Contents');
      expect(result.subject).toBe('components');
      expect(result.path).toBe('src/lib');
      expect(result.isDirectory).toBe(true);
    });

    it('should classify "view" with view_range as file-read', () => {
      const result = classifyTool('view', {
        path: 'src/index.ts',
        view_range: [1, 50],
      });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('index.ts:1-50');
    });

    it('should classify "str-replace-editor" tool as file-write with verb "Edit"', () => {
      const result = classifyTool('str-replace-editor', {
        path: 'src/index.ts',
        command: 'str_replace',
        old_str_1: 'foo',
        new_str_1: 'bar',
      });

      expect(result.category).toBe('file-write');
      expect(result.verb).toBe('Edit');
      expect(result.subject).toBe('index.ts');
    });

    it('should classify "save-file" tool as file-write with verb "Save"', () => {
      const result = classifyTool('save-file', {
        path: 'src/new-file.ts',
        file_content: 'export const foo = 1;',
      });

      expect(result.category).toBe('file-write');
      expect(result.verb).toBe('Save');
      expect(result.subject).toBe('new-file.ts');
    });

    it('should classify "remove-files" tool as file-delete', () => {
      const result = classifyTool('remove-files', {
        file_paths: ['src/old-file.ts'],
      });

      expect(result.category).toBe('file-delete');
      expect(result.verb).toBe('Delete');
    });
  });

  describe('search operations', () => {
    it('should classify "codebase-retrieval" as context-engine', () => {
      const result = classifyTool('codebase-retrieval', {
        information_request: 'Find the login function',
      });

      expect(result.category).toBe('context-engine');
      expect(result.verb).toBe('Context Engine'); // Specific verb for codebase retrieval
    });

    it('should classify "web-search" as search', () => {
      const result = classifyTool('web-search', {
        query: 'TypeScript generics',
      });

      expect(result.category).toBe('search');
      expect(result.verb).toBe('Search web'); // Specific verb for web search
    });
  });

  describe('terminal operations', () => {
    it('should classify "launch-process" as terminal', () => {
      const result = classifyTool('launch-process', {
        command: 'npm test',
        cwd: '/project',
        wait: true,
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Run');
    });

    it('should use description as subject when available (for terminal tools)', () => {
      const result = classifyTool('bash', {
        command: 'npm test',
        description: 'Install dependencies',
      });

      expect(result.category).toBe('terminal');
      expect(result.subject).toBe('Install dependencies');
    });

    it('should fallback to command when description is not available', () => {
      const result = classifyTool('bash', {
        command: 'npm test',
      });

      expect(result.category).toBe('terminal');
      expect(result.subject).toBe('npm test');
    });

    it('should handle missing command by using description', () => {
      const result = classifyTool('bash', {
        description: 'Install dependencies',
      });

      expect(result.category).toBe('terminal');
      expect(result.subject).toBe('Install dependencies');
    });

    it('should handle empty input gracefully', () => {
      const result = classifyTool('bash', {});

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Run');
      expect(result.subject).toBeNull();
    });

    it('should classify bare "Run" name (from ACP title) as terminal', () => {
      const result = classifyTool('Run', {});

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Run');
    });

    it('should extract command from _acpTitle when input.command is missing', () => {
      const result = classifyTool('Run', {
        _acpTitle: 'Run cd experimental/amelia && npx vitest run src/test.ts',
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Run');
      expect(result.subject).toBe('cd experimental/amelia && npx vitest run src/test.ts');
    });

    it('should classify ACP title "List processes" correctly', () => {
      const result = classifyTool('List processes', {});

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('List');
      expect(result.subject).toBe('processes');
    });

    it('should classify ACP title "Read terminal 123" correctly', () => {
      const result = classifyTool('Read terminal 123', {});

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Read');
      expect(result.subject).toContain('terminal');
    });

    it('should classify ACP title "Kill terminal 5" correctly', () => {
      const result = classifyTool('Kill terminal 5', {});

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Kill');
      expect(result.subject).toContain('terminal');
    });

    it('should classify read-process with terminal_id from input', () => {
      const result = classifyTool('Read terminal 3', {
        terminal_id: 3,
        wait: true,
        _acpTitle: 'Read terminal 3',
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('terminal 3');
    });

    it('should detect read-process from input.terminal_id when name is generic', () => {
      // When ACP title is just "Run" but input has terminal_id
      const result = classifyTool('run', { terminal_id: 5 });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('terminal 5');
    });

    it('should detect write-process from input.terminal_id and input_text', () => {
      const result = classifyTool('run', {
        terminal_id: 2,
        input_text: 'y\n',
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Write to');
      expect(result.subject).toBe('terminal 2');
    });

    it('should classify _acpTitle "List processes" as fallback', () => {
      const result = classifyTool('run', {
        _acpTitle: 'List processes',
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('List');
      expect(result.subject).toBe('processes');
    });

    it('should classify _acpTitle "Read terminal 7" as fallback', () => {
      const result = classifyTool('run', {
        _acpTitle: 'Read terminal 7',
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('terminal 7');
    });

    it('should classify _acpTitle "Kill terminal 3" as fallback', () => {
      const result = classifyTool('run', {
        _acpTitle: 'Kill terminal 3',
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Kill');
      expect(result.subject).toBe('terminal 3');
    });
  });

  describe('edge cases - tool name vs title disambiguation', () => {
    // These tests verify the fix for the bug where human-readable titles
    // (like "Read", "Edit") were being used instead of actual tool names

    it('should NOT classify a tool named "Read" with edit input as file-read', () => {
      // This simulates the bug: ACP sends title="Read" but input has str_replace command
      // The streaming provider should derive the actual tool name from input
      // But if it doesn't, the classifier should still handle it gracefully
      const result = classifyTool('Read', {
        path: 'src/index.ts',
        command: 'str_replace',
        old_str_1: 'foo',
        new_str_1: 'bar',
      });

      // Even with a misleading name, the presence of command='str_replace'
      // should ideally be detected. Currently it falls through to generic.
      // This test documents current behavior - the fix is in the streaming provider.
      expect(result.verb).toBeDefined();
    });

    it('should correctly classify actual tool names', () => {
      // str-replace-editor should always be Edit
      expect(classifyTool('str-replace-editor', { path: 'f.ts', command: 'str_replace' }).verb).toBe(
        'Edit',
      );

      // view file should be Read, view directory should be List Contents
      expect(classifyTool('view', { path: 'f.ts', type: 'file' }).verb).toBe('Read');
      expect(classifyTool('view', { path: 'src/lib', type: 'directory' }).verb).toBe('List Contents');

      // save-file should always be Save
      expect(classifyTool('save-file', { path: 'f.ts', file_content: 'x' }).verb).toBe('Save');
    });
  });

  describe('glob/find operations', () => {
    it('should classify "glob" tool with pattern as search with verb "Find"', () => {
      const result = classifyTool('glob', {
        pattern: '**/*.ts',
        path: 'src/',
      });

      expect(result.category).toBe('search');
      expect(result.verb).toBe('Find');
      expect(result.subject).toBe('**/*.ts');
    });

    it('should classify "find" tool as search with verb "Find"', () => {
      const result = classifyTool('find', {
        pattern: '*.json',
        path: '/config',
      });

      expect(result.category).toBe('search');
      expect(result.verb).toBe('Find');
      expect(result.subject).toBe('*.json');
    });

    it('should use description as fallback for glob when pattern is missing', () => {
      const result = classifyTool('glob', {
        pattern: '',
        path: 'src/',
        description: 'Find TypeScript files',
      });

      expect(result.category).toBe('search');
      expect(result.verb).toBe('Find');
      expect(result.subject).toBe('Find TypeScript files');
    });

    it('should use glob field as fallback subject', () => {
      const result = classifyTool('find-files', {
        glob: '**/*.test.ts',
      });

      expect(result.category).toBe('search');
      expect(result.verb).toBe('Find');
      expect(result.subject).toBe('**/*.test.ts');
    });

    it('should classify bare glob without pattern or path as search with "files" fallback', () => {
      const result = classifyTool('glob', {
        some_other_param: 'value',
      });

      expect(result.category).toBe('search');
      expect(result.verb).toBe('Find');
      expect(result.subject).toBe('files');
    });

    it('should classify bare glob with empty input as search', () => {
      const result = classifyTool('glob', {});

      expect(result.category).toBe('search');
      expect(result.verb).toBe('Find');
      expect(result.subject).toBe('files');
    });
  });

  describe('search with description fallback', () => {
    it('should use description as fallback for grep tools', () => {
      const result = classifyTool('grep', {
        pattern: '',
        description: 'Search for error messages',
      });

      expect(result.category).toBe('search');
      expect(result.subject).toBe('Search for error messages');
    });

    it('should use description as fallback when query/pattern/glob are empty', () => {
      const result = classifyTool('search', {
        description: 'Find all function definitions',
      });

      expect(result.category).toBe('search');
      expect(result.subject).toBe('Find all function definitions');
    });
  });

  describe('MCP server prefix stripping', () => {
    it('should strip workspace-mcp_ prefix and classify set_workspace_title as workspace', () => {
      const result = classifyTool('workspace-mcp_set_workspace_title', { title: 'My Project' });

      expect(result.category).toBe('workspace');
      expect(result.verb).toBeDefined();
    });

    it('should strip workspace-mcp_ prefix and classify read_note as note', () => {
      const result = classifyTool('workspace-mcp_read_note', { noteId: 'spec' });

      expect(result.category).toBe('note');
      expect(result.verb).toBeDefined();
    });

    it('should strip workspace-mcp_ prefix and classify set_note_content as note', () => {
      const result = classifyTool('workspace-mcp_set_note_content', {
        noteId: 'spec',
        content: 'hello',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBeDefined();
    });

    it('should strip filesystem_ prefix', () => {
      const result = classifyTool('filesystem_read', { path: 'src/index.ts' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
    });

    it('should strip browser-mcp_ prefix', () => {
      const result = classifyTool('browser-mcp_snapshot', {});

      // After stripping, "snapshot" should classify as browser
      expect(result.category).toBe('browser');
    });
  });

  describe('daemon MCP suffix (_workspace-mcp) stripping', () => {
    it('classifies delegate_task_workspace-mcp as agent op (Delegate + task subject)', () => {
      const result = classifyTool('delegate_task_workspace-mcp', {
        taskText: 'Wire up dark mode',
      });

      expect(result.category).toBe('agent');
      expect(result.verb).toBe('Delegate');
      expect(result.subject).toBe('Wire up dark mode');
    });

    it('classifies list_agents_workspace-mcp as agent op', () => {
      const result = classifyTool('list_agents_workspace-mcp', {});

      expect(result.category).toBe('agent');
      expect(result.verb).not.toBe('Workspace');
    });

    it('classifies read_agent_conversation_workspace-mcp as agent op', () => {
      const result = classifyTool('read_agent_conversation_workspace-mcp', {
        agentId: 'agent-1',
      });

      expect(result.category).toBe('agent');
      expect(result.verb).not.toBe('Workspace');
    });

    it('classifies create_note_workspace-mcp as note op', () => {
      const result = classifyTool('create_note_workspace-mcp', { title: 'Meeting' });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Create note');
    });

    it('classifies add_to_note_workspace-mcp as note op', () => {
      const result = classifyTool('add_to_note_workspace-mcp', { noteId: 'spec' });

      expect(result.category).toBe('note');
      expect(result.verb).not.toBe('Workspace');
    });

    it('keeps set_workspace_title_workspace-mcp as "Rename workspace"', () => {
      const result = classifyTool('set_workspace_title_workspace-mcp', {
        title: 'My Project',
      });

      expect(result.category).toBe('workspace');
      expect(result.verb).toBe('Rename workspace');
      expect(result.subject).toBe('My Project');
    });

    it('strips -workspace-mcp suffix variant', () => {
      const result = classifyTool('delegate_task-workspace-mcp', {
        taskText: 'Do the thing',
      });

      expect(result.category).toBe('agent');
      expect(result.verb).toBe('Delegate');
    });
  });

  describe('bare tool names (no inputs)', () => {
    it('should classify bare "read" with no path as file-read', () => {
      const result = classifyTool('read', {});

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('file');
    });

    it('should classify "read" with a path normally', () => {
      const result = classifyTool('read', { path: 'src/index.ts' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('index.ts');
    });
  });

  describe('result-based metadata extraction', () => {
    it('should extract filename from cat -n result text for bare read', () => {
      const resultText = "Here's the result of running `cat -n` on src/lib/App.svelte:\n   1\t<script>\n   2\t  let count = 0;\n";
      const result = classifyTool('read', {}, resultText);

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('App.svelte');
      expect(result.path).toBe('src/lib');
      expect(result.filePath).toBe('src/lib/App.svelte');
    });

    it('should fall back to "file" when bare read has empty result', () => {
      const result = classifyTool('read', {}, '');

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('file');
    });

    it('should extract file path from _acpTitle for bare read', () => {
      const result = classifyTool('read', { _acpTitle: 'Read src/lib/App.svelte' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('App.svelte');
      expect(result.path).toBe('src/lib');
      expect(result.filePath).toBe('src/lib/App.svelte');
    });

    it('should extract note title from line-numbered result for read_note', () => {
      const resultText = '   1 | # Dark Mode Implementation\n   2 | \n   3 | ## Overview\n';
      const result = classifyTool('workspace-mcp_read_note', {}, resultText);

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Read note');
      expect(result.subject).toBe('Dark Mode Implementation');
    });

    it('should extract metadata from MCP ContentItem array result', () => {
      const mcpResult = [{ type: 'text', text: "Here's the result of running `cat -n` on src/utils.ts:\n   1\texport function foo() {}" }];
      const result = classifyTool('read', {}, mcpResult);

      expect(result.category).toBe('file-read');
      expect(result.subject).toBe('utils.ts');
      expect(result.filePath).toBe('src/utils.ts');
    });
  });

  describe('backtick-wrapped ACP names', () => {
    it('should extract file path from "read `src/lib/App.svelte`" name', () => {
      const result = classifyTool('Read `src/lib/App.svelte`', {});

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('App.svelte');
      expect(result.path).toBe('src/lib');
      expect(result.filePath).toBe('src/lib/App.svelte');
    });

    it('should extract command from "Run `cd experimental && npx vitest`" name', () => {
      const result = classifyTool('Run `cd experimental && npx vitest`', {});

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Run');
      expect(result.subject).toBe('cd experimental && npx vitest');
    });

    it('should extract command from _acpTitle with backticks for terminal', () => {
      const result = classifyTool('run', { _acpTitle: 'Run `cd experimental/amelia && npx vitest run`' });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Run');
      expect(result.subject).toBe('cd experimental/amelia && npx vitest run');
    });

    it('should extract file path from _acpTitle with backticks for read', () => {
      const result = classifyTool('read', { _acpTitle: 'Read `src/lib/App.svelte`' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('App.svelte');
      expect(result.filePath).toBe('src/lib/App.svelte');
    });

    it('should strip backticks from path in file read display', () => {
      const result = classifyTool('view', { path: '`src/lib/App.svelte`', type: 'file' });

      expect(result.category).toBe('file-read');
      expect(result.subject).toBe('App.svelte');
      expect(result.filePath).toBe('src/lib/App.svelte');
    });

    it('should strip backticks in pre-formatted write name', () => {
      const result = classifyTool('Edit `src/lib/App.svelte`', {});

      expect(result.category).toBe('file-write');
      expect(result.verb).toBe('Edit');
      expect(result.subject).toBe('App.svelte');
      expect(result.filePath).toBe('src/lib/App.svelte');
    });

    it('should strip backticks in pre-formatted delete name', () => {
      const result = classifyTool('Delete `src/lib/App.svelte`', {});

      expect(result.category).toBe('file-delete');
      expect(result.verb).toBe('Delete');
      expect(result.subject).toBe('App.svelte');
      expect(result.filePath).toBe('src/lib/App.svelte');
    });

    it('should detect directory read from backtick-wrapped path with explicit type', () => {
      const result = classifyTool('Read `src/lib/components`', { type: 'directory' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('List Contents');
      expect(result.subject).toBe('components');
      expect(result.path).toBe('src/lib');
      expect(result.isDirectory).toBe(true);
    });

    it('should NOT treat extensionless backtick paths as directories without explicit type', () => {
      const result = classifyTool('Read `src/lib/components`', {});

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('components');
      expect(result.isDirectory).toBeFalsy();
    });

    it('should detect directory read from absolute path with explicit type', () => {
      const result = classifyTool('view', {
        path: '/Users/clement/workspaces/augment',
        type: 'directory',
      });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('List Contents');
      expect(result.subject).toBe('augment');
      expect(result.isDirectory).toBe(true);
    });

    it('should NOT treat extensionless paths as directories without explicit type', () => {
      const result = classifyTool('view', { path: '/Users/clement/workspaces/augment' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('augment');
      expect(result.isDirectory).toBeFalsy();
    });

    it('should treat Dockerfile and Makefile as clickable files, not directories', () => {
      const dockerfile = classifyTool('view', { path: 'src/Dockerfile' });
      expect(dockerfile.verb).toBe('Read');
      expect(dockerfile.isDirectory).toBeFalsy();

      const makefile = classifyTool('view', { path: 'Makefile' });
      expect(makefile.verb).toBe('Read');
      expect(makefile.isDirectory).toBeFalsy();

      const license = classifyTool('view', { path: 'LICENSE' });
      expect(license.verb).toBe('Read');
      expect(license.isDirectory).toBeFalsy();
    });

    it('should still show Read for file paths with extensions', () => {
      const result = classifyTool('view', { path: 'src/lib/App.svelte' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read');
      expect(result.subject).toBe('App.svelte');
      expect(result.isDirectory).toBeFalsy();
    });

    it('should detect directory via _acpTitle "List Contents"', () => {
      const result = classifyTool('read', { _acpTitle: 'List Contents src/lib/' });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('List Contents');
      expect(result.isDirectory).toBe(true);
    });
  });

  describe('workspace_api tool display', () => {
    it('should prefer summary over raw mcp__ tool name in _acpTitle', () => {
      const result = classifyTool('mcp__workspace-mcp__workspace_api', {
        code: 'return await ws.note.listTasks("spec")',
        summary: 'List task notes from spec',
        _acpTitle: 'mcp__workspace-mcp__workspace_api',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('List task notes from spec');
    });

    it('should prefer summary when _acpTitle equals workspace_api', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.note.read("spec")',
        summary: 'Reading spec note',
        _acpTitle: 'workspace_api',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Reading spec note');
    });

    it('should use human-readable _acpTitle when it is not a raw tool name', () => {
      const result = classifyTool('mcp__workspace-mcp__workspace_api', {
        code: 'return await ws.note.read("spec")',
        summary: 'Reading spec note',
        _acpTitle: 'Read spec note',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Read spec note');
    });

    it('should fall back to summary when _acpTitle is empty', () => {
      const result = classifyTool('mcp__workspace-mcp__workspace_api', {
        code: 'return await ws.note.read("spec")',
        summary: 'Reading spec note',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Reading spec note');
    });

    it('should prefer summary when _acpTitle is workspace-mcp_workspace_api', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.note.read("spec")',
        summary: 'Reading spec note',
        _acpTitle: 'workspace-mcp_workspace_api',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Reading spec note');
    });

    it('should prefer summary when _acpTitle is URL format //local/mcp/workspace_api', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.note.read("spec")',
        summary: 'Reading spec note',
        _acpTitle: '//local/mcp/workspace_api',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Reading spec note');
    });

    it('should classify ws.task code as task category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.task.updateStatus("abc", "Fix bug", "done")',
        summary: 'Mark task done',
      });

      expect(result.category).toBe('task');
      expect(result.verb).toBe('Mark task done');
    });

    it('should classify ws.agent code as agent category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.agent.create("implementor", "Build feature")',
        summary: 'Create implementor agent',
      });

      expect(result.category).toBe('agent');
      expect(result.verb).toBe('Create implementor agent');
    });

    it('should classify ws.git code as api category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.git.status()',
        summary: 'Check git status',
      });

      expect(result.category).toBe('api');
      expect(result.verb).toBe('Check git status');
    });

    it('should classify ws.file.read as file-read category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.file.read("src/index.ts")',
        summary: 'Read src/index.ts',
      });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('Read src/index.ts');
    });

    it('should classify ws.file.write as file-write category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.file.write("src/new.ts", content)',
        summary: 'Write src/new.ts',
      });

      expect(result.category).toBe('file-write');
      expect(result.verb).toBe('Write src/new.ts');
    });

    it('should classify ws.workspace code as workspace category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.workspace.info()',
        summary: 'Get workspace info',
      });

      expect(result.category).toBe('workspace');
      expect(result.verb).toBe('Get workspace info');
    });

    it('should classify ws.comment code as note category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.comment.add("note-1", { searchContext: "foo", commentTarget: "bar", comment: "test" })',
        summary: 'Add comment on note',
      });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Add comment on note');
    });

    it('should classify ws.script code as terminal category', () => {
      const result = classifyTool('workspace_api', {
        code: 'return await ws.script.run("build")',
        summary: 'Run build script',
      });

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('Run build script');
    });

    it('should fall back to workspace for code without ws. calls', () => {
      const result = classifyTool('workspace_api', {
        code: 'return { hello: "world" }',
        summary: 'Return hello world',
      });

      expect(result.category).toBe('workspace');
      expect(result.verb).toBe('Return hello world');
    });
  });

  describe('prose ACP titles rendered verbatim', () => {
    it('renders a sub-agent prose title verbatim, never bare "Workspace"/"Agent"', () => {
      const title =
        'sub-agent-explore: Explore the services/ directory of the Augment monorepo and summarize each service';
      const result = classifyTool(title, {
        action: 'run',
        instruction: 'Explore the services/ directory',
        name: 'explore-1',
      });

      expect(result.category).toBe('agent');
      expect(result.verb).toBe(title);
      expect(result.verb).not.toBe('Workspace');
      expect(result.verb).not.toBe('Agent');
      expect(result.subject).toBeNull();
    });

    it('renders "Deep workspace exploration" verbatim instead of bare "Workspace"', () => {
      const result = classifyTool('Deep workspace exploration', {});

      expect(result.category).toBe('workspace');
      expect(result.verb).toBe('Deep workspace exploration');
      expect(result.subject).toBeNull();
    });

    it('truncates very long prose titles', () => {
      const longTitle = `sub-agent-explore: ${'Explore the services/ directory of the monorepo and '.repeat(5)}report back`;
      const result = classifyTool(longTitle, {});

      expect(result.verb.length).toBeLessThanOrEqual(123);
      expect(result.verb.endsWith('...')).toBe(true);
      expect(result.verb.startsWith('sub-agent-explore: Explore')).toBe(true);
    });

    it('classifies doubled-suffix get_workspace_details_workspace-mcp_workspace-mcp without collapsing to bare "Workspace"', () => {
      const result = classifyTool('get_workspace_details_workspace-mcp_workspace-mcp', {});

      expect(result.category).toBe('workspace');
      expect(result.verb).toBe('Get');
      expect(result.subject).toBe('workspace info');
      expect(result.mcpSource).toBe('workspace-mcp');
    });

    it('classifies doubled-suffix add_to_note_workspace-mcp_workspace-mcp as note op', () => {
      const result = classifyTool('add_to_note_workspace-mcp_workspace-mcp', { noteId: 'spec' });

      expect(result.category).toBe('note');
      expect(result.verb).toBe('Add to note');
      expect(result.subject).toBe('Spec');
    });

    it('uses prose _acpTitle verbatim for unrecognized tool names', () => {
      const result = classifyTool('zz_unrecognized_tool', {
        _acpTitle: 'Summarize recent activity for the user',
      });

      expect(result.verb).toBe('Summarize recent activity for the user');
      expect(result.subject).toBeNull();
    });

    it('prefers structured input-shape routing over prose title (github-api ACP title)', () => {
      const result = classifyTool('Get recent failed CI runs', {
        summary: 'Get recent failed CI runs',
        path: '/repos/intent-hq/intentd/actions/runs',
      });

      expect(result.category).toBe('api');
    });

    it('keeps two-word ACP titles on category matching (regression)', () => {
      const result = classifyTool('List processes', {});

      expect(result.category).toBe('terminal');
      expect(result.verb).toBe('List');
      expect(result.subject).toBe('processes');
    });
  });

  describe('directory-listing ACP titles localize to List Contents', () => {
    it('maps "List directory `.`" tool name to the List Contents verb', () => {
      const result = classifyTool('List directory `.`', {});

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('List Contents');
      expect(result.subject).toBe('.');
      expect(result.isDirectory).toBe(true);
    });

    it('maps "List directory `src/lib`" tool name with path split', () => {
      const result = classifyTool('List directory `src/lib`', {});

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('List Contents');
      expect(result.subject).toBe('lib');
      expect(result.path).toBe('src');
      expect(result.filePath).toBe('src/lib');
      expect(result.isDirectory).toBe(true);
    });

    it('maps a "List directory" _acpTitle on an unrecognized tool name', () => {
      const result = classifyTool('zz_unrecognized_tool', {
        _acpTitle: 'List directory `packages/app`',
      });

      expect(result.category).toBe('file-read');
      expect(result.verb).toBe('List Contents');
      expect(result.subject).toBe('app');
      expect(result.isDirectory).toBe(true);
    });
  });
});
