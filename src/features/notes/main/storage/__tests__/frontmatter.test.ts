/**
 * Tests for Frontmatter Parser/Serializer
 *
 * Tests edge cases: special chars, malformed input, UTF-8, delimiter handling
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  parseFrontmatter,
  serializeFrontmatter,
  createDefaultFrontmatter,
} from '../frontmatter';
import type { NoteId } from '../../../../../shared/types';

describe('Frontmatter', () => {
  describe('parseFrontmatter', () => {
    it('should parse basic frontmatter', () => {
      const markdown = `---
id: note-1
title: Test Note
tags: [test, example]
---

# Content`;
      const { frontmatter, content } = parseFrontmatter(markdown);
      expect(frontmatter).not.toBeNull();
      expect(frontmatter!.id).toBe('note-1');
      expect(frontmatter!.title).toBe('Test Note');
      expect(frontmatter!.tags).toEqual(['test', 'example']);
      expect(content).toBe('# Content');
    });

    it('should handle content without frontmatter', () => {
      const markdown = '# Just content\n\nNo frontmatter here';
      const { frontmatter, content } = parseFrontmatter(markdown);
      expect(frontmatter).toBeNull();
      expect(content).toBe(markdown);
    });

    it('should handle empty content', () => {
      const { frontmatter, content } = parseFrontmatter('');
      expect(frontmatter).toBeNull();
      expect(content).toBe('');
    });

    it('should handle frontmatter without closing delimiter', () => {
      const markdown = `---
id: note-1
title: Test
# Missing closing delimiter`;
      const { frontmatter, content } = parseFrontmatter(markdown);
      expect(frontmatter).toBeNull();
      expect(content).toBe(markdown);
    });

    it('should handle titles with colons', () => {
      const markdown = `---
id: note-1
title: "My Title: With Colon"
---

Content`;
      const { frontmatter } = parseFrontmatter(markdown);
      expect(frontmatter!.title).toBe('My Title: With Colon');
    });

    it('should handle titles with single quotes', () => {
      const markdown = `---
id: note-1
title: 'Single Quoted Title'
---

Content`;
      const { frontmatter } = parseFrontmatter(markdown);
      expect(frontmatter!.title).toBe('Single Quoted Title');
    });

    it('should handle UTF-8 characters', () => {
      const markdown = `---
id: note-1
title: 日本語タイトル
tags: [日本語, emoji🎉]
---

# こんにちは`;
      const { frontmatter, content } = parseFrontmatter(markdown);
      expect(frontmatter!.title).toBe('日本語タイトル');
      expect(frontmatter!.tags).toContain('日本語');
      expect(content).toBe('# こんにちは');
    });

    it('should handle boolean values', () => {
      const markdown = `---
id: note-1
pinned: true
archived: false
---

Content`;
      const { frontmatter } = parseFrontmatter(markdown);
      expect(frontmatter!.pinned).toBe(true);
      expect(frontmatter!.archived).toBe(false);
    });

    it('should handle null/empty values', () => {
      const markdown = `---
id: note-1
title: null
parent:
---

Content`;
      const { frontmatter } = parseFrontmatter(markdown);
      expect(frontmatter!.title).toBeUndefined();
      expect(frontmatter!.parent).toBeUndefined();
    });

    it('should handle empty arrays', () => {
      const markdown = `---
id: note-1
tags: []
---

Content`;
      const { frontmatter } = parseFrontmatter(markdown);
      expect(frontmatter!.tags).toEqual([]);
    });

    it('should handle content containing --- delimiter', () => {
      const markdown = `---
id: note-1
title: Test
---

# Content with delimiter

---

More content after horizontal rule`;
      const { frontmatter, content } = parseFrontmatter(markdown);
      expect(frontmatter!.id).toBe('note-1');
      expect(content).toContain('---');
      expect(content).toContain('More content after horizontal rule');
    });

    it('should handle YAML comments', () => {
      const markdown = `---
# This is a comment
id: note-1
title: Test
---

Content`;
      const { frontmatter } = parseFrontmatter(markdown);
      expect(frontmatter!.id).toBe('note-1');
    });
  });

  describe('serializeFrontmatter', () => {
    it('should serialize basic frontmatter', () => {
      const frontmatter = {
        id: 'note-1' as NoteId,
        title: 'Test Note',
        tags: ['test', 'example'],
        created: '2024-01-01T00:00:00.000Z',
      };
      const content = '# Content here';
      const result = serializeFrontmatter(frontmatter, content);

      expect(result).toContain('---');
      expect(result).toContain('id: note-1');
      expect(result).toContain('title: Test Note');
      expect(result).toContain('tags: [test, example]');
      expect(result).toContain('# Content here');
    });

    it('should quote titles with special characters', () => {
      const frontmatter = {
        id: 'note-1' as NoteId,
        title: 'Title: With Colon',
      };
      const result = serializeFrontmatter(frontmatter, 'Content');
      expect(result).toContain('"Title: With Colon"');
    });

    it('should handle empty tags', () => {
      const frontmatter = {
        id: 'note-1' as NoteId,
        title: 'Test',
        tags: [],
      };
      const result = serializeFrontmatter(frontmatter, 'Content');
      // Empty arrays should be omitted
      expect(result).not.toContain('tags:');
    });

    it('should skip undefined values', () => {
      const frontmatter = {
        id: 'note-1' as NoteId,
        title: 'Test',
        parent: undefined,
      };
      const result = serializeFrontmatter(frontmatter, 'Content');
      expect(result).not.toContain('parent');
    });
  });

  describe('createDefaultFrontmatter', () => {
    it('should create frontmatter with id and title', () => {
      const fm = createDefaultFrontmatter('note-123' as NoteId, 'My New Note');
      expect(fm.id).toBe('note-123');
      expect(fm.title).toBe('My New Note');
      expect(fm.created).toBeDefined();
    });

    it('should set created timestamp', () => {
      const before = new Date().toISOString();
      const fm = createDefaultFrontmatter('note-1' as NoteId, 'Test');
      const after = new Date().toISOString();

      expect(fm.created).toBeDefined();
      expect(fm.created! >= before).toBe(true);
      expect(fm.created! <= after).toBe(true);
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip basic frontmatter', () => {
      const original = {
        id: 'note-1' as NoteId,
        title: 'Test Note',
        tags: ['a', 'b'],
        pinned: true,
        created: '2024-01-01T00:00:00.000Z',
      };
      const content = '# My Content\n\nSome text here.';

      const serialized = serializeFrontmatter(original, content);
      const { frontmatter, content: parsedContent } = parseFrontmatter(serialized);

      expect(frontmatter!.id).toBe(original.id);
      expect(frontmatter!.title).toBe(original.title);
      expect(frontmatter!.tags).toEqual(original.tags);
      expect(frontmatter!.pinned).toBe(original.pinned);
      expect(parsedContent).toBe(content);
    });

    it('should roundtrip UTF-8 content', () => {
      const original = {
        id: 'note-1' as NoteId,
        title: '日本語タイトル',
      };
      const content = '# 日本語コンテンツ\n\n絵文字: 🎉🚀';

      const serialized = serializeFrontmatter(original, content);
      const { frontmatter, content: parsedContent } = parseFrontmatter(serialized);

      expect(frontmatter!.title).toBe(original.title);
      expect(parsedContent).toBe(content);
    });
  });
});
