import { describe, it, expect } from 'vitest';
import {
  getFileChangesFromMessage,
  getFileChangesFromMessages,
  getFileChangesFromMessageMemoKey,
} from '../get-file-changes-from-messages';
import type { AgentMessage } from '$shared/types';

function makeAssistantMessage(blocks: any[]): AgentMessage {
  return {
    role: 'assistant',
    contentBlocks: blocks,
  } as AgentMessage;
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
  });
});
