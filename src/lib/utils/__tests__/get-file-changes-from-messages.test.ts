import { describe, it, expect } from 'vitest';
import { getFileChangesFromMessage } from '../get-file-changes-from-messages';
import type { AgentMessage } from '$shared/types';

function makeAssistantMessage(blocks: any[]): AgentMessage {
  return {
    role: 'assistant',
    contentBlocks: blocks,
  } as AgentMessage;
}

describe('getFileChangesFromMessage', () => {
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
});

