/**
 * Tests for NotesPrimitivesSerializer
 *
 * These tests verify the parsing and validation of note primitives,
 * including diagram blocks with non-UUID IDs.
 */
import { describe, it, expect } from 'vitest';
import { NotesPrimitivesSerializer } from '../../src/features/notes/notes-primitives-serializer';
import { NotePrimitiveSchema } from '../../src/shared/types/notes-primitives';

describe('NotesPrimitivesSerializer', () => {
  const serializer = new NotesPrimitivesSerializer();

  describe('parseMarkdown', () => {
    it('should normalize non-UUID diagram IDs to valid UUIDs', () => {
      const markdown = `# Test

\`\`\`diagram
{
  "id": "dark-mode-architecture",
  "type": "diagram",
  "version": 1,
  "createdAt": "2026-01-20T00:00:00Z",
  "createdBy": "agent",
  "grammar": "architecture",
  "model": {
    "nodes": [
      {"id": "user", "label": "User", "kind": "actor"},
      {"id": "toggle", "label": "ThemeToggle", "kind": "component"}
    ],
    "edges": [
      {"id": "e1", "from": "user", "to": "toggle", "label": "clicks"}
    ]
  },
  "baseView": {
    "layout": {"type": "layered", "direction": "LR", "spacing": 100}
  }
}
\`\`\`

Some text after.
`;

      // Parse with validation enabled
      const primitives = serializer.parseMarkdown(markdown, { validateSchema: true });

      // Should find exactly one primitive
      expect(primitives.length).toBe(1);

      const primitive = primitives[0].primitive;

      // ID should be a valid UUID now (normalized from "dark-mode-architecture")
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(primitive.id).toMatch(uuidRegex);

      // Type should be diagram
      expect(primitive.type).toBe('diagram');

      // Should pass schema validation
      const validationResult = NotePrimitiveSchema.safeParse(primitive);
      expect(validationResult.success).toBe(true);
    });

    it('should preserve valid UUID IDs', () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const markdown = `\`\`\`diagram
{
  "id": "${validUuid}",
  "type": "diagram",
  "version": 1,
  "createdAt": "2026-01-20T00:00:00Z",
  "createdBy": "agent",
  "grammar": "architecture",
  "model": {"nodes": [], "edges": []},
  "baseView": {"layout": {"type": "layered", "direction": "TB"}}
}
\`\`\``;

      const primitives = serializer.parseMarkdown(markdown, { validateSchema: true });

      expect(primitives.length).toBe(1);
      expect(primitives[0].primitive.id).toBe(validUuid);
    });

    it('should handle missing IDs by generating new UUIDs', () => {
      const markdown = `\`\`\`diagram
{
  "type": "diagram",
  "version": 1,
  "createdAt": "2026-01-20T00:00:00Z",
  "createdBy": "agent",
  "grammar": "architecture",
  "model": {"nodes": [], "edges": []},
  "baseView": {"layout": {"type": "layered", "direction": "TB"}}
}
\`\`\``;

      const primitives = serializer.parseMarkdown(markdown, { validateSchema: true });

      expect(primitives.length).toBe(1);

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(primitives[0].primitive.id).toMatch(uuidRegex);
    });

    it('should normalize ws-block primitive IDs as well', () => {
      const markdown = `\`\`\`ws-block
{
  "id": "my-custom-reference",
  "type": "reference",
  "version": 1,
  "createdAt": "2026-01-20T00:00:00Z",
  "createdBy": "agent",
  "target": {"kind": "symbol", "semanticId": "src/lib/test.ts#myFunction"}
}
\`\`\``;

      const primitives = serializer.parseMarkdown(markdown, { validateSchema: true });

      expect(primitives.length).toBe(1);

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(primitives[0].primitive.id).toMatch(uuidRegex);
    });

    it('should infer type from fence suffix (ws-block:reference)', () => {
      const markdown = `\`\`\`ws-block:reference
{"target":{"filePath":"src/file.ts","range":{"startLine":22,"endLine":22}}}
\`\`\``;

      const primitives = serializer.parseMarkdown(markdown, { validateSchema: true });

      expect(primitives.length).toBe(1);
      expect(primitives[0].primitive.type).toBe('reference');
    });

    it('should normalize simplified target format (path -> filePath, startLine/endLine -> range)', () => {
      const markdown = `\`\`\`ws-block:reference
{"target":{"path":"src/file.ts","startLine":10,"endLine":20}}
\`\`\``;

      const primitives = serializer.parseMarkdown(markdown, { validateSchema: true });

      expect(primitives.length).toBe(1);
      const primitive = primitives[0].primitive;
      expect(primitive.type).toBe('reference');

      // Check that target was normalized
      if (primitive.type === 'reference') {
        expect(primitive.target.filePath).toBe('src/file.ts');
        expect(primitive.target.range).toEqual({ startLine: 10, endLine: 20 });
        expect(primitive.target.kind).toBe('file_range');
        // path, startLine, endLine should be removed
        expect((primitive.target as Record<string, unknown>).path).toBeUndefined();
        expect((primitive.target as Record<string, unknown>).startLine).toBeUndefined();
        expect((primitive.target as Record<string, unknown>).endLine).toBeUndefined();
      }
    });

    it('should normalize line-range kind to file_range', () => {
      const markdown = `\`\`\`ws-block:reference
{"target":{"kind":"line-range","filePath":"src/file.ts","range":{"startLine":1,"endLine":5}}}
\`\`\``;

      const primitives = serializer.parseMarkdown(markdown, { validateSchema: true });

      expect(primitives.length).toBe(1);
      const primitive = primitives[0].primitive;
      expect(primitive.type).toBe('reference');

      if (primitive.type === 'reference') {
        expect(primitive.target.kind).toBe('file_range');
      }
    });
  });
});
