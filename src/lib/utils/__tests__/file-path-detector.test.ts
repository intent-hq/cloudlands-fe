import { describe, it, expect } from 'vitest';
import { isFilePath, extractFilePath } from '../file-path-detector';

describe('file-path-detector', () => {
  describe('isFilePath', () => {
    it('should detect simple file paths', () => {
      expect(isFilePath('src/components/Button.tsx')).toBe(true);
      expect(isFilePath('package.json')).toBe(true);
      expect(isFilePath('README.md')).toBe(true);
    });

    it('should detect relative paths', () => {
      expect(isFilePath('./src/index.ts')).toBe(true);
      expect(isFilePath('../parent/file.js')).toBe(true);
    });

    it('should detect absolute paths', () => {
      expect(isFilePath('/absolute/path/file.py')).toBe(true);
    });

    it('should detect deeply nested paths', () => {
      expect(isFilePath('typescript/apps/app/app/lib/agents/prompts/query.ts')).toBe(true);
    });

    it('should detect paths with underscores and hyphens', () => {
      expect(isFilePath('src/my_module/some-file.tsx')).toBe(true);
      expect(isFilePath('components/Button-Primary.svelte')).toBe(true);
    });

    it('should reject URLs', () => {
      expect(isFilePath('https://example.com')).toBe(false);
      expect(isFilePath('http://localhost:3000')).toBe(false);
      expect(isFilePath('ftp://files.example.com')).toBe(false);
    });

    it('should reject other non-file patterns', () => {
      expect(isFilePath('mailto:test@example.com')).toBe(false);
      expect(isFilePath('#anchor-link')).toBe(false);
      expect(isFilePath('$VARIABLE')).toBe(false);
    });

    it('should reject short strings', () => {
      expect(isFilePath('a')).toBe(false);
      expect(isFilePath('ab')).toBe(false);
    });

    it('should reject strings without valid extensions', () => {
      expect(isFilePath('src/file.xyz')).toBe(false);
      expect(isFilePath('just-text')).toBe(false);
    });
  });

  describe('extractFilePath', () => {
    it('should extract file paths with File: prefix', () => {
      expect(extractFilePath('File: src/components/Button.tsx')).toBe('src/components/Button.tsx');
      expect(extractFilePath('File:path/to/file.ts')).toBe('path/to/file.ts');
    });

    it('should extract file paths without prefix', () => {
      expect(extractFilePath('src/components/Button.tsx')).toBe('src/components/Button.tsx');
    });

    it('should return null for non-file-paths', () => {
      expect(extractFilePath('hello world')).toBe(null);
      expect(extractFilePath('https://example.com')).toBe(null);
    });

    it('should handle the screenshot example', () => {
      expect(extractFilePath('typescript/apps/app/app/lib/agents/prompts/query.ts')).toBe(
        'typescript/apps/app/app/lib/agents/prompts/query.ts',
      );
    });
  });
});
