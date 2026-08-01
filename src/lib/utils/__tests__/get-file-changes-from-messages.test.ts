import { describe, it, expect } from 'vitest';
import {
  getFileChangesFromMessage,
  getFileChangesFromMessages,
  getFileChangesFromMessageMemoKey,
  getLastTurnAssistantMessages,
  isAggregateFileChangesRedundant,
} from '../get-file-changes-from-messages';
import type { AgentMessage } from '$shared/types';

function makeAssistantMessage(blocks: any[]): AgentMessage {
  return {
    role: 'assistant',
    contentBlocks: blocks,
  } as AgentMessage;
}

function makeUserMessage(): AgentMessage {
  return {
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'do something' }],
  } as AgentMessage;
}

function makeEditBlock(id: string, path: string): any {
  return {
    type: 'tool_use',
    id,
    name: 'str_replace_editor',
    input: { command: 'str_replace', path, old_str: 'old', new_str: 'new' },
  };
}

describe('getFileChangesFromMessage', () => {
  describe('getFileChangesFromMessageMemoKey', () => {
    it('ignores text-only streaming changes', () => {
      const before = makeAssistantMessage([
        { type: 'text', text: 'hello' },
        { type: 'tool_use', id: 'tool-1', name: 'str_replace_editor', input: { path: 'a.ts' } },
      ]);
      const after = makeAssistantMessage([
        { type: 'text', text: 'hello world' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'str_replace_editor',
          input: before.contentBlocks?.[1].input,
        },
      ]);

      expect(getFileChangesFromMessageMemoKey(after)).toBe(
        getFileChangesFromMessageMemoKey(before),
      );
    });

    it('changes when tool blocks or results change', () => {
      const before = makeAssistantMessage([
        { type: 'tool_use', id: 'tool-1', name: 'str_replace_editor', input: { path: 'a.ts' } },
      ]);
      const after = makeAssistantMessage([
        { type: 'tool_use', id: 'tool-1', name: 'str_replace_editor', input: { path: 'a.ts' } },
        { type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'failed' },
      ]);

      expect(getFileChangesFromMessageMemoKey(after)).not.toBe(
        getFileChangesFromMessageMemoKey(before),
      );
    });
  });

  describe('str_replace_editor with command: create', () => {
    it('extracts file creation from str_replace_editor create command', () => {
      const fileContent = 'const x = 1;\nconst y = 2;\nexport { x, y };\n';
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'str_replace_editor',
          input: {
            command: 'create',
            path: 'src/new-file.ts',
            file_text: fileContent,
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);

      expect(result.totalFiles).toBe(1);
      expect(result.changes).toHaveLength(1);

      const change = result.changes[0];
      expect(change.filePath).toBe('src/new-file.ts');
      expect(change.action).toBe('create');
      expect(change.oldContent).toBe('');
      expect(change.newContent).toBe(fileContent);
      expect(change.additions).toBe(4); // 4 lines
      expect(change.deletions).toBe(0);
      expect(change.toolName).toBe('str_replace_editor');
      expect(change.toolCallId).toBe('tool-1');
    });

    it('handles empty file_text in create command (filtered as no-op)', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-2',
          name: 'str_replace_editor',
          input: {
            command: 'create',
            path: 'src/empty.ts',
            file_text: '',
          },
        },
      ]);

      // Empty file creation is filtered out as a no-op (oldContent === newContent === '')
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('counts 0 additions for empty file_text in create command', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-empty-additions',
          name: 'str_replace_editor',
          input: {
            command: 'create',
            path: 'src/empty-additions.ts',
            file_text: '',
          },
        },
      ]);

      // Access the raw changes before no-op filtering by checking totalAdditions
      const result = getFileChangesFromMessage(message);
      // Empty file_text should contribute 0 additions to the total, not 1
      expect(result.totalAdditions).toBe(0);
    });

    it('handles single-line file_text in create command', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-3',
          name: 'str_replace_editor',
          input: {
            command: 'create',
            path: 'src/single-line.ts',
            file_text: 'export default {};',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].action).toBe('create');
      expect(result.changes[0].additions).toBe(1);
      expect(result.changes[0].newContent).toBe('export default {};');
    });

    it('unescapes \\n in file_text content', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-4',
          name: 'str_replace_editor',
          input: {
            command: 'create',
            path: 'src/escaped.ts',
            file_text: 'line1\\nline2\\nline3',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes[0].newContent).toBe('line1\nline2\nline3');
      expect(result.changes[0].additions).toBe(3);
    });
  });

  describe('str_replace_editor with command: str_replace', () => {
    it('still handles str_replace correctly', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-5',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 'src/existing.ts',
            old_str_1: 'old code',
            new_str_1: 'new code',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].action).toBe('modify');
      expect(result.changes[0].oldContent).toBe('old code');
      expect(result.changes[0].newContent).toBe('new code');
    });
  });

  describe('save-file fallback with file_text content field', () => {
    it('extracts file creation from display name "Create foo.swift" with file_text', () => {
      const fileContent = 'import Foundation\n\nclass Foo {\n}\n';
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-ft',
          name: 'Create foo.swift',
          input: {
            file_text: fileContent,
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);

      const change = result.changes[0];
      expect(change.filePath).toBe('foo.swift');
      expect(change.action).toBe('create');
      expect(change.newContent).toBe(fileContent);
      expect(change.toolCallId).toBe('tool-ft');
    });
  });

  describe('non-file tool calls (regression: monorepo#1245)', () => {
    const workspaceApiCode =
      'const tasks = await ws.note.listTasks("spec");\nreturn tasks;\n' +
      'const x = 1;\n'.repeat(28);

    it('ignores a workspace_api call whose title starts with "Create "', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-ws-api',
          name: 'Create follow-up task for AgentMetadata typing and delegate AgentMetadata typing task',
          toolName: 'workspace_api',
          input: {
            code: workspaceApiCode,
            summary: 'Create follow-up task and delegate it',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
      expect(result.totalAdditions).toBe(0);
    });

    it('ignores a workspace_api call identified via metadata.toolName', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-ws-api-meta',
          name: 'Edit spec note with progress update',
          metadata: { toolName: 'workspace_api', toolId: 'tool-ws-api-meta' },
          input: {
            code: 'await ws.note.add("spec", { content: "done" });',
            summary: 'Update spec',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('ignores raw workspace_api name even without a title', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-ws-api-raw',
          name: 'workspace_api',
          input: { code: workspaceApiCode, summary: 'Create task note' },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('rejects sentence-style title-derived paths even without a raw tool name', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-sentence-create',
          name: 'Create follow-up task and delegate the typing work',
          input: { code: workspaceApiCode, summary: 'Create follow-up task' },
        },
        {
          type: 'tool_use',
          id: 'tool-sentence-edit',
          name: 'Edit the config to support new panels',
          input: { old_str: 'old', new_str: 'new' },
        },
        {
          type: 'tool_use',
          id: 'tool-sentence-save',
          name: 'Save the results of the analysis',
          input: { body: 'analysis text' },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('rejects bare-word title-derived paths without extension or separator', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-bare-word',
          name: 'Create Foo',
          input: { file_text: 'content' },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('still extracts genuine file edits from title-derived paths', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-title-edit',
          name: 'Edit src/foo.ts',
          input: { old_str: 'old', new_str: 'new' },
        },
        {
          type: 'tool_use',
          id: 'tool-title-save',
          name: 'Save ThemeToggle.svelte',
          input: { file_content: '<button>toggle</button>' },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(2);
      const editChange = result.changes.find((c) => c.filePath === 'src/foo.ts');
      const saveChange = result.changes.find((c) => c.filePath === 'ThemeToggle.svelte');
      expect(editChange?.action).toBe('modify');
      expect(saveChange?.action).toBe('create');
    });

    it('does not use loose content fallbacks (code/body/text) for title-prefix matches', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-title-loose',
          name: 'Create foo.swift',
          input: { code: 'let x = 1' },
        },
      ]);

      // Path looks valid but content comes from a loose field on a
      // title-matched tool: no content is extracted, so the empty
      // create is filtered as a no-op.
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('still uses loose content fallbacks for raw save_file tools', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-raw-loose',
          name: 'save_file',
          input: { path: 'src/from-code.ts', code: 'const x = 1;\nconst y = 2;' },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].filePath).toBe('src/from-code.ts');
      expect(result.changes[0].newContent).toBe('const x = 1;\nconst y = 2;');
      expect(result.changes[0].additions).toBe(2);
    });
  });

  describe('str_replace_editor with command: insert', () => {
    it('still handles insert correctly', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-6',
          name: 'str_replace_editor',
          input: {
            command: 'insert',
            path: 'src/existing.ts',
            insert_line_1: '5',
            new_str_1: 'inserted line',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].action).toBe('modify');
      expect(result.changes[0].additions).toBe(1);
    });
  });

  describe('non-string tool input values (regression: content.replace is not a function)', () => {
    it('does not throw when flat old_str/new_str are numbers', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-num',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 'src/nums.ts',
            old_str: 42,
            new_str: 43,
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].oldContent).toBe('42');
      expect(result.changes[0].newContent).toBe('43');
    });

    it('does not throw when flat old_str/new_str are booleans', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-bool',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 'src/bools.ts',
            old_str: false,
            new_str: true,
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].oldContent).toBe('false');
      expect(result.changes[0].newContent).toBe('true');
    });

    it('does not throw when flat old_str/new_str are objects or arrays', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-obj',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 'src/objs.ts',
            old_str: { nested: 'value' },
            new_str: ['a', 'b'],
          },
        },
      ]);

      // Objects/arrays render as empty strings; both empty means the change
      // is filtered as a no-op, but nothing should throw.
      expect(() => getFileChangesFromMessage(message)).not.toThrow();
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('does not throw when str_replace_entries contain non-string values', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-nested',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 'src/nested.ts',
            str_replace_entries: [
              { old_str: 1, new_str: { foo: 'bar' } },
              { old_str: 'real old', new_str: 'real new' },
            ],
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].oldContent).toContain('real old');
      expect(result.changes[0].newContent).toContain('real new');
    });

    it('does not throw when insert_entries contain non-string values', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-ins-nested',
          name: 'str_replace_editor',
          input: {
            command: 'insert',
            path: 'src/ins.ts',
            insert_entries: [{ new_str: 7, insert_line: 3 }],
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].newContent).toBe('7');
    });

    it('does not throw when save_file content is a number', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-save-num',
          name: 'save_file',
          input: {
            path: 'src/save-num.ts',
            file_content: 123,
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].newContent).toBe('123');
    });

    it('does not throw when save_file content is an object', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-save-obj',
          name: 'save_file',
          input: {
            path: 'src/save-obj.ts',
            file_text: { some: 'object' },
          },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
    });

    it('does not throw when create command file_text is an object', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-create-obj',
          name: 'str_replace_editor',
          input: {
            command: 'create',
            path: 'src/create-obj.ts',
            file_text: { some: 'object' },
          },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
    });

    it('handles null and undefined string fields without throwing', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-null',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 'src/nulls.ts',
            old_str: null,
            new_str: 'new value',
          },
        },
        {
          type: 'tool_use',
          id: 'tool-create-null',
          name: 'str_replace_editor',
          input: {
            command: 'create',
            path: 'src/create-null.ts',
            file_text: null,
          },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
      const result = getFileChangesFromMessage(message);
      const nullsChange = result.changes.find((c) => c.filePath === 'src/nulls.ts');
      expect(nullsChange?.oldContent).toBe('');
      expect(nullsChange?.newContent).toBe('new value');
    });

    it('does not count empty unescaped content as a changed line', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-empty-counts',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 'src/empty-counts.ts',
            old_str: null,
            new_str: 'new value',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].deletions).toBe(0);
      expect(result.changes[0].additions).toBe(1);
      expect(result.totalDeletions).toBe(0);
      expect(result.totalAdditions).toBe(1);
    });

    it('getFileChangesFromMessages does not throw on non-string inputs', () => {
      const messages = [
        makeAssistantMessage([
          {
            type: 'tool_use',
            id: 'tool-multi-1',
            name: 'str_replace_editor',
            input: {
              command: 'str_replace',
              path: 'src/multi.ts',
              old_str: 10,
              new_str: { bad: 'input' },
            },
          },
        ]),
        makeAssistantMessage([
          {
            type: 'tool_use',
            id: 'tool-multi-2',
            name: 'save_file',
            input: {
              path: 'src/multi-save.ts',
              content: 456,
            },
          },
        ]),
      ];

      expect(() => getFileChangesFromMessages(messages)).not.toThrow();
      const result = getFileChangesFromMessages(messages);
      const saveChange = result.changes.find((c) => c.filePath === 'src/multi-save.ts');
      expect(saveChange?.newContent).toBe('456');
    });
  });

  describe('non-string path-type input values (regression: monorepo#846)', () => {
    it('treats a numeric path on str-replace-editor as missing', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-path-num',
          name: 'str_replace_editor',
          input: {
            command: 'str_replace',
            path: 42,
            old_str: 'old',
            new_str: 'new',
          },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('falls through to file_path when save_file path is an object', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-path-obj',
          name: 'save_file',
          input: {
            path: { bad: 'value' },
            file_path: 'src/fallback.ts',
            file_content: 'content',
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].filePath).toBe('src/fallback.ts');
    });

    it('picks the first string element from a mixed file_paths array', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-paths-mixed',
          name: 'remove_files',
          input: {
            file_paths: [42, 'src/a.ts'],
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].filePath).toBe('src/a.ts');
      expect(result.changes[0].action).toBe('delete');
    });

    it('returns no change when file_paths contains no valid strings', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-paths-invalid',
          name: 'remove_files',
          input: {
            file_paths: [42, { bad: 'value' }, null, '   '],
          },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('falls through to paths when file_paths yields no valid string', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-paths-fallthrough-empty',
          name: 'remove_files',
          input: {
            file_paths: [],
            paths: ['src/b.ts'],
          },
        },
        {
          type: 'tool_use',
          id: 'tool-paths-fallthrough-invalid',
          name: 'remove_files',
          input: {
            file_paths: [42],
            paths: ['src/c.ts'],
          },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(2);
      const bChange = result.changes.find((c) => c.filePath === 'src/b.ts');
      const cChange = result.changes.find((c) => c.filePath === 'src/c.ts');
      expect(bChange?.action).toBe('delete');
      expect(cChange?.action).toBe('delete');
    });

    it('handles a non-array non-string file_paths value without throwing', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-paths-nonarray',
          name: 'remove_files',
          input: {
            file_paths: 42,
          },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('returns no change for tool-name fallbacks with whitespace-only suffix', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-edit-blank',
          name: 'Edit ',
          input: { old_str: 'old', new_str: 'new' },
        },
        {
          type: 'tool_use',
          id: 'tool-save-blank',
          name: 'Save  ',
          input: { file_content: 'content' },
        },
        {
          type: 'tool_use',
          id: 'tool-create-blank',
          name: 'Create ',
          input: { file_text: 'content' },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('returns no change when toolName is not a string', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-name-num',
          name: 42,
          input: { path: 'src/a.ts', old_str: 'old', new_str: 'new' },
        },
      ]);

      expect(() => getFileChangesFromMessage(message)).not.toThrow();
      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(0);
    });

    it('falls back to a string toolName when name is a truthy non-string', () => {
      const message = makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tool-name-fallback',
          name: 42,
          toolName: 'save_file',
          input: { path: 'src/from-tool-name.ts', file_content: 'content' },
        },
      ]);

      const result = getFileChangesFromMessage(message);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].filePath).toBe('src/from-tool-name.ts');
      expect(result.changes[0].toolName).toBe('save_file');
    });
  });
});

