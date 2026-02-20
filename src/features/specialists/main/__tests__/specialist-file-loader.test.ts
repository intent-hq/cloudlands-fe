/**
 * Specialist File Loader Unit Tests
 *
 * Tests for edge cases in specialist file parsing, including:
 * - Empty files/content
 * - Malformed YAML frontmatter
 * - Missing required fields
 * - Invalid field values
 * - Unicode and special characters
 * - YAML block scalars (| and >)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSpecialistFile } from '../specialist-file-loader';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-augment',
    isPackaged: false,
  },
}));

describe('parseSpecialistFile', () => {
  describe('Valid files', () => {
    it('should parse a valid specialist file', () => {
      const content = `---
name: "Test Specialist"
description: "A test specialist"
modelTier: "fast"
---

You are a test specialist.`;

      const result = parseSpecialistFile('/path/to/test-specialist.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('test-specialist');
        expect(result.frontmatter.name).toBe('Test Specialist');
        expect(result.frontmatter.description).toBe('A test specialist');
        expect(result.frontmatter.modelTier).toBe('fast');
        expect(result.behaviorPrompt).toBe('You are a test specialist.');
      }
    });

    it('should handle empty body', () => {
      const content = `---
name: "Empty Body"
description: "A specialist with no body"
---
`;

      const result = parseSpecialistFile('/path/to/empty-body.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.behaviorPrompt).toBe('');
      }
    });

    it('should parse unquoted string values', () => {
      const content = `---
name: Unquoted Name
description: Unquoted description
---

Body content`;

      const result = parseSpecialistFile('/path/to/unquoted.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Unquoted Name');
      }
    });
  });

  describe('Missing required fields', () => {
    it('should error on missing name', () => {
      const content = `---
description: "A specialist"
---

Body`;

      const result = parseSpecialistFile('/path/to/missing-name.md', content);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('Missing required field: name');
      }
    });

    it('should error on missing description', () => {
      const content = `---
name: "Test"
---

Body`;

      const result = parseSpecialistFile('/path/to/missing-desc.md', content);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('Missing required field: description');
      }
    });
  });

  describe('Invalid modelTier', () => {
    it('should error on invalid modelTier', () => {
      const content = `---
name: "Test"
description: "A test"
modelTier: "invalid"
---

Body`;

      const result = parseSpecialistFile('/path/to/invalid-tier.md', content);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('Invalid modelTier');
      }
    });

    it('should accept valid modelTier values', () => {
      for (const tier of ['fast', 'balanced', 'smart']) {
        const content = `---
name: "Test"
description: "A test"
modelTier: "${tier}"
---

Body`;

        const result = parseSpecialistFile(`/path/to/${tier}.md`, content);
        expect('error' in result).toBe(false);
      }
    });
  });

  describe('Malformed frontmatter', () => {
    it('should error on no frontmatter', () => {
      const content = `Just some content without frontmatter`;

      const result = parseSpecialistFile('/path/to/no-fm.md', content);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('No valid YAML frontmatter found');
      }
    });

    it('should error on missing closing ---', () => {
      const content = `---
name: "Test"
description: "A test"

Body content`;

      const result = parseSpecialistFile('/path/to/no-close.md', content);
      expect('error' in result).toBe(true);
    });

    it('should error on empty file', () => {
      const result = parseSpecialistFile('/path/to/empty.md', '');
      expect('error' in result).toBe(true);
    });

    it('should error on only opening ---', () => {
      const content = `---`;

      const result = parseSpecialistFile('/path/to/only-open.md', content);
      expect('error' in result).toBe(true);
    });
  });

  describe('Unicode and special characters', () => {
    it('should handle unicode in name', () => {
      const content = `---
name: "测试 Specialist 🚀"
description: "A test with unicode"
---

Body`;

      const result = parseSpecialistFile('/path/to/unicode.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('测试 Specialist 🚀');
      }
    });

    it('should handle colons in values', () => {
      const content = `---
name: "Test: With Colon"
description: "Description: has colons: everywhere"
---

Body`;

      const result = parseSpecialistFile('/path/to/colons.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Test: With Colon');
      }
    });
  });

  describe('YAML block scalars', () => {
    it('should handle literal block scalar (|)', () => {
      const content = `---
name: "Test"
description: "A test"
roleReminder: |
  Line 1
  Line 2
  Line 3
---

Body`;

      const result = parseSpecialistFile('/path/to/literal.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.roleReminder).toContain('Line 1');
        expect(result.frontmatter.roleReminder).toContain('Line 2');
      }
    });
  });

  describe('Windows line endings', () => {
    it('should handle CRLF line endings', () => {
      const content = "---\r\nname: \"Test\"\r\ndescription: \"A test\"\r\n---\r\n\r\nBody content";

      const result = parseSpecialistFile('/path/to/crlf.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.name).toBe('Test');
        expect(result.behaviorPrompt).toBe('Body content');
      }
    });
  });

  describe('ID extraction from filename', () => {
    it('should extract ID from simple filename', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/my-specialist.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('my-specialist');
      }
    });

    it('should handle nested paths', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/deep/nested/path/specialist-name.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBe('specialist-name');
      }
    });
  });

  describe('Large files', () => {
    it('should handle large body content', () => {
      const largeBody = 'X'.repeat(100000); // 100KB of content
      const content = `---
name: "Large Specialist"
description: "A specialist with large body"
---

${largeBody}`;

      const result = parseSpecialistFile('/path/to/large.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.behaviorPrompt.length).toBeGreaterThan(90000);
      }
    });

    it('should handle large roleReminder using block scalar', () => {
      const largeReminder = 'Never do X. '.repeat(1000);
      const content = `---
name: "Test"
description: "A test"
roleReminder: |
  ${largeReminder}
---

Body`;

      const result = parseSpecialistFile('/path/to/large-reminder.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.frontmatter.roleReminder).toBeDefined();
        expect(result.frontmatter.roleReminder!.length).toBeGreaterThan(5000);
      }
    });
  });

  describe('Source parameter', () => {
    it('should set source to file by default', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/test.md', content);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.source).toBe('file');
      }
    });

    it('should respect bundled source', () => {
      const content = `---
name: "Test"
description: "A test"
---

Body`;

      const result = parseSpecialistFile('/path/to/test.md', content, 'bundled');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.source).toBe('bundled');
      }
    });
  });
});