describe('getLastTurnAssistantMessages', () => {
  it('returns the trailing assistant messages after the last user message', () => {
    const lastTurnA = makeAssistantMessage([makeEditBlock('tool-3', 'src/c.ts')]);
    const lastTurnB = makeAssistantMessage([makeEditBlock('tool-4', 'src/d.ts')]);
    const messages = [
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-1', 'src/a.ts')]),
      makeUserMessage(),
      lastTurnA,
      lastTurnB,
    ];

    expect(getLastTurnAssistantMessages(messages)).toEqual([lastTurnA, lastTurnB]);
  });

  it('returns all assistant messages when there is no user message', () => {
    const a = makeAssistantMessage([makeEditBlock('tool-1', 'src/a.ts')]);
    const b = makeAssistantMessage([makeEditBlock('tool-2', 'src/b.ts')]);

    expect(getLastTurnAssistantMessages([a, b])).toEqual([a, b]);
  });

  it('returns an empty array when the last message is from the user', () => {
    const messages = [
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-1', 'src/a.ts')]),
      makeUserMessage(),
    ];

    expect(getLastTurnAssistantMessages(messages)).toEqual([]);
  });
});

describe('isAggregateFileChangesRedundant', () => {
  it('is redundant when the aggregate file set equals the last turn file set', () => {
    const messages = [
      makeUserMessage(),
      makeAssistantMessage([]),
      makeUserMessage(),
      makeAssistantMessage([
        makeEditBlock('tool-1', 'src/a.ts'),
        makeEditBlock('tool-2', 'src/b.ts'),
      ]),
    ];

    expect(isAggregateFileChangesRedundant(messages)).toBe(true);
  });

  it('is redundant when prior turns touched the same files as the last turn', () => {
    const messages = [
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-1', 'src/a.ts')]),
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-2', 'src/a.ts')]),
    ];

    expect(isAggregateFileChangesRedundant(messages)).toBe(true);
  });

  it('unions changes across multiple assistant messages in the last turn', () => {
    const messages = [
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-1', 'src/a.ts')]),
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-2', 'src/a.ts')]),
      makeAssistantMessage([makeEditBlock('tool-3', 'src/b.ts')]),
    ];

    expect(isAggregateFileChangesRedundant(messages)).toBe(true);
  });

  it('is not redundant when a prior turn touched an extra file', () => {
    const messages = [
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-1', 'src/extra.ts')]),
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-2', 'src/a.ts')]),
    ];

    expect(isAggregateFileChangesRedundant(messages)).toBe(false);
  });

  it('does not affect per-turn extraction for the last assistant message', () => {
    const lastAssistant = makeAssistantMessage([makeEditBlock('tool-2', 'src/a.ts')]);
    const messages = [
      makeUserMessage(),
      makeAssistantMessage([makeEditBlock('tool-1', 'src/a.ts')]),
      makeUserMessage(),
      lastAssistant,
    ];

    expect(isAggregateFileChangesRedundant(messages)).toBe(true);

    const perTurn = getFileChangesFromMessage(lastAssistant);
    expect(perTurn.totalFiles).toBe(1);
    expect(perTurn.changes[0].filePath).toBe('src/a.ts');
  });
});
